import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

// Icons
const Icons = {
    Book: () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>,
    Plus: () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>,
    Trash: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>,
    Search: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>,
    Calendar: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>,
    Download: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>,
    Speaker: ({ playing }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />{playing ? <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></> : <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}</svg>,
    Sparkles: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></svg>,
    Refresh: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>,
    Settings: () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>,
    LogOut: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>,
    Cloud: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg>
};

// OpenAI - Get translation and contextual example
async function getAIContent(text, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
                    {
                        role: "user",
                        content: `For this ${langName} word/phrase: "${text}"

Please provide:
1. Chinese translation (concise, include article for German nouns)
2. One example sentence in ${langName} with Chinese translation

IMPORTANT: Match the example to the word's nature:
- If it's an everyday/casual word (like "cool", "hang out", "Gemütlich"), use a casual, daily-life context
- If it's a technical/professional term (like "algorithm", "Rechtsprechung", "derivative"), use an appropriate professional/academic context
- If it's formal vocabulary, use formal context

Respond in this exact JSON format only, no other text:
{"translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal"}`
                    }
                ]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('API Error', data.error);
            return null;
        }

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('OpenAI API error:', e);
        return null;
    }
}

// OpenAI - Detect language and get content
async function detectAndGetContent(text, apiKey) {
    try {
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
                    {
                        role: "user",
                        content: `Analyze this word/phrase: "${text}"

1. Detect whether it is primarily English or German.
2. Provide Chinese translation (concise).
3. Provide one example sentence in the detected language with Chinese translation.

IMPORTANT: Match the example to the word's nature (daily/professional/formal).

Respond in this exact JSON format only:
{"language": "en|de", "translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal"}`
                    }
                ]
            })
        });

        const data = await response.json();
        if (data.error) return null;

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Detection error:', e);
        return null;
    }
}

// Regenerate example
async function regenerateExample(word, meaning, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 200,
                messages: [
                    { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
                    {
                        role: "user",
                        content: `Generate a NEW, different example sentence for this ${langName} word: "${word}" (meaning: ${meaning})

Match the context to the word's nature:
- Everyday words → casual, daily-life scenarios
- Technical terms → professional/academic context
- Formal words → formal context

Respond in this exact JSON format only:
{"example": "New example sentence in ${langName}", "exampleCn": "例句中文翻译"}`
                    }
                ]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Regenerate error:', e);
        return null;
    }
}

// Audio Cache to save bandwidth and make repeated plays instant
const audioCache = new Map();

