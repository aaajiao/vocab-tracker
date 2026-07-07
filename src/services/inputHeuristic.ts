// 输入分类启发式：在调用 AI 前对用户输入做本地快速预判，
// 判断它更像「单词/短语」还是「完整句子」。
// 注意：这只是本地预判，权威分类由 detectAndAnalyze 的 AI 结果决定。
import {
    SENTENCE_MIN_TOKENS,
    SENTENCE_PUNCT_MIN_TOKENS,
    SENTENCE_COMMA_MIN_TOKENS
} from '../constants';

// 句末终结标点（中英文）
const TERMINAL_PUNCT = /[.!?。！？…]/;

// 逗号（英/德半角 + 中文全角）
const COMMA = /[,，]/;

// 首尾成对引号（英文直引号、各类弯引号、德语 „ 「」 « » 等）
const LEADING_QUOTES = /^[\s"'`“”‘’„‚«»‹›「」『』]+/u;
const TRAILING_QUOTES = /[\s"'`“”‘’„‚«»‹›「」『』]+$/u;

// 去除首尾引号与空白（不影响词内的撇号，如 It's）
function stripQuotes(text: string): string {
    return text.replace(LEADING_QUOTES, '').replace(TRAILING_QUOTES, '');
}

/**
 * 判定输入是「单词/短语」还是「句子」。
 *
 * 判 sentence 的条件（任一成立）：
 *  - 含句末标点 且 token >= SENTENCE_PUNCT_MIN_TOKENS(3)
 *  - token >= SENTENCE_MIN_TOKENS(5)
 *  - 含逗号 且 token >= SENTENCE_COMMA_MIN_TOKENS(4)
 *
 * 其余情况归为 word：
 *  - 单 token 恒为 word（德语长复合词如 Rechtsschutzversicherung = 1 token）
 *  - 2-4 token 且不满足以上任一条件（含仅 2 token 却带句末标点的 "It's raining."）
 *    归为短语，走词汇管线
 */
export function classifyInput(text: string): 'word' | 'sentence' {
    const cleaned = stripQuotes(text.trim()).trim();
    if (!cleaned) return 'word';

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const tokenCount = tokens.length;

    // 单 token 恒为词汇
    if (tokenCount <= 1) return 'word';

    const hasTerminal = TERMINAL_PUNCT.test(cleaned);
    const hasComma = COMMA.test(cleaned);

    if (hasTerminal && tokenCount >= SENTENCE_PUNCT_MIN_TOKENS) return 'sentence';
    if (tokenCount >= SENTENCE_MIN_TOKENS) return 'sentence';
    if (hasComma && tokenCount >= SENTENCE_COMMA_MIN_TOKENS) return 'sentence';

    // 2-4 token 且无强句子信号 → 短语，归词汇管线
    return 'word';
}
