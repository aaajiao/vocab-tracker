import { describe, it, expect, beforeEach } from 'vitest';
import {
    addPendingWord,
    setCachedWords,
    getAllCachedWords,
    getPendingOperations,
    clearWordsCache,
    markWordSynced,
} from './wordsCache';
import type { Word } from '../types';

function makeWord(overrides: Partial<Word> = {}): Word {
    return {
        id: 'temp_1',
        word: 'hello',
        meaning: '你好',
        language: 'en',
        example: 'Say hello.',
        exampleCn: '打招呼。',
        category: 'daily',
        date: '2026-05-13',
        timestamp: 1715587200000,
        ...overrides,
    };
}

describe('wordsCache', () => {
    beforeEach(async () => {
        await clearWordsCache();
    });

    describe('setCachedWords', () => {
        it('preserves pending offline writes when refreshing from server', async () => {
            // 1. user adds a word offline
            const offlineWord = makeWord({ id: 'temp_offline_1', word: 'apple', meaning: '苹果' });
            await addPendingWord(offlineWord);

            // 2. server returns its current rows (which DON'T include the offline word yet)
            const serverWord = makeWord({ id: 'server_uuid_1', word: 'banana', meaning: '香蕉' });
            await setCachedWords([serverWord]);

            // 3. cache should still contain BOTH — server word + the still-pending offline write
            const cached = await getAllCachedWords();
            const ids = cached.map(w => w.id).sort();
            expect(ids).toEqual(['server_uuid_1', 'temp_offline_1']);

            // 4. and the pending op queue should still be intact (not flushed by setCachedWords)
            const pending = await getPendingOperations();
            expect(pending).toHaveLength(1);
            expect(pending[0].type).toBe('add_word');
        });

        it('replaces synced rows with the latest server snapshot', async () => {
            // Pre-existing synced row should be replaced when setCachedWords runs.
            const oldServerWord = makeWord({ id: 'server_1', word: 'cat', meaning: '旧译' });
            await setCachedWords([oldServerWord]);

            const newServerWord = makeWord({ id: 'server_1', word: 'cat', meaning: '猫' });
            await setCachedWords([newServerWord]);

            const cached = await getAllCachedWords();
            expect(cached).toHaveLength(1);
            expect(cached[0].meaning).toBe('猫');
        });
    });

    describe('markWordSynced', () => {
        it('replaces the temp ID with the server-assigned UUID', async () => {
            const tempWord = makeWord({ id: 'temp_xyz', word: 'dog' });
            await addPendingWord(tempWord);

            await markWordSynced('temp_xyz', 'server_uuid_xyz');

            const cached = await getAllCachedWords();
            expect(cached).toHaveLength(1);
            expect(cached[0].id).toBe('server_uuid_xyz');
            expect(cached.map(w => w.id)).not.toContain('temp_xyz');
        });

        it('keeps the same ID when no new ID is provided', async () => {
            const word = makeWord({ id: 'server_already', word: 'fish' });
            await addPendingWord(word);

            await markWordSynced('server_already');

            const cached = await getAllCachedWords();
            expect(cached).toHaveLength(1);
            expect(cached[0].id).toBe('server_already');
        });
    });
});
