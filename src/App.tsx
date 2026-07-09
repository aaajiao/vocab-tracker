import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Word, SentenceData, ExpansionPreviewItem, SentenceAnalysis, SentenceKeyword } from './types';

// Components
import { Icons } from './components/Icons';
import VirtualWordList from './components/VirtualWordList';
import AuthForm from './components/AuthForm';
import SettingsPanel from './components/SettingsPanel';
import UndoToast from './components/UndoToast';
import ToastContainer from './components/ToastContainer';
import SwipeableSentenceCard from './components/SwipeableSentenceCard';
import SentenceCard from './components/SentenceCard';
import ReviewSession from './components/ReviewSession';
import { PageSkeleton } from './components/Skeleton';

// Constants
import { DEBOUNCE_DELAY, AI_TYPING_DELAY, STORAGE_KEYS, CATEGORY_CONFIG, sceneFromRegister } from './constants';

// Services
import { getAIContent, detectAndAnalyze, regenerateExample, generateCombinedSentence, generateVocabularyExpansion, sanitizeCategory } from './services/openai';
import { speakWord } from './services/tts';
import { generateCacheKey } from './services/audioCache';
import { classifyInput } from './services/inputHeuristic';
import { filterSavedSentences, type SentenceLanguageFilter } from './services/sentenceFilter';

