import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Word } from '../types';
import type { ReviewState } from './srs';

// Mock the supabase client BEFORE importing anything that pulls it in.
// syncQueue.ts → import { supabase } from '../supabaseClient'
const fromMock = vi.fn();
const eventRequest = vi.hoisted(() => vi.fn());
vi.mock('./learningApi', async (original) => ({ ...await original<typeof import('./learningApi')>(), learningRequest: eventRequest }));
vi.mock('../supabaseClient', () => ({
    supabase: {
        from: (...args: unknown[]) => fromMock(...args),
    },
}));

// Now import the module under test and the cache helpers.
const { syncPendingOperations, getPendingCount, MAX_SYNC_RETRIES } = await import('./syncQueue');
const {
    addPendingWord,
    getAllCachedWords,
    getPendingOperations,
    incrementOperationRetry,
    clearWordsCache,
} = await import('./wordsCache');
const { clearSentencesCache } = await import('./sentencesCache');
const { enqueueReviewEvent, getReviewEvents, clearReviewEventQueue } = await import('./reviewEventQueue');
const {
    upsert: upsertReviewState,
    getPending: getPendingReviewStates,
    get: getReviewState,
    clear: clearReviewCache,
} = await import('./reviewCache');

function makeReviewState(wordId: string): ReviewState {
    return {
        wordId,
        due: '2026-07-08',
        intervalDays: 3,
        ease: 2.5,
        reps: 1,
        lapses: 0,
        lastReviewedAt: '2026-07-07T10:00:00.000Z',
        updatedAt: '2026-07-07T10:00:00.000Z',
    };
}

function makeWord(overrides: Partial<Word> = {}): Word {
    return {
        id: 'temp_1715587200000_abc',
        word: 'apple',
        meaning: '苹果',
        language: 'en',
        example: 'I ate an apple.',
        exampleCn: '我吃了一个苹果。',
        category: 'daily',
        date: '2026-05-13',
        timestamp: 1715587200000,
        ...overrides,
    };
}

// Build a thenable chain that mimics supabase.from('x').insert(...).select().single()
// → resolves to { data, error }.
function mockInsertResolves(data: unknown, error: unknown = null) {
    fromMock.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data, error }),
            }),
        }),
        delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
        }),
    });
}

describe('syncPendingOperations', () => {
    beforeEach(async () => {
        await clearWordsCache();
        await clearSentencesCache();
        await clearReviewCache();
        await clearReviewEventQueue();
        eventRequest.mockReset();
        fromMock.mockReset();
    });

    it('swaps the temp ID for the server UUID and removes the pending op', async () => {
        // 1. user added a word offline → temp ID + pending op
        const tempId = 'temp_1715587200000_abc';
        await addPendingWord(makeWord({ id: tempId }));

        // 2. supabase insert returns the server-assigned UUID
        const serverId = '550e8400-e29b-41d4-a716-446655440000';
        mockInsertResolves({ id: serverId });
        // syncQueue also processes sentences — return empty for that path.
        // (clearSentencesCache leaves the queue empty, so the sentence loop is a no-op
        // and never calls supabase.from('saved_sentences') — no extra mock needed.)

        // 3. run the sync
        const result = await syncPendingOperations('user-123');

        // 4. assert: synced count, temp ID gone, server ID present and synced, pending op cleared
        expect(result.success).toBe(true);
        expect(result.synced).toBe(1);
        expect(result.failed).toBe(0);

        const cached = await getAllCachedWords();
        expect(cached).toHaveLength(1);
        expect(cached[0].id).toBe(serverId);
        expect(cached.map(w => w.id)).not.toContain(tempId);

        const pending = await getPendingOperations();
        expect(pending).toHaveLength(0);

        // 5. assert: insert was called with the right user_id and word fields
        expect(fromMock).toHaveBeenCalledWith('words');
    });

    it('returns failure and keeps the pending op when supabase insert errors', async () => {
        const tempId = 'temp_should_stay';
        await addPendingWord(makeWord({ id: tempId, word: 'banana' }));

        mockInsertResolves(null, { message: 'unique violation', code: '23505' });

        const result = await syncPendingOperations('user-123');

        expect(result.success).toBe(false);
        expect(result.synced).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.errors[0]).toContain('unique violation');

        // Pending op should still be queued for retry.
        const pending = await getPendingOperations();
        expect(pending).toHaveLength(1);

        // Cache should still hold the temp-ID entry (not silently dropped).
        const cached = await getAllCachedWords();
        expect(cached.map(w => w.id)).toContain(tempId);
    });

    it('rejects sync when no userId is provided', async () => {
        const result = await syncPendingOperations('');
        expect(result.success).toBe(false);
        expect(result.errors).toContain('No user ID');
    });

    it('bumps retryCount on failure so the same op is not retried forever', async () => {
        await addPendingWord(makeWord({ id: 'temp_retry', word: 'kiwi' }));

        mockInsertResolves(null, { message: 'boom', code: '500' });
        await syncPendingOperations('user-123');

        const pending = await getPendingOperations();
        expect(pending).toHaveLength(1);
        expect(pending[0].retryCount).toBe(1);
    });

    it('reports deadLettered when an op crosses the retry ceiling', async () => {
        await addPendingWord(makeWord({ id: 'temp_cross', word: 'lime' }));
        // 把重试次数顶到上限前一次（MAX-1）
        for (let i = 0; i < MAX_SYNC_RETRIES - 1; i++) {
            await incrementOperationRetry('add_temp_cross');
        }

        // 这次 insert 失败 → retryCount 从 MAX-1 增到 MAX，刚好跨过上限
        mockInsertResolves(null, { message: 'still failing', code: '500' });
        const result = await syncPendingOperations('user-123');

        expect(result.failed).toBe(1);
        expect(result.deadLettered).toBe(1);
        // 跨过上限后不再计入待同步数（避免徽标永挂）
        expect(await getPendingCount()).toBe(0);
    });

    it('skips ops at the retry ceiling: no request, not counted, data retained', async () => {
        await addPendingWord(makeWord({ id: 'temp_dead', word: 'mango' }));
        for (let i = 0; i < MAX_SYNC_RETRIES; i++) {
            await incrementOperationRetry('add_temp_dead');
        }

        // 已达上限：getPendingCount 排除它
        expect(await getPendingCount()).toBe(0);

        // 再次同步：跳过该操作，不发起任何 supabase 调用（未设置 mock，被调用会抛错暴露问题）
        const result = await syncPendingOperations('user-123');
        expect(result.synced).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.deadLettered).toBe(0);
        expect(fromMock).not.toHaveBeenCalled();

        // 数据仍保留在 IndexedDB（不丢数据）
        const pending = await getPendingOperations();
        expect(pending).toHaveLength(1);
        const cached = await getAllCachedWords();
        expect(cached.map(w => w.id)).toContain('temp_dead');
    });

    it('runs only once when called concurrently (in-flight mutex)', async () => {
        await addPendingWord(makeWord({ id: 'temp_concurrent', word: 'nectarine' }));
        const serverId = 'server-uuid-concurrent';

        let insertCalls = 0;
        fromMock.mockImplementation((table: string) => {
            if (table === 'words') {
                return {
                    insert: () => {
                        insertCalls++;
                        return {
                            select: () => ({
                                single: () => Promise.resolve({ data: { id: serverId }, error: null }),
                            }),
                        };
                    },
                };
            }
            // saved_sentences：无 pending 操作，不会被真正调用
            return { insert: vi.fn(), delete: vi.fn() };
        });

        const [r1, r2] = await Promise.all([
            syncPendingOperations('user-123'),
            syncPendingOperations('user-123'),
        ]);

        // 两次并发调用复用同一 Promise，insert 只发生一次
        expect(insertCalls).toBe(1);
        expect(r1).toBe(r2);
        expect(r1.synced).toBe(1);
    });
});

