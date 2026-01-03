import { useState, useEffect, useCallback } from 'react';
import { syncPendingOperations, getPendingCount } from '../services/syncQueue';

interface UseNetworkStatusProps {
    userId: string | undefined;
    onSyncComplete?: (synced: number, failed: number) => void;
}

interface UseNetworkStatusReturn {
    isOnline: boolean;
    pendingCount: number;
    isSyncing: boolean;
    lastSyncResult: { synced: number; failed: number } | null;
    syncNow: () => Promise<void>;
    refreshPendingCount: () => Promise<void>;
}

export function useNetworkStatus({ userId, onSyncComplete }: UseNetworkStatusProps): UseNetworkStatusReturn {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);

    // Refresh pending count
    const refreshPendingCount = useCallback(async () => {
        const count = await getPendingCount();
        setPendingCount(count);
    }, []);

    // Sync pending operations
    const syncNow = useCallback(async () => {
        if (!userId || isSyncing || !isOnline) return;

        setIsSyncing(true);
        try {
            const result = await syncPendingOperations(userId);
            setLastSyncResult({ synced: result.synced, failed: result.failed });
            await refreshPendingCount();
            onSyncComplete?.(result.synced, result.failed);
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            setIsSyncing(false);
        }
    }, [userId, isSyncing, isOnline, refreshPendingCount, onSyncComplete]);

    // Handle online/offline events
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            // Auto-sync when coming back online
            syncNow();
        };

        const handleOffline = () => {
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
