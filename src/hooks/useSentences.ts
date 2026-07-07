import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import type { SavedSentence, SentenceInput } from '../types';
import { deleteCachedAudio, generateCacheKey } from '../services/audioCache';
import {
    getAllCachedSentences,
    setCachedSentences,
    addPendingSentence,
    markSentenceDeleted,
    withSentenceDefaults
} from '../services/sentencesCache';

interface UseSentencesProps {
    userId: string | undefined;
    isOnline?: boolean;
    showToast?: (type: 'success' | 'error' | 'info', message: string) => void;
    onPendingChange?: () => void;
}

interface UseSentencesReturn {
    savedSentences: SavedSentence[];
    savingId: string | null;
    saveSentence: (sentenceObj: SentenceInput, successMessage?: string) => Promise<boolean>;
    unsaveSentence: (id: string) => Promise<SavedSentence | null>;
    restoreSentence: (sentence: SavedSentence) => Promise<void>;
    isSentenceSaved: (sentence: string) => boolean;
    getSavedSentenceId: (sentence: string) => string | null;
    refreshFromServer: () => Promise<void>;
}

export function useSentences({ userId, isOnline = true, showToast, onPendingChange }: UseSentencesProps): UseSentencesReturn {
    const [savedSentences, setSavedSentences] = useState<SavedSentence[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);

    // Load saved sentences - first from cache, then from server if online
    useEffect(() => {
        if (!userId) return;

        const loadSentences = async () => {
            // Step 1: Load from cache first
            const cachedSentences = await getAllCachedSentences();
            if (cachedSentences.length > 0) {
                setSavedSentences(cachedSentences);
            }

            // Step 2: If online, fetch from server
            if (isOnline) {
                const { data, error } = await supabase
                    .from('saved_sentences')
                    .select('*')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (!error && data) {
                    // 老数据可能缺 keywords/grammar 列，读回统一兜底为空数组
                    const normalized = (data as SavedSentence[]).map(withSentenceDefaults);
                    setSavedSentences(normalized);
                    await setCachedSentences(normalized);
                }
            }
        };

        loadSentences();
    }, [userId, isOnline]);

    // Refresh from server
    const refreshFromServer = useCallback(async () => {
        if (!userId || !isOnline) return;

        const { data, error } = await supabase
            .from('saved_sentences')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            const normalized = (data as SavedSentence[]).map(withSentenceDefaults);
            setSavedSentences(normalized);
            await setCachedSentences(normalized);
        }
    }, [userId, isOnline]);

    // 返回 true 表示保存成功（在线插入成功 / 离线已入队），false 表示在线插入失败。
    // 调用方据此决定是否关闭表单、清空草稿——失败时保留草稿供用户重试，不丢用户输入。
    const saveSentence = useCallback(async (sentenceObj: SentenceInput, successMessage: string = '已收藏'): Promise<boolean> => {
        if (!userId) return false;
        setSavingId(sentenceObj.sentence);

        // Generate temp ID for offline use
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();
        let success = false;

        if (isOnline) {
            const { data, error } = await supabase.from('saved_sentences').insert({
                user_id: userId,
                sentence: sentenceObj.sentence,
                sentence_cn: sentenceObj.sentenceCn,
                language: sentenceObj.language,
                scene: sentenceObj.scene || null,
                source_type: sentenceObj.sourceType,
                source_words: sentenceObj.sourceWords || [],
                keywords: sentenceObj.keywords || [],
                grammar: sentenceObj.grammar || []
            }).select();

            if (!error && data) {
                const saved = withSentenceDefaults(data[0] as SavedSentence);
                setSavedSentences(prev => [saved, ...prev]);
                const allSentences = await getAllCachedSentences();
                await setCachedSentences([saved, ...allSentences]);
                showToast?.('success', successMessage);
                success = true;
            } else {
                showToast?.('error', '收藏失败');
            }
        } else {
            // Offline: save locally
            const offlineSentence: SavedSentence = {
                id: tempId,
                sentence: sentenceObj.sentence,
                sentence_cn: sentenceObj.sentenceCn,
                language: sentenceObj.language,
                scene: sentenceObj.scene || null,
                source_type: sentenceObj.sourceType,
                source_words: sentenceObj.sourceWords || [],
                keywords: sentenceObj.keywords || [],
                grammar: sentenceObj.grammar || [],
                created_at: now
            };
            setSavedSentences(prev => [offlineSentence, ...prev]);
            await addPendingSentence(offlineSentence);
            onPendingChange?.();
            showToast?.('info', '已离线收藏，稍后同步');
            success = true;
        }

        setSavingId(null);
        return success;
    }, [userId, isOnline, showToast, onPendingChange]);

    const unsaveSentence = useCallback(async (id: string): Promise<SavedSentence | null> => {
        // Find the sentence before deleting
        const sentenceToDelete = savedSentences.find(s => s.id === id);
        if (!sentenceToDelete) return null;

        // Optimistic update
        setSavedSentences(prev => prev.filter(s => s.id !== id));

        if (id.startsWith('temp_')) {
            // 该句子仍是离线新增、尚未同步（temp id），服务器上并无对应行。
            // 走离线取消路径：删除本地记录并撤销待同步的新增操作；不向服务器发 delete，
            // 否则 delete().eq('id', temp_id) 匹配 0 行被误判为成功，随后同步又插回真实行导致「删除的句子复活」。
            await markSentenceDeleted(id);
            onPendingChange?.();
        } else if (isOnline) {
            const { error } = await supabase.from('saved_sentences').delete().eq('id', id);
            if (error) {
                // Restore on error
                setSavedSentences(prev => [sentenceToDelete, ...prev]);
                showToast?.('error', '取消收藏失败');
                return null;
            }

            // Update cache
            const allSentences = await getAllCachedSentences();
            await setCachedSentences(allSentences.filter(s => s.id !== id));
        } else {
            // Offline: mark for deletion
            await markSentenceDeleted(id);
            onPendingChange?.();
        }

        // Clean up audio cache for the deleted sentence
        const cacheKey = generateCacheKey(sentenceToDelete.language, sentenceToDelete.sentence);
        deleteCachedAudio(cacheKey).catch(() => { }); // Fire and forget

        return sentenceToDelete;
    }, [savedSentences, isOnline, showToast, onPendingChange]);

    const restoreSentence = useCallback(async (sentence: SavedSentence) => {
        if (!userId) return;

        if (isOnline) {
            const { data, error } = await supabase.from('saved_sentences').insert({
                user_id: userId,
                sentence: sentence.sentence,
                sentence_cn: sentence.sentence_cn,
                language: sentence.language,
                scene: sentence.scene,
                source_type: sentence.source_type,
                source_words: sentence.source_words || [],
                keywords: sentence.keywords || [],
                grammar: sentence.grammar || []
            }).select();

            if (!error && data) {
                const restored = withSentenceDefaults(data[0] as SavedSentence);
                setSavedSentences(prev => [restored, ...prev]);
                const allSentences = await getAllCachedSentences();
                await setCachedSentences([restored, ...allSentences]);
                showToast?.('success', '已恢复');
            }
        } else {
            // Offline restore
            const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            const restoredSentence: SavedSentence = {
                ...sentence,
                id: tempId,
                created_at: new Date().toISOString()
            };
            setSavedSentences(prev => [restoredSentence, ...prev]);
            await addPendingSentence(restoredSentence);
            onPendingChange?.();
            showToast?.('info', '已离线恢复，稍后同步');
        }
    }, [userId, isOnline, showToast, onPendingChange]);

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
        getSavedSentenceId,
        refreshFromServer
    };
}

export default useSentences;
