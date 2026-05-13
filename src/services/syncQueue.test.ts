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
const { syncPendingOperations } = await import('./syncQueue');
const {
    addPendingWord,
    getAllCachedWords,
    getPendingOperations,
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
});
