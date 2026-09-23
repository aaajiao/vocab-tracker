import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Word, SavedSentence } from '../types';
const api = vi.hoisted(() => vi.fn());
vi.mock('./learningApi', async original => ({ ...await original<typeof import('./learningApi')>(), learningRequest: api }));
vi.mock('../supabaseClient', () => ({ supabase: {} }));
import { LearningApiError } from './learningApi';
import { syncPendingOperations, getPendingCount } from './syncQueue';
import { addPendingWord, getAllCachedWords, setCachedWords, markWordDeleted } from './wordsCache';
import { addPendingSentence } from './sentencesCache';
import { getMaterialOperations, readLegacyMaterialData, discardLegacyMaterialData } from './materialStore';
import { getMaterialSyncStatus, exportMaterialRecovery } from './materialQueue';
import { enqueueReviewEvent, getReviewEvents } from './reviewEventQueue';
import { upsert as saveReviewState, get as getReviewState } from './reviewCache';
const word = (): Word => ({ id: crypto.randomUUID(), word: 'Haus', meaning: '房子', language: 'de', example: '', exampleCn: '', category: '', date: '2026-09-23', timestamp: Date.now() });
const sentence = (): SavedSentence => ({ id: crypto.randomUUID(), sentence: 'Ich lerne.', sentence_cn: '我在学习。', language: 'de', scene: null, source_type: 'input', source_words: [], keywords: [{ word: 'lernen', meaning: '学习' }], grammar: [{ point: '动词', explanation: '位置' }], created_at: '2026-09-23T10:00:00Z' });
function accepted(body: Record<string, unknown>) { return { data: { ...body, created_at: body.created_at || new Date().toISOString() } }; }
beforeEach(() => { api.mockReset(); });

