import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import type { SavedSentence, SentenceInput } from '../types';

interface UseSentencesProps {
    userId: string | undefined;
    showToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface UseSentencesReturn {
    savedSentences: SavedSentence[];
    savingId: string | null;
    saveSentence: (sentenceObj: SentenceInput) => Promise<void>;
    unsaveSentence: (id: string) => Promise<void>;
    isSentenceSaved: (sentence: string) => boolean;
    getSavedSentenceId: (sentence: string) => string | null;
}

export function useSentences({ userId, showToast }: UseSentencesProps): UseSentencesReturn {
    const [savedSentences, setSavedSentences] = useState<SavedSentence[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);

    // Load saved sentences
    useEffect(() => {
        if (!userId) return;

        const loadSentences = async () => {
            const { data, error } = await supabase
                .from('saved_sentences')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (!error) {
                setSavedSentences(data || []);
            }
        };

        loadSentences();
    }, [userId]);

    const saveSentence = useCallback(async (sentenceObj: SentenceInput) => {
        if (!userId) return;
        setSavingId(sentenceObj.sentence);

        const { data, error } = await supabase.from('saved_sentences').insert({
            user_id: userId,
            sentence: sentenceObj.sentence,
            sentence_cn: sentenceObj.sentenceCn,
            language: sentenceObj.language,
            scene: sentenceObj.scene || null,
            source_type: sentenceObj.sourceType,
            source_words: sentenceObj.sourceWords || []
        }).select();

        if (!error && data) {
            setSavedSentences(prev => [data[0], ...prev]);
            showToast?.('success', '已收藏');
        } else {
            showToast?.('error', '收藏失败');
        }
        setSavingId(null);
    }, [userId, showToast]);

    const unsaveSentence = useCallback(async (id: string) => {
        const { error } = await supabase.from('saved_sentences').delete().eq('id', id);
        if (!error) {
            setSavedSentences(prev => prev.filter(s => s.id !== id));
        } else {
            showToast?.('error', '取消收藏失败');
        }
    }, [showToast]);

    const isSentenceSaved = useCallback((sentence: string) => {
        return savedSentences.some(s => s.sentence === sentence);
    }, [savedSentences]);

    const getSavedSentenceId = useCallback((sentence: string): string | null => {
        const found = savedSentences.find(s => s.sentence === sentence);
        return found ? found.id : null;
    }, [savedSentences]);

    return {
        savedSentences,
        savingId,
        saveSentence,
        unsaveSentence,
        isSentenceSaved,
        getSavedSentenceId
    };
}

export default useSentences;
