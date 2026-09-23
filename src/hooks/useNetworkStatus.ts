import { useState, useEffect, useCallback, useRef } from 'react';
import { syncPendingOperations } from '../services/syncQueue';
import { getMaterialSyncStatus } from '../services/materialQueue';
import { getPendingReviewEventCount } from '../services/reviewEventQueue';
interface Props { userId: string | undefined; onSyncComplete?: (synced: number, failed: number, deadLettered: number) => void }
export function useNetworkStatus({ userId, onSyncComplete }: Props) {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const online = useRef(isOnline); online.current = isOnline;
    const owner = useRef(userId); owner.current = userId;
    const mounted = useRef(true); const active = useRef(new Set<string>());
    const callback = useRef(onSyncComplete); callback.current = onSyncComplete;
    const [state, setState] = useState<{ owner?: string; pending: number; failed: number; legacy: number; syncing: boolean; result: { synced: number; failed: number; deadLettered: number } | null }>({ owner: userId, pending: 0, failed: 0, legacy: 0, syncing: false, result: null });
    const current = state.owner === userId ? state : { pending: 0, failed: 0, legacy: 0, syncing: false, result: null };
    const valid = useCallback(() => mounted.current && owner.current === userId, [userId]);
    const refreshPendingCount = useCallback(async () => {
        if (!userId) return;
        try {
            const [stats, reviews] = await Promise.all([getMaterialSyncStatus(userId), getPendingReviewEventCount(userId)]);
            if (valid()) setState(previous => ({ owner: userId, pending: stats.pending + stats.failed + reviews, failed: stats.failed, legacy: stats.legacy,
                syncing: previous.owner === userId && previous.syncing, result: previous.owner === userId ? previous.result : null }));
        } catch { /* 保留上次状态，不把无法读取的队列误报为零。 */ }
    }, [userId, valid]);
    const syncNow = useCallback(async (options: { retryFailed?: boolean } = {}) => {
        if (!userId || !valid() || !online.current || active.current.has(userId)) return;
        active.current.add(userId);
        setState(previous => ({ ...(previous.owner === userId ? previous : { pending: 0, failed: 0, legacy: 0, result: null }), owner: userId, syncing: true }));
        try {
            const result = await syncPendingOperations(userId, options); if (!valid()) return;
            setState(previous => ({ ...(previous.owner === userId ? previous : { pending: 0, failed: 0, legacy: 0, syncing: true }), owner: userId, result })); await refreshPendingCount();
            if (valid()) callback.current?.(result.synced, result.failed, result.deadLettered);
        } finally { active.current.delete(userId); if (valid()) setState(previous => ({ ...previous, owner: userId, syncing: false })); }
    }, [userId, valid, refreshPendingCount]);
    useEffect(() => {
        mounted.current = true; void refreshPendingCount();
        // 登录/重新打开应用时无需等待30秒才处理已持久化的队列。
        if (isOnline && userId) void syncNow();
        return () => { mounted.current = false; };
    }, [userId, refreshPendingCount, syncNow]);
    useEffect(() => {
        const onOnline = () => { online.current = true; setIsOnline(true); void syncNow(); };
        const onOffline = () => { online.current = false; setIsOnline(false); };
        const onChange = () => { void refreshPendingCount(); };
        window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); window.addEventListener('vocab-material-change', onChange);
        return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('vocab-material-change', onChange); };
    }, [syncNow, refreshPendingCount]);
    useEffect(() => {
        if (!isOnline || !userId) return;
        const timer = setInterval(async () => {
            try {
                const [stats, reviews] = await Promise.all([getMaterialSyncStatus(userId), getPendingReviewEventCount(userId)]);
                if (valid() && (stats.pending > 0 || reviews > 0)) void syncNow();
            } catch { /* 存储暂不可读时保持已有计数，下一轮重试。 */ }
        }, 30000);
        return () => clearInterval(timer);
    }, [userId, isOnline, valid, syncNow]);
    return { isOnline, pendingCount: current.pending, failedCount: current.failed, legacyCount: current.legacy, isSyncing: current.syncing,
        lastSyncResult: current.result, syncNow, refreshPendingCount };
}
export default useNetworkStatus;
