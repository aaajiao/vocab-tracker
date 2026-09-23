import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueReviewEvent, getReviewEvents, syncReviewEvents, getPendingReviewEventCount, projectReviewStates, clearReviewEventQueue, type ReviewEventInput, type QueuedReviewEvent } from './reviewEventQueue';
import * as cache from './reviewCache';
import { LearningApiError, type ApiReviewState } from './learningApi';
import { initReviewState } from './srs';

const request = vi.hoisted(() => vi.fn());
vi.mock('./learningApi', async (original) => ({ ...await original<typeof import('./learningApi')>(), learningRequest: request }));
vi.mock('../supabaseClient', () => ({ supabase: { auth: {} } }));

const event = (id: string, overrides: Partial<ReviewEventInput> = {}): ReviewEventInput => ({ id, word_id: 'word-a', grade: 'known', source: 'web', practiced_at: '2026-09-23T10:00:00.000Z', timezone: 'Europe/Berlin', ...overrides });
const state = (overrides: Partial<ApiReviewState> = {}): ApiReviewState => ({ word_id: 'word-a', due: '2026-09-26', interval_days: 3, ease: 2.5, reps: 1, lapses: 0, last_reviewed_at: '2026-09-23T10:00:00.000Z', updated_at: '2026-09-23T10:00:01.000Z', ...overrides });
const accepted = (value = state(), replayed = false) => ({ data: { event: {}, state: value, replayed } });

