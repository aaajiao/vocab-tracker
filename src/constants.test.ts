import { describe, it, expect } from 'vitest';
import { sceneFromRegister, SOURCE_TYPE_LABELS } from './constants';

describe('sceneFromRegister', () => {
    it('把三个合法语域映射为中文标签', () => {
        expect(sceneFromRegister('daily')).toBe('日常');
        expect(sceneFromRegister('professional')).toBe('专业');
        expect(sceneFromRegister('formal')).toBe('正式');
    });

    it('缺省 / null / undefined → null', () => {
        expect(sceneFromRegister()).toBeNull();
        expect(sceneFromRegister(null)).toBeNull();
        expect(sceneFromRegister(undefined)).toBeNull();
    });
});

describe('SOURCE_TYPE_LABELS', () => {
    it('三种来源类型都有中文文案', () => {
        expect(SOURCE_TYPE_LABELS.combined).toBe('组合造句');
        expect(SOURCE_TYPE_LABELS.word).toBe('单词例句');
        expect(SOURCE_TYPE_LABELS.input).toBe('我的句子');
    });
});
