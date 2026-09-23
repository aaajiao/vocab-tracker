import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { learningRequest, LEARNING_REQUEST_TIMEOUT_MS } from './learningApi';
import { enqueueReviewEvent, getReviewEvents, syncReviewEvents } from './reviewEventQueue';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: { auth } }));
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
    vi.useFakeTimers(); auth.getSession.mockReset(); auth.refreshSession.mockReset(); fetcher.mockReset();
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'timeout-owner' }, access_token: 'not-a-real-token' } }, error: null });
    vi.stubGlobal('fetch', fetcher); fetcher.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('请求期限与复习同步恢复', () => {
    it('无响应的读取和登录读取都在默认期限内结束，调用方取消仍立即生效', async () => {
        const first = learningRequest('/words', { userId: 'timeout-owner' }).catch(error => error);
        await vi.advanceTimersByTimeAsync(LEARNING_REQUEST_TIMEOUT_MS + 1);
        expect(await first).toMatchObject({ code: 'timeout', status: 0 }); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
        auth.getSession.mockImplementationOnce(() => new Promise(() => {}));
        const second = learningRequest('/words').catch(error => error); await vi.advanceTimersByTimeAsync(LEARNING_REQUEST_TIMEOUT_MS + 1);
        expect(await second).toMatchObject({ code: 'timeout' });
        const controller = new AbortController(), third = learningRequest('/words', { signal: controller.signal }).catch(error => error);
        controller.abort(); expect(await third).toMatchObject({ name: 'AbortError' });
    });
    it('挂起的复习写入超时后释放同步锁，重试仍提交同一个作答UUID', async () => {
        const event = { id: crypto.randomUUID(), word_id: crypto.randomUUID(), grade: 'known' as const, source: 'web' as const, practiced_at: '2026-09-23T10:00:00Z', timezone: 'UTC' };
        // 保留 IndexedDB 的真实任务队列，仅把被测的15秒网络期限缩短到20毫秒。
        vi.useRealTimers(); await enqueueReviewEvent('timeout-owner', event);
        const realSetTimeout = globalThis.setTimeout;
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, ms, ...args) => realSetTimeout(callback, ms === LEARNING_REQUEST_TIMEOUT_MS ? 20 : ms, ...args));
        const failed = await syncReviewEvents('timeout-owner');
        expect(failed.failed).toBe(1); expect((await getReviewEvents('timeout-owner'))[0].event.id).toBe(event.id);
        fetcher.mockResolvedValue(new Response(JSON.stringify({ data: { event, state: null, replayed: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const retried = await syncReviewEvents('timeout-owner'); expect(retried.synced).toBe(1); expect(await getReviewEvents('timeout-owner')).toEqual([]);
        expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)).id)).toEqual([event.id, event.id]);
    });
});
