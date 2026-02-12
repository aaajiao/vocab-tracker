import { useState, useEffect, useCallback, memo } from 'react';
import type { SettingsPanelProps } from '../types';
import { Icons } from './Icons';
import { getCacheStats, clearAudioCache } from '../services/tts';
import { getWordsCacheStats, clearWordsCache } from '../services/wordsCache';
import { getSentencesCacheStats, clearSentencesCache } from '../services/sentencesCache';
import { STORAGE_KEYS } from '../constants';

function SettingsPanel({ apiKey, setApiKey, userEmail }: SettingsPanelProps) {
    const [audioCacheStats, setAudioCacheStats] = useState<{ count: number; totalSize: number } | null>(null);
    const [wordsCacheStats, setWordsCacheStats] = useState<{ count: number; pendingCount: number } | null>(null);
    const [sentencesCacheStats, setSentencesCacheStats] = useState<{ count: number; pendingCount: number } | null>(null);
    const [clearingAudio, setClearingAudio] = useState(false);
    const [clearingData, setClearingData] = useState(false);

    // Load cache stats on mount
    useEffect(() => {
        getCacheStats().then(setAudioCacheStats);
        getWordsCacheStats().then(setWordsCacheStats);
        getSentencesCacheStats().then(setSentencesCacheStats);
    }, []);

    const handleClearAudioCache = useCallback(async () => {
        setClearingAudio(true);
        try {
            await clearAudioCache();
            setAudioCacheStats({ count: 0, totalSize: 0 });
        } catch (e) {
            console.error('Failed to clear audio cache:', e);
        }
        setClearingAudio(false);
    }, []);

    const handleClearDataCache = useCallback(async () => {
        if (!confirm('确定要清除所有离线数据缓存吗？\n\n注意：待同步的离线操作也会被清除。')) {
            return;
        }
        setClearingData(true);
        try {
            await clearWordsCache();
            await clearSentencesCache();
            setWordsCacheStats({ count: 0, pendingCount: 0 });
            setSentencesCacheStats({ count: 0, pendingCount: 0 });
        } catch (e) {
            console.error('Failed to clear data cache:', e);
        }
        setClearingData(false);
    }, []);

    // Format bytes to human readable
    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const totalPending = (wordsCacheStats?.pendingCount || 0) + (sentencesCacheStats?.pendingCount || 0);

    return (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6 space-y-4">
            {/* API Key Section */}
            <div>
                <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100">API Key</h3>
                <label className="block text-xs text-slate-500 mb-1">OpenAI API Key</label>
                <div className="flex gap-2">
                    <input
                        className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                        type="password"
                        placeholder="sk-proj-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        autoComplete="off"
                    />
                    <button
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors shrink-0"
                        onClick={() => {
                            setApiKey('');
                            localStorage.removeItem(STORAGE_KEYS.API_KEY);
                            localStorage.setItem(STORAGE_KEYS.API_KEY_DELETED, 'true');
                        }}
                        title="删除 API Key"
                    >
                        <Icons.Trash /> 删除
                    </button>
                </div>
                <div className="text-xs text-slate-400 mt-2">Key is stored locally. 账户: {userEmail}</div>
            </div>

            {/* Data Cache Section */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    📦 离线数据缓存
                </h3>
                <div className="space-y-2">
                    {wordsCacheStats && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">词汇</span>
                            <span className="text-slate-800 dark:text-slate-200 font-medium">
                                {wordsCacheStats.count} 个
                                {wordsCacheStats.pendingCount > 0 && (
                                    <span className="ml-1 text-amber-600 dark:text-amber-400 text-xs">
                                        ({wordsCacheStats.pendingCount} 待同步)
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                    {sentencesCacheStats && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">句子</span>
                            <span className="text-slate-800 dark:text-slate-200 font-medium">
                                {sentencesCacheStats.count} 个
                                {sentencesCacheStats.pendingCount > 0 && (
                                    <span className="ml-1 text-amber-600 dark:text-amber-400 text-xs">
                                        ({sentencesCacheStats.pendingCount} 待同步)
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                </div>
                {totalPending > 0 && (
                    <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                            ⚠️ 有 {totalPending} 项离线操作待同步，请确保网络连接后同步
                        </div>
                    </div>
                )}
                <button
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                    onClick={handleClearDataCache}
                    disabled={clearingData || ((wordsCacheStats?.count || 0) === 0 && (sentencesCacheStats?.count || 0) === 0)}
                >
                    {clearingData ? '清除中...' : '清除数据缓存'}
                </button>
                <div className="text-xs text-slate-400 mt-1">
                    缓存的数据用于离线访问，清除后需要重新加载
                </div>
            </div>

            {/* Audio Cache Section */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    🔊 音频缓存
                </h3>
                {audioCacheStats && (
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                            已缓存 <span className="font-medium text-slate-800 dark:text-slate-200">{audioCacheStats.count}</span> 个发音
                            <span className="text-slate-400 ml-1">({formatSize(audioCacheStats.totalSize)})</span>
                        </div>
                        <button
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                            onClick={handleClearAudioCache}
                            disabled={clearingAudio || audioCacheStats.count === 0}
                        >
                            {clearingAudio ? '清除中...' : '清除缓存'}
                        </button>
                    </div>
                )}
                <div className="text-xs text-slate-400 mt-1">
                    缓存的发音可离线播放，节省 API 调用
                </div>
            </div>
        </div>
    );
}

export default memo(SettingsPanel);
