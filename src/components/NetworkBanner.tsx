import { memo } from 'react';

interface NetworkBannerProps {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    onSyncNow: () => void;
}

export const NetworkBanner = memo(function NetworkBanner({
    isOnline,
    isSyncing,
    pendingCount,
    onSyncNow
}: NetworkBannerProps) {
    // Offline banner
    if (!isOnline) {
        return (
            <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                <span>📴</span>
                <span>离线模式</span>
                {pendingCount > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                        {pendingCount} 项待同步
                    </span>
                )}
            </div>
        );
    }

    // Syncing banner
    if (isSyncing) {
        return (
            <div className="fixed top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span>
                <span>正在同步...</span>
            </div>
        );
    }

    // Pending sync banner (online but has pending items)
    if (pendingCount > 0) {
        return (
            <div className="fixed top-0 left-0 right-0 bg-green-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
                <span>✓</span>
                <span>已恢复在线</span>
                <button
                    onClick={onSyncNow}
                    className="bg-white/20 hover:bg-white/30 px-3 py-0.5 rounded-full text-xs transition-colors"
                >
                    同步 {pendingCount} 项
                </button>
            </div>
        );
    }

    return null;
});

export default NetworkBanner;