// Hooks
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import { useWords } from './hooks/useWords';
import { useSentences } from './hooks/useSentences';
import { useReview } from './hooks/useReview';
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
        onSyncComplete: (synced, failed, deadLettered) => {
            if (synced > 0) {
                showToast('success', `已同步 ${synced} 项`);
                // Refresh data from server after sync
                refreshFromServer();
                refreshSentencesFromServer();
            }
            // deadLettered 是 failed 的子集（重试刚跨过上限、此后不再自动重试），
            // 给出比普通失败更明确、可操作的提示；否则回退到通用的瞬时失败提示。
            if (deadLettered > 0) {
                showToast('error', `${deadLettered} 项多次同步失败，已暂停自动重试`);
            } else if (failed > 0) {
                showToast('error', `${failed} 项同步失败`);
            }
        }
    });

    const {
        words, loading: wordsLoading, syncing,
        addWord, addWords, deleteWord, updateWordExample, restoreWord,
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

    // 复习功能（SRS）：从 useWords 传入 words 组合，复习状态与词库对账
    const {
        loading: reviewLoading,
        dueCount,
        reviewedTodayCount,
        totalTracked,
        tomorrowDueCount,
        aheadCount,
        session: reviewSession,
        currentCard: reviewCurrentCard,
        isSessionFinished: reviewFinished,
        summary: reviewSummary,
        startSession, startAheadSession, nextRound, endSession,
        gradeWord, previewFor, removeReviewState
    } = useReview({
        userId: user?.id,
        words,
        wordsLoading,
        isOnline,
        onPendingChange: refreshPendingCount
    });

    // Local state
    const [activeTab, setActiveTab] = useState<'all' | 'en' | 'de' | 'saved' | 'review'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, DEBOUNCE_DELAY);
    // 收藏 tab 的语言过滤（本地状态，仅影响收藏列表展示）
    const [savedLanguageFilter, setSavedLanguageFilter] = useState<SentenceLanguageFilter>('all');
    const [isAdding, setIsAdding] = useState(false);
    const [newWord, setNewWord] = useState<NewWord>({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '', etymology: '' });
    // 输入模式：单词 or 句子。默认由 classifyInput 本地预判，权威值以 detectAndAnalyze 的 AI 结果为准
    const [inputMode, setInputMode] = useState<'word' | 'sentence'>('word');
    const [sentenceDraft, setSentenceDraft] = useState<SentenceAnalysis | null>(null);
    const [sentenceAiLoading, setSentenceAiLoading] = useState(false);
    // 句子解析因离线 / AI 失败而不可得：仍允许手填翻译后离线保存
    const [sentenceNeedsConnection, setSentenceNeedsConnection] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [cachedKeys, setCachedKeys] = useState<Set<string>>(() => new Set());
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

    // Vocabulary expansion state
    const [showExpansion, setShowExpansion] = useState(false);
    const [expansionLoading, setExpansionLoading] = useState(false);
    const [expansionData, setExpansionData] = useState<{
        sourceWord: Word;
        theme: string;
        items: ExpansionPreviewItem[];
    } | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const aiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const ignoreFetch = useRef(false);
    // AI 请求序号：每次发起 ++，回填前校验仍是最新，避免双请求竞态（后返回者覆盖）
    const aiSeqRef = useRef(0);
    // 保存最新的 newWord，供异步回调中读取（规避闭包捕获的过期值）
    const newWordRef = useRef(newWord);
    newWordRef.current = newWord;
    // 保存最新的 inputMode，供防抖定时器回调判断当前是否仍在单词模式（句子模式不回填单词字段）
    const inputModeRef = useRef(inputMode);
    inputModeRef.current = inputMode;

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

    // AI content（仅单词模式逐字防抖重取；句子模式不逐字重取，交由 handleStartAdd / 手动切换触发）
    useEffect(() => {
        if (ignoreFetch.current) {
            ignoreFetch.current = false;
            return;
        }
        // 句子模式不逐字重取（用 ref 读当前模式，避免把 inputMode 加进依赖导致切换时重复请求）
        if (inputModeRef.current !== 'word') return;
        if (!newWord.word.trim()) return;
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        if (!apiKey) return;

        aiTimeoutRef.current = setTimeout(async () => {
            const requestText = newWord.word.trim();
            if (requestText.length >= 1) {
                const seq = ++aiSeqRef.current;
                setAiLoading(true);
                const content = await getAIContent(
                    requestText,
                    newWord.language,
                    apiKey,
                    (msg) => { if (seq === aiSeqRef.current) showToast('error', msg); }
                );
                // 竞态防护：非最新请求直接丢弃，loading 由更新的请求负责收尾
                if (seq !== aiSeqRef.current) return;
                // 若期间已切到句子模式，丢弃该结果（避免回填单词字段）
                if (inputModeRef.current !== 'word') { setAiLoading(false); return; }
                // 仅当输入框文本仍等于发起时文本才回填，避免后返回者覆盖成错配条目
                if (content && newWordRef.current.word.trim() === requestText) {
                    setNewWord(prev => ({
                        ...prev,
                        meaning: content.translation || prev.meaning,
                        example: content.example || '',
                        exampleCn: content.exampleCn || '',
                        category: sanitizeCategory(content.category),
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

    // 重置并关闭添加表单（单词/句子两种模式共用）
    const resetAddForm = useCallback(() => {
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        setIsAdding(false);
        setInputMode('word');
        setSentenceDraft(null);
        setSentenceAiLoading(false);
        setSentenceNeedsConnection(false);
        setAiLoading(false);
        setNewWord(prev => ({ word: '', meaning: '', language: prev.language, example: '', exampleCn: '', category: '', etymology: '' }));
        // 搜索框兼作句子/单词输入框，退出添加态时一并清空——否则残留的整句会把词列表按词过滤成空
        // （只剩刚存的句子在收藏命中），且这是纯内存态，用户只能退出重进才恢复。覆盖成功/取消/失败全路径。
        setSearchQuery('');
    }, []);

    const handleStartAdd = async () => {
        setIsAdding(true);
        const text = searchQuery.trim();
        if (!text) return;
        // 文本已捕获进 text/newWord，立即清空搜索框：进入添加态后词列表不再被这段整句过滤成空
        setSearchQuery('');

        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);

        // 本地启发式先定默认模式，立即渲染对应骨架（不等 AI）
        const guessed = classifyInput(text);
        setInputMode(guessed);
        ignoreFetch.current = true;
        setNewWord(prev => ({ ...prev, word: text }));

        if (guessed === 'sentence') {
            // 临时占位：先把原句显示出来，翻译/重点词随后由 AI 回填
            setSentenceDraft({ language: newWord.language, sentence: text, translation: '', keywords: [], grammar: [] });
            setSentenceNeedsConnection(false);
        } else {
            setSentenceDraft(null);
        }

        // 无 API Key：句子模式仍可手填翻译离线保存
        if (!apiKey) {
            if (guessed === 'sentence') setSentenceNeedsConnection(true);
            return;
        }

        const seq = ++aiSeqRef.current;
        if (guessed === 'sentence') setSentenceAiLoading(true); else setAiLoading(true);

        const result = await detectAndAnalyze(
            text,
            apiKey,
            (msg) => { if (seq === aiSeqRef.current) showToast('error', msg); }
        );

        // 竞态防护：非最新请求直接丢弃，loading 由更新的请求负责收尾
        if (seq !== aiSeqRef.current) return;

        // 仅当输入框文本仍等于发起时文本才回填，避免「词与释义错配」
        if (newWordRef.current.word.trim() === text) {
            if (result && result.inputType === 'word') {
                // AI 权威：判为单词 → 切到单词表单并回填
                setInputMode('word');
                setSentenceDraft(null);
                ignoreFetch.current = true;
                setNewWord(prev => ({
                    ...prev,
                    language: result.language,
                    meaning: result.translation,
                    example: result.example,
                    exampleCn: result.exampleCn,
                    category: sanitizeCategory(result.category),
                    etymology: result.etymology || ''
                }));
            } else if (result && result.inputType === 'sentence') {
                // AI 权威：判为句子 → 填充句子卡片
                setInputMode('sentence');
                setSentenceDraft({
                    language: result.language,
                    sentence: result.sentence,
                    translation: result.translation,
                    keywords: result.keywords ?? [],
                    grammar: result.grammar ?? [],
                    register: result.register
                });
                setSentenceNeedsConnection(false);
            } else if (guessed === 'sentence') {
                // AI 失败且当前处于句子模式：保留原句，提示需联网
                setSentenceNeedsConnection(true);
            }
        }
        setAiLoading(false);
        setSentenceAiLoading(false);
    };

    // 手动切换单词/句子模式：用当前文本重跑对应 AI 调用
    const handleSwitchInputMode = async (mode: 'word' | 'sentence') => {
        if (mode === inputMode) return;
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        setInputMode(mode);
        const text = newWord.word.trim();

        if (mode === 'word') {
            setSentenceDraft(null);
            setSentenceNeedsConnection(false);
            setSentenceAiLoading(false);
            if (!text || !apiKey) return;
            const seq = ++aiSeqRef.current;
            setAiLoading(true);
            const content = await getAIContent(
                text,
                newWord.language,
                apiKey,
                (msg) => { if (seq === aiSeqRef.current) showToast('error', msg); }
            );
            if (seq !== aiSeqRef.current) return;
            if (content && newWordRef.current.word.trim() === text) {
                ignoreFetch.current = true;
                setNewWord(prev => ({
                    ...prev,
                    meaning: content.translation || prev.meaning,
                    example: content.example || '',
                    exampleCn: content.exampleCn || '',
                    category: sanitizeCategory(content.category),
                    etymology: content.etymology || ''
                }));
            }
            setAiLoading(false);
            setSentenceAiLoading(false);
        } else {
            // 切到句子模式：先占位，再跑整句解析
            setSentenceNeedsConnection(false);
            setSentenceDraft({ language: newWord.language, sentence: newWord.word, translation: '', keywords: [], grammar: [] });
            if (!text) return;
            if (!apiKey) { setSentenceNeedsConnection(true); return; }
            const seq = ++aiSeqRef.current;
            setSentenceAiLoading(true);
            const result = await detectAndAnalyze(
                text,
                apiKey,
                (msg) => { if (seq === aiSeqRef.current) showToast('error', msg); }
            );
            if (seq !== aiSeqRef.current) return;
            if (newWordRef.current.word.trim() === text) {
                if (result && result.inputType === 'sentence') {
                    setSentenceDraft({
                        language: result.language,
                        sentence: result.sentence,
                        translation: result.translation,
                        keywords: result.keywords ?? [],
                        grammar: result.grammar ?? [],
                        register: result.register
                    });
                } else if (result && result.inputType === 'word') {
                    // 用户手动指定为句子但 AI 判为单词：保留句子 UI，用可得信息兜底（无重点词/语法点）
                    setSentenceDraft({ language: result.language, sentence: text, translation: result.translation, keywords: [], grammar: [] });
                } else {
                    setSentenceNeedsConnection(true);
                }
            }
            setAiLoading(false);
            setSentenceAiLoading(false);
        }
    };

    // 句子翻译可编辑
    const handleSentenceTranslationChange = useCallback((value: string) => {
        setSentenceDraft(prev => (prev ? { ...prev, translation: value } : prev));
    }, []);

    // 判断某重点词是否已在生词本（大小写不敏感 + 同语言）
    const isKeywordAdded = useCallback((word: string) => {
        const draft = sentenceDraft;
        if (!draft) return false;
        const target = word.trim().toLowerCase();
        return words.some(w => w.word.toLowerCase() === target && w.language === draft.language);
    }, [words, sentenceDraft]);

    // 把重点词加入生词本
    const handleAddKeyword = useCallback(async (kw: SentenceKeyword) => {
        const draft = sentenceDraft;
        if (!draft) return;
        const trimmed = kw.word.trim();
        const isDuplicate = words.some(w => w.word.toLowerCase() === trimmed.toLowerCase() && w.language === draft.language);
        if (isDuplicate) {
            showToast('info', '已在生词本');
            return;
        }
        await addWord({
            word: trimmed, // 保留词典原型大小写（德语名词首字母大写不被归一）
            meaning: kw.meaning,
            language: draft.language,
            example: draft.sentence,
            exampleCn: draft.translation,
            category: draft.register || 'daily',
            etymology: '',
            date: new Date().toLocaleDateString('sv-SE')
        });
        showToast('success', '已加入生词本');
    }, [sentenceDraft, words, addWord, showToast]);

    // 句子卡片的 draft：sentenceDraft 为空时回退到基于当前输入的占位对象。
    // 用 useMemo 稳定引用，避免每次渲染都新建对象字面量导致 memo(SentenceCard) 失效。
    const sentenceCardDraft = useMemo<SentenceAnalysis>(
        () => sentenceDraft ?? { language: newWord.language, sentence: newWord.word, translation: '', keywords: [], grammar: [] },
        [sentenceDraft, newWord.language, newWord.word]
    );

    // 朗读句子输入：抽成 useCallback 稳定引用，配合 memo(SentenceCard) 避免每次渲染因新建箭头函数而失效。
    const handleSpeakSentenceInput = useCallback(() => {
        const d = sentenceDraft;
        if (!d || !d.sentence.trim()) return;
        speakWord(d.sentence, d.language, setSpeakingId, 'input-sentence', apiKey, (key) => setCachedKeys(prev => new Set(prev).add(key)));
    }, [sentenceDraft, apiKey]);

    // 保存句子输入到收藏
    const handleSaveSentenceInput = useCallback(async () => {
        const draft = sentenceDraft;
        if (!draft) return;
        const translation = draft.translation.trim();
        if (!draft.sentence.trim() || !translation) return;
        const ok = await saveSentence({
            sentence: draft.sentence,              // 绝不 toLowerCase，原样保留大小写
            sentenceCn: translation,
            language: draft.language,
            scene: sceneFromRegister(draft.register),
            sourceType: 'input',
            sourceWords: draft.keywords.map(k => k.word),
            keywords: draft.keywords,
            grammar: draft.grammar
        }, '已保存到收藏');
        // 仅在保存成功时关闭表单并清空草稿；失败时保留用户手填/AI 生成的整句，供直接重试，不丢草稿
        // （resetAddForm 内已清空搜索框，覆盖成功路径）
        if (ok) {
            resetAddForm();
            setActiveTab('saved'); // 保存成功后跳到「收藏」，直接看到刚存的句子，而非停在原词表 tab
        }
    }, [sentenceDraft, saveSentence, resetAddForm]);

    const handleAddWord = async () => {
        if (!newWord.word.trim() || !newWord.meaning.trim()) return;

        const trimmedWord = newWord.word.trim();
        // 去重：比较时统一小写归一（英德一致），命中则提示并保持表单打开、不写入
        const isDuplicate = words.some(w => w.word.toLowerCase() === trimmedWord.toLowerCase() && w.language === newWord.language);
        if (isDuplicate) {
            showToast('info', '该单词已存在');
            return;
        }

        await addWord({
            word: trimmedWord, // 保留原大小写（德语名词 Haus 不再被小写化）
            meaning: newWord.meaning.trim(),
            language: newWord.language,
            example: newWord.example.trim(),
            exampleCn: newWord.exampleCn.trim(),
            category: newWord.category,
            etymology: newWord.etymology,
            date: new Date().toLocaleDateString('sv-SE')
        });

        resetAddForm(); // 内含清空搜索框
    };

    const handleDeleteWord = useCallback(async (id: string) => {
        const deleted = await deleteWord(id);
        if (deleted) {
            // 删词联动：清本地复习状态（fire-and-forget；服务端靠 FK CASCADE）。
            // 撤销时该词由 useReview 的回填对账重新补建状态（可接受的轻微 SRS 漂移）。
            removeReviewState(id);
            markDeleted({
                id: deleted.id,
                type: 'word',
                label: deleted.word,
                restore: async () => { await restoreWord(deleted); }
            });
        }
    }, [deleteWord, markDeleted, restoreWord, removeReviewState]);

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

    // 收藏句子：语言过滤 + 搜索（复用 debouncedSearchQuery，对原句与中译大小写不敏感）
    const filteredSavedSentences = useMemo(() =>
        filterSavedSentences(savedSentences, savedLanguageFilter, debouncedSearchQuery),
        [savedSentences, savedLanguageFilter, debouncedSearchQuery]
    );

    const formatDate = useCallback((d: string) => {
        const today = new Date().toLocaleDateString('sv-SE');
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
        if (d === today) return '今天';
        if (d === yesterday) return '昨天';
        // 按本地时区解析 YYYY-MM-DD，避免 new Date(d) 以 UTC 解析在负时区少显示一天
        return new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }, []);

    const getCategoryClass = useCallback((cat: string) => {
        return CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG]?.style || CATEGORY_CONFIG[''].style;
    }, []);

    const getCategoryLabel = useCallback((cat: string) => {
        return CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG]?.label || '';
    }, []);

    const exportWords = useCallback(() => {
        const langLabel = { en: '英语', de: '德语' } as const;
        const catLabel = { daily: '日常', professional: '专业', formal: '正式' } as const;
        // 按日期分组
        const grouped: Record<string, typeof words> = {};
        for (const w of words) {
            (grouped[w.date] ||= []).push(w);
        }
        const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
        const lines: string[] = [`# 词汇本`, ``, `> 导出时间：${new Date().toLocaleString('zh-CN')}　共 ${words.length} 词`, ``];
        for (const date of dates) {
            // 本地时区解析，避免 UTC 偏移（见 formatDate）
            const label = new Date(date + 'T00:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
            lines.push(`## ${label}`, ``);
            for (const w of grouped[date]) {
                const lang = langLabel[w.language] || w.language;
                const cat = catLabel[w.category as keyof typeof catLabel] || '';
                lines.push(`### ${w.word}${cat ? `　\`${cat}\`` : ''}`);
                lines.push(`- **释义**：${w.meaning}　_(${lang})_`);
                if (w.example) lines.push(`- **例句**：${w.example}`);
                if (w.exampleCn) lines.push(`- **例句翻译**：${w.exampleCn}`);
                if (w.etymology) lines.push(`- **词源**：${w.etymology}`);
                lines.push(``);
            }
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vocab-${new Date().toLocaleDateString('sv-SE')}.md`;
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
        const shuffled = [...langWords];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
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

    // Vocabulary expansion handlers
    const handleVocabularyExpansion = async (word?: Word) => {
        if (!apiKey || activeTab === 'all' || activeTab === 'saved') return;

        const langWords = words.filter(w => w.language === activeTab);
        if (langWords.length < 1) return;

        setExpansionLoading(true);
        setShowExpansion(true);
        setShowSentence(false);
        setSentenceData(null);

        // Use provided word or pick random one
        const sourceWord = word || langWords[Math.floor(Math.random() * langWords.length)];

        const result = await generateVocabularyExpansion(sourceWord, apiKey);

        if (result) {
            setExpansionData({
                sourceWord,
                theme: result.theme,
                items: result.expansions.map(exp => ({
                    ...exp,
                    selected: true
                }))
            });
        } else {
            setExpansionData(null);
            showToast('error', '扩展失败，请重试');
        }

        setExpansionLoading(false);
    };

    const handleAddSelectedWords = async () => {
        if (!expansionData || activeTab === 'all' || activeTab === 'saved') return;

        const selectedItems = expansionData.items.filter(item => item.selected);
        if (selectedItems.length === 0) {
            showToast('info', '请至少选择一个新词');
            return;
        }

        // Filter out words that already exist
        const newWordsToAdd: Omit<Word, 'id' | 'timestamp'>[] = [];
        const skippedWords: string[] = [];

        for (const item of selectedItems) {
            const exists = words.some(w => w.word.toLowerCase() === item.word.toLowerCase() && w.language === activeTab);
            if (exists) {
                skippedWords.push(item.word);
            } else {
                newWordsToAdd.push({
                    word: item.word.trim(), // 保留原大小写（去重比较处已小写归一）
                    meaning: item.meaning,
                    language: activeTab as 'en' | 'de',
                    example: item.sentence,
                    exampleCn: item.sentenceCn,
                    category: sanitizeCategory(expansionData.sourceWord.category) || 'daily',
                    etymology: `通过"${expansionData.sourceWord.word}"扩展学习 (${item.relationType})`,
                    date: new Date().toLocaleDateString('sv-SE')
                });
            }
        }

        // Batch add all new words with a single state update
        if (newWordsToAdd.length > 0) {
            await addWords(newWordsToAdd);
            showToast('success', `已添加 ${newWordsToAdd.length} 个新词`);
        }

        // Show info about skipped words (if any and some were added)
        if (skippedWords.length > 0 && newWordsToAdd.length === 0) {
            showToast('info', `所选词汇均已在词汇本中`);
        }

        setShowExpansion(false);
        setExpansionData(null);
    };

    const toggleWordSelection = (index: number) => {
        if (!expansionData) return;
        setExpansionData(prev => {
            if (!prev) return null;
            const newItems = [...prev.items];
            newItems[index] = { ...newItems[index], selected: !newItems[index].selected };
            return { ...prev, items: newItems };
        });
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
                    onClick={() => { setActiveTab('all'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); setShowExpansion(false); setExpansionData(null); }}
                >
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{allStats.total}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">总计</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-blue-400 dark:hover:border-blue-500 active:scale-95 ${activeTab === 'en' ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setActiveTab('en'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); setShowExpansion(false); setExpansionData(null); }}
                >
                    <div className="text-2xl font-bold text-blue-600">{allStats.en}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">英语</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-green-400 dark:hover:border-green-500 active:scale-95 ${activeTab === 'de' ? 'border-green-400 dark:border-green-500 ring-1 ring-green-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setActiveTab('de'); setTodayFilter(false); setShowSentence(false); setSentenceData(null); setShowExpansion(false); setExpansionData(null); }}
                >
                    <div className="text-2xl font-bold text-green-600">{allStats.de}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">德语</div>
                </button>
                <button
                    className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-amber-400 dark:hover:border-amber-500 active:scale-95 ${todayFilter ? 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                    onClick={() => { setTodayFilter(!todayFilter); setActiveTab('all'); setShowSentence(false); setSentenceData(null); setShowExpansion(false); setExpansionData(null); }}
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
                        placeholder={activeTab === 'saved' ? '搜索句子…' : '搜索或输入句子…'}
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

            {/* Tabs：按钮禁止换行，窄屏时整条横向滚动而非挤压换行 */}
            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-6 overflow-x-auto">
                {[{ id: 'all' as const, label: '全部' }, { id: 'en' as const, label: '🇬🇧 英语' }, { id: 'de' as const, label: '🇩🇪 德语' }, { id: 'saved' as const, label: '⭐ 收藏' }, { id: 'review' as const, label: '📖 复习' }].map(t => {
                    // 复习 tab 显到期徽标（>0 才显示，99+ 封顶）；其余 tab 显数量
                    let badge: string | null;
                    if (t.id === 'review') {
                        badge = dueCount > 0 ? (dueCount > 99 ? '99+' : String(dueCount)) : null;
                    } else if (t.id === 'all') {
                        badge = String(allStats.total);
                    } else if (t.id === 'saved') {
                        badge = String(allStats.saved);
                    } else {
                        badge = String(allStats[t.id]);
                    }
                    return (
                        <button
                            key={t.id}
                            className={`flex-1 px-2 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeTab === t.id
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                }`}
                            onClick={() => { setActiveTab(t.id); setTodayFilter(false); setShowSentence(false); setSentenceData(null); setShowExpansion(false); setExpansionData(null); }}
                        >
                            {t.label}
                            {badge !== null && (
                                <span className={`ml-1 text-xs ${t.id === 'review'
                                    ? 'inline-flex items-center justify-center min-w-[18px] px-1 rounded-full bg-amber-500 text-white font-semibold align-middle'
                                    : 'opacity-60'
                                    }`}>{badge}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Sentence Generation & Vocabulary Expansion Panel */}
            {(activeTab === 'en' || activeTab === 'de') && allStats[activeTab] >= 1 && (
                <div className="mb-6">
                    {!showSentence && !showExpansion ? (
                        <div className="flex gap-2">
                            {/* Combined Sentence Button - requires 2+ words */}
                            <button
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-xl hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/30 dark:hover:to-orange-900/30 active:scale-[0.98] transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={handleGenerateSentence}
                                disabled={!apiKey || !isOnline || allStats[activeTab] < 2}
                                title={allStats[activeTab] < 2 ? '需要至少2个单词' : ''}
                            >
                                <Icons.Sparkles /> 组合造句
                            </button>

                            {/* Vocabulary Expansion Button */}
                            <button
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400 rounded-xl hover:from-purple-100 hover:to-indigo-100 dark:hover:from-purple-900/30 dark:hover:to-indigo-900/30 active:scale-[0.98] transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => handleVocabularyExpansion()}
                                disabled={!apiKey || !isOnline}
                            >
                                <Icons.Expand /> 词汇扩展
                            </button>
                        </div>
                    ) : showSentence ? (
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
                                        {sentenceData.words.map((w) => (
                                            <span
                                                key={w.id}
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
                                            <Icons.Speaker playing={speakingId === 'sentence'} cached={cachedKeys.has(generateCacheKey(activeTab, sentenceData.sentence))} /> 朗读
                                        </button>
                                        <button
                                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg active:scale-95 transition-all text-sm font-medium ${isSentenceSaved(sentenceData.sentence)
                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                                }`}
                                            onClick={() => {
                                                if (isSentenceSaved(sentenceData.sentence)) {
                                                    handleDeleteSentence(getSavedSentenceId(sentenceData.sentence)!);
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
                    ) : showExpansion ? (
                        /* Vocabulary Expansion Panel */
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-purple-600 dark:text-purple-400">
                                    <Icons.Expand /> 词汇扩展
                                </div>
                                <button
                                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                                    onClick={() => { setShowExpansion(false); setExpansionData(null); }}
                                >
                                    ✕
                                </button>
                            </div>

                            {expansionLoading ? (
                                <div className="space-y-3">
                                    <div className="h-8 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg"></div>
                                    <div className="h-24 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg"></div>
                                    <div className="h-24 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg"></div>
                                </div>
                            ) : expansionData ? (
                                <>
                                    {/* Source Word Display */}
                                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">基于:</span>
                                        <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${
                                            activeTab === 'en'
                                                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                                : 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                        }`}>
                                            {expansionData.sourceWord.word}
                                        </span>
                                        <span className="text-xs text-slate-400">→</span>
                                        <span className="text-xs px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-full">
                                            {expansionData.theme}
                                        </span>
                                    </div>

                                    {/* New Words List */}
                                    <div className="space-y-3 mb-4">
                                        {expansionData.items.map((item, index) => (
                                            <div
                                                key={item.word}
                                                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                                                    item.selected
                                                        ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700'
                                                        : 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 opacity-60'
                                                }`}
                                                onClick={() => toggleWordSelection(index)}
                                            >
                                                {/* Word Header */}
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={item.selected}
                                                            onChange={() => toggleWordSelection(index)}
                                                            className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                                        />
                                                        <span className="font-bold text-slate-800 dark:text-slate-100">
                                                            {item.word}
                                                        </span>
                                                        <span className="text-sm text-slate-600 dark:text-slate-300">
                                                            {item.meaning}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">
                                                        {item.relationType === 'synonym' ? '近义' :
                                                         item.relationType === 'antonym' ? '反义' :
                                                         item.relationType === 'collocation' ? '搭配' :
                                                         item.relationType === 'thematic' ? '主题' : '相关'}
                                                    </span>
                                                </div>

                                                {/* Sentence */}
                                                <div className="ml-6">
                                                    <div className="text-sm text-slate-700 dark:text-slate-300 mb-1">
                                                        {item.sentence}
                                                    </div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                                        {item.sentenceCn}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                        <button
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all text-sm font-medium"
                                            onClick={() => handleVocabularyExpansion()}
                                        >
                                            <Icons.Refresh /> 换一个词
                                        </button>
                                        <button
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg active:scale-95 transition-all text-sm font-medium disabled:opacity-50"
                                            onClick={handleAddSelectedWords}
                                            disabled={!expansionData.items.some(i => i.selected) || syncing}
                                        >
                                            <Icons.Plus /> 添加选中 ({expansionData.items.filter(i => i.selected).length})
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-slate-400 py-4">扩展失败，请重试</div>
                            )}
                        </div>
                    ) : null}
                </div>
            )}

            {/* Add Form */}
            {isAdding && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6 shadow-sm">
                    <div className="flex flex-wrap gap-2 mb-4">
                        {/* 语言开关 */}
                        <div className="flex gap-2 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg w-fit">
                            <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'en' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => { setInputMode('word'); setSentenceDraft(null); setSentenceNeedsConnection(false); setNewWord(p => ({ ...p, language: 'en', word: '', meaning: '', example: '', exampleCn: '', category: '', etymology: '' })); }}>🇬🇧 英语</button>
                            <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'de' ? 'bg-white dark:bg-slate-600 text-green-600 dark:text-green-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => { setInputMode('word'); setSentenceDraft(null); setSentenceNeedsConnection(false); setNewWord(p => ({ ...p, language: 'de', word: '', meaning: '', example: '', exampleCn: '', category: '', etymology: '' })); }}>🇩🇪 德语</button>
                        </div>
                        {/* 单词 / 句子 分段开关 */}
                        <div className="flex gap-2 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg w-fit">
                            <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${inputMode === 'word' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => handleSwitchInputMode('word')}>单词</button>
                            <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${inputMode === 'sentence' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => handleSwitchInputMode('sentence')}>句子</button>
                        </div>
                    </div>
                    <input
                        ref={inputRef}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100 font-medium"
                        placeholder="输入单词、短语或句子"
                        value={newWord.word}
                        onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))}
                    />
                    {inputMode === 'sentence' ? (
                        <SentenceCard
                            draft={sentenceCardDraft}
                            loading={sentenceAiLoading}
                            needsConnection={sentenceNeedsConnection}
                            speaking={speakingId === 'input-sentence'}
                            cached={cachedKeys.has(generateCacheKey(sentenceDraft?.language ?? newWord.language, sentenceDraft?.sentence ?? newWord.word))}
                            saving={savingId === (sentenceDraft?.sentence ?? '')}
                            onSpeak={handleSpeakSentenceInput}
                            onTranslationChange={handleSentenceTranslationChange}
                            onAddKeyword={handleAddKeyword}
                            isKeywordAdded={isKeywordAdded}
                            onSave={handleSaveSentenceInput}
                            onCancel={resetAddForm}
                        />
                    ) : (
                        <>
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
                                <button className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium" onClick={resetAddForm}>取消</button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Word List */}
            {activeTab === 'review' ? (
                <ReviewSession
                    loading={reviewLoading}
                    dueCount={dueCount}
                    reviewedTodayCount={reviewedTodayCount}
                    totalTracked={totalTracked}
                    tomorrowDueCount={tomorrowDueCount}
                    aheadCount={aheadCount}
                    session={reviewSession}
                    currentCard={reviewCurrentCard}
                    isSessionFinished={reviewFinished}
                    summary={reviewSummary}
                    startSession={startSession}
                    startAheadSession={startAheadSession}
                    nextRound={nextRound}
                    endSession={endSession}
                    gradeWord={gradeWord}
                    previewFor={previewFor}
                    speakingId={speakingId}
                    setSpeakingId={setSpeakingId}
                    apiKey={apiKey}
                    cachedKeys={cachedKeys}
                    setCachedKeys={setCachedKeys}
                    getCategoryClass={getCategoryClass}
                    getCategoryLabel={getCategoryLabel}
                />
            ) : activeTab === 'saved' ? (
                <div>
                    {savedSentences.length === 0 ? (
                        // 完全没有收藏
                        <div className="text-center py-16">
                            <div className="text-6xl text-slate-200 dark:text-slate-700 mb-4">⭐</div>
                            <div className="text-slate-500 font-medium mb-1">还没有收藏的句子</div>
                            <div className="text-sm text-slate-400">收藏你喜欢的例句和组合造句吧</div>
                        </div>
                    ) : (
                        <>
                            {/* 语言过滤 pills（样式对齐主 tab pills） */}
                            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-4">
                                {[{ id: 'all' as const, label: '全部' }, { id: 'en' as const, label: '🇬🇧 英语' }, { id: 'de' as const, label: '🇩🇪 德语' }].map(f => (
                                    <button
                                        key={f.id}
                                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${savedLanguageFilter === f.id
                                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                            }`}
                                        onClick={() => setSavedLanguageFilter(f.id)}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>

                            {filteredSavedSentences.length === 0 ? (
                                // 有收藏但当前过滤条件无匹配
                                <div className="text-center py-16">
                                    <div className="text-6xl text-slate-200 dark:text-slate-700 mb-4">🔍</div>
                                    <div className="text-slate-500 font-medium mb-1">无匹配结果</div>
                                    <div className="text-sm text-slate-400">换个搜索词或语言筛选试试</div>
                                </div>
                            ) : (
                                <div className="space-y-0">
                                    {filteredSavedSentences.map(s => (
                                        <SwipeableSentenceCard
                                            key={s.id}
                                            sentence={s}
                                            onDelete={() => handleDeleteSentence(s.id)}
                                            onSpeak={() => speakWord(s.sentence, s.language, setSpeakingId, s.id, apiKey, (key) => setCachedKeys(prev => new Set(prev).add(key)))}
                                            speakingId={speakingId}
                                            cached={cachedKeys.has(generateCacheKey(s.language, s.sentence))}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
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
                    deleteSentence={handleDeleteSentence}
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
