import type { Word, SavedSentence } from '../types';
import { learningRequest, LearningApiError, learningErrorMessage } from './learningApi';
import { getReviewEvents, removeReviewEventsForWord } from './reviewEventQueue';
import { remove as removeReviewState } from './reviewCache';
import { getMaterialOperations, materialOperation, materialConfirmed, claimMaterial, failMaterial, acknowledgeMaterial, readLegacyMaterialData, retryFailedMaterialOperations, discardMaterialOperation as discardStoredOperation, discardLegacyMaterialData as discardStoredLegacy, type MaterialOperation } from './materialStore';
export { getMaterialOperations, retryFailedMaterialOperations };
export type { MaterialOperation };
export function notifyMaterialsChanged(userId?: string) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vocab-material-change', { detail: { userId } })); }
export async function discardMaterialOperation(userId: string, id: string) { await discardStoredOperation(userId, id); notifyMaterialsChanged(userId); }
export async function discardLegacyMaterialData() { await discardStoredLegacy(); notifyMaterialsChanged(); }
export function wordFromApi(row: Record<string, unknown>): Word {
    if (typeof row.id !== 'string' || typeof row.word !== 'string') throw new Error('词汇响应无效');
    return { id: row.id, word: row.word, meaning: String(row.meaning || ''), language: row.language as Word['language'],
        example: String(row.example || ''), exampleCn: String(row.example_cn || ''), category: (row.category || '') as Word['category'],
        etymology: String(row.etymology || ''), date: String(row.date), timestamp: Date.parse(String(row.created_at)) };
}
export function sentenceFromApi(row: Record<string, unknown>): SavedSentence {
    if (typeof row.id !== 'string' || typeof row.sentence !== 'string') throw new Error('句子响应无效');
    return { ...row, source_words: row.source_words || [], keywords: row.keywords || [], grammar: row.grammar || [] } as unknown as SavedSentence;
}
export interface MaterialSyncResult { synced: number; failed: number; deadLettered: number; errors: string[]; pending: number }
async function confirm(op: MaterialOperation, value?: Word | SavedSentence) {
    if (op.kind === 'word' && op.action === 'delete') {
        await removeReviewState(op.record_id, op.user_id); await removeReviewEventsForWord(op.user_id, op.record_id);
    }
    await acknowledgeMaterial(op, value);
}
const running = new Map<string, Promise<MaterialSyncResult>>();
async function process(owner: string): Promise<MaterialSyncResult> {
    const result: MaterialSyncResult = { synced: 0, failed: 0, deadLettered: 0, errors: [], pending: 0 };
    for (let count = 0; count < 1000; count++) {
        const entries = await getMaterialOperations(owner);
        const blocked = new Set(entries.filter(op => op.status === 'failed').map(op => `${op.kind}:${op.record_id}`));
        const next = entries.find(op => op.status === 'pending' && !blocked.has(`${op.kind}:${op.record_id}`)
            && (!op.depends_on || !entries.some(prior => prior.id === op.depends_on)));
        if (!next) break;
        if (next.depends_on && !await materialConfirmed(owner, next.depends_on)) {
            const message = '前置请求未确认，已暂停这项操作；请导出或丢弃对应请求。';
            await failMaterial(next, message, true); result.failed++; result.deadLettered++; result.errors.push(message); continue;
        }
        const op = await claimMaterial(owner, next.id); if (!op) continue;
        try {
            const path = op.kind === 'word' ? '/words' : '/sentences';
            const response = await learningRequest<Record<string, unknown>>(op.action === 'add' ? path : `${path}/${op.record_id}`, {
                userId: owner, method: op.action === 'add' ? 'POST' : op.action === 'delete' ? 'DELETE' : 'PATCH',
                ...(op.action === 'delete' ? {} : { body: op.body }), signal: AbortSignal.timeout(15000),
            });
            await confirm(op, op.action === 'delete' ? undefined : op.kind === 'word' ? wordFromApi(response.data) : sentenceFromApi(response.data));
            result.synced++;
        } catch (error) {
            // 删除本就幂等；记录已被另一端删除时，同样可以确认本地删除。
            if (op.action === 'delete' && error instanceof LearningApiError && error.status === 404) {
                await confirm(op); result.synced++; continue;
            }
            const permanent = error instanceof LearningApiError && [400, 403, 404, 409, 413, 422].includes(error.status);
            const message = learningErrorMessage(error);
            await failMaterial(op, message, permanent); result.failed++; result.errors.push(message);
            if (permanent) { result.deadLettered++; continue; }
            // 临时网络/服务/登录故障只中断本轮，原 UUID 永久保留供恢复，不累计永久封禁。
            break;
        }
    }
    result.pending = (await getMaterialOperations(owner)).filter(op => op.status === 'pending').length;
    return result;
}
export async function syncMaterialOperations(owner: string): Promise<MaterialSyncResult> {
    if (!owner) return { synced: 0, failed: 0, deadLettered: 0, errors: ['请先登录'], pending: 0 };
    const existing = running.get(owner); if (existing) return existing;
    const run: Promise<MaterialSyncResult> = Promise.resolve(typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`vocab-material-sync:${owner}`, () => process(owner)) : process(owner));
    running.set(owner, run);
    try { return await run; } finally { if (running.get(owner) === run) running.delete(owner); notifyMaterialsChanged(owner); }
}
export async function retryMaterialOperation(owner: string, id: string): Promise<void> {
    const op = await materialOperation(owner, id); if (op?.status === 'failed') await failMaterial(op, '', false);
}
export async function getMaterialSyncStatus(userId: string): Promise<{ pending: number; failed: number; legacy: number }> {
    const [operations, legacy] = await Promise.all([getMaterialOperations(userId), readLegacyMaterialData()]);
    return { pending: operations.filter(op => op.status === 'pending').length, failed: operations.filter(op => op.status === 'failed').length,
        legacy: Math.max(legacy.words.length, legacy.word_operations.length) + Math.max(legacy.sentences.length, legacy.sentence_operations.length)
            + (Array.isArray(legacy.local_storage_words) ? legacy.local_storage_words.length : legacy.local_storage_words ? 1 : 0) };
}
export async function exportMaterialRecovery(userId: string): Promise<object> {
    if (!userId) throw new Error('请先登录');
    return { format: 'vocab-recovery-v1', exported_at: new Date().toISOString(), user_id: userId,
        operations: await getMaterialOperations(userId), review_events: await getReviewEvents(userId),
        unknown_owner_legacy: await readLegacyMaterialData() };
}
