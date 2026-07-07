import { useState, useMemo, memo, Fragment } from 'react';
import type { ReviewCardProps } from '../types';
import { Icons } from './Icons';
import { LANGUAGE_CONFIG } from '../constants';
import { speakWord } from '../services/tts';
import { generateCacheKey } from '../services/audioCache';

// 去掉德语名词的冠词前缀（der/die/das + 空格），英文原样返回，供整词匹配用。
function stripArticle(word: string, language: 'en' | 'de'): string {
    if (language === 'de') {
        return word.replace(/^(der|die|das)\s+/i, '').trim();
    }
    return word.trim();
}

// 在例句中定位目标词的全部出现：先去德语冠词，再 case-insensitive 整词匹配（全局）。
// 返回每处命中的 [start, end)（按出现顺序）；空例句或无匹配返回 []（挖空模式据此退回翻转模式）。
// 必须全局匹配：目标词在例句中可能出现多次（成语、强调、复数/复合词复用），
// 只挖第一处会把后续出现原样留在挖空正面泄露答案。
function findTargets(example: string, word: string, language: 'en' | 'de'): { start: number; end: number }[] {
    if (!example) return [];
    const core = stripArticle(word, language);
    if (!core) return [];
    const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re: RegExp;
    try {
        // 整词边界用 Unicode 字母/数字负向断言（兼顾德语变元音 ä ö ü ß）；g 标志遍历所有出现
        re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
    } catch {
        // 极老引擎不支持后行断言 / u 标志时的兜底
        re = new RegExp(escaped, 'gi');
    }
    const ranges: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(example)) !== null) {
        ranges.push({ start: m.index, end: m.index + m[0].length });
        // 防御零长匹配导致的死循环（core 非空时通常不会发生，稳妥起见仍处理）
        if (m.index === re.lastIndex) re.lastIndex += 1;
    }
    return ranges;
}

// 间隔天数 → 中文小字（如「明天」「3 天后」）
function formatDays(n: number | undefined): string {
    if (n === undefined || n === null) return '';
    if (n <= 1) return '明天';
    return `${n} 天后`;
}

