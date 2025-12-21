// IndexedDB Audio Cache Service
// Provides persistent storage for TTS audio blobs

const DB_NAME = 'vocab-tracker-audio-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audio';

interface CachedAudio {
    key: string;           // "en_hello" or "de_Hallo"
    audioBlob: Blob;       // Audio binary data
    size: number;          // Blob size in bytes
    createdAt: number;     // Creation timestamp
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Initialize IndexedDB
function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
    });

    return dbPromise;
}

// Get cached audio by key
export async function getCachedAudio(key: string): Promise<Blob | null> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result as CachedAudio | undefined;
                resolve(result?.audioBlob || null);
            };

            request.onerror = () => {
                console.error('Failed to get cached audio:', request.error);
                resolve(null);
            };
        });
    } catch {
        return null;
    }
}

// Save audio to cache
export async function setCachedAudio(key: string, audioBlob: Blob): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const cacheEntry: CachedAudio = {
                key,
                audioBlob,
                size: audioBlob.size,
                createdAt: Date.now()
            };

            const request = store.put(cacheEntry);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.error('Failed to cache audio:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Failed to set cached audio:', error);
    }
}

// Get cache statistics
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result as CachedAudio[];
                const count = entries.length;
                const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
                resolve({ count, totalSize });
            };

            request.onerror = () => {
                resolve({ count: 0, totalSize: 0 });
            };
        });
    } catch {
        return { count: 0, totalSize: 0 };
    }
}

// Clear all cached audio
export async function clearAudioCache(): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to clear audio cache:', error);
        throw error;
    }
}

// Delete a single cached audio by key
export async function deleteCachedAudio(key: string): Promise<void> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.warn('Failed to delete cached audio:', request.error);
                resolve(); // Don't throw, just log
            };
        });
    } catch (error) {
        console.warn('Failed to delete cached audio:', error);
    }
}

// Check if audio is cached (without loading the blob)
export async function isAudioCached(key: string): Promise<boolean> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count(IDBKeyRange.only(key));

            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

// Generate cache key from language and text
export function generateCacheKey(language: string, text: string): string {
    return `${language}_${text.toLowerCase().trim()}`;
}
