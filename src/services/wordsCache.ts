import type { Word } from '../types';
import { readMaterials, replaceMaterials, enqueueMaterial, getMaterialOperations, cancelUnsentMaterial, acknowledgeMaterial, updateMaterialCache, removeMaterialCache, type MaterialOperation } from './materialStore';

export interface CachedWord extends Word { syncStatus: 'synced' | 'pending_add' | 'pending_delete' }
export type PendingOperation = MaterialOperation;
export const getAllCachedWords = async (userId = ''): Promise<Word[]> => (await readMaterials<Word>(userId, 'word')).sort((a, b) => b.timestamp - a.timestamp);
export const setCachedWords = (words: Word[], userId = '', expectedRevision?: number) => replaceMaterials(userId, 'word', words, expectedRevision);
export const getPendingOperations = async (userId = '') => (await getMaterialOperations(userId)).filter(op => op.kind === 'word');
export const getPendingAddWords = async (userId = ''): Promise<Word[]> => (await getPendingOperations(userId)).filter(op => op.action === 'add').map(op => op.record as Word);
export function wordBody(word: Word): Record<string, unknown> {
    return { id: word.id, word: word.word, meaning: word.meaning, language: word.language, example: word.example,
        example_cn: word.exampleCn, category: word.category || '', date: word.date, etymology: word.etymology || '' };
}
export const addPendingWord = (word: Word, userId = '') => enqueueMaterial({ id: word.id, user_id: userId, kind: 'word', action: 'add', record_id: word.id, record: word, body: wordBody(word) });
export async function markWordDeleted(id: string, userId = ''): Promise<void> {
    const existing = await getPendingOperations(userId);
    if (existing.some(op => op.action === 'delete' && op.record_id === id)) return;
    if (await cancelUnsentMaterial(userId, 'word', id, 'add')) return;
    const record = (await getAllCachedWords(userId)).find(word => word.id === id);
    if (!record) throw new Error('没有找到要删除的词汇，请刷新后再试。');
    await enqueueMaterial({ id: crypto.randomUUID(), user_id: userId, kind: 'word', action: 'delete', record_id: id, record, body: {} });
}
export const updateCachedWord = (id: string, updates: Partial<Word>, userId = '') => updateMaterialCache(userId, 'word', id, updates);
export const removeFromCache = (id: string, userId = '') => removeMaterialCache(userId, 'word', id);
export async function markWordSynced(id: string, newId: string | undefined, userId = ''): Promise<void> {
    const op = (await getPendingOperations(userId)).find(item => item.action === 'add' && item.record_id === id);
    if (op) await acknowledgeMaterial(op, { ...op.record, id: newId || id });
}
export async function getWordsCacheStats(userId = ''): Promise<{ count: number; pendingCount: number }> {
    return { count: (await getAllCachedWords(userId)).length, pendingCount: (await getPendingOperations(userId)).length };
}
// 清缓存只清已同步快照，待写入不会随“缓存清理”静默丢失。
export const clearWordsCache = (userId = '') => replaceMaterials(userId, 'word', []);
export function mergePendingAdds(serverWords: Word[], pendingAdds: Word[]): Word[] {
    const ids = new Set(serverWords.map(word => word.id));
    return [...pendingAdds.filter(word => !ids.has(word.id)), ...serverWords].sort((a, b) => b.timestamp - a.timestamp);
}
export function selectWordsToMigrate(localWords: Word[], serverWords: Word[]): Word[] {
    const keys = new Set(serverWords.map(word => `${word.word.toLowerCase()}|${word.language}`));
    return localWords.filter(word => { const key = `${word.word.toLowerCase()}|${word.language}`; if (keys.has(key)) return false; keys.add(key); return true; });
}
