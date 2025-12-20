// TTS (Text-to-Speech) service

// Audio Cache to save bandwidth and make repeated plays instant
export const audioCache = new Map();

// OpenAI Text-to-Speech
export async function speakWord(text, language, setSpeakingId, wordId, apiKey, onCacheUpdate) {
    setSpeakingId(wordId);

    // Cache key
    const cacheKey = `${language}:${text}`;

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

    // Check cache first
    if (audioCache.has(cacheKey)) {
        try {
            const audio = new Audio(audioCache.get(cacheKey));
            await audio.play();
            setSpeakingId(null);
            return;
        } catch (e) {
            console.error('Cache playback failed:', e);
            audioCache.delete(cacheKey); // Clear bad cache
        }
    }

    // If no API key, use browser TTS
    if (!apiKey) {
        useBrowserTTS();
        setSpeakingId(null);
        return;
    }

    // Try with retry logic (Exponential Backoff)
    let retries = 0;
    const maxRetries = 3;
    let response;

    while (retries <= maxRetries) {
        try {
            // Optimization: Add period to short words to prevent cutoff
            // Many users report OpenAI TTS cuts off the end of single words.
            // Adding a period prompts the model to finish the sentence naturally without reading "dot".
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
                signal: AbortSignal.timeout(10000) // 10s timeout
            });

            if (response.ok) break;

            // If we're here, response was not OK
            const errorData = await response.json().catch(() => ({}));
            console.warn(`TTS attempt ${retries + 1} failed (${response.status}):`, errorData);

            // Wait with exponential backoff: 500ms, 1000ms, 2000ms
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

    try {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Save to cache for next time
        audioCache.set(cacheKey, audioUrl);
        if (onCacheUpdate) onCacheUpdate(cacheKey);

        const audio = new Audio(audioUrl);
        await new Promise((resolve) => {
            audio.onended = resolve;
            audio.onerror = () => {
                useBrowserTTS();
                resolve();
            };
            audio.play().catch((err) => {
                console.error('Playback error:', err);
                useBrowserTTS();
                resolve();
            });
        });
    } catch (e) {
        console.error('Final TTS processing error:', e);
        useBrowserTTS();
    }
    setSpeakingId(null);
}
