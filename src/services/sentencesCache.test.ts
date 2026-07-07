import { describe, it, expect, beforeEach } from 'vitest';
import {
    addPendingSentence,
    getPendingSentenceOperations,
    getAllCachedSentences,
    markSentenceDeleted,
    incrementSentenceOperationRetry,
    clearSentencesCache,
    withSentenceDefaults,
} from './sentencesCache';
import type { SavedSentence } from '../types';

function makeSentence(overrides: Partial<SavedSentence> = {}): SavedSentence {
    return {
        id: 'temp_1',
        sentence: 'The cat sleeps.',
        sentence_cn: '猫在睡觉。',
        language: 'en',
        scene: null,
        source_type: 'word',
        source_words: ['cat'],
        created_at: '2026-05-13T00:00:00.000Z',
        ...overrides,
    };
}

describe('sentencesCache', () => {
    beforeEach(async () => {
        await clearSentencesCache();
    });

    // 句子侧重试次数持久化，与词汇侧对称
    describe('incrementSentenceOperationRetry', () => {
        it('increments and persists retryCount, returning the new value', async () => {
            await addPendingSentence(makeSentence({ id: 'temp_s' }));

            expect(await incrementSentenceOperationRetry('add_temp_s')).toBe(1);
            expect(await incrementSentenceOperationRetry('add_temp_s')).toBe(2);

            const pending = await getPendingSentenceOperations();
            expect(pending[0].retryCount).toBe(2);
        });

        it('returns 0 for an unknown operation id', async () => {
            expect(await incrementSentenceOperationRetry('add_missing')).toBe(0);
        });
    });

    // 删除仍未同步的 temp id 句子走取消路径——markSentenceDeleted 对 pending_add
    // 应移除本地记录并撤销待同步的新增操作（不产生 delete 操作）。
    // 支撑 useSentences.unsaveSentence 的 temp id 分支，避免离线句子在线删除后复活。
    describe('markSentenceDeleted on a pending_add sentence (取消路径)', () => {
        it('removes the sentence and its add op, leaving no delete op', async () => {
            await addPendingSentence(makeSentence({ id: 'temp_cancel' }));

            await markSentenceDeleted('temp_cancel');

            const cached = await getAllCachedSentences();
            expect(cached.map(s => s.id)).not.toContain('temp_cancel');

            const pending = await getPendingSentenceOperations();
            expect(pending).toHaveLength(0);
        });
    });

    // 句子输入一等公民：读回时 keywords/grammar 兜底
    describe('withSentenceDefaults', () => {
        it('给缺失(undefined)的 keywords/grammar/source_words 兜底为空数组', () => {
            const row = makeSentence({ source_type: 'input' });
            delete (row as { keywords?: unknown }).keywords;
            delete (row as { grammar?: unknown }).grammar;
            delete (row as { source_words?: unknown }).source_words;

            const result = withSentenceDefaults(row);

            expect(result.keywords).toEqual([]);
            expect(result.grammar).toEqual([]);
            expect(result.source_words).toEqual([]);
        });

        it('把 null 兜底为空数组', () => {
            const row = makeSentence({
                keywords: null as unknown as SavedSentence['keywords'],
                grammar: null as unknown as SavedSentence['grammar'],
                source_words: null as unknown as string[],
            });

            const result = withSentenceDefaults(row);

            expect(result.keywords).toEqual([]);
            expect(result.grammar).toEqual([]);
            expect(result.source_words).toEqual([]);
        });

        it('保留已有的 keywords/grammar 并不改动其他字段', () => {
            const row = makeSentence({
                source_type: 'input',
                sentence: 'Original CASE kept.',
                keywords: [{ word: 'lieben', meaning: '爱', partOfSpeech: 'verb' }],
                grammar: [{ point: '宾格', explanation: 'dich 是 du 的宾格' }],
                source_words: ['lieben'],
            });

            const result = withSentenceDefaults(row);

            expect(result.keywords).toHaveLength(1);
            expect(result.keywords![0].word).toBe('lieben');
            expect(result.grammar![0].point).toBe('宾格');
            expect(result.sentence).toBe('Original CASE kept.');
            expect(result.source_type).toBe('input');
        });
    });
});