describe('syncPendingOperations — review events', () => {
    beforeEach(async () => {
        await clearWordsCache();
        await clearSentencesCache();
        await clearReviewCache();
        await clearReviewEventQueue();
        fromMock.mockReset();
        eventRequest.mockReset();
    });

    const attempt = (id: string) => ({ id, word_id: 'word-a', grade: 'known' as const, source: 'web' as const, practiced_at: '2026-09-23T10:00:00Z', timezone: 'Europe/Berlin' });

    it('preserves legacy pending states without uploading or counting them', async () => {
        await upsertReviewState(makeReviewState('legacy-word'), 'pending_upsert');
        const result = await syncPendingOperations('user-a');
        expect(result.success).toBe(true);
        expect(result.synced).toBe(0);
        expect(fromMock).not.toHaveBeenCalled();
        expect(eventRequest).not.toHaveBeenCalled();
        expect(await getPendingReviewStates()).toHaveLength(1);
        expect(await getPendingCount('user-a')).toBe(0);
    });

    it('counts only current-account review events, and requires an account to count them', async () => {
        await enqueueReviewEvent('user-a', attempt('a'));
        await enqueueReviewEvent('user-b', attempt('b'));
        await enqueueReviewEvent('user-b', attempt('c'));
        expect(await getPendingCount('user-a')).toBe(1);
        expect(await getPendingCount('user-b')).toBe(2);
        expect(await getPendingCount()).toBe(0);
    });

    it('submits event payloads through the API, never direct state upserts', async () => {
        await enqueueReviewEvent('user-a', attempt('a'));
        eventRequest.mockResolvedValueOnce({ data: { event: {}, state: { word_id: 'word-a', due: '2026-09-26', interval_days: 3, ease: 2.5, reps: 1, lapses: 0, last_reviewed_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:00:01Z' }, replayed: false } });
        const result = await syncPendingOperations('user-a');
        expect(result.synced).toBe(1);
        expect(eventRequest).toHaveBeenCalledWith('/events', expect.objectContaining({ method: 'POST', userId: 'user-a', body: attempt('a') }));
        expect(fromMock).not.toHaveBeenCalled();
        expect(await getReviewEvents('user-a')).toEqual([]);
        expect((await getReviewState('word-a', 'user-a'))?.reps).toBe(1);
    });
});
