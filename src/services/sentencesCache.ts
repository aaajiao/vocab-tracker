import type { SavedSentence } from '../types';
import { readMaterials, replaceMaterials, enqueueMaterial, getMaterialOperations, cancelUnsentMaterial, acknowledgeMaterial, removeMaterialCache, type MaterialOperation } from './materialStore';
export interface CachedSentence extends SavedSentence { syncStatus: 'synced' | 'pending_add' | 'pending_delete' }
export type PendingSentenceOperation = MaterialOperation;
export function withSentenceDefaults(row: SavedSentence): SavedSentence {
    return { ...row, source_words: row.source_words ?? [], keywords: row.keywords ?? [], grammar: row.grammar ?? [] };
}
export const getAllCachedSentences = async (userId = ''): Promise<SavedSentence[]> => (await readMaterials<SavedSentence>(userId, 'sentence')).map(withSentenceDefaults).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
export const setCachedSentences = (sentences: SavedSentence[], userId = '', expectedRevision?: number) => replaceMaterials(userId, 'sentence', sentences.map(withSentenceDefaults), expectedRevision);
export const getPendingSentenceOperations = async (userId = '') => (await getMaterialOperations(userId)).filter(op => op.kind === 'sentence');
export function sentenceBody(sentence: SavedSentence): Record<string, unknown> {
    return { id: sentence.id, sentence: sentence.sentence, sentence_cn: sentence.sentence_cn, language: sentence.language,
        scene: sentence.scene || '', source_type: sentence.source_type, source_words: sentence.source_words || [],
        keywords: sentence.keywords || [], grammar: sentence.grammar || [], created_at: sentence.created_at };
}
export const addPendingSentence = (sentence: SavedSentence, userId = '') => enqueueMaterial({ id: sentence.id, user_id: userId, kind: 'sentence', action: 'add', record_id: sentence.id, record: withSentenceDefaults(sentence), body: sentenceBody(sentence) });
export async function markSentenceDeleted(id: string, userId = ''): Promise<void> {
    if ((await getPendingSentenceOperations(userId)).some(op => op.action === 'delete' && op.record_id === id)) return;
    if (await cancelUnsentMaterial(userId, 'sentence', id, 'add')) return;
    const record = (await getAllCachedSentences(userId)).find(sentence => sentence.id === id);
    if (!record) throw new Error('没有找到要删除的句子，请刷新后再试。');
    await enqueueMaterial({ id: crypto.randomUUID(), user_id: userId, kind: 'sentence', action: 'delete', record_id: id, record, body: {} });
}
export const removeFromSentenceCache = (id: string, userId = '') => removeMaterialCache(userId, 'sentence', id);
export async function markSentenceSynced(id: string, newId: string | undefined, userId = ''): Promise<void> {
    const op = (await getPendingSentenceOperations(userId)).find(item => item.action === 'add' && item.record_id === id);
    if (op) await acknowledgeMaterial(op, { ...op.record, id: newId || id });
}
export async function getSentencesCacheStats(userId = ''): Promise<{ count: number; pendingCount: number }> {
    return { count: (await getAllCachedSentences(userId)).length, pendingCount: (await getPendingSentenceOperations(userId)).length };
}
export const clearSentencesCache = (userId = '') => replaceMaterials(userId, 'sentence', []);
