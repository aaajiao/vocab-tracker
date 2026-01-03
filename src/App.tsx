import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Word, SentenceData, SavedSentence } from './types';

// Components
import { Icons } from './components/Icons';
import VirtualWordList from './components/VirtualWordList';
import AuthForm from './components/AuthForm';
import SettingsPanel from './components/SettingsPanel';
import UndoToast from './components/UndoToast';
import ToastContainer from './components/ToastContainer';
import SwipeableSentenceCard from './components/SwipeableSentenceCard';
import { PageSkeleton } from './components/Skeleton';

// Constants
import { DEBOUNCE_DELAY, AI_TYPING_DELAY, STORAGE_KEYS, CATEGORY_CONFIG } from './constants';

// Services
import { getAIContent, detectAndGetContent, regenerateExample, generateCombinedSentence } from './services/openai';
import { speakWord } from './services/tts';

// Hooks
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import { useWords } from './hooks/useWords';
import { useSentences } from './hooks/useSentences';
import { useDebounce } from './hooks/useDebounce';
import { useToast } from './hooks/useToast';
import { useUndo } from './hooks/useUndo';
import { useNetworkStatus } from './hooks/useNetworkStatus';

interface NewWord {
    word: string;
    meaning: string;
    language: 'en' | 'de';
    example: string;
    exampleCn: string;
    category: 'daily' | 'professional' | 'formal' | '';
    etymology?: string;
}

