import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useReview } from './useReview';
import type { Word } from '../types';
import { clear as clearCache, upsert, get as getCachedState, fromReviewRow, getReviewTimezone } from '../services/reviewCache';
import { clearReviewEventQueue, enqueueReviewEvent, getReviewEvents } from '../services/reviewEventQueue';
import { LearningApiError, type ApiReviewState } from '../services/learningApi';

const request = vi.hoisted(() => vi.fn());
vi.mock('../services/learningApi', async (original) => ({ ...await original<typeof import('../services/learningApi')>(), learningRequest: request }));
vi.mock('../supabaseClient', () => ({ supabase: { auth: {} } }));

const word: Word = { id: 'word-a', word: 'Haus', meaning: '房子', language: 'de', example: 'Das Haus ist groß.', exampleCn: '房子很大。', category: 'daily', date: '2026-09-23', timestamp: 1 };
const words = [word];
function baseline(): ApiReviewState { return { word_id: word.id, due: '2020-01-01', interval_days: 0, ease: 2.5, reps: 0, lapses: 0, last_reviewed_at: null, updated_at: '2020-01-01T00:00:00.000Z' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }

describe('useReview durable event flow', () => {
    let root: Root;
    let container: HTMLDivElement;
    let current: ReturnType<typeof useReview>;
    const onError = vi.fn();

    function Probe({ userId = 'user-a', online = false }: { userId?: string; online?: boolean }) {
        current = useReview({ userId, words, isOnline: online, onError });
        return <span>{current.session?.index ?? 'idle'}</span>;
    }
    async function settle(check: () => boolean = () => !current.loading) {
        for (let i = 0; i < 100; i++) {
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });
            if (check()) return;
        }
        throw new Error('hook did not settle');
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        await clearCache();
        await clearReviewEventQueue();
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        await upsert(fromReviewRow(baseline()), 'synced', 'user-a');
        request.mockImplementation(async (path: string) => {
            if (path.startsWith('/review')) return { data: [{ word: { id: word.id }, state: baseline() }], meta: { has_more: false } };
            return { data: { event: {}, state: { ...baseline(), interval_days: 3, reps: 1, due: '2099-01-01', last_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, replayed: false } };
        });
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('keeps the current card on local transaction failure and reports the failure', async () => {
        await act(async () => root.render(<Probe />));
        await settle();
        await act(async () => current.startSession());
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
        await act(async () => current.gradeWord(word.id, 'known'));
        expect(current.session?.index).toBe(0);
        expect(current.currentCard?.id).toBe(word.id);
        expect(current.session?.tally.known).toBe(0);
        expect(await getReviewEvents('user-a')).toEqual([]);
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('卡片尚未前进'));
    });

    it('persists once before advancing and keeps predictions out of canonical storage', async () => {
        await act(async () => root.render(<Probe />));
        await settle();
        await act(async () => current.startSession());
        await act(async () => Promise.all([current.gradeWord(word.id, 'known'), current.gradeWord(word.id, 'known')]));
        expect(current.session?.index).toBe(1);
        expect(current.session?.tally.known).toBe(1);
        expect(await getReviewEvents('user-a')).toHaveLength(1);
        expect((await getCachedState(word.id, 'user-a'))?.reps).toBe(0);
        expect(current.previewFor(word.id)?.known).toBe(8);
        expect(request).not.toHaveBeenCalled();
    });

    it('never shows the previous account’s cached state after switching accounts', async () => {
        await act(async () => root.render(<Probe userId="user-a" />));
        await settle();
        expect(current.totalTracked).toBe(1);
        await act(async () => current.startSession());
        await act(async () => root.render(<Probe userId="user-b" />));
        expect(current.totalTracked).toBe(0);
        expect(current.session).toBeNull();
        await settle();
        expect(current.totalTracked).toBe(0);
        expect(await getCachedState(word.id, 'user-a')).toBeDefined();
    });

    it('does not fetch a possibly updated cloud baseline while an acknowledgement is uncertain', async () => {
        await enqueueReviewEvent('user-a', { id: 'attempt-a', word_id: word.id, grade: 'known', source: 'web', practiced_at: new Date().toISOString(), timezone: 'Europe/Berlin' });
        request.mockRejectedValueOnce(new LearningApiError('network_error', '连接失败'));
        await act(async () => root.render(<Probe online />));
        await settle();
        expect(request).toHaveBeenCalledOnce();
        expect(request.mock.calls[0][0]).toBe('/events');
        expect(current.previewFor(word.id)?.known).toBe(8);
        expect(await getReviewEvents('user-a')).toHaveLength(1);
    });

    it('ignores a slower old-account cloud response', async () => {
        const oldResponse = deferred<unknown>();
        request.mockImplementation((path: string, options: { userId: string }) => options.userId === 'user-a' ? oldResponse.promise : Promise.resolve({ data: [], meta: { has_more: false } }));
        await act(async () => root.render(<Probe online userId="user-a" />));
        await settle(() => request.mock.calls.length > 0);
        await act(async () => root.render(<Probe online userId="user-b" />));
        await settle();
        await act(async () => oldResponse.resolve({ data: [{ word: { id: word.id }, state: baseline() }], meta: { has_more: false } }));
        expect(current.totalTracked).toBe(0);
        expect(await getCachedState(word.id, 'user-b')).toBeUndefined();
    });

    it('uses the saved learning timezone for day boundaries and offline events', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-23T00:30:00.000Z'));
        request.mockResolvedValue({ data: [{ word: { id: word.id }, state: { ...baseline(), due: '2026-09-23', last_reviewed_at: '2026-09-22T23:45:00.000Z', updated_at: '2026-09-23T00:00:00.000Z' } }], meta: { has_more: false, timezone: 'America/Los_Angeles' } });
        await act(async () => root.render(<Probe online />));
        await settle();
        expect(current.dueCount).toBe(0);
        expect(current.aheadCount).toBe(1);
        expect(current.reviewedTodayCount).toBe(1);
        expect(await getReviewTimezone('user-a')).toBe('America/Los_Angeles');
        expect(await getReviewTimezone('user-b')).toBeUndefined();
        expect(request.mock.calls[0][0]).not.toContain('timezone=');
        await act(async () => root.render(<Probe online={false} />));
        await settle();
        await act(async () => current.startAheadSession());
        await act(async () => current.gradeWord(word.id, 'known'));
        const entries = await getReviewEvents('user-a');
        expect(entries[0].event.timezone).toBe('America/Los_Angeles');
        expect(entries[0].event.practiced_at).toBe('2026-09-23T00:30:00.000Z');
    });

    it('survives StrictMode effect replay without creating review events', async () => {
        await act(async () => root.render(<StrictMode><Probe online /></StrictMode>));
        await settle();
        expect(current.totalTracked).toBe(1);
        expect(await getReviewEvents('user-a')).toEqual([]);
        expect(request.mock.calls.every((call) => call[0].startsWith('/review'))).toBe(true);
    });
});
