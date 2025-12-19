import { useState, useEffect, useRef } from 'react';

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
    Settings: () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
};

// Claude AI - Get translation and contextual example
async function getAIContent(text, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/anthropic/v1/messages", { // Proxy
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
                model: "claude-3-haiku-20240307", // Most compatible/fastest
                max_tokens: 300,
                messages: [{
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
                }]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('API Error', data.error);
            return null;
        }

        if (data.content && data.content[0] && data.content[0].text) {
            const jsonStr = data.content[0].text.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Claude API error:', e);
        return null;
    }
}

// Regenerate example
async function regenerateExample(word, meaning, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/anthropic/v1/messages", { // Proxy
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
                model: "claude-3-haiku-20240307",
                max_tokens: 200,
                messages: [{
                    role: "user",
                    content: `Generate a NEW, different example sentence for this ${langName} word: "${word}" (meaning: ${meaning})

Match the context to the word's nature:
- Everyday words → casual, daily-life scenarios
- Technical terms → professional/academic context
- Formal words → formal context

Respond in this exact JSON format only:
{"example": "New example sentence in ${langName}", "exampleCn": "例句中文翻译"}`
                }]
            })
        });

        const data = await response.json();
        if (data.content && data.content[0] && data.content[0].text) {
            const jsonStr = data.content[0].text.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Regenerate error:', e);
        return null;
    }
}

