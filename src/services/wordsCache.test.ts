import { describe, it, expect, beforeEach } from 'vitest';
import {
    addPendingWord,
    setCachedWords,
    getAllCachedWords,
    getPendingAddWords,
    getPendingOperations,
    clearWordsCache,
    markWordSynced,
    markWordDeleted,
    incrementOperationRetry,
    mergePendingAdds,
    selectWordsToMigrate,
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

    // 服务器数据覆盖内存前需合并本地 pending_add 项
    describe('getPendingAddWords', () => {
        it('returns only pending_add words, excluding synced and pending_delete', async () => {
            await addPendingWord(makeWord({ id: 'temp_a', word: 'ant' }));
            await setCachedWords([makeWord({ id: 'server_b', word: 'bee' })]); // synced，保留上面的 pending

            const pendingAdds = await getPendingAddWords();
            expect(pendingAdds.map(w => w.id)).toEqual(['temp_a']);
        });
    });

    describe('mergePendingAdds (纯函数)', () => {
        it('appends pending adds not present on the server, sorted by timestamp desc', () => {
            const server = [makeWord({ id: 's1', word: 'sun', timestamp: 100 })];
            const pending = [makeWord({ id: 'temp_x', word: 'moon', timestamp: 200 })];

            const merged = mergePendingAdds(server, pending);
            expect(merged.map(w => w.id)).toEqual(['temp_x', 's1']);
        });

        it('drops a pending add already present on the server (deduped by id)', () => {
            const server = [makeWord({ id: 'same', word: 'star', timestamp: 100 })];
            const pending = [makeWord({ id: 'same', word: 'star', timestamp: 100 })];

            const merged = mergePendingAdds(server, pending);
            expect(merged).toHaveLength(1);
            expect(merged[0].id).toBe('same');
        });
    });

    // 迁移前按服务器数据大小写不敏感去重
    describe('selectWordsToMigrate (纯函数)', () => {
        it('filters out words already on the server, case-insensitively on word+language', () => {
            const local = [
                makeWord({ id: 'l1', word: 'Apple', language: 'en' }),
                makeWord({ id: 'l2', word: 'birne', language: 'de' }),
            ];
            const server = [makeWord({ id: 's1', word: 'apple', language: 'en' })];

            const toMigrate = selectWordsToMigrate(local, server);
            expect(toMigrate.map(w => w.word)).toEqual(['birne']);
        });

        it('dedupes duplicates within the local list itself', () => {
            const local = [
                makeWord({ id: 'l1', word: 'Cat', language: 'en' }),
                makeWord({ id: 'l2', word: 'cat', language: 'en' }),
            ];
            const toMigrate = selectWordsToMigrate(local, []);
            expect(toMigrate).toHaveLength(1);
        });

        it('treats same word in different languages as distinct', () => {
            const local = [
                makeWord({ id: 'l1', word: 'die', language: 'en' }),
                makeWord({ id: 'l2', word: 'die', language: 'de' }),
            ];
            const toMigrate = selectWordsToMigrate(local, []);
            expect(toMigrate).toHaveLength(2);
        });
    });

    // 删除仍未同步的 temp id 词走取消路径——markWordDeleted 对 pending_add
    // 应移除本地记录并撤销待同步的新增操作（不产生 delete 操作）
    describe('markWordDeleted on a pending_add word (取消路径)', () => {
        it('removes the word and its add op, leaving no delete op', async () => {
            await addPendingWord(makeWord({ id: 'temp_cancel', word: 'owl' }));

            await markWordDeleted('temp_cancel');

            const cached = await getAllCachedWords();
            expect(cached.map(w => w.id)).not.toContain('temp_cancel');

            const pending = await getPendingOperations();
            expect(pending).toHaveLength(0);
        });
    });

    // 重试次数持久化
    describe('incrementOperationRetry', () => {
        it('increments and persists retryCount, returning the new value', async () => {
            await addPendingWord(makeWord({ id: 'temp_r', word: 'pig' }));

            expect(await incrementOperationRetry('add_temp_r')).toBe(1);
            expect(await incrementOperationRetry('add_temp_r')).toBe(2);

            const pending = await getPendingOperations();
            expect(pending[0].retryCount).toBe(2);
        });
    });
});
