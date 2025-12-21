import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import type { Word } from '../types';
import { deleteCachedAudio, generateCacheKey } from '../services/audioCache';

interface UseWordsProps {
    userId: string | undefined;
    onLoadComplete?: () => void;
    showToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface UseWordsReturn {
    words: Word[];
    loading: boolean;
    syncing: boolean;
    addWord: (newWord: Omit<Word, 'id' | 'timestamp'>) => Promise<void>;
    deleteWord: (id: string) => Promise<Word | null>;
    updateWordExample: (id: string, example: string, exampleCn: string) => Promise<void>;
    restoreWord: (word: Word) => Promise<void>;
    getFilteredWords: (activeTab: string, searchQuery: string, todayFilter: boolean) => Word[];
    getGroupedByDate: (filteredWords: Word[]) => Record<string, Word[]>;
    stats: { total: number; en: number; de: number; today: number };
}

export function useWords({ userId, onLoadComplete, showToast }: UseWordsProps): UseWordsReturn {
    const [words, setWords] = useState<Word[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    // Load words from Supabase
    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        const loadWords = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('words')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Load error:', error);
                showToast?.('error', '加载词汇失败');
            } else {
                const formatted: Word[] = (data || []).map((w: any) => ({
                    id: w.id,
                    word: w.word,
                    meaning: w.meaning,
                    language: w.language,
                    example: w.example || '',
                    exampleCn: w.example_cn || '',
                    category: w.category || '',
                    etymology: w.etymology || '',
                    date: w.date,
                    timestamp: new Date(w.created_at).getTime()
                }));
                setWords(formatted);

                // Migrate localStorage if needed
                await migrateLocalStorage(userId);
            }
            setLoading(false);
            onLoadComplete?.();
        };

        loadWords();
    }, [userId]);

    const migrateLocalStorage = async (uid: string) => {
        const localData = localStorage.getItem('vocab-words-v4');
        if (!localData) return;

        try {
            const localWords = JSON.parse(localData);
            if (localWords.length === 0) return;

            setSyncing(true);
            showToast?.('info', `正在迁移 ${localWords.length} 个本地词汇...`);

            for (const w of localWords) {
                await supabase.from('words').upsert({
                    user_id: uid,
                    word: w.word,
                    meaning: w.meaning,
                    language: w.language,
                    example: w.example,
                    example_cn: w.exampleCn,
                    category: w.category || '',
                    date: w.date
                }, { onConflict: 'user_id,word,language' });
            }

            // Reload after migration
            const { data } = await supabase
                .from('words')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: false });

            if (data) {
                setWords(data.map((w: any) => ({
                    id: w.id,
                    word: w.word,
                    meaning: w.meaning,
                    language: w.language,
                    example: w.example || '',
                    exampleCn: w.example_cn || '',
                    category: w.category || '',
                    etymology: w.etymology || '',
                    date: w.date,
                    timestamp: new Date(w.created_at).getTime()
                })));
            }

            localStorage.removeItem('vocab-words-v4');
            showToast?.('success', `已迁移 ${localWords.length} 个词汇到云端`);
            setSyncing(false);
        } catch (e) {
            console.error('Migration failed:', e);
            showToast?.('error', '迁移失败');
            setSyncing(false);
        }
    };

    const addWord = useCallback(async (newWord: Omit<Word, 'id' | 'timestamp'>) => {
        if (!userId) return;
        setSyncing(true);

        const { data, error } = await supabase.from('words').insert({
            user_id: userId,
            word: newWord.word,
            meaning: newWord.meaning,
            language: newWord.language,
            example: newWord.example,
            example_cn: newWord.exampleCn,
            category: newWord.category,
            etymology: newWord.etymology,
            date: newWord.date
        }).select().single();

        if (error) {
            console.error('Add error:', error);
            showToast?.('error', '添加失败');
        } else {
            setWords(prev => [{
                id: data.id,
                word: data.word,
                meaning: data.meaning,
                language: data.language,
                example: data.example || '',
                exampleCn: data.example_cn || '',
                category: data.category || '',
                etymology: data.etymology || '',
                date: data.date,
                timestamp: new Date(data.created_at).getTime()
            }, ...prev]);
            showToast?.('success', '已添加');
        }
        setSyncing(false);
    }, [userId, showToast]);

    const deleteWord = useCallback(async (id: string): Promise<Word | null> => {
        if (!userId) return null;

        const wordToDelete = words.find(w => w.id === id);
        if (!wordToDelete) return null;

        // Optimistic update
        setWords(prev => prev.filter(w => w.id !== id));

        const { error } = await supabase.from('words').delete().eq('id', id);
        if (error) {
            // Restore on error
            setWords(prev => [...prev, wordToDelete].sort((a, b) => b.timestamp - a.timestamp));
            showToast?.('error', '删除失败');
            return null;
        }

        // Clean up audio cache for the deleted word
        const cacheKey = generateCacheKey(wordToDelete.language, wordToDelete.word);
        deleteCachedAudio(cacheKey).catch(() => { }); // Fire and forget

        return wordToDelete;
    }, [userId, words, showToast]);

    const updateWordExample = useCallback(async (id: string, example: string, exampleCn: string) => {
        const { error } = await supabase
            .from('words')
            .update({ example, example_cn: exampleCn })
            .eq('id', id);

        if (!error) {
            setWords(prev => prev.map(w => w.id === id ? { ...w, example, exampleCn } : w));
        } else {
            showToast?.('error', '更新例句失败');
        }
    }, [showToast]);

    const restoreWord = useCallback(async (word: Word) => {
        if (!userId) return;

        const { data, error } = await supabase.from('words').insert({
            user_id: userId,
            word: word.word,
            meaning: word.meaning,
            language: word.language,
            example: word.example,
            example_cn: word.exampleCn,
            category: word.category,
            etymology: word.etymology,
            date: word.date
        }).select().single();

        if (!error && data) {
            setWords(prev => [{
                id: data.id,
                word: data.word,
                meaning: data.meaning,
                language: data.language,
                example: data.example || '',
                exampleCn: data.example_cn || '',
                category: data.category || '',
                etymology: data.etymology || '',
                date: data.date,
                timestamp: new Date(data.created_at).getTime()
            }, ...prev]);
            showToast?.('success', '已恢复');
        }
    }, [userId, showToast]);

    const getFilteredWords = useCallback((activeTab: string, searchQuery: string, todayFilter: boolean) => {
        return words.filter(w => {
            const matchesTab = activeTab === 'all' || activeTab === 'saved' || w.language === activeTab;
            const matchesSearch = !searchQuery || w.word.toLowerCase().includes(searchQuery.toLowerCase()) || w.meaning.includes(searchQuery);
            const matchesToday = !todayFilter || w.date === new Date().toLocaleDateString('sv-SE');
            return matchesTab && matchesSearch && matchesToday;
        });
    }, [words]);

    const getGroupedByDate = useCallback((filteredWords: Word[]) => {
        return filteredWords.reduce((acc, word) => {
            if (!acc[word.date]) acc[word.date] = [];
            acc[word.date].push(word);
            return acc;
        }, {} as Record<string, Word[]>);
    }, []);

    const stats = useMemo(() => ({
        total: words.length,
        en: words.filter(w => w.language === 'en').length,
        de: words.filter(w => w.language === 'de').length,
        today: words.filter(w => w.date === new Date().toLocaleDateString('sv-SE')).length
    }), [words]);

    return {
        words,
        loading,
        syncing,
        addWord,
        deleteWord,
        updateWordExample,
        restoreWord,
        getFilteredWords,
        getGroupedByDate,
        stats
    };
}

export default useWords;
