import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import type { Word, ReviewGrade, ReviewState } from '../types';
import {
    initReviewState,
    applyGrade,
    previewIntervals,
    addDays,
} from '../services/srs';
import {
    getAll as getAllReviewStates,
    upsert as upsertReviewCache,
    markSynced as markReviewSyncedCache,
    remove as removeReviewCache,
    toReviewRow,
    fromReviewRow,
    type CachedReviewState,
    type ReviewSyncStatus,
    type ReviewRow,
} from '../services/reviewCache';

// 单次 session 最多 50 张卡
const SESSION_LIMIT = 50;
// 存量词库回填错峰：每批 20 个，due 依次顺延一天
const BACKFILL_BATCH = 20;

// 当前时区的 YYYY-MM-DD（与 words 表 date 字段一致，用 sv-SE locale 得到 ISO 日期）
function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE');
}
function nowIso(): string {
    return new Date().toISOString();
}
// ISO 时间戳 → 本地 YYYY-MM-DD
function localDate(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE');
}
// 比较两个 ISO 时间戳，a 是否严格更新（用数值比较，规避 +00:00 / Z 字符串差异）
function isNewer(a: string, b: string): boolean {
    return new Date(a).getTime() > new Date(b).getTime();
}

export interface ReviewSessionData {
    cards: Word[];                                              // 本组待复习的词卡快照
    index: number;                                             // 当前进度（已评级张数）
    tally: { forgot: number; fuzzy: number; known: number };  // 本组各评级计数
}

export interface ReviewSummary {
    tally: { forgot: number; fuzzy: number; known: number };
    reviewedTodayCount: number;   // 今日已复习总数
    tomorrowDueCount: number;     // 明日到期数
    remainingDueCount: number;    // 仍有多少到期词（>0 时可「再来一组」）
}

interface UseReviewProps {
    userId: string | undefined;
    // 复习状态需要词卡信息（词、义、例句…），由 useWords 的 words 传入，二者组合于 App.tsx
    words: Word[];
    // useWords 的加载态：words 完整加载（服务端全量已回）前不做孤儿清理/回填，
    // 避免 cache-first 下 words 仍是过期子集时把尚未加载的词误判为孤儿删除、随后回填成初始态丢进度。
    wordsLoading?: boolean;
    isOnline?: boolean;
    onLoadComplete?: () => void;
    onPendingChange?: () => void;
}

interface UseReviewReturn {
    loading: boolean;
    // 统计
    dueCount: number;
    reviewedTodayCount: number;
    totalTracked: number;
    tomorrowDueCount: number;
    // 未到期但可「提前复习」的词数（due > 今天，非 temp）
    aheadCount: number;
    // session
    session: ReviewSessionData | null;
    currentCard: Word | null;
    isSessionFinished: boolean;
    summary: ReviewSummary | null;
    startSession: () => void;
    // 提前复习：无到期词时按到期日从近到远取一组
    startAheadSession: () => void;
    nextRound: () => void;
    endSession: () => void;
    gradeWord: (wordId: string, grade: ReviewGrade) => Promise<void>;
    // 当前词卡三键的「下次间隔」预览（天数）；无状态则返回 null
    previewFor: (wordId: string) => { forgot: number; fuzzy: number; known: number } | null;
    // 删词联动：删除某词的本地复习状态（服务端靠 CASCADE），供 App 的删除入口 fire-and-forget 调用
    removeReviewState: (wordId: string) => void;
}

