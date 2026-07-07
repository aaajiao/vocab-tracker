import { describe, it, expect } from 'vitest';
import { classifyInput } from './inputHeuristic';

describe('classifyInput', () => {
    // ---- 单 token 恒为 word ----
    it('单个英文词 → word', () => {
        expect(classifyInput('Haus')).toBe('word');
    });

    it('德语长复合词（单 token）→ word', () => {
        expect(classifyInput('Rechtsschutzversicherung')).toBe('word');
    });

    // ---- 2-4 token 无强句子信号 → word（短语） ----
    it('两词短语无标点 → word', () => {
        expect(classifyInput('guten Morgen')).toBe('word');
    });

    it('三词专有名词无标点 → word', () => {
        expect(classifyInput('New York City')).toBe('word');
    });

    it('仅 2 token 却带句末标点（未达 token>=3 阈值）→ word', () => {
        // "It's raining." = 2 token；终结标点规则要求 token>=3，故归短语/词汇管线
        expect(classifyInput("It's raining.")).toBe('word');
    });

    // ---- 句子信号 → sentence ----
    it('三词带句末标点 → sentence', () => {
        expect(classifyInput('Ich liebe dich.')).toBe('sentence');
    });

    it('无标点长句（>=5 词）→ sentence', () => {
        expect(classifyInput('I want to learn German fast')).toBe('sentence');
    });

    it('含逗号且 token>=4 → sentence', () => {
        expect(classifyInput('Zum Beispiel, ich komme')).toBe('sentence');
    });

    it('含中文全角逗号且 token>=4 → sentence', () => {
        expect(classifyInput('one two， three four')).toBe('sentence');
    });

    // ---- 引号 / 空白处理 ----
    it('去除首尾引号后再判定，不影响词内撇号', () => {
        expect(classifyInput('"Ich liebe dich."')).toBe('sentence');
    });

    it('前后空白被 trim 后单词仍为 word', () => {
        expect(classifyInput('   Haus   ')).toBe('word');
    });

    // ---- 空输入 ----
    it('空串 → word', () => {
        expect(classifyInput('')).toBe('word');
    });

    it('纯空白 → word', () => {
        expect(classifyInput('   ')).toBe('word');
    });

    it('纯引号 → word', () => {
        expect(classifyInput('""')).toBe('word');
    });

    // ---- 边界：恰好 3 token + 终结标点 vs 恰好 4 token + 逗号 ----
    it('含逗号但 token<4 → word', () => {
        expect(classifyInput('yes, no')).toBe('word');
    });
});
