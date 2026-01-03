// IndexedDB Sentences Cache Service
// Provides persistent storage for offline sentence access

import type { SavedSentence, SentenceInput } from '../types';

const DB_NAME = 'vocab-tracker-sentences-cache';
const DB_VERSION = 1;
const SENTENCES_STORE = 'sentences';
const PENDING_STORE = 'pending_operations';

export interface CachedSentence extends SavedSentence {
    syncStatus: 'synced' | 'pending_add' | 'pending_delete';
}

export interface PendingSentenceOperation {
    id: string;
    type: 'add_sentence' | 'delete_sentence';
    data: any;
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
            console.error('Failed to open sentences cache DB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(SENTENCES_STORE)) {
                const store = db.createObjectStore(SENTENCES_STORE, { keyPath: 'id' });
                store.createIndex('syncStatus', 'syncStatus', { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
            }

            if (!db.objectStoreNames.contains(PENDING_STORE)) {
                const store = db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
    });

    return dbPromise;
}

// Get all cached sentences
export async function getAllCachedSentences(): Promise<SavedSentence[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(SENTENCES_STORE, 'readonly');
            const store = transaction.objectStore(SENTENCES_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                const sentences = (request.result as CachedSentence[])
                    .filter(s => s.syncStatus !== 'pending_delete')
                    .map(({ syncStatus, ...sentence }) => sentence as SavedSentence)
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                resolve(sentences);
            };

            request.onerror = () => {
                console.error('Failed to get cached sentences:', request.error);
                resolve([]);
            };
        });
    } catch {
        return [];
    }
}

// Set all cached sentences (full sync from server)
export async function setCachedSentences(sentences: SavedSentence[]): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SENTENCES_STORE, 'readwrite');
            const store = transaction.objectStore(SENTENCES_STORE);

            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const existing = getAllRequest.result as CachedSentence[];
                const pendingOps = existing.filter(s =>
                    s.syncStatus === 'pending_add' || s.syncStatus === 'pending_delete'
                );

                store.clear();

                for (const sentence of sentences) {
                    const cached: CachedSentence = { ...sentence, syncStatus: 'synced' };
                    store.put(cached);
                }

                for (const pending of pendingOps) {
                    store.put(pending);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to set cached sentences:', error);
    }
}

// Add a sentence locally (for offline add)
export async function addPendingSentence(sentence: SavedSentence): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([SENTENCES_STORE, PENDING_STORE], 'readwrite');
            const sentencesStore = transaction.objectStore(SENTENCES_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            const cached: CachedSentence = { ...sentence, syncStatus: 'pending_add' };
            sentencesStore.put(cached);

            const pendingOp: PendingSentenceOperation = {
                id: `add_${sentence.id}`,
                type: 'add_sentence',
                data: sentence,
                createdAt: Date.now(),
                retryCount: 0
            };
            pendingStore.put(pendingOp);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to add pending sentence:', error);
        throw error;
    }
}

// Mark a sentence as deleted locally
export async function markSentenceDeleted(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([SENTENCES_STORE, PENDING_STORE], 'readwrite');
            const sentencesStore = transaction.objectStore(SENTENCES_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            const getRequest = sentencesStore.get(id);
            getRequest.onsuccess = () => {
                const sentence = getRequest.result as CachedSentence;
                if (sentence) {
                    if (sentence.syncStatus === 'pending_add') {
                        sentencesStore.delete(id);
                        pendingStore.delete(`add_${id}`);
                    } else {
                        sentence.syncStatus = 'pending_delete';
                        sentencesStore.put(sentence);

                        const pendingOp: PendingSentenceOperation = {
                            id: `delete_${id}`,
                            type: 'delete_sentence',
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
        console.error('Failed to mark sentence as deleted:', error);
        throw error;
    }
}

// Get all pending operations
export async function getPendingSentenceOperations(): Promise<PendingSentenceOperation[]> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(PENDING_STORE, 'readonly');
            const store = transaction.objectStore(PENDING_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                const ops = request.result as PendingSentenceOperation[];
                resolve(ops.sort((a, b) => a.createdAt - b.createdAt));
            };

            request.onerror = () => resolve([]);
        });
    } catch {
        return [];
    }
}

// Remove a pending operation
export async function removePendingSentenceOperation(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(PENDING_STORE, 'readwrite');
            const store = transaction.objectStore(PENDING_STORE);
            store.delete(id);
            transaction.oncomplete = () => resolve();
        });
    } catch (error) {
        console.error('Failed to remove pending sentence operation:', error);
    }
}

// Mark a cached sentence as synced
export async function markSentenceSynced(id: string, newId?: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SENTENCES_STORE, 'readwrite');
            const store = transaction.objectStore(SENTENCES_STORE);

            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const sentence = getRequest.result as CachedSentence;
                if (sentence) {
                    if (newId && newId !== id) {
                        store.delete(id);
                        sentence.id = newId;
                    }
                    sentence.syncStatus = 'synced';
                    store.put(sentence);
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to mark sentence as synced:', error);
    }
}

// Remove a sentence from cache
export async function removeFromSentenceCache(id: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(SENTENCES_STORE, 'readwrite');
            const store = transaction.objectStore(SENTENCES_STORE);
            store.delete(id);
            transaction.oncomplete = () => resolve();
        });
    } catch (error) {
        console.error('Failed to remove from sentence cache:', error);
    }
}

// Get cache statistics
export async function getSentencesCacheStats(): Promise<{ count: number; pendingCount: number }> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction([SENTENCES_STORE, PENDING_STORE], 'readonly');
            const sentencesStore = transaction.objectStore(SENTENCES_STORE);
            const pendingStore = transaction.objectStore(PENDING_STORE);

            let count = 0;
            let pendingCount = 0;

            const sentencesRequest = sentencesStore.count();
            sentencesRequest.onsuccess = () => {
                count = sentencesRequest.result;
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

// Clear all cached sentences
export async function clearSentencesCache(): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([SENTENCES_STORE, PENDING_STORE], 'readwrite');
            transaction.objectStore(SENTENCES_STORE).clear();
            transaction.objectStore(PENDING_STORE).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.error('Failed to clear sentences cache:', error);
        throw error;
    }
}