function App() {
    // Hooks
    const { theme, toggleTheme } = useTheme();
    const { user, loading: authLoading, showPasswordUpdate, setShowPasswordUpdate, logout } = useAuth();
    const { toasts, showToast, dismissToast } = useToast();
    const { deletedItem, markDeleted, handleUndo, dismiss: dismissUndo } = useUndo();

    // Network status
    const { isOnline, pendingCount, isSyncing: networkSyncing, syncNow, refreshPendingCount } = useNetworkStatus({
        userId: user?.id,
        onSyncComplete: (synced, failed) => {
            if (synced > 0) {
                showToast('success', `已同步 ${synced} 项`);
                // Refresh data from server after sync
                refreshFromServer();
                refreshSentencesFromServer();
            }
            if (failed > 0) {
                showToast('error', `${failed} 项同步失败`);
            }
        }
    });

    const {
        words, loading: wordsLoading, syncing,
        addWord, deleteWord, updateWordExample, restoreWord,
        getFilteredWords, getGroupedByDate, stats,
        refreshFromServer
    } = useWords({
        userId: user?.id,
        isOnline,
        showToast,
        onPendingChange: refreshPendingCount
    });

    const {
        savedSentences, savingId,
        saveSentence, unsaveSentence, restoreSentence, isSentenceSaved, getSavedSentenceId,
        refreshFromServer: refreshSentencesFromServer
    } = useSentences({
        userId: user?.id,
        isOnline,
        showToast,
        onPendingChange: refreshPendingCount
    });

    // Local state
    const [activeTab, setActiveTab] = useState<'all' | 'en' | 'de' | 'saved'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, DEBOUNCE_DELAY);
    const [isAdding, setIsAdding] = useState(false);
    const [newWord, setNewWord] = useState<NewWord>({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '', etymology: '' });
    const [aiLoading, setAiLoading] = useState(false);
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [cachedKeys, setCachedKeys] = useState<Set<string>>(new Set());
    const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState<string>(() => {
        const savedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
        const wasDeleted = localStorage.getItem(STORAGE_KEYS.API_KEY_DELETED);
        if (savedKey) return savedKey;
        if (wasDeleted) return '';
        return import.meta.env.VITE_OPENAI_API_KEY || '';
    });
    const [showSettings, setShowSettings] = useState(false);
    const [todayFilter, setTodayFilter] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [showSentence, setShowSentence] = useState(false);
    const [sentenceData, setSentenceData] = useState<SentenceData | null>(null);
    const [sentenceLoading, setSentenceLoading] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const aiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const ignoreFetch = useRef(false);

    const loading = authLoading || wordsLoading;

    useEffect(() => {
        if (!loading) {
            if (apiKey) {
                localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey);
                localStorage.removeItem(STORAGE_KEYS.API_KEY_DELETED);
            }
        }
    }, [apiKey, loading]);

    // Focus
    useEffect(() => {
        if (isAdding && inputRef.current) inputRef.current.focus();
    }, [isAdding]);

    // AI content
    useEffect(() => {
        if (ignoreFetch.current) {
            ignoreFetch.current = false;
            return;
        }
        if (!newWord.word.trim()) return;
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        if (!apiKey) return;

        aiTimeoutRef.current = setTimeout(async () => {
            if (newWord.word.trim().length >= 1) {
                setAiLoading(true);
                const content = await getAIContent(newWord.word.trim(), newWord.language, apiKey);
                if (content) {
                    setNewWord(prev => ({
                        ...prev,
                        meaning: content.translation || prev.meaning,
                        example: content.example || '',
                        exampleCn: content.exampleCn || '',
                        category: content.category || '',
                        etymology: content.etymology || ''
                    }));
                }
                setAiLoading(false);
            }
        }, AI_TYPING_DELAY);
        return () => { if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current); };
    }, [newWord.word, newWord.language, apiKey]);

    const handleRegenerate = useCallback(async (wordId: string) => {
        const word = words.find(w => w.id === wordId);
        if (!word || !apiKey) return;
        setRegeneratingId(wordId);
        const newEx = await regenerateExample(word.word, word.meaning, word.language, apiKey);
        if (newEx) {
            await updateWordExample(wordId, newEx.example, newEx.exampleCn);
        }
        setRegeneratingId(null);
    }, [words, apiKey, updateWordExample]);

    const handleStartAdd = async () => {
        setIsAdding(true);
        if (searchQuery.trim()) {
            const text = searchQuery.trim();
            ignoreFetch.current = true;
            setNewWord(prev => ({ ...prev, word: text }));

            if (apiKey) {
                setAiLoading(true);
                const content = await detectAndGetContent(text, apiKey);

                if (content) {
                    ignoreFetch.current = true;
                    setNewWord(prev => ({
                        ...prev,
                        language: content.language,
                        meaning: content.translation,
                        example: content.example,
                        exampleCn: content.exampleCn,
                        category: content.category,
                        etymology: content.etymology || ''
                    }));
                }
                setAiLoading(false);
            }
        }
    };

    const handleAddWord = async () => {
        if (!newWord.word.trim() || !newWord.meaning.trim()) return;

        await addWord({
            word: newWord.word.trim(),
            meaning: newWord.meaning.trim(),
            language: newWord.language,
            example: newWord.example.trim(),
            exampleCn: newWord.exampleCn.trim(),
            category: newWord.category,
            etymology: newWord.etymology,
            date: new Date().toLocaleDateString('sv-SE')
        });

        setNewWord({ word: '', meaning: '', language: newWord.language, example: '', exampleCn: '', category: '', etymology: '' });
        setIsAdding(false);
        setSearchQuery('');
    };

    const handleDeleteWord = useCallback(async (id: string) => {
        const deleted = await deleteWord(id);
        if (deleted) {
            markDeleted({
                id: deleted.id,
                type: 'word',
                label: deleted.word,
                restore: async () => { await restoreWord(deleted); }
            });
        }
    }, [deleteWord, markDeleted, restoreWord]);

    const handleDeleteSentence = useCallback(async (id: string) => {
        const deleted = await unsaveSentence(id);
        if (deleted) {
            markDeleted({
                id: deleted.id,
                type: 'sentence',
                label: deleted.sentence,
                restore: async () => { await restoreSentence(deleted); }
            });
        }
    }, [unsaveSentence, markDeleted, restoreSentence]);

    // Computed values with debounced search
    const filteredWords = useMemo(() =>
        getFilteredWords(activeTab, debouncedSearchQuery, todayFilter),
        [getFilteredWords, activeTab, debouncedSearchQuery, todayFilter]
    );

    const groupedByDate = useMemo(() =>
        getGroupedByDate(filteredWords),
        [getGroupedByDate, filteredWords]
    );

    const formatDate = useCallback((d: string) => {
        const today = new Date().toLocaleDateString('sv-SE');
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
        if (d === today) return '今天';
        if (d === yesterday) return '昨天';
        return new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }, []);

    const getCategoryClass = useCallback((cat: string) => {
        return CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG]?.style || CATEGORY_CONFIG[''].style;
    }, []);

    const getCategoryLabel = useCallback((cat: string) => {
        return CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG]?.label || '';
    }, []);

    const exportWords = useCallback(() => {
        const csv = ['Word,Meaning,Language,Example,Example_CN,Category,Date']
            .concat(words.map(w => `"${w.word}","${w.meaning}","${w.language}","${w.example}","${w.exampleCn || ''}","${w.category || ''}","${w.date}"`))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vocab-${new Date().toLocaleDateString('sv-SE')}.csv`;
        a.click();
        showToast('success', '导出成功');
    }, [words, showToast]);

    const allStats = useMemo(() => ({
        ...stats,
        saved: savedSentences.length
    }), [stats, savedSentences]);

    const handleGenerateSentence = async () => {
        if (!apiKey || activeTab === 'all') return;

        const langWords = words.filter(w => w.language === activeTab);
        if (langWords.length < 2) return;

        setSentenceLoading(true);
        setShowSentence(true);

        const count = Math.min(langWords.length, Math.floor(Math.random() * 3) + 2);
        const shuffled = [...langWords].sort(() => Math.random() - 0.5);
        const selectedWords = shuffled.slice(0, count);

        const result = await generateCombinedSentence(selectedWords, activeTab, apiKey);

        if (result) {
            setSentenceData({
                words: selectedWords,
                scene: result.scene || '',
                sentence: result.sentence,
                sentenceCn: result.sentenceCn
            });
        } else {
            setSentenceData(null);
            showToast('error', '生成失败，请重试');
        }

        setSentenceLoading(false);
    };

    // Show auth form if not logged in
    if (!user && !loading) {
        return <AuthForm onAuth={() => { }} />;
    }

    if (loading) return <PageSkeleton />;

    return (
        <div className="max-w-xl mx-auto p-4 py-8">
            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />

            {/* Offline Banner */}
            {!isOnline && (
                <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                    <span>📴</span>
                    <span>离线模式</span>
                    {pendingCount > 0 && (
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                            {pendingCount} 项待同步
                        </span>
                    )}
                </div>
            )}

            {/* Syncing Banner */}
            {isOnline && networkSyncing && (
                <div className="fixed top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                    <span className="animate-spin">⟳</span>
                    <span>正在同步...</span>
                </div>
            )}

            {/* Pending Sync Indicator (when online but has pending) */}
            {isOnline && !networkSyncing && pendingCount > 0 && (
                <div className="fixed top-0 left-0 right-0 bg-green-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                    <span>✓</span>
                    <span>已恢复在线</span>
                    <button
                        onClick={syncNow}
                        className="bg-white/20 hover:bg-white/30 px-3 py-0.5 rounded-full text-xs transition-colors"
                    >
                        同步 {pendingCount} 项
                    </button>
                </div>
            )}

            {/* Add top padding when banner is shown */}
            {(!isOnline || networkSyncing || pendingCount > 0) && <div className="h-10" />}

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-amber-500/30">
                        <Icons.Book />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-slate-800 dark:text-slate-100">词汇本</div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {isOnline ? (
                                <>
                                    <Icons.Cloud /> 云端同步 {syncing && '· 同步中...'}
                                </>
                            ) : (
                                <>
                                    <span className="text-amber-500">📴</span> 离线模式
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded-lg active:scale-90 transition-all" onClick={toggleTheme}>
                        {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
                    </button>
                    <button className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded-lg active:scale-90 transition-all" onClick={() => setShowSettings(!showSettings)}><Icons.Settings /></button>
                    {words.length > 0 && (
                        <button className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg active:scale-95 transition-all" onClick={exportWords}><Icons.Download /> 导出</button>
                    )}
                    <button className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded-lg active:scale-90 transition-all" onClick={logout} title="退出登录"><Icons.LogOut /></button>
                </div>
            </div>

            {/* Password Update Modal */}
            {showPasswordUpdate && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-xl w-full max-w-sm">
                        <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">设置新密码</h3>
                        <p className="text-sm text-slate-500 mb-4">请输入您的新密码。</p>
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            if (newPassword.length < 6) return;
                            const { supabase } = await import('./supabaseClient');
                            const { error } = await supabase.auth.updateUser({ password: newPassword });
                            if (!error) {
                                setShowPasswordUpdate(false);
                                setNewPassword('');
                                showToast('success', '密码修改成功');
                            } else {
                                showToast('error', '修改失败：' + error.message);
                            }
                        }}>
                            <input
                                className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-4 text-slate-800 dark:text-slate-100"
                                type="password"
                                placeholder="新密码 (至少6位)"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                minLength={6}
                                required
                                autoComplete="new-password"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPasswordUpdate(false)}
                                    className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium"
                                >
                                    确认修改
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* API Key Warning */}
            {!apiKey && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">⚠️</span>
                        <h3 className="text-sm font-semibold text-red-600 m-0">需要 OpenAI API Key</h3>
                    </div>
                    <p className="text-xs text-red-700 mb-3 leading-relaxed">
                        本应用使用 OpenAI 进行翻译、例句生成和语音朗读。
                        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                            获取 API Key →
                        </a>
                    </p>
                    <input
                        className="w-full px-3 py-2 bg-white border border-red-200 rounded-lg text-sm outline-none focus:border-red-400 text-slate-800"
                        type="password"
                        placeholder="sk-proj-xxxxx"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        autoComplete="off"
                    />
                </div>
            )}

            {/* Settings Panel */}
            {showSettings && apiKey && (
                <SettingsPanel apiKey={apiKey} setApiKey={setApiKey} userEmail={user?.email} />
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-slate-400 dark:hover:border-slate-500 active:scale-95 ${activeTab === 'all' ? 'border-slate-400 dark:border-slate-500 ring-1 ring-slate-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setActiveTab('all'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); }}
                >
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{allStats.total}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">总计</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-blue-400 dark:hover:border-blue-500 active:scale-95 ${activeTab === 'en' ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setActiveTab('en'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); }}
                >
                    <div className="text-2xl font-bold text-blue-600">{allStats.en}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">英语</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-green-400 dark:hover:border-green-500 active:scale-95 ${activeTab === 'de' ? 'border-green-400 dark:border-green-500 ring-1 ring-green-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setActiveTab('de'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); }}
                >
                    <div className="text-2xl font-bold text-green-600">{allStats.de}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">德语</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-amber-400 dark:hover:border-amber-500 active:scale-95 ${todayFilter ? 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setTodayFilter(!todayFilter); setActiveTab('all'); setShowSentence(false); setSentenceData(null); }}
                >
                    <div className="text-2xl font-bold text-amber-600">{allStats.today}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">今日</div>
                </button>
            </div>

            {/* Search */}
            <div className="flex gap-3 mb-6">
                <div className="flex-1 relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></div>
                    <input
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100 transition-colors"
                        placeholder="搜索单词..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 active:scale-95 transition-all font-medium shadow-lg shadow-slate-900/10"
                    onClick={handleStartAdd}
                >
                    <Icons.Plus /> 添加
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-6">
                {[{ id: 'all' as const, label: '全部' }, { id: 'en' as const, label: '🇬🇧 英语' }, { id: 'de' as const, label: '🇩🇪 德语' }, { id: 'saved' as const, label: '⭐ 收藏' }].map(t => (
                    <button
                        key={t.id}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === t.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                            }`}
                        onClick={() => { setActiveTab(t.id); setTodayFilter(false); setShowSentence(false); setSentenceData(null); }}
                    >
                        {t.label}<span className="ml-1 opacity-60 text-xs">{t.id === 'all' ? allStats.total : allStats[t.id]}</span>
                    </button>
                ))}
            </div>

            {/* Sentence Generation Panel */}
            {(activeTab === 'en' || activeTab === 'de') && allStats[activeTab] >= 2 && (
                <div className="mb-6">
                    {!showSentence ? (
                        <button
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-xl hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/30 dark:hover:to-orange-900/30 active:scale-[0.98] transition-all font-medium"
                            onClick={handleGenerateSentence}
                            disabled={!apiKey || !isOnline}
                        >
                            <Icons.Sparkles /> 组合造句 {!isOnline && '(需要网络)'}
                        </button>
                    ) : (
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                                    <Icons.Sparkles /> 组合造句
                                </div>
                                <button
                                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                                    onClick={() => { setShowSentence(false); setSentenceData(null); }}
                                >
                                    ✕
                                </button>
                            </div>

                            {sentenceLoading ? (
                                <div className="space-y-3">
                                    <div className="h-8 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg"></div>
                                    <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg"></div>
                                </div>
                            ) : sentenceData ? (
                                <>
                                    {sentenceData.scene && (
                                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                                            <span>📍</span>
                                            <span className="font-medium">{sentenceData.scene}</span>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {sentenceData.words.map((w, i) => (
                                            <span
                                                key={i}
                                                className={`px-2.5 py-1 rounded-full text-sm font-medium ${activeTab === 'en'
                                                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                                    : 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                                    }`}
                                            >
                                                {w.word}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-3">
                                        <div className="text-base text-slate-800 dark:text-slate-200 mb-1 leading-relaxed">{sentenceData.sentence}</div>
                                        <div className="text-sm text-slate-500 dark:text-slate-400">{sentenceData.sentenceCn}</div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all text-sm font-medium"
                                            onClick={() => speakWord(sentenceData.sentence, activeTab, setSpeakingId, 'sentence', apiKey, (key) => setCachedKeys(prev => new Set(prev).add(key)))}
                                        >
                                            <Icons.Speaker playing={speakingId === 'sentence'} cached={false} /> 朗读
                                        </button>
                                        <button
                                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg active:scale-95 transition-all text-sm font-medium ${isSentenceSaved(sentenceData.sentence)
                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                                }`}
                                            onClick={() => {
                                                if (isSentenceSaved(sentenceData.sentence)) {
                                                    unsaveSentence(getSavedSentenceId(sentenceData.sentence)!);
                                                } else {
                                                    saveSentence({
                                                        sentence: sentenceData.sentence,
                                                        sentenceCn: sentenceData.sentenceCn,
                                                        language: activeTab as 'en' | 'de',
                                                        scene: sentenceData.scene,
                                                        sourceType: 'combined',
                                                        sourceWords: sentenceData.words.map(w => w.word)
                                                    });
                                                }
                                            }}
                                            disabled={savingId === sentenceData.sentence}
                                        >
                                            <Icons.Star filled={isSentenceSaved(sentenceData.sentence)} /> {isSentenceSaved(sentenceData.sentence) ? '已收藏' : '收藏'}
                                        </button>
                                        <button
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 active:scale-95 transition-all text-sm font-medium"
                                            onClick={handleGenerateSentence}
                                        >
                                            <Icons.Refresh /> 换一批
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-slate-400 py-4">生成失败，请重试</div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Add Form */}
            {isAdding && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6 shadow-sm">
                    <div className="flex gap-2 mb-4 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg w-fit">
                        <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'en' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => setNewWord(p => ({ ...p, language: 'en', word: '', meaning: '', example: '', exampleCn: '', category: '', etymology: '' }))}>🇬🇧 英语</button>
                        <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'de' ? 'bg-white dark:bg-slate-600 text-green-600 dark:text-green-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => setNewWord(p => ({ ...p, language: 'de', word: '', meaning: '', example: '', exampleCn: '', category: '', etymology: '' }))}>🇩🇪 德语</button>
                    </div>
                    <input
                        ref={inputRef}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100 font-medium"
                        placeholder="输入单词或短语"
                        value={newWord.word}
                        onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))}
                    />
                    {aiLoading ? (
                        <>
                            <div className="h-10 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg flex items-center px-3 text-sm text-slate-400 gap-2 mb-2"><Icons.Sparkles /> GPT 分析中...</div>
                            <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg mb-2"></div>
                        </>
                    ) : (
                        <>
                            <div className="relative mb-2">
                                <input
                                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                                    placeholder="中文翻译"
                                    value={newWord.meaning}
                                    onChange={e => setNewWord(p => ({ ...p, meaning: e.target.value }))}
                                />
                                {newWord.meaning && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500"><Icons.Sparkles /></div>}
                            </div>
                            {newWord.example && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-4">
                                    <div className="text-sm text-slate-700 dark:text-slate-300 mb-1">{newWord.example}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">{newWord.exampleCn}</div>
                                </div>
                            )}
                        </>
                    )}
                    <div className="flex gap-2">
                        <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 active:scale-95 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleAddWord} disabled={!newWord.word.trim() || !newWord.meaning.trim() || aiLoading || syncing}>
                            {syncing ? '保存中...' : '保存'}
                        </button>
                        <button className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium" onClick={() => { setIsAdding(false); setNewWord({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '', etymology: '' }); }}>取消</button>
                    </div>
                </div>
            )}

            {/* Word List */}
            {activeTab === 'saved' ? (
                <div>
                    {savedSentences.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="text-6xl text-slate-200 dark:text-slate-700 mb-4">⭐</div>
                            <div className="text-slate-500 font-medium mb-1">还没有收藏的句子</div>
                            <div className="text-sm text-slate-400">收藏你喜欢的例句和组合造句吧</div>
                        </div>
                    ) : (
                        <div className="space-y-0">
                            {savedSentences.map(s => (
                                <SwipeableSentenceCard
                                    key={s.id}
                                    sentence={s}
                                    onDelete={() => handleDeleteSentence(s.id)}
                                    onSpeak={() => speakWord(s.sentence, s.language, setSpeakingId, s.id, apiKey, (key) => setCachedKeys(prev => new Set(prev).add(key)))}
                                    speakingId={speakingId}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : Object.keys(groupedByDate).length === 0 ? (
                <div className="text-center py-16">
                    <div className="text-6xl text-slate-200 dark:text-slate-700 mb-4">📚</div>
                    <div className="text-slate-500 font-medium mb-1">还没有单词</div>
                    <div className="text-sm text-slate-400">开始记录你每天遇到的新单词吧</div>
                </div>
            ) : (
                <VirtualWordList
                    groupedByDate={groupedByDate}
                    formatDate={formatDate}
                    deleteWord={handleDeleteWord}
                    speakWord={speakWord}
                    setSpeakingId={setSpeakingId}
                    speakingId={speakingId}
                    apiKey={apiKey}
                    setCachedKeys={setCachedKeys}
                    cachedKeys={cachedKeys}
                    getCategoryClass={getCategoryClass}
                    getCategoryLabel={getCategoryLabel}
                    handleRegenerate={handleRegenerate}
                    regeneratingId={regeneratingId}
                    saveSentence={saveSentence}
                    unsaveSentence={unsaveSentence}
                    isSentenceSaved={isSentenceSaved}
                    getSavedSentenceId={getSavedSentenceId}
                    savingId={savingId}
                />
            )}

            <div className="mt-8 text-center text-xs text-slate-400 flex items-center justify-center gap-1 pb-8">
                {isOnline ? (
                    <>
                        <Icons.Cloud /> 数据已同步到云端 · 点击单词听发音
                    </>
                ) : (
                    <>
                        <span>📴</span> 离线模式 · 数据将在恢复网络后同步
                    </>
                )}
            </div>

            {/* Unified Undo Toast */}
            <UndoToast
                deletedItem={deletedItem}
                onUndo={handleUndo}
                onDismiss={dismissUndo}
            />
        </div>
    );
}

export default App;