// TTS
async function speakWord(text, language, setSpeakingId, wordId) {
    setSpeakingId(wordId);
    try {
        const langCode = language === 'en' ? 'en' : 'de';
        const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob`;
        const audio = new Audio(audioUrl);
        audio.playbackRate = 0.9;
        await new Promise((resolve) => {
            audio.onended = resolve;
            audio.onerror = () => {
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = language === 'en' ? 'en-US' : 'de-DE';
                    u.rate = 0.85;
                    u.onend = resolve;
                    u.onerror = resolve;
                    window.speechSynthesis.speak(u);
                } else resolve();
            };
            audio.play().catch(() => audio.onerror());
        });
    } catch (e) { console.error('TTS error:', e); }
    setSpeakingId(null);
}

function App() {
    const [words, setWords] = useState([]);
    const [activeTab, setActiveTab] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newWord, setNewWord] = useState({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '' });
    const [loading, setLoading] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);
    const [speakingId, setSpeakingId] = useState(null);
    const [regeneratingId, setRegeneratingId] = useState(null);
    const [apiKey, setApiKey] = useState(import.meta.env.VITE_ANTHROPIC_API_KEY || '');
    const [showSettings, setShowSettings] = useState(false);

    const inputRef = useRef(null);
    const aiTimeoutRef = useRef(null);

    // Load
    useEffect(() => {
        try {
            const saved = localStorage.getItem('vocab-words-v4');
            if (saved) setWords(JSON.parse(saved));

            const savedKey = localStorage.getItem('vocab-api-key');
            if (savedKey) setApiKey(savedKey);

        } catch (e) { console.error(e) }
        setLoading(false);
    }, []);

    // Save
    useEffect(() => {
        if (!loading) localStorage.setItem('vocab-words-v4', JSON.stringify(words));
    }, [words, loading]);

    // Save API Key
    useEffect(() => {
        if (!loading && apiKey !== import.meta.env.VITE_ANTHROPIC_API_KEY) {
            localStorage.setItem('vocab-api-key', apiKey);
        }
    }, [apiKey]);

    // Focus
    useEffect(() => {
        if (isAdding && inputRef.current) inputRef.current.focus();
    }, [isAdding]);

    // AI content
    useEffect(() => {
        if (!newWord.word.trim()) return;
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);

        if (!apiKey) return; // Don't try if no key

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
        if (newEx) {
            setWords(prev => prev.map(w => w.id === wordId ? { ...w, example: newEx.example, exampleCn: newEx.exampleCn } : w));
        }
        setRegeneratingId(null);
    };

    const addWord = () => {
        if (!newWord.word.trim() || !newWord.meaning.trim()) return;
        setWords(prev => [{
            id: Date.now().toString(),
            word: newWord.word.trim(),
            meaning: newWord.meaning.trim(),
            language: newWord.language,
            example: newWord.example.trim(),
            exampleCn: newWord.exampleCn.trim(),
            category: newWord.category,
            date: new Date().toISOString().split('T')[0],
            timestamp: Date.now()
        }, ...prev]);
        setNewWord({ word: '', meaning: '', language: newWord.language, example: '', exampleCn: '', category: '' });
        setIsAdding(false);
    };

    const deleteWord = (id) => setWords(prev => prev.filter(w => w.id !== id));

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
        const map = { daily: 'badge-daily', professional: 'badge-professional', formal: 'badge-formal' };
        return map[cat] || '';
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

    if (loading) return <div className="container" style={{ textAlign: 'center', paddingTop: '4rem', color: '#64748b' }}>Loading...</div>;

    return (
        <div className="container">
            {/* Header */}
            <div className="header">
                <div className="header-left">
                    <div className="header-icon"><Icons.Book /></div>
                    <div>
                        <div className="header-title">词汇本</div>
                        <div className="header-subtitle"><Icons.Sparkles /> AI 翻译 · 例句 · 发音</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-ghost" onClick={() => setShowSettings(!showSettings)}><Icons.Settings /></button>
                    {words.length > 0 && (
                        <button className="btn btn-ghost" onClick={exportWords}><Icons.Download /> 导出</button>
                    )}
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div className="form-card" style={{ marginBottom: '1.5rem', background: '#f8fafc', borderColor: '#cbd5e1' }}>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Settings</h3>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#64748b' }}>Anthropic API Key</label>
                    <input
                        className="input"
                        type="password"
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Key is stored locally in your browser.</div>
                </div>
            )}


            {/* Stats */}
            <div className="stats">
                <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">总计</div></div>
                <div className="stat-card"><div className="stat-value blue">{stats.en}</div><div className="stat-label">英语</div></div>
                <div className="stat-card"><div className="stat-value green">{stats.de}</div><div className="stat-label">德语</div></div>
                <div className="stat-card"><div className="stat-value amber">{stats.today}</div><div className="stat-label">今日</div></div>
            </div>

            {/* Search */}
            <div className="search-row">
                <div className="search-box">
                    <div className="search-icon"><Icons.Search /></div>
                    <input className="search-input" placeholder="搜索单词..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={() => setIsAdding(true)}><Icons.Plus /> 添加</button>
            </div>

            {/* Tabs */}
            <div className="tabs">
                {[{ id: 'all', label: '全部' }, { id: 'en', label: '🇬🇧 英语' }, { id: 'de', label: '🇩🇪 德语' }].map(t => (
                    <button key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
                        {t.label}<span className="tab-count">{t.id === 'all' ? stats.total : stats[t.id]}</span>
                    </button>
                ))}
            </div>

            {/* Add Form */}
            {isAdding && (
                <div className="form-card">
                    <div className="lang-toggle">
                        <button className={`lang-btn ${newWord.language === 'en' ? 'en' : 'inactive'}`} onClick={() => setNewWord(p => ({ ...p, language: 'en', word: '', meaning: '', example: '', exampleCn: '', category: '' }))}>🇬🇧 英语</button>
                        <button className={`lang-btn ${newWord.language === 'de' ? 'de' : 'inactive'}`} onClick={() => setNewWord(p => ({ ...p, language: 'de', word: '', meaning: '', example: '', exampleCn: '', category: '' }))}>🇩🇪 德语</button>
                    </div>
                    <input ref={inputRef} className="input" placeholder="输入单词或短语" value={newWord.word} onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))} />
                    {aiLoading ? (
                        <>
                            <div className="ai-loading"><Icons.Sparkles /> Claude AI 分析中...</div>
                            <div className="ai-loading" style={{ height: '60px' }}></div>
                        </>
                    ) : (
                        <>
                            <div className="input-wrapper">
                                <input className="input" style={{ marginBottom: 0 }} placeholder="中文翻译" value={newWord.meaning} onChange={e => setNewWord(p => ({ ...p, meaning: e.target.value }))} />
                                {newWord.meaning && <div className="input-icon"><Icons.Sparkles /></div>}
                            </div>
                            {newWord.example && (
                                <div className="example-preview">
                                    <div className="example-text">{newWord.example}</div>
                                    <div className="example-cn">{newWord.exampleCn}</div>
                                </div>
                            )}
                        </>
                    )}
                    <div className="form-actions">
                        <button className="btn btn-primary" onClick={addWord} disabled={!newWord.word.trim() || !newWord.meaning.trim() || aiLoading}>保存</button>
                        <button className="btn btn-ghost" onClick={() => { setIsAdding(false); setNewWord({ word: '', meaning: '', language: 'en', example: '', exampleCn: '', category: '' }); }}>取消</button>
                    </div>
                </div>
            )}

            {/* Word List */}
            {Object.keys(groupedByDate).length === 0 ? (
                <div className="empty">
                    <div className="empty-icon">📚</div>
                    <div className="empty-text">还没有单词</div>
                    <div className="empty-hint">开始记录你每天遇到的新单词吧</div>
                </div>
            ) : (
                Object.entries(groupedByDate).sort(([a], [b]) => b.localeCompare(a)).map(([date, dateWords]) => (
                    <div key={date} className="date-group">
                        <div className="date-header"><Icons.Calendar /> {formatDate(date)} <span className="date-count">({dateWords.length})</span></div>
                        {dateWords.sort((a, b) => b.timestamp - a.timestamp).map(word => (
                            <div key={word.id} className="word-card">
                                <div className="word-header">
                                    <div className="word-content">
                                        <div className="word-badges">
                                            <span className={`badge ${word.language === 'en' ? 'badge-en' : 'badge-de'}`}>{word.language === 'en' ? '🇬🇧' : '🇩🇪'}</span>
                                            {word.category && <span className={`badge ${getCategoryClass(word.category)}`}>{getCategoryLabel(word.category)}</span>}
                                            <span className="word-text" onClick={() => speakWord(word.word, word.language, setSpeakingId, word.id)}>
                                                {word.word}
                                                <button className={`speaker-btn ${speakingId === word.id ? 'speaking' : ''}`}><Icons.Speaker playing={speakingId === word.id} /></button>
                                            </span>
                                        </div>
                                        <div className="word-meaning">{word.meaning}</div>
                                        {word.example && (
                                            <div className="word-example">
                                                <div className="word-example-text">{word.example}</div>
                                                <div className="word-example-cn">{word.exampleCn}</div>
                                                <button className={`regen-btn ${regeneratingId === word.id ? 'loading' : ''}`} onClick={() => handleRegenerate(word.id)} title="重新生成例句"><Icons.Refresh /></button>
                                            </div>
                                        )}
                                    </div>
                                    <button className="delete-btn" onClick={() => deleteWord(word.id)}><Icons.Trash /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                ))
            )}

            <div className="footer"><Icons.Sparkles /> 点击单词听发音 · 点击 ↻ 重新生成例句</div>
        </div>
    );
}

export default App;
