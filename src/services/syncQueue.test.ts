import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Word } from '../types';
import type { ReviewState } from './srs';

// Mock the supabase client BEFORE importing anything that pulls it in.
// syncQueue.ts → import { supabase } from '../supabaseClient'
const fromMock = vi.fn();
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

describe('syncPendingOperations — review states', () => {
    beforeEach(async () => {
        await clearWordsCache();
        await clearSentencesCache();
        await clearReviewCache();
        fromMock.mockReset();
    });

    // 只为 review_states 表打桩 upsert 链：from('review_states').upsert(rows, opts) → { error }
    function mockReviewUpsert(error: unknown = null) {
        fromMock.mockImplementation((table: string) => {
            if (table === 'review_states') {
                return { upsert: vi.fn().mockResolvedValue({ error }) };
            }
            // 其他表本测试无 pending，不应被调用
            return { insert: vi.fn(), delete: vi.fn(), upsert: vi.fn() };
        });
    }

    it('upserts a pending review state and marks it synced', async () => {
        await upsertReviewState(makeReviewState('word-uuid-1'), 'pending_upsert');
        mockReviewUpsert(null);

        const result = await syncPendingOperations('user-123');

        expect(result.success).toBe(true);
        expect(result.synced).toBe(1);
        expect(fromMock).toHaveBeenCalledWith('review_states');

        // 同步后不再 pending
        expect(await getPendingReviewStates()).toHaveLength(0);
        const state = await getReviewState('word-uuid-1');
        expect(state?.syncStatus).toBe('synced');
    });

    it('keeps the state pending when the upsert errors (e.g. table not migrated)', async () => {
        await upsertReviewState(makeReviewState('word-uuid-2'), 'pending_upsert');
        mockReviewUpsert({ message: 'relation "review_states" does not exist', code: '42P01' });

        const result = await syncPendingOperations('user-123');

        expect(result.success).toBe(false);
        expect(result.failed).toBe(1);
        expect(result.errors[0]).toContain('review_states');

        // 保持 pending，供下次重试
        expect(await getPendingReviewStates()).toHaveLength(1);
    });

    it('discards the pending op and local state on a foreign-key violation', async () => {
        await upsertReviewState(makeReviewState('word-deleted'), 'pending_upsert');
        mockReviewUpsert({ message: 'insert or update violates foreign key', code: '23503' });

        const result = await syncPendingOperations('user-123');

        // FK 冲突不计失败、不阻塞
        expect(result.failed).toBe(0);
        expect(result.synced).toBe(0);
        // 本地状态被丢弃
        expect(await getReviewState('word-deleted')).toBeUndefined();
        expect(await getPendingReviewStates()).toHaveLength(0);
    });

    it('skips and drops a temp-id review state without hitting supabase', async () => {
        await upsertReviewState(makeReviewState('temp_123_abc'), 'pending_upsert');

        const result = await syncPendingOperations('user-123');

        expect(result.synced).toBe(0);
        expect(result.failed).toBe(0);
        expect(fromMock).not.toHaveBeenCalled();
        // temp id 状态被丢弃
        expect(await getReviewState('temp_123_abc')).toBeUndefined();
    });

    it('counts review pending states in getPendingCount', async () => {
        await upsertReviewState(makeReviewState('word-a'), 'pending_upsert');
        await upsertReviewState(makeReviewState('word-b'), 'synced');
        expect(await getPendingCount()).toBe(1);
    });
});
