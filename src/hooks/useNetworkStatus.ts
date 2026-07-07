import { useState, useEffect, useCallback, useRef } from 'react';
import { syncPendingOperations, getPendingCount } from '../services/syncQueue';

interface UseNetworkStatusProps {
    userId: string | undefined;
    // deadLettered：本次同步中重试次数刚跨过上限、此后不再自动重试的操作数，供上层给出区别于普通失败的提示。
    onSyncComplete?: (synced: number, failed: number, deadLettered: number) => void;
}

interface UseNetworkStatusReturn {
    isOnline: boolean;
    pendingCount: number;
    isSyncing: boolean;
    lastSyncResult: { synced: number; failed: number; deadLettered: number } | null;
    syncNow: () => Promise<void>;
    refreshPendingCount: () => Promise<void>;
}

export function useNetworkStatus({ userId, onSyncComplete }: UseNetworkStatusProps): UseNetworkStatusReturn {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number; deadLettered: number } | null>(null);

    // 用 ref 镜像最新的在线/同步状态，供 syncNow 读取。
    // 否则重连时 handleOnline 调用的是离线渲染期创建的 syncNow 闭包（isOnline 仍为 false），
    // 守卫直接 return，只能等 30s 定时器——用户联网后无法立即同步。
    const isOnlineRef = useRef(isOnline);
    const isSyncingRef = useRef(isSyncing);
    useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
    useEffect(() => { isSyncingRef.current = isSyncing; }, [isSyncing]);

    // Refresh pending count
    const refreshPendingCount = useCallback(async () => {
        const count = await getPendingCount();
        setPendingCount(count);
    }, []);

    // Sync pending operations
    // 读取 ref 而非 state，因此 syncNow 保持稳定（不依赖 isOnline/isSyncing），不会成为过期闭包。
    // 真正的并发互斥在 syncQueue.syncPendingOperations（模块级 in-flight Promise）；
    // 这里的 isSyncingRef 仅用于避免冗余触发，isSyncing state 仅用于 UI 展示。
    const syncNow = useCallback(async () => {
        if (!userId || isSyncingRef.current || !isOnlineRef.current) return;

        isSyncingRef.current = true;
        setIsSyncing(true);
        try {
            const result = await syncPendingOperations(userId);
            setLastSyncResult({ synced: result.synced, failed: result.failed, deadLettered: result.deadLettered });
            await refreshPendingCount();
            onSyncComplete?.(result.synced, result.failed, result.deadLettered);
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            isSyncingRef.current = false;
            setIsSyncing(false);
        }
    }, [userId, refreshPendingCount, onSyncComplete]);

    // Handle online/offline events
    useEffect(() => {
        const handleOnline = () => {
            // 立即更新 ref，使随后同步调用的守卫读到最新的在线状态（state 更新是异步的）
            isOnlineRef.current = true;
            setIsOnline(true);
            // Auto-sync when coming back online
            syncNow();
        };

        const handleOffline = () => {
            isOnlineRef.current = false;
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [syncNow]);

    // Initial pending count
    useEffect(() => {
        refreshPendingCount();
    }, [refreshPendingCount]);

    // Periodic sync when online (every 30 seconds if there are pending operations)
    useEffect(() => {
        if (!isOnline || !userId) return;

        const interval = setInterval(async () => {
            const count = await getPendingCount();
            if (count > 0) {
                syncNow();
            }
        }, 30000);

        return () => clearInterval(interval);
    }, [isOnline, userId, syncNow]);

    return {
        isOnline,
        pendingCount,
        isSyncing,
        lastSyncResult,
        syncNow,
        refreshPendingCount
    };
}

export default useNetworkStatus;
