import type { SavedSentence } from '../types';

// 收藏句子的语言过滤值：全部 / 英语 / 德语
export type SentenceLanguageFilter = 'all' | 'en' | 'de';

/**
 * 过滤收藏句子：语言过滤 + 搜索词过滤（两者叠加，AND）。
 * - 语言：'all' 不过滤，否则按 SavedSentence.language 精确匹配。
 * - 搜索：对原句 sentence 与中译 sentence_cn 做大小写不敏感的子串匹配；
 *   搜索词去除首尾空白后为空时不做搜索过滤。
 */
export function filterSavedSentences(
    sentences: SavedSentence[],
    languageFilter: SentenceLanguageFilter,
    searchQuery: string
): SavedSentence[] {
    const query = searchQuery.trim().toLowerCase();
    return sentences.filter(s => {
        const matchesLanguage = languageFilter === 'all' || s.language === languageFilter;
        const matchesSearch =
            !query ||
            s.sentence.toLowerCase().includes(query) ||
            s.sentence_cn.toLowerCase().includes(query);
        return matchesLanguage && matchesSearch;
    });
}
