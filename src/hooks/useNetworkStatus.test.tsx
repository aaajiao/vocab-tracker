import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { useNetworkStatus } from './useNetworkStatus';
const { stats, sync, reviews } = vi.hoisted(() => ({ stats: vi.fn(), sync: vi.fn(), reviews: vi.fn() }));
vi.mock('../services/materialQueue', () => ({ getMaterialSyncStatus: stats }));
vi.mock('../services/syncQueue', () => ({ syncPendingOperations: sync }));
vi.mock('../services/reviewEventQueue', () => ({ getPendingReviewEventCount: reviews }));
let root: Root, container: HTMLDivElement, current: ReturnType<typeof useNetworkStatus>;
const callbacks = vi.fn();
const success = { success: true, synced: 0, failed: 0, deadLettered: 0, errors: [] };
function Probe({ owner }: { owner: string }) { current = useNetworkStatus({ userId: owner, onSyncComplete: callbacks }); return <span>{current.pendingCount}</span>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
    stats.mockReset(); sync.mockReset(); reviews.mockReset(); callbacks.mockReset();
    stats.mockResolvedValue({ pending: 0, failed: 0, legacy: 0 }); reviews.mockResolvedValue(0); sync.mockResolvedValue(success);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); });

describe('同步状态账号边界', () => {
    it('B初始同步未结束时不会继承A的待同步、失败或旧结果', async () => {
        const waiting = deferred<typeof success>(), bStats = deferred<{ pending: number; failed: number; legacy: number }>();
        stats.mockImplementation(async owner => owner === 'a' ? { pending: 3, failed: 2, legacy: 0 } : bStats.promise);
        sync.mockImplementation(async owner => owner === 'a' ? success : waiting.promise);
        await act(async () => root.render(<Probe owner="a" />)); expect(current.pendingCount).toBe(5); expect(current.failedCount).toBe(2);
        await act(async () => root.render(<Probe owner="b" />)); expect(current.pendingCount).toBe(0); expect(current.failedCount).toBe(0); expect(current.lastSyncResult).toBeNull();
        await act(async () => { bStats.resolve({ pending: 0, failed: 0, legacy: 0 }); waiting.resolve(success); });
        expect(current.pendingCount).toBe(0);
    });
    it('迟到的A同步结果不会触发B的成功提示，手动重试选项原样传递', async () => {
        const waiting = deferred<typeof success>(); sync.mockImplementation(async owner => owner === 'a' ? waiting.promise : success);
        await act(async () => root.render(<Probe owner="a" />)); await act(async () => root.render(<Probe owner="b" />));
        const before = callbacks.mock.calls.length; await act(async () => waiting.resolve({ ...success, synced: 9 }));
        expect(callbacks.mock.calls.length).toBe(before); expect(current.lastSyncResult?.synced).toBe(0);
        await act(async () => current.syncNow({ retryFailed: true }));
        expect(sync).toHaveBeenLastCalledWith('b', { retryFailed: true });
    });
});
