import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Word } from '../types';

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
