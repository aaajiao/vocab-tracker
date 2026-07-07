import { useState, useCallback, memo } from 'react';
import type { Word, ReviewGrade } from '../types';
import ReviewCard from './ReviewCard';
import { STORAGE_KEYS } from '../constants';
import type { ReviewSessionData, ReviewSummary } from '../hooks/useReview';

// 复习模式：翻转卡片 / 例句挖空
type ReviewMode = 'flip' | 'cloze';

// props 接口就近定义：session / summary 形状来自 useReview（避免 types.ts 反向依赖 hooks）
interface ReviewSessionProps {
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
    // TTS 三件套
    speakingId: string | null;
    setSpeakingId: (id: string | null) => void;
    apiKey: string;
    cachedKeys: Set<string>;
    setCachedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
    getCategoryClass: (cat: string) => string;
    getCategoryLabel: (cat: string) => string;
}

// 复习模式分段切换 [翻转卡片 | 例句挖空]
function ModeToggle({ mode, onChange }: { mode: ReviewMode; onChange: (m: ReviewMode) => void }) {
    return (
        <div className="inline-flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            {([['flip', '翻转卡片'], ['cloze', '例句挖空']] as const).map(([id, label]) => (
                <button
                    key={id}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === id
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                        }`}
                    onClick={() => onChange(id)}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

// 单个统计磁贴
function StatTile({ value, label }: { value: number; label: string }) {
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</div>
        </div>
    );
}

// 复习主视图：起始 / 空状态 · 进行中 · 小结 三态
function ReviewSession({
    loading, dueCount, reviewedTodayCount, totalTracked, tomorrowDueCount, aheadCount,
    session, currentCard, isSessionFinished, summary,
    startSession, startAheadSession, nextRound, endSession, gradeWord, previewFor,
    speakingId, setSpeakingId, apiKey, cachedKeys, setCachedKeys,
    getCategoryClass, getCategoryLabel,
}: ReviewSessionProps) {
    const [mode, setMode] = useState<ReviewMode>(() => {
        const saved = localStorage.getItem(STORAGE_KEYS.REVIEW_MODE);
        return saved === 'cloze' ? 'cloze' : 'flip';
    });

    const changeMode = useCallback((m: ReviewMode) => {
        setMode(m);
        localStorage.setItem(STORAGE_KEYS.REVIEW_MODE, m);
    }, []);

    const handleGrade = useCallback((grade: ReviewGrade) => {
        if (currentCard) gradeWord(currentCard.id, grade);
    }, [currentCard, gradeWord]);

    // 首次加载（通常瞬时）：轻量骨架
    if (loading && totalTracked === 0) {
        return (
            <div className="space-y-3">
                <div className="h-52 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-2xl" />
                <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-xl" />
            </div>
        );
    }

    // 统计磁贴（起始/空状态共用）
    const statsRow = (
        <div className="grid grid-cols-3 gap-3 mt-8 text-left">
            <StatTile value={totalTracked} label="已跟踪" />
            <StatTile value={reviewedTodayCount} label="今日已复习" />
            <StatTile value={tomorrowDueCount} label="明日到期" />
        </div>
    );

    // ---- 进行中 ----
    if (session && !isSessionFinished && currentCard) {
        const total = session.cards.length;
        const position = session.index + 1;   // 当前第几张（1-based）
        const progress = total > 0 ? (session.index / total) * 100 : 0;
        return (
            <div>
                <div className="flex items-center justify-between mb-3 gap-2">
                    <button
                        className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg transition-all"
                        onClick={endSession}
                    >
                        ✕ 退出
                    </button>
                    <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{position} / {total}</div>
                    <div className="w-[52px]" aria-hidden />
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mb-4 overflow-hidden">
                    <div className="h-full bg-amber-500 dark:bg-amber-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-center mb-4">
                    <ModeToggle mode={mode} onChange={changeMode} />
                </div>
                <ReviewCard
                    key={currentCard.id}
                    word={currentCard}
                    mode={mode}
                    preview={previewFor(currentCard.id)}
                    onGrade={handleGrade}
                    speakingId={speakingId}
                    setSpeakingId={setSpeakingId}
                    apiKey={apiKey}
                    cachedKeys={cachedKeys}
                    setCachedKeys={setCachedKeys}
                    getCategoryClass={getCategoryClass}
                    getCategoryLabel={getCategoryLabel}
                />
            </div>
        );
    }

    // ---- 小结 ----
    if (session && isSessionFinished && summary) {
        return (
            <div className="text-center py-6">
                <div className="text-6xl mb-3">🎊</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">本组复习完成</div>
                <div className="grid grid-cols-3 gap-2 my-6 max-w-xs mx-auto">
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-xl py-3">
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">{summary.tally.forgot}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">😵 不认识</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl py-3">
                        <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{summary.tally.fuzzy}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">🤔 模糊</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl py-3">
                        <div className="text-xl font-bold text-green-600 dark:text-green-400">{summary.tally.known}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">✅ 认识</div>
                    </div>
                </div>
                <div className="flex justify-center gap-6 text-sm text-slate-500 dark:text-slate-400 mb-6">
                    <div>今日已复习 <span className="font-semibold text-slate-700 dark:text-slate-200">{summary.reviewedTodayCount}</span></div>
                    <div>明日到期 <span className="font-semibold text-slate-700 dark:text-slate-200">{summary.tomorrowDueCount}</span></div>
                </div>
                <div className="flex gap-2 justify-center">
                    {summary.remainingDueCount > 0 && (
                        <button
                            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-medium active:scale-95 transition-all shadow-lg shadow-amber-500/20"
                            onClick={nextRound}
                        >
                            再来一组（剩余 {summary.remainingDueCount}）
                        </button>
                    )}
                    <button
                        className="px-5 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
                        onClick={endSession}
                    >
                        完成
                    </button>
                </div>
            </div>
        );
    }

    // ---- 起始 / 空状态 ----
    return (
        <div className="text-center py-6">
            {dueCount > 0 ? (
                <>
                    <div className="text-6xl mb-4">🗂️</div>
                    <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">今天有 {dueCount} 个待复习</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-6">用翻转卡片和例句挖空巩固记忆</div>
                    <div className="flex justify-center mb-5">
                        <ModeToggle mode={mode} onChange={changeMode} />
                    </div>
                    <button
                        className="px-6 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 active:scale-95 transition-all font-medium shadow-lg shadow-slate-900/10"
                        onClick={startSession}
                    >
                        开始复习
                    </button>
                </>
            ) : (
                <>
                    <div className="text-6xl mb-4">🎉</div>
                    <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">今日复习已完成</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                        {totalTracked === 0 ? '添加单词后，次日就会出现在这里' : '暂时没有到期的单词，休息一下吧'}
                    </div>
                    {/* 没有到期词但词库里有卡：允许把最近要到期的词提前拉出来刷 */}
                    {aheadCount > 0 && (
                        <div className="mt-6">
                            <div className="flex justify-center mb-4">
                                <ModeToggle mode={mode} onChange={changeMode} />
                            </div>
                            <button
                                className="px-5 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
                                onClick={startAheadSession}
                            >
                                ⏩ 提前复习
                            </button>
                        </div>
                    )}
                </>
            )}
            {statsRow}
        </div>
    );
}

export default memo(ReviewSession);
