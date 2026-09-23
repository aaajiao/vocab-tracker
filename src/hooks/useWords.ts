import { useState, useCallback, useMemo, useRef } from 'react';
import type { Word } from '../types';
import { deleteCachedAudio, generateCacheKey } from '../services/audioCache';
import { addPendingWord, markWordDeleted, wordBody } from '../services/wordsCache';
import { getMaterialOperations, readMaterials, cancelUnsentMaterial, enqueueMaterial, materialConfirmed } from '../services/materialStore';
import { retryMaterialOperation, syncMaterialOperations, wordFromApi } from '../services/materialQueue';
import { useMaterialCollection } from './useMaterialCollection';

interface UseWordsProps { userId: string | undefined; isOnline?: boolean; onLoadComplete?: () => void; showToast?: (type: 'success' | 'error' | 'info', message: string) => void; onPendingChange?: () => void }
type NewWord = Omit<Word, 'id' | 'timestamp'>;
export function useWords({ userId, isOnline = true, onLoadComplete, showToast, onPendingChange }: UseWordsProps) {
    const { values: words, valuesRef, pendingIds: pendingWordIds, loading, isCurrent, loadLocal, refreshFromServer } = useMaterialCollection<Word>({ userId, isOnline, kind: 'word', decode: wordFromApi, onLoadComplete, onError: message => showToast?.('error', message) });
    const [busy, setBusy] = useState<{ owner?: string; count: number }>({ owner: userId, count: 0 });
    const intents = useRef(new Map<string, string>());
    const pendingNotice = () => { if (isCurrent()) onPendingChange?.(); };
    const save = useCallback(async (input: NewWord, options: { silent?: boolean; restoreId?: string; dependency?: string } = {}): Promise<boolean> => {
        if (!userId || !isCurrent()) return false;
        const fingerprint = `${userId}:${options.restoreId ? `restore:${options.restoreId}` : JSON.stringify(input)}`;
        setBusy(old => ({ owner: userId, count: (old.owner === userId ? old.count : 0) + 1 }));
        try {
            const operations = (await getMaterialOperations(userId)).filter(op => op.kind === 'word');
            const same = (word: Word) => word.word.trim().toLowerCase() === input.word.trim().toLowerCase() && word.language === input.language;
            const deletion = operations.filter(op => op.action === 'delete' && same(op.record as Word)).slice(-1)[0];
            const queued = operations.find(op => op.action === 'add' && same(op.record as Word)
                && (!deletion || (op.sequence || 0) > (deletion.sequence || 0)) && (!options.restoreId || op.restore_of === options.restoreId));
            const id = queued?.id || (!deletion ? intents.current.get(fingerprint) : undefined) || crypto.randomUUID();
            intents.current.set(fingerprint, id);
            let word: Word = { ...input, id, timestamp: Date.now() };
            if (queued) {
                if (JSON.stringify(wordBody(word)) !== JSON.stringify(queued.body)) { if (isCurrent()) showToast?.('error', '此词已有不同的待同步版本，请先处理或丢弃该版本；当前草稿已保留。'); return false; }
                word = queued.record as Word;
            } else if (!options.restoreId) {
                const additions = new Set(operations.filter(op => op.action === 'add').map(op => op.record_id));
                if ((await readMaterials<Word>(userId, 'word')).some(existing => !additions.has(existing.id) && same(existing))) {
                    if (isCurrent() && !options.silent) showToast?.('info', '该词已在生词本中'); return isCurrent();
                }
            }
            if (!isCurrent()) return false;
            const dependency = options.dependency || deletion?.id;
            if (dependency || options.restoreId) {
                await enqueueMaterial({ id, user_id: userId, kind: 'word', action: 'add', record_id: id, record: word, body: wordBody(word), depends_on: dependency, restore_of: options.restoreId });
            } else await addPendingWord(word, userId);
            if (!isCurrent()) return false;
            await loadLocal(); onPendingChange?.();
            if (!isOnline) { if (!options.silent) showToast?.('info', '已保存到本机，联网后同步'); intents.current.delete(fingerprint); return true; }
            await retryMaterialOperation(userId, id);
            const result = await syncMaterialOperations(userId); if (!isCurrent()) return false;
            await loadLocal(); onPendingChange?.();
            if (!await materialConfirmed(userId, id)) { showToast?.('error', result.errors[0] || '尚未确认保存，已保留草稿和待同步请求，可重试。'); return false; }
            intents.current.delete(fingerprint); if (!options.silent) showToast?.('success', options.restoreId ? '已恢复' : '已保存'); return true;
        } catch { if (isCurrent()) showToast?.('error', '保存未完成，草稿已保留，请重试或检查本机存储。'); return false; }
        finally { if (isCurrent()) setBusy(old => ({ owner: userId, count: Math.max(0, old.count - 1) })); }
    }, [userId, isCurrent, isOnline, loadLocal, showToast, onPendingChange]);
    const addWord = useCallback((word: NewWord, options?: { silent?: boolean }) => save(word, options), [save]);
    const addWords = useCallback(async (items: NewWord[]): Promise<boolean> => {
        if (!userId || !isCurrent() || !items.length) return false;
        let complete = true;
        // 每项都先持久化；部分成功后重试仍通过规范词去重和稳定请求 ID 保留已确认结果。
        for (const item of items) { if (!isCurrent()) return false; if (!await save(item, { silent: true })) complete = false; }
        return complete;
    }, [userId, isCurrent, save]);
    const deleteWord = useCallback(async (id: string): Promise<Word | null> => {
        if (!userId || !isCurrent()) return null;
        const word = valuesRef.current.find(item => item.id === id); if (!word) return null;
        try {
            await markWordDeleted(id, userId); if (!isCurrent()) return null;
            for (const fingerprint of intents.current.keys()) if (fingerprint.startsWith(`${userId}:`)) intents.current.delete(fingerprint);
            await loadLocal(); pendingNotice();
            if (isOnline) { const result = await syncMaterialOperations(userId); if (!isCurrent()) return null; await loadLocal(); pendingNotice(); if (result.failed) showToast?.('info', '删除已在本机保存，云端确认前可撤销。'); }
            void deleteCachedAudio(generateCacheKey(word.language, word.word)).catch(() => {});
            return word;
        } catch { if (isCurrent()) showToast?.('error', '无法保存删除操作，词汇仍保留。'); return null; }
    }, [userId, isCurrent, loadLocal, isOnline, onPendingChange, showToast]);
    const restoreWord = useCallback(async (word: Word): Promise<boolean> => {
        if (!userId || !isCurrent()) return false;
        try {
            if (await cancelUnsentMaterial(userId, 'word', word.id, 'delete')) { await loadLocal(); pendingNotice(); return true; }
            const deletion = (await getMaterialOperations(userId)).find(op => op.kind === 'word' && op.record_id === word.id && op.action === 'delete');
            const { id: _, timestamp: __, ...input } = word;
            return save(input, { restoreId: word.id, dependency: deletion?.id });
        } catch { if (isCurrent()) showToast?.('error', '恢复未完成，请重试。'); return false; }
    }, [userId, isCurrent, loadLocal, onPendingChange, save, showToast]);
    const updateWordExample = useCallback(async (id: string, example: string, exampleCn: string): Promise<boolean> => {
        if (!userId || !isCurrent()) return false;
        const word = valuesRef.current.find(item => item.id === id); if (!word) return false;
        const fingerprint = `${userId}:example:${id}:${example}:${exampleCn}`;
        const requestId = intents.current.get(fingerprint) || crypto.randomUUID(); intents.current.set(fingerprint, requestId);
        try {
            const addition = (await getMaterialOperations(userId)).find(op => op.kind === 'word' && op.record_id === id && op.action === 'add');
            await enqueueMaterial({ id: requestId, user_id: userId, kind: 'word', action: 'update', record_id: id, record: { ...word, example, exampleCn }, body: { example, example_cn: exampleCn }, depends_on: addition?.id });
            if (!isCurrent()) return false;
            await loadLocal(); pendingNotice();
            if (isOnline) { await retryMaterialOperation(userId, requestId); await syncMaterialOperations(userId); if (!isCurrent()) return false; await loadLocal(); pendingNotice(); if (!await materialConfirmed(userId, requestId)) { showToast?.('error', '例句尚未同步，已保留更新供重试。'); return false; } }
            intents.current.delete(fingerprint); return true;
        } catch { if (isCurrent()) showToast?.('error', '更新例句失败，请重试。'); return false; }
    }, [userId, isCurrent, isOnline, loadLocal, onPendingChange, showToast]);
    const getFilteredWords = useCallback((activeTab: string, searchQuery: string, todayFilter: boolean) => words.filter(word =>
        (activeTab === 'all' || activeTab === 'saved' || word.language === activeTab)
        && (!searchQuery || word.word.toLowerCase().includes(searchQuery.toLowerCase()) || word.meaning.includes(searchQuery))
        && (!todayFilter || word.date === new Date().toLocaleDateString('sv-SE'))), [words]);
    const getGroupedByDate = useCallback((items: Word[]) => items.reduce<Record<string, Word[]>>((groups, word) => { (groups[word.date] ||= []).push(word); return groups; }, {}), []);
    const stats = useMemo(() => ({ total: words.length, en: words.filter(word => word.language === 'en').length, de: words.filter(word => word.language === 'de').length, today: words.filter(word => word.date === new Date().toLocaleDateString('sv-SE')).length }), [words]);
    return { words, pendingWordIds, loading, syncing: busy.owner === userId && busy.count > 0, addWord, addWords, deleteWord, updateWordExample, restoreWord, getFilteredWords, getGroupedByDate, stats, refreshFromServer };
}
export default useWords;
