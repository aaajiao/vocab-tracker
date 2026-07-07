// IndexedDB Review-State Cache Service
// 复习状态的离线优先本地存储，严格照搬 wordsCache.ts 的命名、版本与错误处理习惯。
// 简化模型：单 store、keyPath = wordId、用 syncStatus 字段区分同步态（不另建 pending 表）。

import type { ReviewState } from './srs';

const DB_NAME = 'vocab-tracker-review-cache';
const DB_VERSION = 1;
const REVIEW_STORE = 'review_states';

export type ReviewSyncStatus = 'synced' | 'pending_upsert';

export interface CachedReviewState extends ReviewState {
    syncStatus: ReviewSyncStatus;
}

// Supabase review_states 表行（snake_case 列名）
export interface ReviewRow {
    word_id: string;
    user_id: string;
    due: string;
    interval_days: number;
    ease: number;
    reps: number;
    lapses: number;
    last_reviewed_at: string | null;
    updated_at: string;
}

// ReviewState → Supabase 行（写入用）。集中一处映射，供 hook 与 syncQueue 共用。
export function toReviewRow(state: ReviewState, userId: string): ReviewRow {
    return {
        word_id: state.wordId,
        user_id: userId,
        due: state.due,
        interval_days: state.intervalDays,
        ease: state.ease,
        reps: state.reps,
        lapses: state.lapses,
        last_reviewed_at: state.lastReviewedAt,
        updated_at: state.updatedAt,
    };
}

// Supabase 行 → ReviewState（读取用）。时间戳统一归一化为规范 ISO（Z 结尾），
// 避免 Postgres 的 +00:00 与本地 toISOString 的 Z 混用导致 LWW 字符串比较错乱。
export function fromReviewRow(row: ReviewRow): ReviewState {
    return {
        wordId: row.word_id,
        due: row.due,
        intervalDays: row.interval_days,
        ease: row.ease,
        reps: row.reps,
        lapses: row.lapses,
        lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null,
        updatedAt: new Date(row.updated_at).toISOString(),
    };
}

let dbPromise: Promise<IDBDatabase> | null = null;

// 初始化 IndexedDB
function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open review cache DB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(REVIEW_STORE)) {
                const store = db.createObjectStore(REVIEW_STORE, { keyPath: 'wordId' });
                store.createIndex('syncStatus', 'syncStatus', { unique: false });
                store.createIndex('due', 'due', { unique: false }); // 便于按到期查询
            }
        };
    });

    return dbPromise;
}

// 读取全部复习状态（读操作：出错只 log 并返回默认值，从不 reject）
export async function getAll(): Promise<CachedReviewState[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(REVIEW_STORE, 'readonly');
            const store = transaction.objectStore(REVIEW_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result as CachedReviewState[]);
            };

            request.onerror = () => {
                console.error('Failed to get cached review states:', request.error);
                resolve([]);
            };
        });
    } catch {
        return [];
    }
}

// 读取单条
export async function get(wordId: string): Promise<CachedReviewState | undefined> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(REVIEW_STORE, 'readonly');
            const store = transaction.objectStore(REVIEW_STORE);
            const request = store.get(wordId);

            request.onsuccess = () => {
                resolve(request.result as CachedReviewState | undefined);
            };

            request.onerror = () => {
                console.error('Failed to get cached review state:', request.error);
                resolve(undefined);
            };
        });
    } catch {
        return undefined;
    }
}

// 写入 / 覆盖一条复习状态（写操作：失败 reject，外层 catch 再 throw，避免静默丢数据）
export async function upsert(state: ReviewState, syncStatus: ReviewSyncStatus): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(REVIEW_STORE, 'readwrite');
            const store = transaction.objectStore(REVIEW_STORE);
            const cached: CachedReviewState = { ...state, syncStatus };
            store.put(cached);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to upsert review state:', error);
        throw error;
    }
}

// 标记为已同步（改动型：先 get 再改字段回 put）。写入服务端返回的 updatedAt。
// 更新型操作只 log 不 throw。
export async function markSynced(wordId: string, updatedAt: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(REVIEW_STORE, 'readwrite');
            const store = transaction.objectStore(REVIEW_STORE);

            const getRequest = store.get(wordId);
            getRequest.onsuccess = () => {
                const state = getRequest.result as CachedReviewState | undefined;
                if (state) {
                    state.syncStatus = 'synced';
                    state.updatedAt = updatedAt;
                    store.put(state);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to mark review state synced:', error);
    }
}

// 删除一条（删除型：只 log 不 throw）
export async function remove(wordId: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(REVIEW_STORE, 'readwrite');
            const store = transaction.objectStore(REVIEW_STORE);
            store.delete(wordId);
            transaction.oncomplete = () => resolve();
        });
    } catch (error) {
        console.error('Failed to remove review state:', error);
    }
}

// 返回全部待同步（pending_upsert）状态
export async function getPending(): Promise<CachedReviewState[]> {
    const all = await getAll();
    return all.filter(s => s.syncStatus === 'pending_upsert');
}

// 清空整个复习缓存（clear 型：外层 catch 再 throw）
export async function clear(): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(REVIEW_STORE, 'readwrite');
            transaction.objectStore(REVIEW_STORE).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to clear review cache:', error);
        throw error;
    }
}