describe('review event outbox', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await cache.clear();
        await clearReviewEventQueue();
        request.mockResolvedValue(accepted());
    });
    afterEach(() => vi.restoreAllMocks());

    it('commits separate attempts in FIFO order and stores only authoritative state', async () => {
        await enqueueReviewEvent('user-a', event('first'));
        await enqueueReviewEvent('user-a', event('second', { practiced_at: '2026-09-23T10:01:00.000Z' }));
        request.mockResolvedValueOnce(accepted()).mockResolvedValueOnce(accepted(state({ reps: 2, interval_days: 8, due: '2026-10-01', last_reviewed_at: '2026-09-23T10:01:00.000Z', updated_at: '2026-09-23T10:01:01.000Z' })));
        const result = await syncReviewEvents('user-a');
        expect(result.synced).toBe(2);
        expect(request.mock.calls.map((call) => call[1].body.id)).toEqual(['first', 'second']);
        expect(request.mock.calls.every((call) => !('user_id' in call[1].body))).toBe(true);
        expect((await cache.get('word-a', 'user-a'))?.reps).toBe(2);
        expect(await getReviewEvents('user-a')).toEqual([]);
    });

    it('never submits or counts another account’s events', async () => {
        await enqueueReviewEvent('user-a', event('a'));
        await enqueueReviewEvent('user-b', event('b'));
        await syncReviewEvents('user-a');
        expect(request).toHaveBeenCalledOnce();
        expect(request.mock.calls[0][1].userId).toBe('user-a');
        expect(await getPendingReviewEventCount('user-a')).toBe(0);
        expect(await getPendingReviewEventCount('user-b')).toBe(1);
        expect(await cache.getAll('user-b')).toEqual([]);
    });

    it('retries with the same ID after acknowledgement loss and does not count twice', async () => {
        await cache.upsert(initReviewState('word-a', '2026-09-23', '2026-09-23T09:00:00Z'), 'synced', 'user-a');
        await enqueueReviewEvent('user-a', event('stable-attempt'));
        request.mockRejectedValueOnce(new LearningApiError('network_error', '连接失败'));
        expect((await syncReviewEvents('user-a')).pending).toBe(1);
        const prediction = projectReviewStates(await cache.getAll('user-a'), await getReviewEvents('user-a'));
        expect(prediction[0].reps).toBe(1);
        request.mockResolvedValueOnce(accepted(state({ reps: 5 }), true));
        await syncReviewEvents('user-a');
        expect(request.mock.calls.map((call) => call[1].body.id)).toEqual(['stable-attempt', 'stable-attempt']);
        expect(projectReviewStates(await cache.getAll('user-a'), await getReviewEvents('user-a'))[0].reps).toBe(5);
    });

    it('persists acceptance before caching so a local cache failure cannot reapply a grade', async () => {
        await enqueueReviewEvent('user-a', event('accepted-once'));
        vi.spyOn(cache, 'upsert').mockRejectedValueOnce(new Error('local cache unavailable'));
        const first = await syncReviewEvents('user-a');
        expect(first.pending).toBe(1);
        const entries = await getReviewEvents('user-a');
        expect(entries[0].status).toBe('acknowledged');
        expect(projectReviewStates([], entries)[0].reps).toBe(1);
        await syncReviewEvents('user-a');
        expect(request).toHaveBeenCalledOnce();
        expect(await getReviewEvents('user-a')).toEqual([]);
        expect((await cache.get('word-a', 'user-a'))?.reps).toBe(1);
    });

    it('stops FIFO on expired login and leaves every event retryable', async () => {
        await enqueueReviewEvent('user-a', event('first'));
        await enqueueReviewEvent('user-a', event('second'));
        request.mockRejectedValueOnce(new LearningApiError('unauthorized', '登录已失效', 401));
        const result = await syncReviewEvents('user-a');
        expect(result.pending).toBe(2);
        expect(result.deadLettered).toBe(0);
        expect(request).toHaveBeenCalledOnce();
    });

    it('retains terminal conflicts as visible backups and continues other attempts', async () => {
        await enqueueReviewEvent('user-a', event('conflict'));
        await enqueueReviewEvent('user-a', event('valid'));
        request.mockRejectedValueOnce(new LearningApiError('conflict', '冲突', 409));
        const result = await syncReviewEvents('user-a');
        expect(result.deadLettered).toBe(1);
        expect(result.synced).toBe(1);
        expect(result.errors[0]).toContain('冲突');
        expect(await getPendingReviewEventCount('user-a')).toBe(0);
        expect((await getReviewEvents('user-a'))[0].status).toBe('failed');
        await syncReviewEvents('user-a');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('discards events for deleted words and clears their stale account cache', async () => {
        await cache.upsert(cache.fromReviewRow(state()), 'synced', 'user-a');
        await cache.upsert(cache.fromReviewRow(state()), 'synced', 'user-b');
        await enqueueReviewEvent('user-a', event('deleted'));
        request.mockRejectedValueOnce(new LearningApiError('word_not_found', '词已删除', 404));
        const result = await syncReviewEvents('user-a');
        expect(result.failed).toBe(0);
        expect(await cache.get('word-a', 'user-a')).toBeUndefined();
        expect(await cache.get('word-a', 'user-b')).toBeDefined();
        expect(await getReviewEvents('user-a')).toEqual([]);
    });

    it('handles replayed events whose word was subsequently deleted', async () => {
        await cache.upsert(cache.fromReviewRow(state()), 'synced', 'user-a');
        await enqueueReviewEvent('user-a', event('deleted-after-save'));
        request.mockResolvedValueOnce({ data: { event: {}, state: null, replayed: true } });
        expect((await syncReviewEvents('user-a')).synced).toBe(1);
        expect(await cache.get('word-a', 'user-a')).toBeUndefined();
    });

    it('projects delayed offline attempts without rolling back newer cloud learning', () => {
        const base = cache.fromReviewRow(state({ reps: 7, interval_days: 20, last_reviewed_at: '2026-09-23T12:00:00.000Z', updated_at: '2026-09-23T12:00:01.000Z' }));
        const pending: QueuedReviewEvent = { sequence: 1, user_id: 'user-a', event: event('older'), status: 'pending' };
        expect(projectReviewStates([base], [pending])[0].reps).toBe(7);
        const equal = { ...pending, event: event('equal', { practiced_at: '2026-09-23T12:00:00.000Z' }) };
        expect(projectReviewStates([base], [equal])[0].reps).toBe(8);
    });

    it('enqueues a given attempt once and rejects cross-account ID reuse', async () => {
        await enqueueReviewEvent('user-a', event('same'));
        await enqueueReviewEvent('user-a', event('same'));
        expect(await getReviewEvents('user-a')).toHaveLength(1);
        await expect(enqueueReviewEvent('user-b', event('same'))).rejects.toThrow();
        expect(await getReviewEvents('user-b')).toEqual([]);
    });

    it('rejects failed local transactions instead of reporting a saved attempt', async () => {
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        await expect(enqueueReviewEvent('user-a', event('storage-failed'))).rejects.toThrow();
        expect(await getReviewEvents('user-a')).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });

    it('coalesces concurrent syncs for the same account', async () => {
        await enqueueReviewEvent('user-a', event('concurrent'));
        const [one, two] = await Promise.all([syncReviewEvents('user-a'), syncReviewEvents('user-a')]);
        expect(one).toBe(two);
        expect(request).toHaveBeenCalledOnce();
    });
});
