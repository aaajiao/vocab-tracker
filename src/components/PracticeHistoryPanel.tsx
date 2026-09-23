import { useState, useEffect, memo } from 'react';
import { learningApi, learningErrorMessage, type PracticeSession, type PracticeEvent } from '../services/learningApi';

const statusLabels: Record<PracticeSession['status'], string> = { active: '进行中', completed: '已完成', abandoned: '已结束' };
const modeLabels: Record<PracticeSession['mode'], string> = { conversation: '情境对话', recall: '词汇回忆', cloze: '例句填空' };
const gradeLabels: Record<PracticeEvent['grade'], string> = { known: '掌握', fuzzy: '需巩固', forgot: '待重练' };
const errorTagLabels: Record<string, string> = { meaning: '词义', spelling: '拼写', grammar: '语法', gender: '名词性别', case: '格变化', conjugation: '动词变位', pronunciation: '发音', word_order: '语序', usage: '用法', vocabulary: '选词' };

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function AccountPracticeHistory({ userId }: { userId: string }) {
    const [offset, setOffset] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [page, setPage] = useState<{ offset: number; sessions: PracticeSession[]; next: number | null } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<{ session: PracticeSession; events: PracticeEvent[]; truncated: boolean } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');

    useEffect(() => {
        const onFocus = () => setRefresh((previous) => previous + 1);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        void learningApi.getSessions(userId, offset, controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            setPage({ offset, sessions: result.data, next: result.meta?.has_more ? result.meta.next_offset ?? offset + 10 : null });
        }).catch((cause: unknown) => {
            if (!controller.signal.aborted) setError(learningErrorMessage(cause));
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [userId, offset, refresh]);

    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            setDetailError('');
            setDetailLoading(false);
            return;
        }
        const controller = new AbortController();
        setDetailLoading(true);
        setDetailError('');
        void learningApi.getSession(userId, selectedId, controller.signal).then((result) => {
            if (!controller.signal.aborted) setDetail({ ...result.data, truncated: result.meta?.events_truncated === true });
        }).catch((cause: unknown) => {
            if (!controller.signal.aborted) setDetailError(learningErrorMessage(cause));
        }).finally(() => {
            if (!controller.signal.aborted) setDetailLoading(false);
        });
        return () => controller.abort();
    }, [userId, selectedId, refresh]);

    const visiblePage = page?.offset === offset ? page : null;
    const visibleDetail = detail?.session.id === selectedId ? detail : null;

    return (
        <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4" aria-labelledby="practice-history-title">
            <div className="flex items-center justify-between gap-3">
                <div><h3 id="practice-history-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">对话练习记录</h3><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">回顾 Codex 保存的练习、作答和纠错，下一次从这里继续。</p></div>
                <button type="button" onClick={() => setRefresh((previous) => previous + 1)} disabled={loading || detailLoading} className="shrink-0 text-xs px-2 py-1 rounded text-indigo-600 dark:text-indigo-400 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-400">{loading ? '刷新中…' : '刷新'}</button>
            </div>
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {loading && !visiblePage && <p role="status" className="text-sm text-slate-500 dark:text-slate-400 py-4">正在读取练习记录…</p>}
            {!loading && !error && visiblePage?.sessions.length === 0 && <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{offset === 0 ? '还没有对话练习记录。在设置中连接 Codex，完成并保存一轮练习后，就可以在这里回顾。' : '这一页没有更多记录。'}</div>}
            <ul className="space-y-2">
                {visiblePage?.sessions.map((session) => <li key={session.id}>
                    <button type="button" onClick={() => setSelectedId((previous) => previous === session.id ? null : session.id)} aria-expanded={selectedId === session.id} aria-controls={selectedId === session.id ? 'practice-session-detail' : undefined} className={`w-full text-left rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 ${selectedId === session.id ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-slate-800 dark:text-slate-100 break-words">{session.topic || modeLabels[session.mode]}</span><span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${session.status === 'active' ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950' : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800'}`}>{statusLabels[session.status]}</span></div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{formatDate(session.created_at)} · {session.language === 'mixed' ? '德语与英语' : session.language === 'de' ? '德语' : '英语'} · {modeLabels[session.mode]} · {session.word_ids.length + (session.sentence_ids?.length || 0)} 项素材</p>
                        {session.summary && <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-2 break-words">{session.summary}</p>}
                    </button>
                </li>)}
            </ul>
            {(offset > 0 || visiblePage?.next !== null && visiblePage?.next !== undefined) && <nav aria-label="练习记录分页" className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                <button type="button" disabled={offset === 0 || loading} onClick={() => { setOffset((previous) => Math.max(0, previous - 10)); setSelectedId(null); }} className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40">上一页</button>
                <span>第 {Math.floor(offset / 10) + 1} 页</span>
                <button type="button" disabled={visiblePage?.next == null || loading} onClick={() => { if (visiblePage?.next != null) { setOffset(visiblePage.next); setSelectedId(null); } }} className="px-3 py-2 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40">下一页</button>
            </nav>}
            {selectedId && <div id="practice-session-detail" className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <div className="flex justify-between gap-3"><h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">练习详情</h4><button type="button" onClick={() => setSelectedId(null)} className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1 rounded">收起</button></div>
                {detailLoading && <p role="status" className="text-xs text-slate-500 dark:text-slate-400">正在读取作答记录…</p>}
                {detailError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{detailError}</p>}
                {visibleDetail && <>
                    {visibleDetail.session.summary && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{visibleDetail.session.summary}</p>}
                    {visibleDetail.session.status === 'active' && <p className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-3 text-xs text-indigo-700 dark:text-indigo-300">这次练习尚未结束。可以在 Codex 中说“继续上次的生词练习”。</p>}
                    {visibleDetail.events.length === 0 && !detailLoading && <p className="text-xs text-slate-500 dark:text-slate-400">{visibleDetail.session.word_ids.length === 0 && (visibleDetail.session.sentence_ids?.length || 0) > 0 ? '句子练习的反馈会保存在本次总结中，不计入单词复习排期。' : '尚未保存逐词作答。仅展示过的词不会计入复习。'}</p>}
                    {visibleDetail.truncated && <p className="text-xs text-amber-700 dark:text-amber-300">这次练习记录较多，当前显示前 1,000 条作答。</p>}
                    <ol className="space-y-3">
                        {visibleDetail.events.map((event) => <li key={event.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
                            <div className="flex justify-between items-start gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800 dark:text-slate-100 break-words">{event.word_snapshot?.word || '已删除的词汇'}</p>{event.word_snapshot?.meaning && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">{event.word_snapshot.meaning}</p>}</div><span className="shrink-0 text-xs text-indigo-700 dark:text-indigo-300">{gradeLabels[event.grade]}</span></div>
                            {event.answer && <div><p className="text-xs text-slate-500 dark:text-slate-400">我的作答</p><p className="mt-1 text-sm whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{event.answer}</p></div>}
                            {event.feedback && <div><p className="text-xs text-slate-500 dark:text-slate-400">反馈与正确用法</p><p className="mt-1 text-sm whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{event.feedback}</p></div>}
                            {event.error_tags.length > 0 && <div className="flex flex-wrap gap-1">{event.error_tags.map((tag) => <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300">{errorTagLabels[tag] || tag}</span>)}</div>}
                            <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(event.practiced_at)} · {event.source === 'codex' ? 'Codex' : '网页复习'}{event.hint_count > 0 ? ` · 使用了 ${event.hint_count} 次提示` : ' · 未使用提示'}{!event.scheduling_applied ? ' · 历史补录，保留较新的排期' : ''}</p>
                        </li>)}
                    </ol>
                </>}
            </div>}
        </section>
    );
}

function PracticeHistoryPanel({ userId }: { userId: string }) {
    return <AccountPracticeHistory key={userId} userId={userId} />;
}

export default memo(PracticeHistoryPanel);