describe('稳定账号归属、FIFO与幂等材料同步', () => {
    it('A的词句队列不能被B同步、计数或导出', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(); await addPendingWord(word(), a); await addPendingSentence(sentence(), a);
        expect(await getPendingCount(b)).toBe(0); expect(await getPendingCount()).toBe(0);
        expect((await syncPendingOperations(b)).synced).toBe(0); expect(api).not.toHaveBeenCalled();
        expect((await exportMaterialRecovery(b) as { operations: unknown[] }).operations).toEqual([]);
        api.mockImplementation(async (_path, options) => accepted(options.body));
        expect((await syncPendingOperations(a)).synced).toBe(2);
        expect(api.mock.calls.every(call => call[1].userId === a)).toBe(true);
        expect(await getMaterialOperations(a)).toEqual([]);
    });
    it('提交成功但丢失回执：第二次使用同一UUID和正文，只创建一份云端记录', async () => {
        const owner = crypto.randomUUID(), value = word(); await addPendingWord(value, owner);
        const remote = new Map<string, Record<string, unknown>>(); let dropped = false;
        api.mockImplementation(async (_path, options) => {
            const body = options.body as Record<string, unknown>; remote.set(String(body.id), body);
            if (!dropped) { dropped = true; throw new LearningApiError('network_error', '连接中断'); }
            return accepted(body);
        });
        expect((await syncPendingOperations(owner)).failed).toBe(1); expect(await getPendingCount(owner)).toBe(1);
        expect((await syncPendingOperations(owner)).synced).toBe(1); expect(remote.size).toBe(1);
        expect(api.mock.calls[0][1].body).toEqual(api.mock.calls[1][1].body);
        expect(api.mock.calls[1][1].body.id).toBe(value.id);
        expect((await getAllCachedWords(owner))[0].id).toBe(value.id);
    });
    it('超过5次临时失败仍可恢复且始终可见，永久失败只能明确重试', async () => {
        const owner = crypto.randomUUID(); await addPendingWord(word(), owner);
        api.mockRejectedValue(new LearningApiError('unavailable', '临时不可用', 503));
        for (let i = 0; i < 7; i++) await syncPendingOperations(owner);
        expect(await getMaterialSyncStatus(owner)).toMatchObject({ pending: 1, failed: 0 }); expect(await getPendingCount(owner)).toBe(1);
        api.mockRejectedValue(new LearningApiError('conflict', '冲突', 409)); await syncPendingOperations(owner);
        expect(await getMaterialSyncStatus(owner)).toMatchObject({ pending: 0, failed: 1 }); expect(await getPendingCount(owner)).toBe(1);
        api.mockClear(); await syncPendingOperations(owner); expect(api).not.toHaveBeenCalled();
        api.mockImplementation(async (_path, options) => accepted(options.body));
        expect((await syncPendingOperations(owner, { retryFailed: true })).synced).toBe(1); expect(await getPendingCount(owner)).toBe(0);
    });
    it('网络未确定时阻塞FIFO，且请求有时间界限', async () => {
        const owner = crypto.randomUUID(); await addPendingWord(word(), owner); await addPendingSentence(sentence(), owner);
        api.mockRejectedValue(new LearningApiError('network_error', '断网'));
        await syncPendingOperations(owner); expect(api).toHaveBeenCalledTimes(1);
        expect(api.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); expect(await getPendingCount(owner)).toBe(2);
    });
    it('并发同步复用一次发送，完整保留句子分析信息', async () => {
        const owner = crypto.randomUUID(), value = sentence(); await addPendingSentence(value, owner);
        api.mockImplementation(async (_path, options) => accepted(options.body));
        const [a, b] = await Promise.all([syncPendingOperations(owner), syncPendingOperations(owner)]);
        expect(a.synced).toBe(1); expect(b.synced).toBe(1); expect(api).toHaveBeenCalledTimes(1);
        expect(api.mock.calls[0][1].body).toMatchObject({ source_type: 'input', keywords: value.keywords, grammar: value.grammar, created_at: value.created_at });
    });
    it('保留旧无归属库供导出，绝不作为当前用户队列发送', async () => {
        const opened = indexedDB.open('vocab-tracker-words-cache', 1);
        const legacy = await new Promise<IDBDatabase>((resolve, reject) => { opened.onupgradeneeded = () => { opened.result.createObjectStore('words', { keyPath: 'id' }); opened.result.createObjectStore('pending_operations', { keyPath: 'id' }); }; opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
        const tx = legacy.transaction(['words', 'pending_operations'], 'readwrite');
        tx.objectStore('words').put(word()); tx.objectStore('pending_operations').put({ id: 'old-add', data: word() });
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); legacy.close();
        const owner = crypto.randomUUID(); await syncPendingOperations(owner); expect(api).not.toHaveBeenCalled();
        expect(await getAllCachedWords(owner)).toEqual([]); expect((await readLegacyMaterialData()).words).toHaveLength(1);
        expect((await exportMaterialRecovery(owner) as { unknown_owner_legacy: { words: unknown[] } }).unknown_owner_legacy.words).toHaveLength(1);
        await discardLegacyMaterialData();
    });
    it('原有复习事件仍按账号提交，不被词句改造覆盖', async () => {
        const owner = crypto.randomUUID(), other = crypto.randomUUID();
        const event = { id: crypto.randomUUID(), word_id: crypto.randomUUID(), grade: 'known' as const, source: 'web' as const, practiced_at: '2026-09-23T10:00:00Z', timezone: 'UTC' };
        await enqueueReviewEvent(owner, event); await enqueueReviewEvent(other, { ...event, id: crypto.randomUUID() });
        api.mockResolvedValue({ data: { event, state: { word_id: event.word_id, due: '2026-09-26', interval_days: 3, ease: 2.5, reps: 1, lapses: 0, last_reviewed_at: event.practiced_at, updated_at: event.practiced_at }, replayed: false } });
        expect((await syncPendingOperations(owner)).synced).toBe(1); expect(await getReviewEvents(owner)).toEqual([]); expect(await getReviewEvents(other)).toHaveLength(1);
    });
    it('删除尚未确认时保留复习作答，云端确认后才清理对应状态与队列', async () => {
        const owner = crypto.randomUUID(), value = word(); await setCachedWords([value], owner);
        await saveReviewState({ wordId: value.id, due: '2000-01-01', intervalDays: 3, ease: 2.5, reps: 1, lapses: 0, lastReviewedAt: null, updatedAt: '2000-01-01T00:00:00Z' }, 'synced', owner);
        const event = { id: crypto.randomUUID(), word_id: value.id, grade: 'known' as const, source: 'web' as const, practiced_at: '2026-09-23T10:00:00Z', timezone: 'UTC' };
        await enqueueReviewEvent(owner, event); await markWordDeleted(value.id, owner);
        api.mockRejectedValue(new LearningApiError('network_error', '断网'));
        const { syncMaterialOperations } = await import('./materialQueue'); await syncMaterialOperations(owner);
        expect((await getReviewEvents(owner))[0].event.id).toBe(event.id); expect(await getReviewState(value.id, owner)).toBeDefined();
        api.mockResolvedValue({ data: { deleted: true } }); await syncMaterialOperations(owner);
        expect(await getReviewEvents(owner)).toEqual([]); expect(await getReviewState(value.id, owner)).toBeUndefined();
    });
});
