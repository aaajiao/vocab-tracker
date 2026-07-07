// IndexedDB Words Cache Service
// Provides persistent storage for offline word access

import type { Word } from '../types';

const DB_NAME = 'vocab-tracker-words-cache';
const DB_VERSION = 1;
const WORDS_STORE = 'words';
const PENDING_STORE = 'pending_operations';

export interface CachedWord extends Word {
    syncStatus: 'synced' | 'pending_add' | 'pending_delete';
}

export interface PendingOperation {
    id: string;
    type: 'add_word' | 'delete_word' | 'update_word';
    data: Word | { id: string };
    createdAt: number;
    retryCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Initialize IndexedDB
function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open words cache DB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Words store
            if (!db.objectStoreNames.contains(WORDS_STORE)) {
                const wordsStore = db.createObjectStore(WORDS_STORE, { keyPath: 'id' });
                wordsStore.createIndex('syncStatus', 'syncStatus', { unique: false });
                wordsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // Pending operations store
            if (!db.objectStoreNames.contains(PENDING_STORE)) {
                const pendingStore = db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
                pendingStore.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
    });

    return dbPromise;
}

// Get all cached words
export async function getAllCachedWords(): Promise<Word[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(WORDS_STORE, 'readonly');
            const store = transaction.objectStore(WORDS_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                const words = (request.result as CachedWord[])
                    .filter(w => w.syncStatus !== 'pending_delete')
                    .map(({ syncStatus, ...word }) => word as Word)
                    .sort((a, b) => b.timestamp - a.timestamp);
                resolve(words);
            };

            request.onerror = () => {
                console.error('Failed to get cached words:', request.error);
                resolve([]);
            };
        });
    } catch {
        return [];
    }
}

// 仅返回本地离线新增、尚未同步（pending_add）的词汇。
// 用于在服务器数据覆盖内存前做合并，避免离线新增词从 UI 消失。
export async function getPendingAddWords(): Promise<Word[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(WORDS_STORE, 'readonly');
            const store = transaction.objectStore(WORDS_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                const words = (request.result as CachedWord[])
                    .filter(w => w.syncStatus === 'pending_add')
                    .map(({ syncStatus, ...word }) => word as Word)
                    .sort((a, b) => b.timestamp - a.timestamp);
                resolve(words);
            };

            request.onerror = () => {
                console.error('Failed to get pending add words:', request.error);
                resolve([]);
            };
        });
    } catch {
        return [];
    }
}

// 合并服务器词汇与本地 pending_add 词汇（纯函数，便于测试）。
// - 保留全部服务器结果
// - 追加 id 不在服务器结果中的 pending_add 词汇（离线新增、尚未同步）
// - 结果按 timestamp 倒序，与服务器 created_at 倒序一致
// 已同步的 pending_add 在服务器结果里会以真实 id 出现，因而不会重复追加。
export function mergePendingAdds(serverWords: Word[], pendingAdds: Word[]): Word[] {
    const serverIds = new Set(serverWords.map(w => w.id));
    const extras = pendingAdds.filter(w => !serverIds.has(w.id));
    return [...extras, ...serverWords].sort((a, b) => b.timestamp - a.timestamp);
}

// 从本地待迁移词汇中筛掉服务器已存在的项（纯函数，便于测试）。
// 去重键为大小写不敏感的 word + language，同时对本地列表内部重复去重，
// 避免插入重复行（words 表无 UNIQUE 约束）。
export function selectWordsToMigrate(localWords: Word[], serverWords: Word[]): Word[] {
    const existing = new Set(
        serverWords.map(w => `${(w.word || '').toLowerCase()}|${w.language}`)
    );
    const result: Word[] = [];
    for (const w of localWords) {
        const key = `${(w.word || '').toLowerCase()}|${w.language}`;
        if (existing.has(key)) continue;
        existing.add(key);
        result.push(w);
    }
    return result;
}

// Set all cached words (full sync from server)
export async function setCachedWords(words: Word[]): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WORDS_STORE, 'readwrite');
            const store = transaction.objectStore(WORDS_STORE);

            // Clear existing synced words but keep pending ones
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const existing = getAllRequest.result as CachedWord[];
                const pendingOps = existing.filter(w =>
                    w.syncStatus === 'pending_add' || w.syncStatus === 'pending_delete'
                );

                // Clear store
                store.clear();

                // Add server words
                for (const word of words) {
                    const cachedWord: CachedWord = { ...word, syncStatus: 'synced' };
                    store.put(cachedWord);
                }

                // Restore pending operations
                for (const pending of pendingOps) {
                    store.put(pending);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to set cached words:', error);
    }
}

// Add a word locally (for offline add)
export async function addPendingWord(word: Word): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WORDS_STORE, PENDING_STORE], 'readwrite');
            const wordsStore = transaction.objectStore(WORDS_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            // Add to words cache
            const cachedWord: CachedWord = { ...word, syncStatus: 'pending_add' };
            wordsStore.put(cachedWord);

            // Add to pending operations
            const pendingOp: PendingOperation = {
                id: `add_${word.id}`,
                type: 'add_word',
                data: word,
                createdAt: Date.now(),
                retryCount: 0
            };
            pendingStore.put(pendingOp);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to add pending word:', error);
        throw error;
    }
}

