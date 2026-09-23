import { describe, expect, it } from 'vitest';
import type { SavedSentence } from '../types';
import { addPendingSentence, getAllCachedSentences, setCachedSentences, clearSentencesCache, markSentenceDeleted, withSentenceDefaults, sentenceBody } from './sentencesCache';
import { getMaterialOperations } from './materialStore';
const sentence = (): SavedSentence => ({ id: crypto.randomUUID(), sentence: 'Ich lerne.', sentence_cn: '我在学习。', language: 'de', scene: null, source_type: 'input', source_words: [], keywords: [{ word: 'lernen', meaning: '学习', partOfSpeech: 'verb' }], grammar: [{ point: '现在时', explanation: '动词变位' }], created_at: '2026-09-23T10:00:00Z' });
describe('句子缓存', () => {
    it('完整保留分析信息、词源类型与原创建时间，账号隔离', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(), value = sentence(); await addPendingSentence(value, a);
        expect(await getAllCachedSentences(b)).toEqual([]); expect(await getAllCachedSentences()).toEqual([]);
        expect((await getAllCachedSentences(a))[0]).toEqual(value);
        expect((await getMaterialOperations(a))[0].body).toEqual(sentenceBody(value));
    });
    it('刷新和清缓存都保留离线新增，删除标记在刷新后仍隐藏', async () => {
        const owner = crypto.randomUUID(), value = sentence(), other = sentence();
        await setCachedSentences([value], owner); await markSentenceDeleted(value.id, owner); await addPendingSentence(other, owner);
        await setCachedSentences([value], owner); expect((await getAllCachedSentences(owner)).map(item => item.id)).toEqual([other.id]);
        await clearSentencesCache(owner); expect(await getAllCachedSentences(owner)).toHaveLength(1);
    });
    it('老字段为空时提供数组缺省值', () => {
        const result = withSentenceDefaults({ ...sentence(), keywords: null, grammar: undefined, source_words: null } as unknown as SavedSentence);
        expect(result.keywords).toEqual([]); expect(result.grammar).toEqual([]); expect(result.source_words).toEqual([]);
    });
});
