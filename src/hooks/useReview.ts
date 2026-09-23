import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Word, ReviewGrade } from '../types';
import { previewIntervals, addDays } from '../services/srs';
import { getAll as getAllReviewStates, getPending as getLegacyPending, upsert as saveCanonicalState, remove as removeReviewCache, fromReviewRow, getReviewTimezone, saveReviewTimezone, type CachedReviewState } from '../services/reviewCache';
import { enqueueReviewEvent, getReviewEvents, projectReviewStates, syncReviewEvents, removeReviewEventsForWord, type ReviewEventInput } from '../services/reviewEventQueue';
import { learningRequest, learningErrorMessage, LearningApiError, type ApiReviewState } from '../services/learningApi';

const SESSION_LIMIT = 50;
function deviceTimezone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
function todayStr(timezone: string): string { return new Date().toLocaleDateString('sv-SE', { timeZone: timezone }); }
function localDate(iso: string, timezone: string): string { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: timezone }); }

export interface ReviewSessionData {
    cards: Word[];
    index: number;
    tally: { forgot: number; fuzzy: number; known: number };
}
export interface ReviewSummary {
    tally: { forgot: number; fuzzy: number; known: number };
    reviewedTodayCount: number;
    tomorrowDueCount: number;
    remainingDueCount: number;
}
interface UseReviewProps {
    userId: string | undefined;
    words: Word[];
    wordsLoading?: boolean;
    isOnline?: boolean;
    onLoadComplete?: () => void;
    onPendingChange?: () => void;
    onError?: (message: string) => void;
}
interface UseReviewReturn {
    loading: boolean;
    dueCount: number;
    reviewedTodayCount: number;
    totalTracked: number;
    tomorrowDueCount: number;
    aheadCount: number;
    session: ReviewSessionData | null;
    currentCard: Word | null;
    isSessionFinished: boolean;
    summary: ReviewSummary | null;
    startSession: () => void;
    startAheadSession: () => void;
    nextRound: () => void;
    endSession: () => void;
    gradeWord: (wordId: string, grade: ReviewGrade) => Promise<void>;
    previewFor: (wordId: string) => { forgot: number; fuzzy: number; known: number } | null;
    removeReviewState: (wordId: string) => void;
    refreshFromServer: () => Promise<void>;
    legacyPendingCount: number;
    failedEventCount: number;
}

