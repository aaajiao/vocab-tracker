import { describe, it, expect } from 'vitest';
import type { SavedSentence } from '../types';
import { filterSavedSentences } from './sentenceFilter';

// 构造最小 SavedSentence，仅填测试关心的字段
function makeSentence(overrides: Partial<SavedSentence> & Pick<SavedSentence, 'id'>): SavedSentence {
    return {
        id: overrides.id,
        sentence: overrides.sentence ?? '',
        sentence_cn: overrides.sentence_cn ?? '',
        language: overrides.language ?? 'en',
        scene: overrides.scene ?? null,
        source_type: overrides.source_type ?? 'input',
        source_words: overrides.source_words ?? [],
        keywords: overrides.keywords,
        grammar: overrides.grammar,
        created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z'
    };
}

const sentences: SavedSentence[] = [
    makeSentence({ id: '1', sentence: 'Good morning everyone.', sentence_cn: '大家早上好。', language: 'en' }),
    makeSentence({ id: '2', sentence: 'Ich liebe dich.', sentence_cn: '我爱你。', language: 'de' }),
    makeSentence({ id: '3', sentence: 'The weather is nice today.', sentence_cn: '今天天气很好。', language: 'en' }),
    makeSentence({ id: '4', sentence: 'Guten Morgen!', sentence_cn: '早上好！', language: 'de' })
];

describe('filterSavedSentences', () => {
    // ---- 语言过滤 ----
    it("'all' 返回全部", () => {
        expect(filterSavedSentences(sentences, 'all', '')).toHaveLength(4);
    });

    it("'en' 只返回英语句子", () => {
        const result = filterSavedSentences(sentences, 'en', '');
        expect(result.map(s => s.id)).toEqual(['1', '3']);
    });

    it("'de' 只返回德语句子", () => {
        const result = filterSavedSentences(sentences, 'de', '');
        expect(result.map(s => s.id)).toEqual(['2', '4']);
    });

    // ---- 搜索：命中原句 ----
    it('搜索命中原句（大小写不敏感）', () => {
        // 英文 "morning" 仅命中 id 1；id 4 是德语 "Morgen"，不含子串 "morning"
        const result = filterSavedSentences(sentences, 'all', 'MORNING');
        expect(result.map(s => s.id)).toEqual(['1']);
    });

    // ---- 搜索：命中中译 ----
    it('搜索命中中译 sentence_cn', () => {
        const result = filterSavedSentences(sentences, 'all', '早上好');
        expect(result.map(s => s.id)).toEqual(['1', '4']);
    });

    it('搜索同时匹配原句或中译（子串）', () => {
        const result = filterSavedSentences(sentences, 'all', '天气');
        expect(result.map(s => s.id)).toEqual(['3']);
    });

    // ---- 语言 + 搜索叠加 ----
    it('语言与搜索叠加过滤', () => {
        const result = filterSavedSentences(sentences, 'de', 'morgen');
        expect(result.map(s => s.id)).toEqual(['4']);
    });

    it('语言与搜索叠加无交集时返回空', () => {
        expect(filterSavedSentences(sentences, 'en', 'liebe')).toHaveLength(0);
    });

    // ---- 空 / 空白搜索词 ----
    it('空搜索词不过滤', () => {
        expect(filterSavedSentences(sentences, 'all', '')).toHaveLength(4);
    });

    it('纯空白搜索词等价于不过滤', () => {
        expect(filterSavedSentences(sentences, 'all', '   ')).toHaveLength(4);
    });

    it('搜索词首尾空白被忽略后再匹配', () => {
        const result = filterSavedSentences(sentences, 'all', '  weather  ');
        expect(result.map(s => s.id)).toEqual(['3']);
    });

    // ---- 无匹配 ----
    it('无匹配返回空数组', () => {
        expect(filterSavedSentences(sentences, 'all', 'zzzznotfound')).toHaveLength(0);
    });

    // ---- 空输入列表 ----
    it('空列表返回空', () => {
        expect(filterSavedSentences([], 'all', 'anything')).toHaveLength(0);
    });

    // ---- 不修改原数组 ----
    it('不修改传入的原数组', () => {
        const input = [...sentences];
        filterSavedSentences(input, 'en', 'morning');
        expect(input).toHaveLength(4);
    });
});