// 复习卡片：CSS 3D 翻转，正面（词 / 挖空例句）→ 点击翻面 → 背面（释义、分类、例句、词源），下方三键评分。
function ReviewCard({
    word, mode, preview, onGrade,
    speakingId, setSpeakingId, apiKey, cachedKeys, setCachedKeys,
    getCategoryClass, getCategoryLabel,
}: ReviewCardProps) {
    const [flipped, setFlipped] = useState(false);
    const [graded, setGraded] = useState(false);   // 防重复评级（快速连点）

    const flag = word.language === 'en' ? '🇬🇧' : '🇩🇪';
    const langName = LANGUAGE_CONFIG[word.language].name;
    const langPill = word.language === 'en'
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
        : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400';

    const cacheKey = generateCacheKey(word.language, word.word);
    const speakId = `review-${word.id}`;
    const speaking = speakingId === speakId;
    const cached = cachedKeys.has(cacheKey);

    // 挖空匹配（去德语冠词 + 整词 case-insensitive，全局所有出现）；失败则该卡退回翻转模式
    const targets = useMemo(
        () => findTargets(word.example, word.word, word.language),
        [word.example, word.word, word.language],
    );
    const useCloze = mode === 'cloze' && !!word.example && targets.length > 0;

    // 挖空正面：把目标词的每一处出现都替换成 ____（多次出现全部挖空，避免后续出现泄露答案）
    const clozeExample = useMemo(() => {
        const nodes: React.ReactNode[] = [];
        let cursor = 0;
        targets.forEach((t, i) => {
            if (t.start > cursor) nodes.push(<Fragment key={`c${i}`}>{word.example.slice(cursor, t.start)}</Fragment>);
            nodes.push(
                <span key={`b${i}`} className="mx-1 px-3 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-semibold tracking-widest">____</span>,
            );
            cursor = t.end;
        });
        if (cursor < word.example.length) nodes.push(<Fragment key="cend">{word.example.slice(cursor)}</Fragment>);
        return <>{nodes}</>;
    }, [targets, word.example]);

    const handleSpeak = (e: React.MouseEvent) => {
        e.stopPropagation();  // 不触发卡片翻转
        speakWord(word.word, word.language, setSpeakingId, speakId, apiKey,
            (key) => setCachedKeys(prev => new Set(prev).add(key)));
    };

    const handleGrade = (grade: 'forgot' | 'fuzzy' | 'known') => {
        if (graded) return;
        setGraded(true);
        onGrade(grade);
    };

    const speakerBtn = (
        <button
            className={`shrink-0 p-1.5 rounded-full active:scale-90 transition-all ${speaking
                ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 animate-pulse-ring'
                : cached
                    ? 'text-blue-400/80 dark:text-blue-400/60 hover:bg-slate-100 dark:hover:bg-slate-700'
                    : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
            onClick={handleSpeak}
            title="朗读"
        >
            <Icons.Speaker playing={speaking} cached={cached} />
        </button>
    );

    // 例句高亮（背面）：把目标词的每一处出现都包成 <mark>；无匹配则原样
    const highlightedExample = useMemo(() => {
        if (targets.length === 0) return word.example;
        const nodes: React.ReactNode[] = [];
        let cursor = 0;
        targets.forEach((t, i) => {
            if (t.start > cursor) nodes.push(<Fragment key={`t${i}`}>{word.example.slice(cursor, t.start)}</Fragment>);
            nodes.push(
                <mark key={`m${i}`} className="bg-transparent text-amber-600 dark:text-amber-400 font-semibold">
                    {word.example.slice(t.start, t.end)}
                </mark>,
            );
            cursor = t.end;
        });
        if (cursor < word.example.length) nodes.push(<Fragment key="tend">{word.example.slice(cursor)}</Fragment>);
        return <>{nodes}</>;
    }, [targets, word.example]);

    const faceBase = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden';

    return (
        <div>
            <div className="review-flip-scene w-full">
                <div
                    className={`review-flip-card ${flipped ? 'is-flipped' : ''}`}
                    onClick={() => setFlipped(f => !f)}
                >
                    {/* 正面 */}
                    <div className={`review-flip-face ${faceBase}`}>
                        {useCloze ? (
                            // 挖空模式正面：例句（目标词 → 空格）+ 中译，不放 TTS（避免泄露答案）
                            <div className="flex flex-col justify-center gap-4 min-h-[13rem] py-8 px-5">
                                <span className={`self-start text-xs px-2 py-0.5 rounded-full font-medium ${langPill}`}>{flag} {langName}</span>
                                <div className="text-lg leading-relaxed text-slate-800 dark:text-slate-100">
                                    {clozeExample}
                                </div>
                                {word.exampleCn && (
                                    <div className="text-sm text-slate-500 dark:text-slate-400">{word.exampleCn}</div>
                                )}
                                <span className="text-xs text-slate-400 dark:text-slate-500">点击卡片查看答案</span>
                            </div>
                        ) : (
                            // 翻转模式正面：单词 + 语言旗帜 + TTS 发音键
                            <div className="flex flex-col items-center justify-center gap-3 min-h-[13rem] py-8 px-5 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${langPill}`}>{flag} {langName}</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-3xl font-bold text-slate-800 dark:text-slate-100 break-words">{word.word}</span>
                                    {speakerBtn}
                                </div>
                                <span className="text-xs text-slate-400 dark:text-slate-500">点击卡片查看释义</span>
                            </div>
                        )}
                    </div>

                    {/* 背面（两种模式共用）：释义 + 分类 chip + 例句（目标词高亮）+ 中译 + 词源 */}
                    <div className={`review-flip-face review-flip-back ${faceBase}`}>
                        <div className="flex flex-col gap-3 min-h-[13rem] py-6 px-5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${langPill}`}>{flag}</span>
                                <span className="text-2xl font-bold text-slate-800 dark:text-slate-100 break-words">{word.word}</span>
                                {speakerBtn}
                                {word.category && (
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryClass(word.category)}`}>
                                        {getCategoryLabel(word.category)}
                                    </span>
                                )}
                            </div>
                            <div className="text-base font-medium text-slate-700 dark:text-slate-200 break-words">{word.meaning}</div>
                            {word.example && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800">
                                    <div className="text-sm text-slate-700 dark:text-slate-300 mb-1 leading-relaxed break-words">{highlightedExample}</div>
                                    {word.exampleCn && (
                                        <div className="text-xs text-slate-500 dark:text-slate-400 break-words">{word.exampleCn}</div>
                                    )}
                                </div>
                            )}
                            {word.etymology && (
                                <div className="text-xs text-slate-600 dark:text-slate-300 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-lg px-3 py-2 leading-relaxed break-words">
                                    <span className="text-amber-600 dark:text-amber-500 mr-1">📖</span>{word.etymology}
                                </div>
                            )}
                            <span className="text-xs text-slate-400 dark:text-slate-500 mt-auto">点击卡片返回</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 三键评分：😵 不认识 / 🤔 模糊 / ✅ 认识，下方小字为下次间隔预览 */}
            <div className="grid grid-cols-3 gap-2 mt-4">
                <button
                    className="flex flex-col items-center gap-0.5 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => handleGrade('forgot')}
                    disabled={graded}
                >
                    <span className="text-2xl leading-none">😵</span>
                    <span className="text-sm font-medium">不认识</span>
                    <span className="text-[11px] opacity-70">{formatDays(preview?.forgot)}</span>
                </button>
                <button
                    className="flex flex-col items-center gap-0.5 py-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => handleGrade('fuzzy')}
                    disabled={graded}
                >
                    <span className="text-2xl leading-none">🤔</span>
                    <span className="text-sm font-medium">模糊</span>
                    <span className="text-[11px] opacity-70">{formatDays(preview?.fuzzy)}</span>
                </button>
                <button
                    className="flex flex-col items-center gap-0.5 py-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => handleGrade('known')}
                    disabled={graded}
                >
                    <span className="text-2xl leading-none">✅</span>
                    <span className="text-sm font-medium">认识</span>
                    <span className="text-[11px] opacity-70">{formatDays(preview?.known)}</span>
                </button>
            </div>
        </div>
    );
}

export default memo(ReviewCard);
