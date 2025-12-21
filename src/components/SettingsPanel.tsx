import { useState, useEffect, useCallback } from 'react';
import type { SettingsPanelProps } from '../types';
import { Icons } from './Icons';
import { getCacheStats, clearAudioCache } from '../services/tts';
import { STORAGE_KEYS } from '../constants';

function SettingsPanel({ apiKey, setApiKey, userEmail }: SettingsPanelProps) {
    const [cacheStats, setCacheStats] = useState<{ count: number; totalSize: number } | null>(null);
    const [clearing, setClearing] = useState(false);

    // Load cache stats on mount
    useEffect(() => {
        getCacheStats().then(setCacheStats);
    }, []);

    const handleClearCache = useCallback(async () => {
        setClearing(true);
        try {
            await clearAudioCache();
            setCacheStats({ count: 0, totalSize: 0 });
        } catch (e) {
            console.error('Failed to clear audio cache:', e);
        }
        setClearing(false);
    }, []);

    // Format bytes to human readable
    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

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

            {/* Audio Cache Section */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    🔊 音频缓存
                </h3>
                {cacheStats && (
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                            已缓存 <span className="font-medium text-slate-800 dark:text-slate-200">{cacheStats.count}</span> 个发音
                            <span className="text-slate-400 ml-1">({formatSize(cacheStats.totalSize)})</span>
                        </div>
                        <button
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                            onClick={handleClearCache}
                            disabled={clearing || cacheStats.count === 0}
                        >
                            {clearing ? '清除中...' : '清除缓存'}
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

export default SettingsPanel;
