// TTS (Text-to-Speech) service with IndexedDB caching

import { getCachedAudio, setCachedAudio, generateCacheKey } from './audioCache';

// Memory cache for current session (Blob URLs)
const sessionCache = new Map<string, string>();

// 当前正在播放的 Audio 引用，用于打断上一段播放（避免叠音）
let currentAudio: HTMLAudioElement | null = null;
// 打断当前播放的回调：由 playAudio 注册，stopCurrentPlayback 调用
let stopCurrentAudio: (() => void) | null = null;
// 播放令牌：每次新的 speakWord 递增，用于识别过期回调，避免旧播放清掉新指示
let playbackToken = 0;

// 停止当前正在播放的音频与浏览器语音合成
function stopCurrentPlayback(): void {
    if (stopCurrentAudio) {
        stopCurrentAudio();
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
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
    // 先打断上一段播放，避免叠音
    stopCurrentPlayback();
    // 认领本次播放令牌；后续所有清除指示的操作都要校验令牌是否仍然有效
    const token = ++playbackToken;
    const isCurrent = () => token === playbackToken;
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
    // 返回 'ended'（正常播放结束）、'failed'（播放出错）或 'interrupted'（被新的播放打断）
    const playAudio = (url: string): Promise<'ended' | 'failed' | 'interrupted'> => {
        return new Promise((resolve) => {
            const audio = new Audio(url);
            currentAudio = audio;
            let settled = false;

            const cleanup = () => {
                audio.onended = null;
                audio.onerror = null;
                // 仅当仍是当前音频时才清空模块级引用（避免误清新播放的引用）
                if (currentAudio === audio) {
                    currentAudio = null;
                    stopCurrentAudio = null;
                }
            };

            // 被新的 speakWord 打断时调用：暂停旧音频并以 'interrupted' 结束
            stopCurrentAudio = () => {
                if (settled) return;
                settled = true;
                audio.pause();
                audio.currentTime = 0;
                cleanup();
                resolve('interrupted');
            };

            audio.onended = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve('ended');
            };
            audio.onerror = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve('failed');
            };
            audio.play().catch(() => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve('failed');
            });
        });
    };

    // 1. Check session cache (fastest - already have blob URL)
    if (sessionCache.has(cacheKey)) {
        const result = await playAudio(sessionCache.get(cacheKey)!);
        if (result === 'interrupted') return; // 已被新的播放接管，不要触碰指示
        if (result === 'ended') {
            if (isCurrent()) setSpeakingId(null);
            return;
        }
        sessionCache.delete(cacheKey); // Clear bad cache
    }

    // 2. Check IndexedDB cache (persistent)
    try {
        const cachedBlob = await getCachedAudio(cacheKey);
        if (cachedBlob) {
            const url = URL.createObjectURL(cachedBlob);
            sessionCache.set(cacheKey, url); // Add to session cache
            // 已被更新的 speakWord 接管（IndexedDB 读取期间用户点了别的词）：只写缓存，不开声，避免叠音
            if (!isCurrent()) return;
            const result = await playAudio(url);
            if (result === 'interrupted') return;
            if (result === 'ended') {
                if (onCacheUpdate) onCacheUpdate(cacheKey);
                if (isCurrent()) setSpeakingId(null);
                return;
            }
        }
    } catch (e) {
        console.warn('IndexedDB cache check failed:', e);
    }

    // 3. If no API key, use browser TTS
    if (!apiKey) {
        if (!isCurrent()) return;
        useBrowserTTS();
        if (isCurrent()) setSpeakingId(null);
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
            if (isCurrent()) {
                useBrowserTTS();
                setSpeakingId(null);
            }
            return;
        }
    }

    // 5. Process response and cache
    try {
        if (!response) {
            if (isCurrent()) {
                useBrowserTTS();
                setSpeakingId(null);
            }
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Save to IndexedDB (persistent) and session cache
        await setCachedAudio(cacheKey, audioBlob).catch(e => {
            console.warn('Failed to save to IndexedDB:', e);
        });
        sessionCache.set(cacheKey, audioUrl);
        if (onCacheUpdate) onCacheUpdate(cacheKey);

        // Play
        // 已被更新的 speakWord 接管（fetch/重试期间用户点了别的词）：只写缓存，不开声，避免叠音
        if (!isCurrent()) return;
        const result = await playAudio(audioUrl);
        if (result === 'interrupted') return; // 已被新的播放接管
        if (result === 'failed' && isCurrent()) {
            useBrowserTTS();
        }
    } catch (e) {
        console.error('Final TTS processing error:', e);
        if (isCurrent()) useBrowserTTS();
    }
    if (isCurrent()) setSpeakingId(null);
}

// Re-export cache functions for use elsewhere
export { getCacheStats, clearAudioCache, isAudioCached } from './audioCache';
