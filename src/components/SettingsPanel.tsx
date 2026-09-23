import { useState, useEffect, useCallback, useRef, memo } from 'react';
import type { SettingsPanelProps } from '../types';
import { Icons } from './Icons';
import { getCacheStats, clearAudioCache } from '../services/tts';
import { getWordsCacheStats, clearWordsCache } from '../services/wordsCache';
import { getSentencesCacheStats, clearSentencesCache } from '../services/sentencesCache';
import { getMaterialSyncStatus, getMaterialOperations, exportMaterialRecovery, retryFailedMaterialOperations, discardMaterialOperation, discardLegacyMaterialData } from '../services/materialQueue';
import { STORAGE_KEYS } from '../constants';
import CodexConnectionPanel from './CodexConnectionPanel';

type RecoveryOperation = { id: string; kind: 'word' | 'sentence'; action: 'add' | 'delete' | 'update'; status: 'pending' | 'failed'; error?: string; created_at: string };
const actionClass = 'px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';

function SettingsPanel({ apiKey, setApiKey, userEmail, userId, onSyncRequested }: SettingsPanelProps) {
    const [audioStats, setAudioStats] = useState<{ count: number; totalSize: number } | null>(null);
    const [wordStats, setWordStats] = useState<{ count: number; pendingCount: number } | null>(null);
    const [sentenceStats, setSentenceStats] = useState<{ count: number; pendingCount: number } | null>(null);
    const [syncStatus, setSyncStatus] = useState<{ pending: number; failed: number; legacy: number } | null>(null);
    const [operations, setOperations] = useState<RecoveryOperation[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [exported, setExported] = useState(false);
    const mounted = useRef(false);
    const lock = useRef(false);
    const refresh = useCallback(async () => {
        const results = await Promise.allSettled([getCacheStats(), getWordsCacheStats(userId), getSentencesCacheStats(userId), getMaterialSyncStatus(userId), getMaterialOperations(userId)]);
        if (!mounted.current) return;
        if (results[0].status === 'fulfilled') setAudioStats(results[0].value);
        if (results[1].status === 'fulfilled') setWordStats(results[1].value);
        if (results[2].status === 'fulfilled') setSentenceStats(results[2].value);
        if (results[3].status === 'fulfilled') setSyncStatus(results[3].value);
        if (results[4].status === 'fulfilled') setOperations(results[4].value);
        if (results.some((result) => result.status === 'rejected')) setError('部分本机数据暂时无法读取，请稍后重试。');
    }, [userId]);
    useEffect(() => {
        mounted.current = true;
        void refresh();
        window.addEventListener('focus', refresh);
        return () => { mounted.current = false; window.removeEventListener('focus', refresh); };
    }, [refresh]);
    const run = useCallback(async (operation: () => Promise<void>) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError(''); setMessage('');
        try { await operation(); await refresh(); }
        catch { if (mounted.current) setError('操作没有完成，本地待同步内容仍保留，请重试。'); }
        finally { lock.current = false; if (mounted.current) setBusy(false); }
    }, [refresh]);
    const exportRecovery = () => run(async () => {
        const backup = await exportMaterialRecovery(userId);
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `vocab-recovery-${new Date().toISOString().slice(0, 10)}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (mounted.current) { setExported(true); setMessage('备份文件已生成，请妥善保存。'); }
    });
    const clearData = () => run(async () => {
        if (!confirm('清理当前账号已经同步的本机缓存？云端数据和所有待同步操作都会保留。')) return;
        await Promise.all([clearWordsCache(userId), clearSentencesCache(userId)]);
        if (mounted.current) setMessage('已清理当前账号的已同步缓存。');
    });
    const size = audioStats ? audioStats.totalSize < 1024 * 1024 ? `${(audioStats.totalSize / 1024).toFixed(1)} KB` : `${(audioStats.totalSize / (1024 * 1024)).toFixed(1)} MB` : '';

    return <div className="space-y-5">
        <CodexConnectionPanel userId={userId} />
        <section className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">网页 AI</h3>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">用于自动翻译、例句与词汇拓展。手动添加和 Codex 练习无需在这里配置。</p>
            <label htmlFor="openai-api-key" className="block text-xs text-slate-500 dark:text-slate-400">OpenAI API Key</label>
            <div className="flex gap-2">
                <input id="openai-api-key" className="min-w-0 flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100" type="password" placeholder="sk-proj-..." value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
                <button type="button" className="flex items-center gap-1 px-2 py-2 text-sm text-red-600 dark:text-red-400 rounded-lg" onClick={() => { setApiKey(''); localStorage.removeItem(STORAGE_KEYS.API_KEY); localStorage.setItem(STORAGE_KEYS.API_KEY_DELETED, 'true'); }}><Icons.Trash /> 删除</button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">密钥仅保存在本机。<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline ml-1">获取 API Key</a></p>
        </section>
        <section className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">本机数据与同步</h3>
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            <dl className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex justify-between"><dt>词汇缓存</dt><dd>{wordStats?.count ?? '…'} 个</dd></div>
                <div className="flex justify-between"><dt>句子缓存</dt><dd>{sentenceStats?.count ?? '…'} 条</dd></div>
                <div className="flex justify-between"><dt>待同步</dt><dd>{syncStatus?.pending ?? '…'} 项</dd></div>
                {!!syncStatus?.failed && <div className="flex justify-between text-amber-700 dark:text-amber-400"><dt>需要处理</dt><dd>{syncStatus.failed} 项</dd></div>}
            </dl>
            {!!syncStatus?.failed && <div className="space-y-2">
                <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">部分操作需要处理，内容保存在本机。可以重试，或下载备份后停止重试。</p>
                <button type="button" disabled={busy} className={actionClass} onClick={() => void run(async () => { await retryFailedMaterialOperations(userId); await onSyncRequested?.(); })}>重试失败项目</button>
                <ul className="space-y-2">{operations.filter((item) => item.status === 'failed').map((item) => <li key={item.id} className="text-xs text-slate-600 dark:text-slate-400 flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words">{item.kind === 'word' ? '单词' : '句子'} · {{ add: '新增', delete: '删除', update: '更新' }[item.action]}{item.error ? `：${item.error}` : ''}</span>
                    <button type="button" disabled={busy} className="shrink-0 text-red-600 dark:text-red-400 underline" onClick={() => { if (confirm('停止重试这条操作？已发送的请求可能已经保存到云端，不会被撤回。建议先下载备份。')) void run(async () => { await discardMaterialOperation(userId, item.id); await onSyncRequested?.(); }); }}>停止重试</button>
                </li>)}</ul>
            </div>}
            {!!syncStatus?.legacy && <div className="space-y-2 text-xs text-amber-700 dark:text-amber-400">
                <p>发现 {syncStatus.legacy} 项旧版数据，无法确认所属账号，已隔离且不会自动上传。请先下载备份。</p>
                {exported && <button type="button" disabled={busy} className="underline" onClick={() => { if (confirm('确认已经保存备份，并清除无法确认账号的旧版本机数据？当前账号的云端数据和新队列会保留。')) void run(async () => { await discardLegacyMaterialData(); }); }}>清理已备份的旧数据</button>}
            </div>}
            <div className="flex flex-wrap gap-2">
                {!!(syncStatus?.failed || syncStatus?.pending || syncStatus?.legacy) && <button type="button" disabled={busy} className={actionClass} onClick={() => void exportRecovery()}>下载恢复备份</button>}
                <button type="button" disabled={busy || !((wordStats?.count || 0) + (sentenceStats?.count || 0))} className={actionClass} onClick={() => void clearData()}>清理已同步缓存</button>
            </div>
        </section>
        <section className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">发音缓存</h3>
            <div className="flex items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-400"><span>{audioStats ? `${audioStats.count} 个发音 · ${size}` : '读取中…'}</span><button type="button" disabled={busy || !audioStats?.count} className={actionClass} onClick={() => void run(async () => { await clearAudioCache(); setAudioStats({ count: 0, totalSize: 0 }); })}>清理</button></div>
            <p className="text-xs text-slate-400 dark:text-slate-500">已缓存的发音可离线播放。</p>
        </section>
        <p className="border-t border-slate-200 dark:border-slate-700 pt-4 text-xs text-slate-400 dark:text-slate-500 break-all">当前账号：{userEmail}</p>
    </div>;
}
export default memo(SettingsPanel);