export function useReview({ userId, words, wordsLoading = false, isOnline = true, onLoadComplete, onPendingChange, onError }: UseReviewProps): UseReviewReturn {
    const [view, setView] = useState<{ userId?: string; states: CachedReviewState[] }>({ states: [] });
    const [loading, setLoading] = useState(true);
    const [sessionView, setSessionView] = useState<{ userId?: string; session: ReviewSessionData | null }>({ session: null });
    const [legacyPendingCount, setLegacyPendingCount] = useState(0);
    const [timezoneView, setTimezoneView] = useState({ userId, timezone: deviceTimezone() });
    const timezoneRef = useRef({ userId, timezone: deviceTimezone() });
    const [failedView, setFailedView] = useState<{ userId?: string; count: number }>({ count: 0 });
    const userRef = useRef(userId);
    const wordsRef = useRef(words);
    const statesRef = useRef<CachedReviewState[]>([]);
    const sessionRef = useRef<ReviewSessionData | null>(null);
    const gradingRef = useRef(false);
    const refreshRef = useRef<AbortController | null>(null);
    const callbacks = useRef({ onLoadComplete, onPendingChange, onError });
    const mountedRef = useRef(false);
    const accountGeneration = useRef(0);
    userRef.current = userId;
    wordsRef.current = words;
    callbacks.current = { onLoadComplete, onPendingChange, onError };
    const states = view.userId === userId ? view.states : [];
    const session = sessionView.userId === userId ? sessionView.session : null;

    const commitSession = useCallback((next: ReviewSessionData | null) => {
        sessionRef.current = next;
        setSessionView({ userId: userRef.current, session: next });
    }, []);
    const loadProjection = useCallback(async (owner: string, signal?: AbortSignal) => {
        const [canonical, entries, legacy, savedTimezone] = await Promise.all([getAllReviewStates(owner), getReviewEvents(owner), getLegacyPending(), getReviewTimezone(owner)]);
        if (!mountedRef.current || userRef.current !== owner || signal?.aborted) return;
        const timezone = savedTimezone || deviceTimezone();
        timezoneRef.current = { userId: owner, timezone };
        setTimezoneView({ userId: owner, timezone });
        const projected = projectReviewStates(canonical, entries);
        statesRef.current = projected;
        setView({ userId: owner, states: projected });
        setLegacyPendingCount(legacy.length);
        setFailedView({ userId: owner, count: entries.filter((entry) => entry.status === 'failed').length });
    }, []);

    const refreshFromServer = useCallback(async () => {
        if (!userId) return;
        refreshRef.current?.abort();
        const controller = new AbortController();
        refreshRef.current = controller;
        const stillCurrent = () => !controller.signal.aborted && mountedRef.current && userRef.current === userId;
        setLoading(true);
        try {
            await loadProjection(userId, controller.signal);
            if (!stillCurrent() || !isOnline) return;
            const sync = await syncReviewEvents(userId);
            if (!stillCurrent()) return;
            callbacks.current.onPendingChange?.();
            if (sync.errors.length) callbacks.current.onError?.(sync.errors[0]);
            await loadProjection(userId, controller.signal);
            // 若上次写入可能已成功却未拿到回执，先保留本地基线，不能把云端结果再叠加该作答。
            if (!stillCurrent() || sync.pending > 0) return;
            const serverStates: ApiReviewState[] = [];
            let timezone: string | undefined;
            let offset = 0;
            for (;;) {
                const result = await learningRequest<Array<{ word: { id: string }; state: ApiReviewState }>>(`/review?mode=all&limit=100&offset=${offset}${timezone ? `&timezone=${encodeURIComponent(timezone)}` : ''}`, { userId, signal: controller.signal });
                if (typeof result.meta?.timezone === 'string') timezone = result.meta.timezone;
                serverStates.push(...result.data.map((item) => item.state));
                if (!result.meta?.has_more) break;
                const next = result.meta.next_offset;
                if (typeof next !== 'number' || !Number.isInteger(next) || next <= offset) throw new LearningApiError('invalid_response', '复习记录分页无效，请刷新后再试。');
                offset = next;
            }
            if (!stillCurrent()) return;
            // 拉取期间可能又保存了作答。若存在尚未确认的事件，放弃这份可能已包含其结果的快照。
            if (timezone) await saveReviewTimezone(userId, timezone);
            const concurrentEntries = await getReviewEvents(userId);
            if (!stillCurrent()) return;
            if (!concurrentEntries.some((entry) => entry.status !== 'failed')) {
                for (const state of serverStates) {
                    if (!stillCurrent()) return;
                    await saveCanonicalState(fromReviewRow(state), 'synced', userId);
                }
            }
            await loadProjection(userId, controller.signal);
        } catch (cause) {
            if (stillCurrent()) callbacks.current.onError?.(learningErrorMessage(cause));
        } finally {
            if (stillCurrent()) {
                setLoading(false);
                callbacks.current.onLoadComplete?.();
            }
        }
    }, [userId, isOnline, loadProjection]);

    useEffect(() => {
        accountGeneration.current++;
        statesRef.current = [];
        timezoneRef.current = { userId, timezone: deviceTimezone() };
        setTimezoneView(timezoneRef.current);
        sessionRef.current = null;
        setSessionView({ userId, session: null });
        setView({ userId, states: [] });
        gradingRef.current = false;
    }, [userId]);

    useEffect(() => {
        mountedRef.current = true;
        if (userId) void refreshFromServer(); else setLoading(false);
        return () => { mountedRef.current = false; refreshRef.current?.abort(); };
    }, [userId, refreshFromServer]);

    // 新同步进云端的单词由 /review 原子补齐状态；浏览器不再盲写初始排期。
    const wordKey = useMemo(() => words.filter((word) => !word.id.startsWith('temp_')).map((word) => word.id).sort().join(','), [words]);
    const previousWordKey = useRef(wordKey);
    useEffect(() => {
        if (wordsLoading) return;
        const changed = previousWordKey.current !== wordKey;
        previousWordKey.current = wordKey;
        if (changed && !wordsLoading && userId && isOnline) void refreshFromServer();
    }, [wordKey, wordsLoading, userId, isOnline, refreshFromServer]);

    const visibleStates = useMemo(() => {
        const ids = new Set(words.map((word) => word.id));
        return states.filter((state) => ids.has(state.wordId) && !state.wordId.startsWith('temp_'));
    }, [states, words]);
    const timezone = timezoneView.userId === userId ? timezoneView.timezone : deviceTimezone();
    const today = todayStr(timezone);
    const dueCount = visibleStates.filter((state) => state.due <= today).length;
    const reviewedTodayCount = visibleStates.filter((state) => state.lastReviewedAt && localDate(state.lastReviewedAt, timezone) === today).length;
    const tomorrowDueCount = visibleStates.filter((state) => state.due === addDays(today, 1)).length;
    const aheadCount = visibleStates.filter((state) => state.due > today).length;

    const buildSession = useCallback((ahead = false) => {
        if (!userRef.current) return;
        const wordMap = new Map(wordsRef.current.map((word) => [word.id, word]));
        const cards = statesRef.current.filter((state) => wordMap.has(state.wordId) && !state.wordId.startsWith('temp_') && (ahead || state.due <= todayStr(timezoneRef.current.timezone)))
            .sort((a, b) => a.due.localeCompare(b.due)).slice(0, SESSION_LIMIT).map((state) => wordMap.get(state.wordId)!);
        commitSession({ cards, index: 0, tally: { forgot: 0, fuzzy: 0, known: 0 } });
    }, [commitSession]);
    const startSession = useCallback(() => buildSession(), [buildSession]);
    const startAheadSession = useCallback(() => buildSession(true), [buildSession]);
    const endSession = useCallback(() => commitSession(null), [commitSession]);

    const gradeWord = useCallback(async (wordId: string, grade: ReviewGrade) => {
        if (!userId || userRef.current !== userId || gradingRef.current || wordId.startsWith('temp_')) return;
        const attemptSession = sessionRef.current;
        if (!attemptSession || attemptSession.cards[attemptSession.index]?.id !== wordId) return;
        gradingRef.current = true;
        const generation = accountGeneration.current;
        const event: ReviewEventInput = { id: crypto.randomUUID(), word_id: wordId, grade, source: 'web', practiced_at: new Date().toISOString(), timezone: timezoneRef.current.userId === userId ? timezoneRef.current.timezone : deviceTimezone() };
        try {
            await enqueueReviewEvent(userId, event);
            if (!mountedRef.current || userRef.current !== userId || generation !== accountGeneration.current) return;
            // 事务已提交，此时才能显示已完成；预测仅留在内存，不把它写回权威缓存。
            const projected = projectReviewStates(statesRef.current, [{ sequence: 0, user_id: userId, event, status: 'pending' }]);
            statesRef.current = projected;
            setView({ userId, states: projected });
            if (sessionRef.current === attemptSession) commitSession({ ...attemptSession, index: attemptSession.index + 1, tally: { ...attemptSession.tally, [grade]: attemptSession.tally[grade] + 1 } });
            callbacks.current.onPendingChange?.();
        } catch {
            if (mountedRef.current && userRef.current === userId) callbacks.current.onError?.('无法保存这次作答，卡片尚未前进。请检查本机存储后重试。');
            return;
        } finally {
            if (userRef.current === userId && generation === accountGeneration.current) gradingRef.current = false;
        }
        if (isOnline && mountedRef.current && userRef.current === userId) void refreshFromServer();
    }, [userId, isOnline, loadProjection, commitSession, refreshFromServer]);

    const previewFor = useCallback((wordId: string) => {
        const state = statesRef.current.find((entry) => entry.wordId === wordId);
        return state ? previewIntervals(state, todayStr(timezoneRef.current.timezone)) : null;
    }, []);
    const removeReviewState = useCallback((wordId: string) => {
        if (!userId) return;
        statesRef.current = statesRef.current.filter((state) => state.wordId !== wordId);
        setView({ userId, states: statesRef.current });
        void Promise.all([removeReviewCache(wordId, userId), removeReviewEventsForWord(userId, wordId)]).then(() => callbacks.current.onPendingChange?.()).catch(() => callbacks.current.onError?.('本地复习记录清理失败，请刷新后再试。'));
    }, [userId]);

    const isSessionFinished = session !== null && session.index >= session.cards.length;
    const currentCard = session && !isSessionFinished ? session.cards[session.index] ?? null : null;
    const summary: ReviewSummary | null = session && isSessionFinished ? { tally: session.tally, reviewedTodayCount, tomorrowDueCount, remainingDueCount: dueCount } : null;
    return { loading, dueCount, reviewedTodayCount, totalTracked: visibleStates.length, tomorrowDueCount, aheadCount, session, currentCard, isSessionFinished, summary, startSession, startAheadSession, nextRound: startSession, endSession, gradeWord, previewFor, removeReviewState, refreshFromServer, legacyPendingCount, failedEventCount: failedView.userId === userId ? failedView.count : 0 };
}

export default useReview;