// TTS - OpenAI Text-to-Speech
async function speakWord(text, language, setSpeakingId, wordId, apiKey) {
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
            // Optimization: Add ellipsis to short words to prevent cutoff
            // Many users report OpenAI TTS cuts off the end of single words.
            const apiInput = (text.length < 50 && !text.endsWith('.') && !text.endsWith('!'))
                ? `${text}...`
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

// Auth Component
function AuthForm({ onAuth }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setError('注册成功！请查看邮箱确认链接。');
            }
        } catch (err) {
            setError(err.message);
        }
        setLoading(false);
    };

    return (
        <div className="max-w-md mx-auto p-4 py-20">
            <div className="flex items-center justify-center gap-3 mb-8">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-amber-500/30">
                    <Icons.Book />
                </div>
                <div>
                    <div className="text-xl font-bold text-slate-800 dark:text-slate-100">词汇本</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Icons.Cloud /> 云端同步版
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm mb-6 max-w-sm mx-auto">
                <h3 className="text-base font-semibold mb-4 text-center text-slate-800 dark:text-slate-100">
                    {isLogin ? '登录' : '注册'}
                </h3>

                <form onSubmit={handleSubmit}>
                    <input
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100"
                        type="email"
                        placeholder="邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100"
                        type="password"
                        placeholder="密码"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                    />

                    {error && (
                        <div style={{ fontSize: '0.75rem', color: error.includes('成功') ? '#059669' : '#ef4444', marginBottom: '0.5rem' }}>
                            {error}
                        </div>
                    )}

                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2" disabled={loading}>
                        {loading ? '处理中...' : (isLogin ? '登录' : '注册')}
                    </button>
                </form>

                <div className="text-center mt-4 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{isLogin ? '没有账户？' : '已有账户？'}</span>
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        className="bg-transparent border-none text-blue-600 hover:text-blue-700 font-medium cursor-pointer ml-1"
                    >
                        {isLogin ? '注册' : '登录'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function App() {
    const [user, setUser] = useState(null);
    const [words, setWords] = useState([]);
    const [activeTab, setActiveTab] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newWord, setNewWord] = useState({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '' });
    const [loading, setLoading] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);
    const [speakingId, setSpeakingId] = useState(null);
    const [regeneratingId, setRegeneratingId] = useState(null);
    const [apiKey, setApiKey] = useState(() => {
        // 优先使用 localStorage 中的值
        const savedKey = localStorage.getItem('vocab-api-key');
        const wasDeleted = localStorage.getItem('vocab-api-key-deleted');
        if (savedKey) return savedKey;
        // 如果用户明确删除了，不使用环境变量
        if (wasDeleted) return '';
        // 否则使用环境变量
        return import.meta.env.VITE_ANTHROPIC_API_KEY || '';
    });
    const [showSettings, setShowSettings] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const inputRef = useRef(null);
    const aiTimeoutRef = useRef(null);
    const ignoreFetch = useRef(false);

    // Auth state listener
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) loadWords(session.user.id);
            else setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) loadWords(session.user.id);
            else {
                setWords([]);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // Load words from Supabase
    const loadWords = async (userId) => {
        setLoading(true);
        const { data, error } = await supabase
            .from('words')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Load error:', error);
        } else {
            // Convert DB format to app format
            const formatted = data.map(w => ({
                id: w.id,
                word: w.word,
                meaning: w.meaning,
                language: w.language,
                example: w.example || '',
                exampleCn: w.example_cn || '',
                category: w.category || '',
                date: w.date,
                timestamp: new Date(w.created_at).getTime()
            }));
            setWords(formatted);

            // Migrate localStorage data if exists
            await migrateLocalStorage(userId);
        }

        // Load saved API key
        const savedKey = localStorage.getItem('vocab-api-key');
        if (savedKey) setApiKey(savedKey);

        setLoading(false);
    };

    // Migrate localStorage data to Supabase
    const migrateLocalStorage = async (userId) => {
        const localData = localStorage.getItem('vocab-words-v4');
        if (!localData) return;

        try {
            const localWords = JSON.parse(localData);
            if (localWords.length === 0) return;

            setSyncing(true);

            for (const w of localWords) {
                const { error } = await supabase.from('words').upsert({
                    user_id: userId,
                    word: w.word,
                    meaning: w.meaning,
                    language: w.language,
                    example: w.example,
                    example_cn: w.exampleCn,
                    category: w.category || '',
                    date: w.date
                }, { onConflict: 'user_id,word,language' });

                if (error) console.error('Migration error:', error);
            }

            // Reload words after migration
            await loadWords(userId);

            // Clear localStorage after successful migration
            localStorage.removeItem('vocab-words-v4');
            console.log(`Migrated ${localWords.length} words to cloud`);

            setSyncing(false);
        } catch (e) {
            console.error('Migration failed:', e);
            setSyncing(false);
        }
    };

    // Save API Key
    useEffect(() => {
        if (!loading) {
            if (apiKey) {
                localStorage.setItem('vocab-api-key', apiKey);
                localStorage.removeItem('vocab-api-key-deleted');
            }
        }
    }, [apiKey, loading]);

    // Focus
    useEffect(() => {
        if (isAdding && inputRef.current) inputRef.current.focus();
    }, [isAdding]);

    // AI content
    useEffect(() => {
        if (ignoreFetch.current) {
            ignoreFetch.current = false;
            return;
        }
        if (!newWord.word.trim()) return;
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        if (!apiKey) return;

        aiTimeoutRef.current = setTimeout(async () => {
            if (newWord.word.trim().length >= 1) {
                setAiLoading(true);
                const content = await getAIContent(newWord.word.trim(), newWord.language, apiKey);
                if (content) {
                    setNewWord(prev => ({
                        ...prev,
                        meaning: content.translation || prev.meaning,
                        example: content.example || '',
                        exampleCn: content.exampleCn || '',
                        category: content.category || ''
                    }));
                }
                setAiLoading(false);
            }
        }, 800);
        return () => { if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current); };
    }, [newWord.word, newWord.language, apiKey]);

    const handleRegenerate = async (wordId) => {
        const word = words.find(w => w.id === wordId);
        if (!word || !apiKey) return;
        setRegeneratingId(wordId);
        const newEx = await regenerateExample(word.word, word.meaning, word.language, apiKey);
        if (newEx && user) {
            // Update in Supabase
            const { error } = await supabase
                .from('words')
                .update({ example: newEx.example, example_cn: newEx.exampleCn })
                .eq('id', wordId);

            if (!error) {
                setWords(prev => prev.map(w => w.id === wordId ? { ...w, example: newEx.example, exampleCn: newEx.exampleCn } : w));
            }
        }
        setRegeneratingId(null);
    };

    const handleStartAdd = async () => {
        setIsAdding(true);
        if (searchQuery.trim()) {
            const text = searchQuery.trim();

            // Set word but ignore the standard AI fetch effect
            ignoreFetch.current = true;
            setNewWord(prev => ({ ...prev, word: text }));

            if (apiKey) {
                setAiLoading(true);
                // Smart detect
                const content = await detectAndGetContent(text, apiKey);

                if (content) {
                    // Update all fields, ignore effect again
                    ignoreFetch.current = true;
                    setNewWord(prev => ({
                        ...prev,
                        language: content.language,
                        meaning: content.translation,
                        example: content.example,
                        exampleCn: content.exampleCn,
                        category: content.category
                    }));
                }
                setAiLoading(false);
            }
        }
    };

    const addWord = async () => {
        if (!newWord.word.trim() || !newWord.meaning.trim() || !user) return;

        setSyncing(true);

        const { data, error } = await supabase.from('words').insert({
            user_id: user.id,
            word: newWord.word.trim(),
            meaning: newWord.meaning.trim(),
            language: newWord.language,
            example: newWord.example.trim(),
            example_cn: newWord.exampleCn.trim(),
            category: newWord.category,
            date: new Date().toISOString().split('T')[0]
        }).select().single();

        if (error) {
            console.error('Add error:', error);
        } else {
            setWords(prev => [{
                id: data.id,
                word: data.word,
                meaning: data.meaning,
                language: data.language,
                example: data.example || '',
                exampleCn: data.example_cn || '',
                category: data.category || '',
                date: data.date,
                timestamp: new Date(data.created_at).getTime()
            }, ...prev]);
        }

        setNewWord({ word: '', meaning: '', language: newWord.language, example: '', exampleCn: '', category: '' });
        setIsAdding(false);
        setSearchQuery(''); // Clear search so all words appear
        setSyncing(false);
    };

    const deleteWord = async (id) => {
        if (!user) return;

        const { error } = await supabase.from('words').delete().eq('id', id);

        if (!error) {
            setWords(prev => prev.filter(w => w.id !== id));
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    const filteredWords = words.filter(w => {
        const matchesTab = activeTab === 'all' || w.language === activeTab;
        const matchesSearch = !searchQuery || w.word.toLowerCase().includes(searchQuery.toLowerCase()) || w.meaning.includes(searchQuery);
        return matchesTab && matchesSearch;
    });

    const groupedByDate = filteredWords.reduce((acc, word) => {
        if (!acc[word.date]) acc[word.date] = [];
        acc[word.date].push(word);
        return acc;
    }, {});

    const formatDate = (d) => {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (d === today) return '今天';
        if (d === yesterday) return '昨天';
        return new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    };

    const getCategoryClass = (cat) => {
        const map = {
            daily: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
            professional: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
            formal: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
        };
        return map[cat] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    };
    const getCategoryLabel = (cat) => {
        const map = { daily: '日常', professional: '专业', formal: '正式' };
        return map[cat] || '';
    };

    const exportWords = () => {
        const csv = ['Word,Meaning,Language,Example,Example_CN,Category,Date']
            .concat(words.map(w => `"${w.word}","${w.meaning}","${w.language}","${w.example}","${w.exampleCn || ''}","${w.category || ''}","${w.date}"`))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vocab-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    const stats = {
        total: words.length,
        en: words.filter(w => w.language === 'en').length,
        de: words.filter(w => w.language === 'de').length,
        today: words.filter(w => w.date === new Date().toISOString().split('T')[0]).length
    };

    // Show auth form if not logged in
    if (!user && !loading) {
        return <AuthForm onAuth={setUser} />;
    }

    if (loading) return <div className="container" style={{ textAlign: 'center', paddingTop: '4rem', color: '#64748b' }}>Loading...</div>;

    return (
        <div className="max-w-xl mx-auto p-4 py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-amber-500/30">
                        <Icons.Book />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-slate-800 dark:text-slate-100">词汇本</div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <Icons.Cloud /> 云端同步 {syncing && '· 同步中...'}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded-lg transition-colors" onClick={() => setShowSettings(!showSettings)}><Icons.Settings /></button>
                    {words.length > 0 && (
                        <button className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" onClick={exportWords}><Icons.Download /> 导出</button>
                    )}
                    <button className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded-lg transition-colors" onClick={handleLogout} title="退出登录"><Icons.LogOut /></button>
                </div>
            </div>

            {/* API Key Warning - Show when no API key is set */}
            {!apiKey && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">⚠️</span>
                        <h3 className="text-sm font-semibold text-red-600 m-0">需要 OpenAI API Key</h3>
                    </div>
                    <p className="text-xs text-red-700 mb-3 leading-relaxed">
                        本应用使用 OpenAI 进行翻译、例句生成和语音朗读。请输入您的 OpenAI API Key 才能使用完整功能。
                        <br />
                        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 hover:underline">
                            → 获取 API Key
                        </a>
                    </p>
                    <label className="block text-xs text-slate-500 mb-1">OpenAI API Key</label>
                    <input
                        className="w-full px-3 py-2 bg-white border border-red-200 rounded-lg text-sm outline-none focus:border-red-400 text-slate-800"
                        type="password"
                        placeholder="sk-proj-xxxxx"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="text-xs text-slate-400 mt-1">
                        Key 仅保存在本地浏览器中，不会上传到服务器。
                    </div>
                </div>
            )}

            {/* Settings Panel */}
            {showSettings && apiKey && (
                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
                    <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100">Settings</h3>
                    <label className="block text-xs text-slate-500 mb-1">OpenAI API Key</label>
                    <div className="flex gap-2">
                        <input
                            className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                            type="password"
                            placeholder="sk-proj-..."
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                        <button
                            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                            onClick={() => {
                                setApiKey('');
                                localStorage.removeItem('vocab-api-key');
                                localStorage.setItem('vocab-api-key-deleted', 'true');
                            }}
                            title="删除 API Key"
                        >
                            <Icons.Trash /> 删除
                        </button>
                    </div>
                    <div className="text-xs text-slate-400 mt-2">Key is stored locally. 账户: {user?.email}</div>
                </div>
            )}


            {/* Stats */}
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm">
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.total}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">总计</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm">
                    <div className="text-2xl font-bold text-blue-600">{stats.en}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">英语</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm">
                    <div className="text-2xl font-bold text-green-600">{stats.de}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">德语</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm">
                    <div className="text-2xl font-bold text-amber-600">{stats.today}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">今日</div>
                </div>
            </div>

            {/* Search */}
            {/* Search */}
            <div className="flex gap-3 mb-6">
                <div className="flex-1 relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></div>
                    <input
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100 transition-colors"
                        placeholder="搜索单词..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors font-medium shadow-lg shadow-slate-900/10"
                    onClick={handleStartAdd}
                >
                    <Icons.Plus /> 添加
                </button>
            </div>

            {/* Tabs */}
            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-6">
                {[{ id: 'all', label: '全部' }, { id: 'en', label: '🇬🇧 英语' }, { id: 'de', label: '🇩🇪 德语' }].map(t => (
                    <button
                        key={t.id}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === t.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                            }`}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.label}<span className="ml-1 opacity-60 text-xs">{t.id === 'all' ? stats.total : stats[t.id]}</span>
                    </button>
                ))}
            </div>

            {/* Add Form */}
            {isAdding && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6 shadow-sm">
                    <div className="flex gap-2 mb-4 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg w-fit">
                        <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'en' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => setNewWord(p => ({ ...p, language: 'en', word: '', meaning: '', example: '', exampleCn: '', category: '' }))}>🇬🇧 英语</button>
                        <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${newWord.language === 'de' ? 'bg-white dark:bg-slate-600 text-green-600 dark:text-green-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`} onClick={() => setNewWord(p => ({ ...p, language: 'de', word: '', meaning: '', example: '', exampleCn: '', category: '' }))}>🇩🇪 德语</button>
                    </div>
                    <input
                        ref={inputRef}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100 font-medium"
                        placeholder="输入单词或短语"
                        value={newWord.word}
                        onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))}
                    />
                    {aiLoading ? (
                        <>
                            <div className="h-10 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg flex items-center px-3 text-sm text-slate-400 gap-2 mb-2"><Icons.Sparkles /> GPT 分析中...</div>
                            <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg mb-2"></div>
                        </>
                    ) : (
                        <>
                            <div className="relative mb-2">
                                <input
                                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                                    placeholder="中文翻译"
                                    value={newWord.meaning}
                                    onChange={e => setNewWord(p => ({ ...p, meaning: e.target.value }))}
                                />
                                {newWord.meaning && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500"><Icons.Sparkles /></div>}
                            </div>
                            {newWord.example && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-4">
                                    <div className="text-sm text-slate-700 dark:text-slate-300 mb-1">{newWord.example}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">{newWord.exampleCn}</div>
                                </div>
                            )}
                        </>
                    )}
                    <div className="flex gap-2">
                        <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed" onClick={addWord} disabled={!newWord.word.trim() || !newWord.meaning.trim() || aiLoading || syncing}>
                            {syncing ? '保存中...' : '保存'}
                        </button>
                        <button className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium" onClick={() => { setIsAdding(false); setNewWord({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '' }); }}>取消</button>
                    </div>
                </div>
            )}

            {/* Word List */}
            {Object.keys(groupedByDate).length === 0 ? (
                <div className="text-center py-16">
                    <div className="text-6xl text-slate-200 dark:text-slate-700 mb-4">📚</div>
                    <div className="text-slate-500 font-medium mb-1">还没有单词</div>
                    <div className="text-sm text-slate-400">开始记录你每天遇到的新单词吧</div>
                </div>
            ) : (
                Object.entries(groupedByDate).sort(([a], [b]) => b.localeCompare(a)).map(([date, dateWords]) => (
                    <div key={date} className="mb-8">
                        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                            <Icons.Calendar /> {formatDate(date)} <span className="text-xs opacity-60">({dateWords.length})</span>
                        </div>
                        {dateWords.sort((a, b) => b.timestamp - a.timestamp).map(word => (
                            <div key={word.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-3 hover:border-blue-300 dark:hover:border-blue-700 transition-all group shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${word.language === 'en' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'}`}>
                                                {word.language === 'en' ? '🇬🇧' : '🇩🇪'}
                                            </span>
                                            {word.category && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryClass(word.category)}`}>{getCategoryLabel(word.category)}</span>}
                                            <span className="text-lg font-bold text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer inline-flex items-center gap-1 transition-colors" onClick={() => speakWord(word.word, word.language, setSpeakingId, word.id, apiKey)}>
                                                {word.word}
                                                <button className={`p-1 rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${speakingId === word.id ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : ''}`}>
                                                    <Icons.Speaker playing={speakingId === word.id} />
                                                </button>
                                            </span>
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-300 mb-2 font-medium">{word.meaning}</div>
                                        {word.example && (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 relative group/example">
                                                <div className="text-sm text-slate-700 dark:text-slate-300 mb-0.5 pr-6">{word.example}</div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400">{word.exampleCn}</div>
                                                <button className={`absolute top-2 right-2 p-1.5 rounded text-slate-400 opacity-0 group-hover/example:opacity-100 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-all ${regeneratingId === word.id ? 'opacity-100 animate-spin text-amber-600' : ''}`} onClick={() => handleRegenerate(word.id)} title="重新生成例句"><Icons.Refresh /></button>
                                            </div>
                                        )}
                                    </div>
                                    <button className="p-2 rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-all" onClick={() => deleteWord(word.id)}><Icons.Trash /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                ))
            )}

            <div className="mt-8 text-center text-xs text-slate-400 flex items-center justify-center gap-1 pb-8">
                <Icons.Cloud /> 数据已同步到云端 · 点击单词听发音
            </div>
        </div>
    );
}

export default App;
