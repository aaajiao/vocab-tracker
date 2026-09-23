import type { ReviewGrade, ReviewState } from './srs';
import { applyGrade, initReviewState } from './srs';
import { fromReviewRow, upsert as saveReviewState, remove as removeReviewState, type CachedReviewState } from './reviewCache';
import { learningRequest, LearningApiError, learningErrorMessage, type ApiReviewState, type PracticeEvent } from './learningApi';

const DB_NAME = 'vocab-tracker-review-events';
const STORE = 'events';

export interface ReviewEventInput {
    id: string;
    word_id: string;
    grade: ReviewGrade;
    source: 'web';
    practiced_at: string;
    timezone: string;
}
export interface QueuedReviewEvent {
    sequence: number;
    user_id: string;
    event: ReviewEventInput;
    status: 'pending' | 'acknowledged' | 'failed';
    accepted_state?: ApiReviewState | null;
    error?: string;
}
export interface ReviewSyncResult {
    synced: number;
    failed: number;
    deadLettered: number;
    errors: string[];
    pending: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => { dbPromise = null; reject(request.error); };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE, { keyPath: 'sequence', autoIncrement: true });
            store.createIndex('id', 'event.id', { unique: true });
            store.createIndex('user_id', 'user_id');
        };
    });
    return dbPromise;
}
function done(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('离线作答保存失败'));
        transaction.onabort = () => reject(transaction.error || new Error('离线作答保存已取消'));
    });
}

/** 成功仅在 IndexedDB 事务提交后返回；调用方此后才可推进卡片。 */
export async function enqueueReviewEvent(userId: string, event: ReviewEventInput): Promise<void> {
    if (!userId || !event.id || event.word_id.startsWith('temp_')) throw new Error('这张词卡尚未同步，请联网后再复习。');
    const db = await getDB();
    const transaction = db.transaction(STORE, 'readwrite');
    const completion = done(transaction);
    const store = transaction.objectStore(STORE);
    const request = store.index('id').get(event.id);
    request.onsuccess = () => {
        const existing = request.result as QueuedReviewEvent | undefined;
        if (existing) {
            if (existing.user_id !== userId || JSON.stringify(existing.event) !== JSON.stringify(event)) transaction.abort();
        } else {
            try { store.add({ user_id: userId, event, status: 'pending' }); } catch { transaction.abort(); }
        }
    };
    await completion;
}

export async function getReviewEvents(userId: string): Promise<QueuedReviewEvent[]> {
    if (!userId) return [];
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('user_id').getAll(userId);
        request.onsuccess = () => resolve((request.result as QueuedReviewEvent[]).sort((a, b) => a.sequence - b.sequence));
        request.onerror = () => reject(request.error);
    });
}
export async function getPendingReviewEventCount(userId: string): Promise<number> {
    return (await getReviewEvents(userId)).filter((entry) => entry.status !== 'failed').length;
}
async function updateEntry(entry: QueuedReviewEvent): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(STORE, 'readwrite');
    const completion = done(transaction);
    const store = transaction.objectStore(STORE);
    const request = store.get(entry.sequence);
    request.onsuccess = () => {
        const current = request.result as QueuedReviewEvent | undefined;
        // 别的标签页已处理/删除时不把事件重新插回队列。
        if (current?.user_id === entry.user_id && current.event.id === entry.event.id) store.put(entry);
    };
    await completion;
}
async function removeEntry(entry: QueuedReviewEvent): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(STORE, 'readwrite');
    const completion = done(transaction);
    transaction.objectStore(STORE).delete(entry.sequence);
    await completion;
}
export async function removeReviewEventsForWord(userId: string, wordId: string): Promise<void> {
    for (const entry of await getReviewEvents(userId)) if (entry.event.word_id === wordId) await removeEntry(entry);
}
export async function clearReviewEventQueue(): Promise<void> {
    const db = await getDB();
    const transaction = db.transaction(STORE, 'readwrite');
    const completion = done(transaction);
    transaction.objectStore(STORE).clear();
    await completion;
}

