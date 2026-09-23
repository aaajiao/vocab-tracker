import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Word, SavedSentence, SentenceInput } from '../types';
import { useWords } from './useWords';
import { useSentences } from './useSentences';
import { useReview } from './useReview';
import { upsert as saveReviewState, get as getReviewState } from '../services/reviewCache';
import { getReviewEvents } from '../services/reviewEventQueue';
import { addPendingWord, setCachedWords, getAllCachedWords, markWordDeleted } from '../services/wordsCache';
import { addPendingSentence, setCachedSentences, markSentenceDeleted } from '../services/sentencesCache';
import { claimMaterial, getMaterialOperations } from '../services/materialStore';
import { syncMaterialOperations } from '../services/materialQueue';
import { LearningApiError } from '../services/learningApi';
const request = vi.hoisted(() => vi.fn());
vi.mock('../services/learningApi', async original => ({ ...await original<typeof import('../services/learningApi')>(), learningRequest: request }));
vi.mock('../supabaseClient', () => ({ supabase: {} }));
const newWord = { word: 'Haus', meaning: '房子', language: 'de' as const, example: 'Das Haus.', exampleCn: '房子。', category: '' as const, date: '2026-09-23', etymology: '词源' };
const existingWord = (): Word => ({ ...newWord, id: crypto.randomUUID(), timestamp: 1 });
const input: SentenceInput = { sentence: 'Ich suche ein Haus.', sentenceCn: '我在找房子。', language: 'de', scene: '租房', sourceType: 'input', sourceWords: ['Haus'], keywords: [{ word: 'Haus', meaning: '房子' }], grammar: [{ point: '冠词', explanation: '不定冠词' }] };
const existingSentence = (): SavedSentence => ({ id: crypto.randomUUID(), sentence: input.sentence, sentence_cn: input.sentenceCn, language: 'de', scene: input.scene, source_type: 'input', source_words: input.sourceWords, keywords: input.keywords, grammar: input.grammar, created_at: '2026-09-23T10:00:00Z' });
const wordRow = (word: Word) => ({ ...word, example_cn: word.exampleCn, created_at: new Date(word.timestamp).toISOString() });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let root: Root, container: HTMLDivElement, words: ReturnType<typeof useWords>, sentences: ReturnType<typeof useSentences>;
function Probe({ owner, online = true }: { owner: string; online?: boolean }) { words = useWords({ userId: owner, isOnline: online }); sentences = useSentences({ userId: owner, isOnline: online }); return <span>{words.words.map(item => item.word).join('|')} {sentences.savedSentences.map(item => item.sentence).join('|')}</span>; }
async function settle(check: () => boolean = () => !words.loading) {
    for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(done => setTimeout(done, 2)); }); if (check()) return; }
    throw new Error('材料 hook 没有完成');
}
async function render(owner: string, online = true) { await act(async () => root.render(<Probe owner={owner} online={online} />)); await settle(); }
async function remount(owner: string) { await act(async () => root.unmount()); root = createRoot(container); await render(owner); }
beforeEach(() => {
    request.mockReset(); request.mockImplementation(async (_path, options) => options?.method ? { data: { ...options.body, created_at: options.body?.created_at || new Date().toISOString() } } : { data: [], meta: { has_more: false } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('词句 hook 的账号与持久化边界', () => {
    it('换账号第一帧即隐藏上个账号的词句，离线也不读取旧账号缓存', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(); await setCachedWords([existingWord()], a); await setCachedSentences([existingSentence()], a);
        await render(a, false); await settle(() => sentences.savedSentences.length === 1); expect(words.words).toHaveLength(1);
        await act(async () => root.render(<Probe owner={b} online={false} />));
        expect(words.words).toEqual([]); expect(sentences.savedSentences).toEqual([]); expect(container.textContent).not.toContain('Haus');
        await settle(); expect(words.words).toEqual([]);
    });
    it('账号A迟到的云端响应不会覆盖B，也不会写到B缓存', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(), slow = deferred<unknown>();
        request.mockImplementation(async (path, options) => options.userId === a && path.startsWith('/words') ? slow.promise : { data: [], meta: {} });
        await act(async () => root.render(<Probe owner={a} />)); await settle(() => request.mock.calls.some(call => call[1].userId === a));
        await render(b); await act(async () => slow.resolve({ data: [wordRow(existingWord())], meta: {} }));
        expect(words.words).toEqual([]); expect(await getAllCachedWords(b)).toEqual([]);
    });
    it('联网刷新保留待新增句子，并继续隐藏待删除的词', async () => {
        const owner = crypto.randomUUID(), word = existingWord(); await setCachedWords([word], owner); await markWordDeleted(word.id, owner); await addPendingSentence(existingSentence(), owner);
        request.mockImplementation(async path => ({ data: path.startsWith('/words') ? [wordRow(word)] : [], meta: {} }));
        await render(owner, false); await settle(() => sentences.savedSentences.length === 1); await render(owner);
        expect(words.words).toEqual([]); expect(sentences.savedSentences).toHaveLength(1);
    });
    it('单词在线失败返回false；重新挂载后重试仍复用磁盘中的原UUID', async () => {
        const owner = crypto.randomUUID(); await render(owner); let fail = true;
        request.mockImplementation(async (_path, options) => {
            if (!options.method) return { data: [], meta: {} };
            if (fail) throw new LearningApiError('network_error', '断网');
            return { data: { ...options.body, created_at: new Date().toISOString() } };
        });
        let ok = true; await act(async () => { ok = await words.addWord(newWord); }); expect(ok).toBe(false);
        const pending = (await getMaterialOperations(owner))[0]; expect(words.pendingWordIds.has(pending.record_id)).toBe(true);
        await remount(owner); fail = false;
        await act(async () => { ok = await words.addWord(newWord); }); expect(ok).toBe(true);
        const writes = request.mock.calls.filter(call => call[1].method === 'POST'); expect(writes).toHaveLength(2);
        expect(writes[0][1].body).toEqual(writes[1][1].body); expect(writes[1][1].body.id).toBe(pending.id);
        expect(words.pendingWordIds.size).toBe(0);
    });
    it('句子失败后重试保持UUID、created_at和全部分析字段', async () => {
        const owner = crypto.randomUUID(); await render(owner); let fail = true;
        request.mockImplementation(async (_path, options) => { if (!options.method) return { data: [], meta: {} }; if (fail) throw new LearningApiError('unavailable', '稍后', 503); return { data: options.body }; });
        let ok = true; await act(async () => { ok = await sentences.saveSentence(input); }); expect(ok).toBe(false);
        await remount(owner); fail = false; await act(async () => { ok = await sentences.saveSentence(input); }); expect(ok).toBe(true);
        const writes = request.mock.calls.filter(call => call[1].method === 'POST'); expect(writes[0][1].body).toEqual(writes[1][1].body);
        expect(writes[1][1].body).toMatchObject({ source_type: 'input', keywords: input.keywords, grammar: input.grammar });
    });
    it('离线接受后重复点击不生成额外词句队列', async () => {
        const owner = crypto.randomUUID(); await render(owner, false);
        await act(async () => { expect(await Promise.all([words.addWord(newWord), words.addWord(newWord), sentences.saveSentence(input), sentences.saveSentence(input)])).toEqual([true, true, true, true]); });
        expect(await getMaterialOperations(owner)).toHaveLength(2); expect(request).not.toHaveBeenCalled();
    });
    it('批量部分失败保留每条请求；重试跳过已确认词且不会重复插入', async () => {
        const owner = crypto.randomUUID(); await render(owner); let fail = true;
        request.mockImplementation(async (_path, options) => { if (!options.method) return { data: [], meta: {} }; if (options.body.word === 'Fenster' && fail) throw new LearningApiError('network_error', '失败'); return { data: { ...options.body, created_at: new Date().toISOString() } }; });
        const items = [newWord, { ...newWord, word: 'Fenster' }]; let ok = true;
        await act(async () => { ok = await words.addWords(items); }); expect(ok).toBe(false); expect(await getMaterialOperations(owner)).toHaveLength(1);
        fail = false; await act(async () => { ok = await words.addWords(items); }); expect(ok).toBe(true);
        expect(request.mock.calls.filter(call => call[1].method && call[1].body.word === 'Haus')).toHaveLength(1);
        const retries = request.mock.calls.filter(call => call[1].method && call[1].body.word === 'Fenster'); expect(retries[0][1].body.id).toBe(retries[1][1].body.id);
    });
    it('磁盘写入失败不前进、不假报成功，用户仍能重试', async () => {
        const owner = crypto.randomUUID(); await render(owner, false);
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        let ok = true; await act(async () => { ok = await words.addWord(newWord); }); expect(ok).toBe(false);
        expect(await getMaterialOperations(owner)).toEqual([]); expect(words.words).toEqual([]);
        await act(async () => { ok = await words.addWord(newWord); }); expect(ok).toBe(true);
    });
    it('换账号后本机读取失败也会结束首次加载，不把空界面永久锁在骨架屏', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(); await setCachedWords([existingWord()], a); await render(a, false);
        vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementationOnce(() => { throw new DOMException('blocked', 'InvalidStateError'); });
        await render(b, false); expect(words.loading).toBe(false); expect(words.words).toEqual([]);
    });
    it('未发送删除撤销保留ID；未知删除结果则先确认删除再用稳定新ID恢复', async () => {
        const owner = crypto.randomUUID(), value = existingWord(); await setCachedWords([value], owner); await markWordDeleted(value.id, owner);
        await render(owner, false); await act(async () => { expect(await words.restoreWord(value)).toBe(true); });
        expect(words.words[0].id).toBe(value.id); expect(await getMaterialOperations(owner)).toEqual([]);
        await markWordDeleted(value.id, owner); const deletion = (await getMaterialOperations(owner))[0]; await claimMaterial(owner, deletion.id);
        await act(async () => { expect(await words.restoreWord(value)).toBe(true); });
        const queue = await getMaterialOperations(owner); expect(queue).toHaveLength(2); expect(queue[1]).toMatchObject({ action: 'add', depends_on: deletion.id, restore_of: value.id }); expect(queue[1].id).not.toBe(value.id);
        await render(owner, true);
        await act(async () => { expect(await words.restoreWord(value)).toBe(true); });
        const calls = request.mock.calls.filter(call => call[1].method); expect(calls.map(call => call[1].method)).toEqual(['DELETE', 'POST']); expect(calls[1][1].body.id).toBe(queue[1].id);
        expect(words.words[0].id).toBe(queue[1].id);
    });
    it('句子未知删除后的恢复保留全部元数据，恢复请求失败仍返回false并可重试', async () => {
        const owner = crypto.randomUUID(), value = existingSentence(); await setCachedSentences([value], owner); await markSentenceDeleted(value.id, owner);
        const deletion = (await getMaterialOperations(owner))[0]; await claimMaterial(owner, deletion.id); await render(owner);
        let fail = true; request.mockImplementation(async (_path, options) => { if (!options.method) return { data: [], meta: {} }; if (options.method === 'POST' && fail) throw new LearningApiError('network_error', '断网'); return { data: options.body || {} }; });
        let ok = true; await act(async () => { ok = await sentences.restoreSentence(value); }); expect(ok).toBe(false);
        const restore = (await getMaterialOperations(owner))[0]; expect(restore.restore_of).toBe(value.id); expect(restore.id).not.toBe(value.id);
        fail = false; await act(async () => { ok = await sentences.restoreSentence(value); }); expect(ok).toBe(true);
        const calls = request.mock.calls.filter(call => call[1].method === 'POST'); expect(calls[0][1].body).toEqual(calls[1][1].body);
        expect(calls[1][1].body).toMatchObject({ created_at: value.created_at, keywords: value.keywords, grammar: value.grammar, source_type: value.source_type });
    });
    it('原新增仍未确认时，撤销未发送删除保留原请求；已尝试删除的恢复绝不误用原新增ID', async () => {
        const owner = crypto.randomUUID(), word = existingWord(), sentence = existingSentence();
        await addPendingWord(word, owner); await claimMaterial(owner, word.id); await markWordDeleted(word.id, owner);
        await render(owner, false); await act(async () => { expect(await words.restoreWord(word)).toBe(true); });
        expect((await getMaterialOperations(owner)).map(op => op.id)).toEqual([word.id]);
        await markWordDeleted(word.id, owner);
        const wordDelete = (await getMaterialOperations(owner)).find(op => op.action === 'delete')!;
        // 注入旧标签页/中断恢复可能留下的“新增与删除均已尝试”状态。
        await claimMaterial(owner, wordDelete.id);
        await addPendingSentence(sentence, owner); await claimMaterial(owner, sentence.id); await markSentenceDeleted(sentence.id, owner);
        const sentenceDelete = (await getMaterialOperations(owner)).find(op => op.kind === 'sentence' && op.action === 'delete')!;
        await claimMaterial(owner, sentenceDelete.id);
        await act(async () => { expect(await words.restoreWord(word)).toBe(true); expect(await sentences.restoreSentence(sentence)).toBe(true); });
        const restorations = (await getMaterialOperations(owner)).filter(op => op.restore_of);
        expect(restorations).toHaveLength(2); expect(restorations.every(op => op.id !== op.restore_of)).toBe(true);
        await act(async () => { expect((await syncMaterialOperations(owner)).synced).toBe(6); });
        await settle(() => words.words.length === 1 && sentences.savedSentences.length === 1);
        expect(words.words[0].id).toBe(restorations.find(op => op.kind === 'word')!.id);
        expect(sentences.savedSentences[0].id).toBe(restorations.find(op => op.kind === 'sentence')!.id);
    });
    it('失败保存后删除再手动添加同词句，会生成依赖删除的新请求而非复用旧ID', async () => {
        const owner = crypto.randomUUID(); await render(owner);
        request.mockImplementation(async (_path, options) => { if (!options.method) return { data: [], meta: {} }; throw new LearningApiError('network_error', '断网'); });
        await act(async () => { expect(await words.addWord(newWord)).toBe(false); expect(await sentences.saveSentence(input)).toBe(false); });
        const oldWord = words.words[0], oldSentence = sentences.savedSentences[0];
        // 句子可能由另一个标签页发出后丢失回执，同样不能把旧 UUID 当作删除后的新保存。
        await claimMaterial(owner, oldSentence.id);
        await act(async () => { await words.deleteWord(oldWord.id); await sentences.unsaveSentence(oldSentence.id); });
        await act(async () => { expect(await words.addWord(newWord)).toBe(false); expect(await sentences.saveSentence(input)).toBe(false); });
        const queued = await getMaterialOperations(owner);
        const newAdds = queued.filter(op => op.action === 'add' && op.record_id !== oldWord.id && op.record_id !== oldSentence.id);
        expect(newAdds).toHaveLength(2); expect(newAdds.every(op => op.depends_on)).toBe(true);
        request.mockImplementation(async (_path, options) => ({ data: options.method === 'DELETE' ? {} : { ...options.body, created_at: options.body?.created_at || new Date().toISOString() } }));
        await act(async () => { await syncMaterialOperations(owner); });
        await settle(() => words.words.length === 1 && sentences.savedSentences.length === 1);
        expect(words.words[0].id).toBe(newAdds.find(op => op.kind === 'word')!.id);
        expect(sentences.savedSentences[0].id).toBe(newAdds.find(op => op.kind === 'sentence')!.id);
    });
    it('后台读取挂起时缓存或空库已经可操作，不恢复整页加载状态', async () => {
        for (const cached of [true, false]) {
            const owner = crypto.randomUUID(), waiting = deferred<unknown>(); if (cached) await setCachedWords([existingWord()], owner);
            request.mockImplementation(async () => waiting.promise);
            await render(owner); expect(words.loading).toBe(false); expect(words.words).toHaveLength(cached ? 1 : 0);
            let refreshing!: Promise<void>; await act(async () => { refreshing = words.refreshFromServer(); });
            expect(words.loading).toBe(false); expect(words.words).toHaveLength(cached ? 1 : 0);
            await act(async () => { waiting.resolve({ data: [], meta: {} }); await refreshing; });
        }
    });
    it('离线作答→删除→撤销不会丢失作答UUID和原排期', async () => {
        const owner = crypto.randomUUID(), value = existingWord(); await setCachedWords([value], owner);
        await saveReviewState({ wordId: value.id, due: '2000-01-01', intervalDays: 7, ease: 2.5, reps: 3, lapses: 0, lastReviewedAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z' }, 'synced', owner);
        let review!: ReturnType<typeof useReview>;
        function ReviewProbe() { words = useWords({ userId: owner, isOnline: false }); review = useReview({ userId: owner, words: words.words, wordsLoading: words.loading, isOnline: false }); return <span>{words.words.length}</span>; }
        await act(async () => root.render(<ReviewProbe />)); await settle(() => !words.loading && !review.loading && review.totalTracked === 1);
        await act(async () => review.startSession()); await act(async () => { expect(await review.gradeWord(value.id, 'known')).toBe(true); });
        const attempt = (await getReviewEvents(owner))[0].event.id;
        await act(async () => { await words.deleteWord(value.id); review.removeReviewState(value.id); });
        expect((await getReviewEvents(owner))[0].event.id).toBe(attempt); expect((await getReviewState(value.id, owner))?.reps).toBe(3);
        await act(async () => { expect(await words.restoreWord(value)).toBe(true); });
        await settle(() => review.totalTracked === 1);
        expect((await getReviewEvents(owner))[0].event.id).toBe(attempt); expect(words.words[0].id).toBe(value.id); expect(review.aheadCount).toBe(1);
    });
});
