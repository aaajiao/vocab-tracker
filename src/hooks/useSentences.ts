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
    unsaveSentence: (id: string) => Promise<SavedSentence | null>;
    restoreSentence: (sentence: SavedSentence) => Promise<void>;
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

    const unsaveSentence = useCallback(async (id: string): Promise<SavedSentence | null> => {
        // Find the sentence before deleting
        const sentenceToDelete = savedSentences.find(s => s.id === id);
        if (!sentenceToDelete) return null;

        // Optimistic update
        setSavedSentences(prev => prev.filter(s => s.id !== id));

        const { error } = await supabase.from('saved_sentences').delete().eq('id', id);
        if (error) {
            // Restore on error
            setSavedSentences(prev => [sentenceToDelete, ...prev]);
            showToast?.('error', '取消收藏失败');
            return null;
        }

        return sentenceToDelete;
    }, [savedSentences, showToast]);

    const restoreSentence = useCallback(async (sentence: SavedSentence) => {
        if (!userId) return;

        const { data, error } = await supabase.from('saved_sentences').insert({
            user_id: userId,
            sentence: sentence.sentence,
            sentence_cn: sentence.sentence_cn,
            language: sentence.language,
            scene: sentence.scene,
            source_type: sentence.source_type,
            source_words: sentence.source_words || []
        }).select();

        if (!error && data) {
            setSavedSentences(prev => [data[0], ...prev]);
            showToast?.('success', '已恢复');
        }
    }, [userId, showToast]);

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
        restoreSentence,
        isSentenceSaved,
        getSavedSentenceId
    };
}

export default useSentences;
