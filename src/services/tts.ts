// TTS (Text-to-Speech) service with IndexedDB caching

import { getCachedAudio, setCachedAudio, generateCacheKey } from './audioCache';

// Memory cache for current session (Blob URLs) with LRU eviction
const MAX_SESSION_CACHE_SIZE = 50;
const sessionCache = new Map<string, string>();
const sessionCacheOrder: string[] = []; // Track insertion order for LRU

// Add to session cache with LRU eviction
function addToSessionCache(key: string, url: string): void {
    // If key already exists, remove it from order (will be re-added at end)
    const existingIndex = sessionCacheOrder.indexOf(key);
    if (existingIndex !== -1) {
        sessionCacheOrder.splice(existingIndex, 1);
        // Revoke old URL if different
        const oldUrl = sessionCache.get(key);
        if (oldUrl && oldUrl !== url) {
            URL.revokeObjectURL(oldUrl);
        }
    }

    // Evict oldest entries if at capacity
    while (sessionCacheOrder.length >= MAX_SESSION_CACHE_SIZE) {
        const oldestKey = sessionCacheOrder.shift();
        if (oldestKey) {
            const oldUrl = sessionCache.get(oldestKey);
            if (oldUrl) {
                URL.revokeObjectURL(oldUrl);
            }
            sessionCache.delete(oldestKey);
        }
    }

    // Add new entry
    sessionCache.set(key, url);
    sessionCacheOrder.push(key);
}

// Remove from session cache
function removeFromSessionCache(key: string): void {
    const url = sessionCache.get(key);
    if (url) {
        URL.revokeObjectURL(url);
        sessionCache.delete(key);
        const index = sessionCacheOrder.indexOf(key);
        if (index !== -1) {
            sessionCacheOrder.splice(index, 1);
        }
    }
}

// OpenAI Text-to-Speech with persistent IndexedDB caching
export async function speakWord(
    text: string,
    language: string,
    setSpeakingId: (id: string | null) => void,
    wordId: string,
    apiKey: string,
    onCacheUpdate?: (key: string) => void
): Promise<void> {
    setSpeakingId(wordId);

    // Cache key
    const cacheKey = generateCacheKey(language, text);

    // Fallback to browser speech synthesis
    const useBrowserTTS = () => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = language === 'en' ? 'en-US' : 'de-DE';
            u.rate = 0.85;
            window.speechSynthesis.speak(u);
        }
    };

    // Play audio from URL
    const playAudio = async (url: string): Promise<boolean> => {
        try {
            const audio = new Audio(url);
            await new Promise<void>((resolve, reject) => {
                audio.onended = () => resolve();
                audio.onerror = () => reject(new Error('Playback error'));
                audio.play().catch(reject);
            });
            return true;
        } catch {
            return false;
        }
    };

    // 1. Check session cache (fastest - already have blob URL)
    if (sessionCache.has(cacheKey)) {
        const played = await playAudio(sessionCache.get(cacheKey)!);
        if (played) {
            setSpeakingId(null);
            return;
        }
        removeFromSessionCache(cacheKey); // Clear bad cache
    }

    // 2. Check IndexedDB cache (persistent)
    try {
        const cachedBlob = await getCachedAudio(cacheKey);
        if (cachedBlob) {
            const url = URL.createObjectURL(cachedBlob);
            addToSessionCache(cacheKey, url); // Add to session cache with LRU
            const played = await playAudio(url);
            if (played) {
                if (onCacheUpdate) onCacheUpdate(cacheKey);
                setSpeakingId(null);
                return;
            }
        }
    } catch (e) {
        console.warn('IndexedDB cache check failed:', e);
    }

    // 3. If no API key, use browser TTS
    if (!apiKey) {
        useBrowserTTS();
        setSpeakingId(null);
        return;
    }

    // 4. Fetch from OpenAI API with retry logic
    let retries = 0;
    const maxRetries = 3;
    let response: Response | undefined;

    while (retries <= maxRetries) {
        try {
            // Add period to short inputs to prevent cutoff
            const apiInput = (text.length < 50 && !text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?'))
                ? `${text}.`
                : text;

            response = await fetch('/api/openai/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini-tts',
                    voice: 'nova',
                    input: apiInput,
                    speed: 0.9
                }),
                signal: AbortSignal.timeout(10000)
            });

            if (response.ok) break;

            const errorData = await response.json().catch(() => ({}));
            console.warn(`TTS attempt ${retries + 1} failed (${response.status}):`, errorData);

            const delay = 500 * Math.pow(2, retries);
            await new Promise(r => setTimeout(r, delay));
        } catch (e) {
            console.warn(`TTS network attempt ${retries + 1} failed:`, e);
            const delay = 500 * Math.pow(2, retries);
            await new Promise(r => setTimeout(r, delay));
        }

        retries++;
        if (retries > maxRetries) {
            useBrowserTTS();
            setSpeakingId(null);
            return;
        }
    }

    // 5. Process response and cache
    try {
        if (!response) {
            useBrowserTTS();
            setSpeakingId(null);
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Save to IndexedDB (persistent) and session cache with LRU
        await setCachedAudio(cacheKey, audioBlob).catch(e => {
            console.warn('Failed to save to IndexedDB:', e);
        });
        addToSessionCache(cacheKey, audioUrl);
        if (onCacheUpdate) onCacheUpdate(cacheKey);

        // Play
        const played = await playAudio(audioUrl);
        if (!played) {
            useBrowserTTS();
        }
    } catch (e) {
        console.error('Final TTS processing error:', e);
        useBrowserTTS();
    }
    setSpeakingId(null);
}

// Re-export cache functions for use elsewhere
export { getCacheStats, clearAudioCache, isAudioCached } from './audioCache';