// Mark a word as deleted locally (for offline delete)
export async function markWordDeleted(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WORDS_STORE, PENDING_STORE], 'readwrite');
            const wordsStore = transaction.objectStore(WORDS_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            // Get the word first
            const getRequest = wordsStore.get(id);
            getRequest.onsuccess = () => {
                const word = getRequest.result as CachedWord;
                if (word) {
                    if (word.syncStatus === 'pending_add') {
                        // Word was added offline and not synced yet, just delete it
                        wordsStore.delete(id);
                        pendingStore.delete(`add_${id}`);
                    } else {
                        // Word exists on server, mark for deletion
                        word.syncStatus = 'pending_delete';
                        wordsStore.put(word);

                        const pendingOp: PendingOperation = {
                            id: `delete_${id}`,
                            type: 'delete_word',
                            data: { id },
                            createdAt: Date.now(),
                            retryCount: 0
                        };
                        pendingStore.put(pendingOp);
                    }
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to mark word as deleted:', error);
        throw error;
    }
}

// Update a word locally
export async function updateCachedWord(id: string, updates: Partial<Word>): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WORDS_STORE, 'readwrite');
            const store = transaction.objectStore(WORDS_STORE);

            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const word = getRequest.result as CachedWord;
                if (word) {
                    Object.assign(word, updates);
                    store.put(word);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to update cached word:', error);
    }
}

// Get all pending operations
export async function getPendingOperations(): Promise<PendingOperation[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(PENDING_STORE, 'readonly');
            const store = transaction.objectStore(PENDING_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                const ops = request.result as PendingOperation[];
                resolve(ops.sort((a, b) => a.createdAt - b.createdAt));
            };

            request.onerror = () => {
                console.error('Failed to get pending operations:', request.error);
                resolve([]);
            };
        });
    } catch {
        return [];
    }
}

// Remove a pending operation
export async function removePendingOperation(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(PENDING_STORE, 'readwrite');
            const store = transaction.objectStore(PENDING_STORE);
            store.delete(id);
            transaction.oncomplete = () => resolve();
        });
    } catch (error) {
        console.error('Failed to remove pending operation:', error);
    }
}

// 递增并持久化某个待同步操作的重试次数，返回递增后的次数。
// 同步失败时调用，配合重试上限跳过注定失败的操作。操作本身不删除（不丢数据）。
export async function incrementOperationRetry(id: string): Promise<number> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(PENDING_STORE, 'readwrite');
            const store = transaction.objectStore(PENDING_STORE);
            let newCount = 0;

            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const op = getRequest.result as PendingOperation | undefined;
                if (op) {
                    newCount = (op.retryCount || 0) + 1;
                    op.retryCount = newCount;
                    store.put(op);
                }
            };

            transaction.oncomplete = () => resolve(newCount);
            transaction.onerror = () => resolve(newCount);
        });
    } catch (error) {
        console.error('Failed to increment operation retry:', error);
        return 0;
    }
}

// Mark a cached word as synced
export async function markWordSynced(id: string, newId?: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WORDS_STORE, 'readwrite');
            const store = transaction.objectStore(WORDS_STORE);

            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const word = getRequest.result as CachedWord;
                if (word) {
                    if (newId && newId !== id) {
                        // Server assigned a new ID
                        store.delete(id);
                        word.id = newId;
                    }
                    word.syncStatus = 'synced';
                    store.put(word);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to mark word as synced:', error);
    }
}

// Remove a word from cache completely
export async function removeFromCache(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(WORDS_STORE, 'readwrite');
            const store = transaction.objectStore(WORDS_STORE);
            store.delete(id);
            transaction.oncomplete = () => resolve();
        });
    } catch (error) {
        console.error('Failed to remove from cache:', error);
    }
}

// Get cache statistics
export async function getWordsCacheStats(): Promise<{ count: number; pendingCount: number }> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction([WORDS_STORE, PENDING_STORE], 'readonly');
            const wordsStore = transaction.objectStore(WORDS_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            let count = 0;
            let pendingCount = 0;

            const wordsRequest = wordsStore.count();
            wordsRequest.onsuccess = () => {
                count = wordsRequest.result;
            };

            const pendingRequest = pendingStore.count();
            pendingRequest.onsuccess = () => {
                pendingCount = pendingRequest.result;
            };

            transaction.oncomplete = () => {
                resolve({ count, pendingCount });
            };
        });
    } catch {
        return { count: 0, pendingCount: 0 };
    }
}

// Clear all cached words
export async function clearWordsCache(): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WORDS_STORE, PENDING_STORE], 'readwrite');
            transaction.objectStore(WORDS_STORE).clear();
            transaction.objectStore(PENDING_STORE).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to clear words cache:', error);
        throw error;
    }
}
