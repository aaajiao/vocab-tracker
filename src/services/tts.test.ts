import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 用可控的 Audio 桩替换真实音频：play() 立即 resolve，但 onended 只有手动触发才会调用，
// 这样测试可以精确控制「播放中 / 播放结束」的时机。
class MockAudio {
    static instances: MockAudio[] = [];
    src: string;
    currentTime = 0;
    paused = true;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(() => {
        this.paused = false;
        return Promise.resolve();
    });
    pause = vi.fn(() => {
        this.paused = true;
    });

    constructor(src?: string) {
        this.src = src ?? '';
        MockAudio.instances.push(this);
    }

    // 手动触发正常播放结束
    end(): void {
        this.onended?.();
    }
}

// 只覆写会碰真实 IndexedDB / 网络的函数，保留真实的 generateCacheKey。
vi.mock('./audioCache', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./audioCache')>();
    return {
        ...actual,
        getCachedAudio: vi.fn(async () => new Blob(['audio'])),
        setCachedAudio: vi.fn(async () => {}),
    };
});

import { speakWord } from './tts';

// 冲刷 microtask + macrotask 队列，让 speakWord 内部的 await 链推进到下一个稳定点
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let originalCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
    MockAudio.instances = [];
    vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url') as unknown as typeof URL.createObjectURL;
});

afterEach(() => {
    vi.unstubAllGlobals();
    URL.createObjectURL = originalCreateObjectURL;
    vi.clearAllMocks();
});

describe('speakWord 播放打断（B8：避免叠音 / 旧播放不清新指示）', () => {
    it('正常播放结束后清除 speakingId', async () => {
        const setSpeakingId = vi.fn();
        const p = speakWord('hello', 'en', setSpeakingId, 'word-1', '');
        await flush();

        expect(MockAudio.instances).toHaveLength(1);
        expect(setSpeakingId).toHaveBeenCalledWith('word-1');
        expect(setSpeakingId).not.toHaveBeenCalledWith(null);

        MockAudio.instances[0].end();
        await p;

        expect(setSpeakingId).toHaveBeenLastCalledWith(null);
    });

    it('新播放开始时暂停并归零上一段音频，避免叠音', async () => {
        const setSpeakingId = vi.fn();
        const p1 = speakWord('hello', 'en', setSpeakingId, 'word-1', '');
        await flush();
        const audio1 = MockAudio.instances[0];
        expect(audio1.paused).toBe(false);

        // 第二次调用应在开始时同步打断第一段
        const p2 = speakWord('world', 'en', setSpeakingId, 'word-2', '');
        expect(audio1.pause).toHaveBeenCalledTimes(1);
        expect(audio1.currentTime).toBe(0);

        await flush();
        expect(MockAudio.instances).toHaveLength(2);
        expect(setSpeakingId).toHaveBeenLastCalledWith('word-2');

        // 被打断的旧调用已解决，且没有清掉新的 speakingId
        await p1;
        expect(setSpeakingId).not.toHaveBeenCalledWith(null);

        // 新音频正常结束后才清除，且清的是新播放
        MockAudio.instances[1].end();
        await p2;
        expect(setSpeakingId).toHaveBeenLastCalledWith(null);
    });

    it('旧音频即便随后触发 onended 也不会清掉新播放的 speakingId', async () => {
        const setSpeakingId = vi.fn();
        const p1 = speakWord('hello', 'en', setSpeakingId, 'word-1', '');
        await flush();
        const audio1 = MockAudio.instances[0];

        const p2 = speakWord('world', 'en', setSpeakingId, 'word-2', '');
        await flush();

        // 打断后旧 Audio 的 onended 已被清空（handler 置 null），迟到的结束事件不应生效
        expect(audio1.onended).toBeNull();
        audio1.end(); // 无害：handler 为空
        await p1;

        expect(setSpeakingId).not.toHaveBeenCalledWith(null);
        expect(setSpeakingId).toHaveBeenLastCalledWith('word-2');

        MockAudio.instances[1].end();
        await p2;
        expect(setSpeakingId).toHaveBeenLastCalledWith(null);
    });
});