/** 只用于 UI 预测；永不将预测状态作为权威基线写入缓存。 */
export function projectReviewStates(canonical: ReviewState[], entries: QueuedReviewEvent[]): CachedReviewState[] {
    const states = new Map(canonical.map((state) => [state.wordId, { ...state, syncStatus: 'synced' as CachedReviewState['syncStatus'] }]));
    for (const entry of entries) {
        if (entry.status !== 'acknowledged') continue;
        if (entry.accepted_state === null) { states.delete(entry.event.word_id); continue; }
        if (!entry.accepted_state) continue;
        const accepted = fromReviewRow(entry.accepted_state);
        const previous = states.get(accepted.wordId);
        if (!previous || Date.parse(accepted.updatedAt) >= Date.parse(previous.updatedAt)) states.set(accepted.wordId, { ...accepted, syncStatus: 'synced' });
    }
    for (const entry of entries) {
        if (entry.status !== 'pending') continue;
        const event = entry.event;
        const today = new Date(event.practiced_at).toLocaleDateString('sv-SE', { timeZone: event.timezone });
        const base = states.get(event.word_id) || initReviewState(event.word_id, today, event.practiced_at);
        if (base.lastReviewedAt && Date.parse(event.practiced_at) < Date.parse(base.lastReviewedAt)) continue;
        states.set(event.word_id, { ...applyGrade(base, event.grade, today, event.practiced_at), syncStatus: 'pending_upsert' });
    }
    return Array.from(states.values());
}

const inFlight = new Map<string, Promise<ReviewSyncResult>>();
async function runSync(userId: string): Promise<ReviewSyncResult> {
    const result: ReviewSyncResult = { synced: 0, failed: 0, deadLettered: 0, errors: [], pending: 0 };
    for (let processed = 0; processed < 1000; processed++) {
        const entry = (await getReviewEvents(userId)).find((candidate) => candidate.status !== 'failed');
        if (!entry) break;
        try {
            let acknowledged = entry;
            if (entry.status === 'pending') {
                const response = await learningRequest<{ event: PracticeEvent; state: ApiReviewState | null; replayed: boolean }>('/events', { method: 'POST', userId, body: entry.event });
                acknowledged = { ...entry, status: 'acknowledged', accepted_state: response.data.state };
                // 先落盘回执，再更新基线。任何中途失败均不会让已接受事件再次参与预测。
                await updateEntry(acknowledged);
            }
            if (acknowledged.accepted_state) await saveReviewState(fromReviewRow(acknowledged.accepted_state), 'synced', userId);
            else await removeReviewState(entry.event.word_id, userId);
            await removeEntry(entry);
            result.synced++;
        } catch (error) {
            if (error instanceof LearningApiError && error.status === 404) {
                await removeReviewState(entry.event.word_id, userId);
                await removeEntry(entry);
                continue;
            }
            result.failed++;
            if (error instanceof LearningApiError && [400, 403, 409, 422].includes(error.status)) {
                const message = error.status === 409 ? '有一条作答与云端记录冲突，已保留本地备份并停止重试。' : '有一条作答无法提交，已保留本地备份并停止重试。';
                await updateEntry({ ...entry, status: 'failed', error: message });
                result.errors.push(message);
                result.deadLettered++;
                continue;
            }
            result.errors.push(learningErrorMessage(error));
            // 未确定结果、限流或登录失效时停止 FIFO，保留后续作答等待下次同步。
            break;
        }
    }
    result.pending = await getPendingReviewEventCount(userId);
    return result;
}

export async function syncReviewEvents(userId: string): Promise<ReviewSyncResult> {
    const existing = inFlight.get(userId);
    if (existing) return existing;
    const promise = runSync(userId);
    inFlight.set(userId, promise);
    try { return await promise; } finally { if (inFlight.get(userId) === promise) inFlight.delete(userId); }
}