export function useReview({
    userId,
    words,
    wordsLoading = false,
    isOnline = true,
    onLoadComplete,
    onPendingChange,
}: UseReviewProps): UseReviewReturn {
    const [states, setStates] = useState<CachedReviewState[]>([]);
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<ReviewSessionData | null>(null);
    // 服务端复习状态是否已在本次会话中成功拉取（权威基线）。
    // 仅当为 true 时才允许懒回填——否则「review_states 拉取失败但 words 拉取成功」的差异性失败下，
    // 会把服务端已有进度误判为缺失并用初始态盲写 upsert 覆盖（静默清零）。
    const [serverLoaded, setServerLoaded] = useState(false);

    // 用 ref 镜像最新 states / words，供稳定回调与副作用读取，避免闭包过期
    const statesRef = useRef(states);
    const wordsRef = useRef(words);
    useEffect(() => { statesRef.current = states; }, [states]);
    useEffect(() => { wordsRef.current = words; }, [words]);

    // 同步更新 state 与 ref，保证同一 tick 内连续调用读到最新值
    const commitStates = useCallback((next: CachedReviewState[]) => {
        statesRef.current = next;
        setStates(next);
    }, []);

    // 本地 upsert 一条状态
    const upsertLocal = useCallback((updated: ReviewState, syncStatus: ReviewSyncStatus) => {
        const cached: CachedReviewState = { ...updated, syncStatus };
        const prev = statesRef.current;
        const idx = prev.findIndex(s => s.wordId === updated.wordId);
        const next = idx >= 0
            ? prev.map(s => (s.wordId === updated.wordId ? cached : s))
            : [...prev, cached];
        commitStates(next);
    }, [commitStates]);

    // 本地标记某状态为已同步
    const markSyncedLocal = useCallback((wordId: string, updatedAt: string) => {
        const next = statesRef.current.map(s =>
            s.wordId === wordId ? { ...s, syncStatus: 'synced' as const, updatedAt } : s,
        );
        commitStates(next);
    }, [commitStates]);

    // LWW 合并：本地缓存与服务端状态按 updatedAt 新者胜；服务端权威项落盘为 synced。
    // 返回合并后的完整数组。
    const mergeStates = useCallback(async (
        local: CachedReviewState[],
        server: ReviewState[],
    ): Promise<CachedReviewState[]> => {
        const result = new Map<string, CachedReviewState>();
        for (const s of local) result.set(s.wordId, s);

        for (const srv of server) {
            const loc = result.get(srv.wordId);
            // 服务端胜：本地不存在，或本地不比服务端新（含相等时以服务端 synced 为准）
            if (!loc || !isNewer(loc.updatedAt, srv.updatedAt)) {
                const cached: CachedReviewState = { ...srv, syncStatus: 'synced' };
                result.set(srv.wordId, cached);
                await upsertReviewCache(srv, 'synced');
            }
            // 否则本地（通常是较新的 pending_upsert）保留，留待同步上行
        }
        return Array.from(result.values());
    }, []);

    // ---- Cache-first 加载 + Supabase LWW 合并 ----
    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            // 每次加载先重置权威标志；仅在服务端拉取成功后再置回 true。
            setServerLoaded(false);
            try {
                // Step 1: 缓存优先，立即出 UI
                const cached = await getAllReviewStates();
                if (!cancelled && cached.length > 0) commitStates(cached);

                // Step 2: 在线则拉服务端并按 updatedAt LWW 合并
                if (isOnline) {
                    const { data, error } = await supabase
                        .from('review_states')
                        .select('*')
                        .eq('user_id', userId);

                    if (error) {
                        // 表未迁移 / 网络错误：优雅降级，保留本地缓存照常工作。
                        // serverLoaded 保持 false —— 本次会话不做回填，避免用初始态覆盖服务端未拉到的真实进度。
                        console.error('Load review states error:', error);
                    } else {
                        const serverStates = (data as ReviewRow[] | null || []).map(fromReviewRow);
                        const merged = await mergeStates(statesRef.current, serverStates);
                        if (!cancelled) {
                            commitStates(merged);
                            // 服务端状态已权威加载：statesRef 现含全部服务端进度，
                            // 此后判为「缺状态」的词才是真正需要回填的（不会误覆盖已有进度）。
                            setServerLoaded(true);
                        }
                    }
                }
            } catch (e) {
                console.error('useReview load failed:', e);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    onLoadComplete?.();
                }
            }
        };

        load();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, isOnline]);

    // ---- 与 words 对账：孤儿清理 + 懒回填 ----
    // 依赖 words / loading：words 加载完成或后续变化（新增/删除词）时重新对账。
    // 不依赖 states，读 statesRef.current，避免自身 setStates 触发的循环。
    useEffect(() => {
        if (!userId || loading) return;
        // 等待 useWords 完整加载：cache-first 下 words 可能先是过期子集，服务端全量未回时贸然对账，
        // 会把「尚未加载」的词误判为孤儿删除、随后回填成初始态，本地与服务端 SRS 进度双双清零。
        if (wordsLoading) return;
        // words 为空可能是尚未加载：跳过对账，避免把全部状态误判为孤儿删光
        if (words.length === 0) return;
        let cancelled = false;

        const reconcile = async () => {
            try {
                const currentStates = statesRef.current;
                const wordIds = new Set(words.map(w => w.id));
                const stateByWord = new Map(currentStates.map(s => [s.wordId, s]));

                // 孤儿：没有对应 word 的本地状态（防御性；正常删词走 removeReviewState + 服务端 CASCADE）
                const orphans = currentStates.filter(s => !wordIds.has(s.wordId));

                // 待回填：非 temp 且尚无状态的词，按 created_at（timestamp）从新到旧。
                // 仅在服务端状态已权威加载（serverLoaded）时才回填——否则拉取失败时会把服务端已有进度
                // 误判为缺失并用初始态盲写覆盖。未加载则本轮只做孤儿清理，待服务端加载成功后再回填。
                const missing = serverLoaded
                    ? words
                        .filter(w => !w.id.startsWith('temp_') && !stateByWord.has(w.id))
                        .sort((a, b) => b.timestamp - a.timestamp)
                    : [];

                if (orphans.length === 0 && missing.length === 0) return;

                // 删孤儿（本地）
                for (const o of orphans) await removeReviewCache(o.wordId);

                // 建回填状态：>20 个时按批错峰 due（前 20 个当天、次 20 个明天…）
                // 第一批当天到期：让首次启用复习的用户立刻有卡可刷，而不是空等一天
                const today = todayStr();
                const now = nowIso();
                const created: CachedReviewState[] = missing.map((w, i) => {
                    const bucket = Math.floor(i / BACKFILL_BATCH);
                    const base = initReviewState(w.id, today, now);
                    const st: ReviewState = { ...base, due: addDays(today, bucket) };
                    return { ...st, syncStatus: 'pending_upsert' };
                });
                for (const c of created) await upsertReviewCache(c, 'pending_upsert');

                // 更新内存：去孤儿 + 加回填
                const orphanIds = new Set(orphans.map(o => o.wordId));
                const next = [
                    ...statesRef.current.filter(s => !orphanIds.has(s.wordId) && !created.some(c => c.wordId === s.wordId)),
                    ...created,
                ];
                if (cancelled) return;
                commitStates(next);

                // 在线则把回填批量 upsert 到服务端，成功后 markSynced
                if (created.length > 0) {
                    if (isOnline && userId) {
                        try {
                            const rows = created.map(c => toReviewRow(c, userId));
                            const { error } = await supabase
                                .from('review_states')
                                .upsert(rows, { onConflict: 'word_id' });
                            if (error) throw error;
                            for (const c of created) await markReviewSyncedCache(c.wordId, c.updatedAt);
                            const syncedIds = new Set(created.map(c => c.wordId));
                            const syncedNext = statesRef.current.map(s =>
                                syncedIds.has(s.wordId) ? { ...s, syncStatus: 'synced' as const } : s,
                            );
                            if (!cancelled) commitStates(syncedNext);
                        } catch (e) {
                            // 表未迁移 / 网络错误：保持 pending，等待后续同步
                            console.error('Backfill sync failed:', e);
                            onPendingChange?.();
                        }
                    } else {
                        onPendingChange?.();
                    }
                }
            } catch (e) {
                console.error('useReview reconcile failed:', e);
            }
        };

        reconcile();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [words, userId, isOnline, loading, wordsLoading, serverLoaded]);

    // ---- 统计（派生） ----
    const today = todayStr();
    const dueCount = useMemo(
        () => states.filter(s => !s.wordId.startsWith('temp_') && s.due <= today).length,
        [states, today],
    );
    const reviewedTodayCount = useMemo(
        () => states.filter(s => s.lastReviewedAt && localDate(s.lastReviewedAt) === today).length,
        [states, today],
    );
    const tomorrowDueCount = useMemo(() => {
        const tomorrow = addDays(today, 1);
        return states.filter(s => s.due === tomorrow).length;
    }, [states, today]);
    const aheadCount = useMemo(
        () => states.filter(s => !s.wordId.startsWith('temp_') && s.due > today).length,
        [states, today],
    );
    const totalTracked = states.length;

    // ---- session 构建 ----
    // ahead=true 为「提前复习」：不限 due <= 今天，按到期日从近到远取一组（无到期词时也能主动刷）
    const buildSession = useCallback((ahead = false) => {
        const t = todayStr();
        const wordMap = new Map(wordsRef.current.map(w => [w.id, w]));
        const dueStates = statesRef.current
            .filter(s => !s.wordId.startsWith('temp_') && (ahead || s.due <= t))
            .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
            .slice(0, SESSION_LIMIT);
        // 关联词卡；缺词（孤儿）跳过
        const cards = dueStates
            .map(s => wordMap.get(s.wordId))
            .filter((w): w is Word => Boolean(w));
        setSession({ cards, index: 0, tally: { forgot: 0, fuzzy: 0, known: 0 } });
    }, []);

    const startSession = useCallback(() => { buildSession(); }, [buildSession]);
    const startAheadSession = useCallback(() => { buildSession(true); }, [buildSession]);
    const nextRound = useCallback(() => { buildSession(); }, [buildSession]);
    const endSession = useCallback(() => { setSession(null); }, []);

    // ---- 评级 ----
    const gradeWord = useCallback(async (wordId: string, grade: ReviewGrade) => {
        if (!userId) return;
        const t = todayStr();
        const now = nowIso();

        const existing = statesRef.current.find(s => s.wordId === wordId);
        // 正常应已有状态；缺失时兜底初始化再评级
        const base: ReviewState = existing
            ? {
                wordId: existing.wordId,
                due: existing.due,
                intervalDays: existing.intervalDays,
                ease: existing.ease,
                reps: existing.reps,
                lapses: existing.lapses,
                lastReviewedAt: existing.lastReviewedAt,
                updatedAt: existing.updatedAt,
            }
            : initReviewState(wordId, t, now);

        const updated = applyGrade(base, grade, t, now);

        // 先写本地（pending_upsert）
        try {
            await upsertReviewCache(updated, 'pending_upsert');
        } catch (e) {
            console.error('grade cache write failed:', e);
        }
        upsertLocal(updated, 'pending_upsert');

        // 推进 session 进度与计数
        setSession(prev => prev
            ? { ...prev, index: prev.index + 1, tally: { ...prev.tally, [grade]: prev.tally[grade] + 1 } }
            : prev,
        );

        // 在线：立即上行 upsert，成功 markSynced；失败/离线保持 pending
        if (isOnline) {
            try {
                const { error } = await supabase
                    .from('review_states')
                    .upsert(toReviewRow(updated, userId), { onConflict: 'word_id' });
                if (error) throw error;
                await markReviewSyncedCache(wordId, updated.updatedAt);
                markSyncedLocal(wordId, updated.updatedAt);
            } catch (e) {
                console.error('grade sync failed:', e);
                onPendingChange?.();
            }
        } else {
            onPendingChange?.();
        }
    }, [userId, isOnline, upsertLocal, markSyncedLocal, onPendingChange]);

    const previewFor = useCallback((wordId: string) => {
        const s = statesRef.current.find(st => st.wordId === wordId);
        if (!s) return null;
        return previewIntervals(s, todayStr());
    }, []);

    const removeReviewState = useCallback((wordId: string) => {
        // fire-and-forget 本地清理；内存同步移除
        removeReviewCache(wordId).catch(() => { });
        const next = statesRef.current.filter(s => s.wordId !== wordId);
        commitStates(next);
    }, [commitStates]);

    // ---- session 派生 ----
    const isSessionFinished = useMemo(
        () => session !== null && session.index >= session.cards.length,
        [session],
    );
    const currentCard = useMemo(() => {
        if (!session || isSessionFinished) return null;
        return session.cards[session.index] ?? null;
    }, [session, isSessionFinished]);

    const summary = useMemo<ReviewSummary | null>(() => {
        if (!session || !isSessionFinished) return null;
        return {
            tally: session.tally,
            reviewedTodayCount,
            tomorrowDueCount,
            remainingDueCount: dueCount, // 评级后已到期词会移出，dueCount 即剩余
        };
    }, [session, isSessionFinished, reviewedTodayCount, tomorrowDueCount, dueCount]);

    return {
        loading,
        dueCount,
        reviewedTodayCount,
        totalTracked,
        tomorrowDueCount,
        aheadCount,
        session,
        currentCard,
        isSessionFinished,
        summary,
        startSession,
        startAheadSession,
        nextRound,
        endSession,
        gradeWord,
        previewFor,
        removeReviewState,
    };
}

export default useReview;
