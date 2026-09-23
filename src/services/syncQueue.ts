import { syncMaterialOperations, getMaterialSyncStatus, retryFailedMaterialOperations } from './materialQueue';
import { syncReviewEvents, getPendingReviewEventCount } from './reviewEventQueue';
export interface SyncResult { success: boolean; synced: number; failed: number; deadLettered: number; errors: string[] }
const running = new Map<string, Promise<SyncResult>>();
export async function syncPendingOperations(userId: string, options: { retryFailed?: boolean } = {}): Promise<SyncResult> {
    if (!userId) return { success: false, synced: 0, failed: 0, deadLettered: 0, errors: ['No user ID'] };
    if (options.retryFailed) await retryFailedMaterialOperations(userId);
    const previous = running.get(userId); if (previous) return previous;
    const promise = (async () => {
        try {
            const materials = await syncMaterialOperations(userId);
            const reviews = await syncReviewEvents(userId);
            return { success: materials.failed + reviews.failed === 0, synced: materials.synced + reviews.synced,
                failed: materials.failed + reviews.failed, deadLettered: materials.deadLettered + reviews.deadLettered,
                errors: [...materials.errors, ...reviews.errors] };
        } catch { return { success: false, synced: 0, failed: 1, deadLettered: 0, errors: ['本机同步未完成，请重试或导出待同步数据。'] }; }
    })();
    running.set(userId, promise);
    try { return await promise; } finally { if (running.get(userId) === promise) running.delete(userId); }
}
// 明确失败仍计入可见总数；自动重试判断应另看 pending，而不是把失败数据藏起来。
export async function getPendingCount(userId?: string): Promise<number> {
    if (!userId) return 0;
    const [status, reviews] = await Promise.all([getMaterialSyncStatus(userId), getPendingReviewEventCount(userId)]);
    return status.pending + status.failed + reviews;
}
