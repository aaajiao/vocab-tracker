// 权威复习缓存按账号隔离；v1 的无归属数据保留在旧 store，不再自动同步。
import type { ReviewState } from './srs';

const DB_NAME = 'vocab-tracker-review-cache';
const DB_VERSION = 3;
const LEGACY_STORE = 'review_states';
const OWNED_STORE = 'owned_review_states';
const TIMEZONE_STORE = 'review_timezones';
export type ReviewSyncStatus = 'synced' | 'pending_upsert';
export interface CachedReviewState extends ReviewState { syncStatus: ReviewSyncStatus; userId?: string }
export interface ReviewRow {
    word_id: string; user_id?: string; due: string; interval_days: number; ease: number;
    reps: number; lapses: number; last_reviewed_at: string | null; updated_at: string;
}

export function toReviewRow(state: ReviewState, userId: string): ReviewRow {
    return { word_id: state.wordId, user_id: userId, due: state.due, interval_days: state.intervalDays, ease: state.ease, reps: state.reps, lapses: state.lapses, last_reviewed_at: state.lastReviewedAt, updated_at: state.updatedAt };
}
export function fromReviewRow(row: ReviewRow): ReviewState {
    return { wordId: row.word_id, due: row.due, intervalDays: row.interval_days, ease: row.ease, reps: row.reps, lapses: row.lapses, lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null, updatedAt: new Date(row.updated_at).toISOString() };
}

let dbPromise: Promise<IDBDatabase> | null = null;
function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => { dbPromise = null; reject(request.error); };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(LEGACY_STORE)) {
                const store = db.createObjectStore(LEGACY_STORE, { keyPath: 'wordId' });
                store.createIndex('syncStatus', 'syncStatus');
                store.createIndex('due', 'due');
            }
            if (!db.objectStoreNames.contains(TIMEZONE_STORE)) db.createObjectStore(TIMEZONE_STORE, { keyPath: 'userId' });
            if (!db.objectStoreNames.contains(OWNED_STORE)) {
                const store = db.createObjectStore(OWNED_STORE, { keyPath: ['userId', 'wordId'] });
                store.createIndex('userId', 'userId');
            }
        };
    });
    return dbPromise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('复习缓存写入失败'));
        transaction.onabort = () => reject(transaction.error || new Error('复习缓存写入已取消'));
    });
}

// 不传 userId 仅用于读取/导出旧版本备份；业务视图必须传账号。
export async function getAll(userId?: string): Promise<CachedReviewState[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const store = db.transaction(userId ? OWNED_STORE : LEGACY_STORE, 'readonly').objectStore(userId ? OWNED_STORE : LEGACY_STORE);
        const request = userId ? store.index('userId').getAll(userId) : store.getAll();
        request.onsuccess = () => resolve(request.result as CachedReviewState[]);
        request.onerror = () => reject(request.error);
    });
}

export async function get(wordId: string, userId?: string): Promise<CachedReviewState | undefined> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const store = db.transaction(userId ? OWNED_STORE : LEGACY_STORE, 'readonly').objectStore(userId ? OWNED_STORE : LEGACY_STORE);
        const request = store.get(userId ? [userId, wordId] : wordId);
        request.onsuccess = () => resolve(request.result as CachedReviewState | undefined);
        request.onerror = () => reject(request.error);
    });
}

export async function upsert(state: ReviewState, syncStatus: ReviewSyncStatus, userId?: string): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(userId ? OWNED_STORE : LEGACY_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(userId ? OWNED_STORE : LEGACY_STORE);
    const cached: CachedReviewState = { ...state, syncStatus, ...(userId ? { userId } : {}) };
    if (userId) {
        const request = store.get([userId, state.wordId]);
        request.onsuccess = () => {
            const previous = request.result as CachedReviewState | undefined;
            // 较慢的多标签页响应不得使权威缓存倒退。
            if (!previous || new Date(state.updatedAt).getTime() >= new Date(previous.updatedAt).getTime()) store.put(cached);
        };
    } else store.put(cached);
    await done;
}

export async function markSynced(wordId: string, updatedAt: string, userId?: string): Promise<void> {
    const state = await get(wordId, userId);
    if (state) await upsert({ ...state, updatedAt }, 'synced', userId);
}

export async function remove(wordId: string, userId?: string): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(userId ? OWNED_STORE : LEGACY_STORE, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(userId ? OWNED_STORE : LEGACY_STORE).delete(userId ? [userId, wordId] : wordId);
    await done;
}

export async function getReviewTimezone(userId: string): Promise<string | undefined> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction(TIMEZONE_STORE, 'readonly').objectStore(TIMEZONE_STORE).get(userId);
        request.onsuccess = () => resolve(request.result?.timezone);
        request.onerror = () => reject(request.error);
    });
}
export async function saveReviewTimezone(userId: string, timezone: string): Promise<void> {
    new Intl.DateTimeFormat('sv-SE', { timeZone: timezone });
    const db = await getDB();
    const transaction = db.transaction(TIMEZONE_STORE, 'readwrite');
    const completion = transactionDone(transaction);
    transaction.objectStore(TIMEZONE_STORE).put({ userId, timezone });
    await completion;
}

export async function getPending(userId?: string): Promise<CachedReviewState[]> {
    return (await getAll(userId)).filter((state) => state.syncStatus === 'pending_upsert');
}

/** 旧 pending 无法还原实际作答，不猜测评级、不自动上传；可供设置页导出。 */
export async function getLegacyReviewBackup(): Promise<{ version: 1; exported_at: string; states: CachedReviewState[] }> {
    return { version: 1, exported_at: new Date().toISOString(), states: await getAll() };
}
export async function discardLegacyReviewBackup(): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(LEGACY_STORE, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(LEGACY_STORE).clear();
    await done;
}

// 仅明确的清理操作/测试使用；日常登出不会删除其他账号的数据。
export async function clear(): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction([LEGACY_STORE, OWNED_STORE, TIMEZONE_STORE], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(LEGACY_STORE).clear();
    transaction.objectStore(OWNED_STORE).clear();
    transaction.objectStore(TIMEZONE_STORE).clear();
    await done;
}
