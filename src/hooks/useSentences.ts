import { useState, useCallback, useRef } from 'react';
import type { SavedSentence, SentenceInput } from '../types';
import { deleteCachedAudio, generateCacheKey } from '../services/audioCache';
import { addPendingSentence, markSentenceDeleted, sentenceBody, withSentenceDefaults } from '../services/sentencesCache';
import { cancelUnsentMaterial, enqueueMaterial, getMaterialOperations, materialConfirmed, readMaterials } from '../services/materialStore';
import { retryMaterialOperation, syncMaterialOperations, sentenceFromApi } from '../services/materialQueue';
import { useMaterialCollection } from './useMaterialCollection';
interface Props { userId: string | undefined; isOnline?: boolean; showToast?: (type: 'success' | 'error' | 'info', message: string) => void; onPendingChange?: () => void }
export function useSentences({ userId, isOnline = true, showToast, onPendingChange }: Props) {
    const { values: savedSentences, valuesRef, isCurrent, loadLocal, refreshFromServer } = useMaterialCollection<SavedSentence>({ userId, isOnline, kind: 'sentence', decode: sentenceFromApi, onError: message => showToast?.('error', message) });
    const [saving, setSaving] = useState<{ owner?: string; id: string | null }>({ owner: userId, id: null });
    const intents = useRef(new Map<string, SavedSentence>());
    const save = useCallback(async (input: SentenceInput, message = '已收藏', restored?: SavedSentence): Promise<boolean> => {
        if (!userId || !isCurrent()) return false;
        const fingerprint = `${userId}:${restored ? `restore:${restored.id}` : JSON.stringify(input)}`;
        setSaving({ owner: userId, id: input.sentence });
        try {
            const operations = (await getMaterialOperations(userId)).filter(op => op.kind === 'sentence');
            const deletion = operations.filter(op => op.action === 'delete' && (restored ? op.record_id === restored.id
                : (op.record as SavedSentence).sentence === input.sentence && op.record.language === input.language)).slice(-1)[0];
            const queued = operations.find(op => op.action === 'add' && (op.record as SavedSentence).sentence === input.sentence && op.record.language === input.language
                && (!deletion || (op.sequence || 0) > (deletion.sequence || 0)) && (!restored || op.restore_of === restored.id));
            let sentence = queued?.record as SavedSentence | undefined || (!deletion ? intents.current.get(fingerprint) : undefined);
            if (!sentence) sentence = withSentenceDefaults({ id: crypto.randomUUID(), sentence: input.sentence, sentence_cn: input.sentenceCn,
                language: input.language, scene: input.scene, source_type: input.sourceType, source_words: input.sourceWords,
                keywords: input.keywords, grammar: input.grammar, created_at: restored?.created_at || new Date().toISOString() });
            intents.current.set(fingerprint, sentence);
            const requested = withSentenceDefaults({ ...sentence, sentence: input.sentence, sentence_cn: input.sentenceCn, language: input.language,
                scene: input.scene, source_type: input.sourceType, source_words: input.sourceWords, keywords: input.keywords, grammar: input.grammar });
            if (queued && JSON.stringify(sentenceBody(requested)) !== JSON.stringify(queued.body)) { if (isCurrent()) showToast?.('error', '这句话已有不同的待同步版本，请先处理或丢弃该版本；当前草稿已保留。'); return false; }
            if (!queued && !restored && (await readMaterials<SavedSentence>(userId, 'sentence')).some(existing => existing.sentence === input.sentence && existing.language === input.language)) {
                if (isCurrent()) showToast?.('info', '这句话已经收藏'); return isCurrent();
            }
            if (!isCurrent()) return false;
            if (deletion || restored) await enqueueMaterial({ id: sentence.id, user_id: userId, kind: 'sentence', action: 'add', record_id: sentence.id, record: sentence, body: sentenceBody(sentence), depends_on: deletion?.id, restore_of: restored?.id });
            else await addPendingSentence(sentence, userId);
            if (!isCurrent()) return false;
            await loadLocal(); onPendingChange?.();
            if (!isOnline) { showToast?.('info', '已保存到本机，联网后同步'); intents.current.delete(fingerprint); return true; }
            await retryMaterialOperation(userId, sentence.id);
            const result = await syncMaterialOperations(userId); if (!isCurrent()) return false;
            await loadLocal(); onPendingChange?.();
            if (!await materialConfirmed(userId, sentence.id)) { showToast?.('error', result.errors[0] || '尚未确认保存，草稿和原请求已保留，可重试。'); return false; }
            intents.current.delete(fingerprint); showToast?.('success', message); return true;
        } catch { if (isCurrent()) showToast?.('error', '保存未完成，草稿已保留，请重试或检查本机存储。'); return false; }
        finally { if (isCurrent()) setSaving({ owner: userId, id: null }); }
    }, [userId, isCurrent, isOnline, loadLocal, showToast, onPendingChange]);
    const saveSentence = useCallback((input: SentenceInput, message?: string) => save(input, message), [save]);
    const unsaveSentence = useCallback(async (id: string): Promise<SavedSentence | null> => {
        if (!userId || !isCurrent()) return null;
        const sentence = valuesRef.current.find(item => item.id === id); if (!sentence) return null;
        try {
            await markSentenceDeleted(id, userId); if (!isCurrent()) return null;
            for (const fingerprint of intents.current.keys()) if (fingerprint.startsWith(`${userId}:`)) intents.current.delete(fingerprint);
            await loadLocal(); onPendingChange?.();
            if (isOnline) { const result = await syncMaterialOperations(userId); if (!isCurrent()) return null; await loadLocal(); onPendingChange?.(); if (result.failed) showToast?.('info', '删除已在本机保存，云端确认前可撤销。'); }
            void deleteCachedAudio(generateCacheKey(sentence.language, sentence.sentence)).catch(() => {});
            return sentence;
        } catch { if (isCurrent()) showToast?.('error', '无法保存删除操作，句子仍保留。'); return null; }
    }, [userId, isCurrent, isOnline, loadLocal, onPendingChange, showToast]);
    const restoreSentence = useCallback(async (sentence: SavedSentence): Promise<boolean> => {
        if (!userId || !isCurrent()) return false;
        try {
            if (await cancelUnsentMaterial(userId, 'sentence', sentence.id, 'delete')) { await loadLocal(); onPendingChange?.(); return true; }
            return save({ sentence: sentence.sentence, sentenceCn: sentence.sentence_cn, language: sentence.language, scene: sentence.scene,
                sourceType: sentence.source_type, sourceWords: sentence.source_words, keywords: sentence.keywords, grammar: sentence.grammar }, '已恢复', sentence);
        } catch { if (isCurrent()) showToast?.('error', '恢复未完成，请重试。'); return false; }
    }, [userId, isCurrent, loadLocal, onPendingChange, save, showToast]);
    const isSentenceSaved = useCallback((sentence: string) => savedSentences.some(item => item.sentence === sentence), [savedSentences]);
    const getSavedSentenceId = useCallback((sentence: string) => savedSentences.find(item => item.sentence === sentence)?.id || null, [savedSentences]);
    return { savedSentences, savingId: saving.owner === userId ? saving.id : null, saveSentence, unsaveSentence, restoreSentence, isSentenceSaved, getSavedSentenceId, refreshFromServer };
}
export default useSentences;
