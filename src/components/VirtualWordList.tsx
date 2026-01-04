import { memo, useState, useMemo } from 'react';
import SwipeableCard from './SwipeableCard';
import { Icons } from './Icons';
import type { VirtualWordListProps, Word } from '../types';

// Word List Component - renders words grouped by date
function VirtualWordList({
    groupedByDate, formatDate, deleteWord, speakWord, setSpeakingId,
    speakingId, apiKey, setCachedKeys, cachedKeys, getCategoryClass,
    getCategoryLabel, handleRegenerate, regeneratingId,
    saveSentence, unsaveSentence, isSentenceSaved, getSavedSentenceId, savingId
}: VirtualWordListProps) {
    const [expandedEtymology, setExpandedEtymology] = useState<Set<string>>(new Set());

    const toggleEtymology = (wordId: string) => {
        setExpandedEtymology(prev => {
            const newSet = new Set(prev);
            if (newSet.has(wordId)) {
                newSet.delete(wordId);
            } else {
                newSet.add(wordId);
            }
            return newSet;
        });
    };

    // Sort dates in descending order
    const sortedDates = useMemo(() => 
        Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a)),
        [groupedByDate]
    );

    return (
        <div className="space-y-2">
            {sortedDates.map(date => {
                const dateWords = groupedByDate[date];
                // Sort words by timestamp descending within each date
                const sortedWords = [...dateWords].sort((a, b) => b.timestamp - a.timestamp);
                
                return (
                    <div key={date}>
                        {/* Date Header */}
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 pt-4 pb-2">
                            <Icons.Calendar /> {formatDate(date)}
                            <span className="text-xs opacity-60">({dateWords.length})</span>
                        </div>
                        
                        {/* Words for this date */}
                        <div className="space-y-4">
                            {sortedWords.map(word => (
                                <SwipeableCard
                                    key={word.id}
                                    onDelete={() => deleteWord(word.id)}
                                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-all group shadow-sm"
                                >
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${word.language === 'en' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'}`}>
                                            {word.language === 'en' ? '🇬🇧' : '🇩🇪'}
                                        </span>
                                        {word.category && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryClass(word.category)}`}>{getCategoryLabel(word.category)}</span>}
                                        <span className="text-lg font-bold text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer inline-flex items-center gap-1 transition-colors" onClick={() => speakWord(word.word, word.language, setSpeakingId, word.id, apiKey, (key) => setCachedKeys(prev => new Set(prev).add(key)))}>
                                            {word.word}
                                            <button className={`p-1.5 rounded-full hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 active:scale-90 transition-all ${speakingId === word.id ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 animate-pulse-ring' : (cachedKeys.has(`${word.language}:${word.word}`) ? 'text-blue-400/80 dark:text-blue-400/60' : 'text-slate-400')}`}>
                                                <Icons.Speaker playing={speakingId === word.id} cached={cachedKeys.has(`${word.language}:${word.word}`)} />
                                            </button>
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-600 dark:text-slate-300 mb-2 font-medium">{word.meaning}</div>

                                    {/* Etymology Section - Collapsible */}
                                    {word.etymology && (
                                        <div className="mb-2">
                                            <button
                                                onClick={() => toggleEtymology(word.id)}
                                                className="w-full text-left text-xs text-slate-500 dark:text-slate-400 bg-amber-50/30 dark:bg-amber-900/5 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 border border-amber-200/30 dark:border-amber-800/20 rounded-lg px-3 py-2 transition-colors"
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-amber-600 dark:text-amber-500">📖</span>
                                                    <span className="font-medium text-amber-700 dark:text-amber-400">词源</span>
                                                    <span className="ml-auto text-amber-600 dark:text-amber-500">
                                                        {expandedEtymology.has(word.id) ? '▲' : '▼'}
                                                    </span>
                                                </div>
                                            </button>
                                            {expandedEtymology.has(word.id) && (
                                                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-lg px-3 py-2">
                                                    {word.etymology}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {word.example && (
                                        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 relative group/example">
                                            <div className="text-sm text-slate-700 dark:text-slate-300 mb-0.5 pr-14">{word.example}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{word.exampleCn}</div>
                                            <div className="absolute top-2 right-2 flex gap-1">
                                                <button
                                                    className={`p-2 rounded-lg active:scale-90 transition-all ${isSentenceSaved(word.example) ? 'text-amber-500' : 'text-slate-300 dark:text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30'}`}
                                                    onClick={() => {
                                                        if (isSentenceSaved(word.example)) {
                                                            unsaveSentence(getSavedSentenceId(word.example)!);
                                                        } else {
                                                            saveSentence({
                                                                sentence: word.example,
                                                                sentenceCn: word.exampleCn,
                                                                language: word.language,
                                                                scene: null,
                                                                sourceType: 'word',
                                                                sourceWords: [word.word]
                                                            });
                                                        }
                                                    }}
                                                    disabled={savingId === word.example}
                                                    title={isSentenceSaved(word.example) ? '取消收藏' : '收藏例句'}
                                                >
                                                    <Icons.Star filled={isSentenceSaved(word.example)} />
                                                </button>
                                                <button className={`p-2 rounded-lg text-slate-300 dark:text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 active:scale-90 transition-all ${regeneratingId === word.id ? 'animate-spin text-amber-600' : ''}`} onClick={() => handleRegenerate(word.id)} title="重新生成例句"><Icons.Refresh /></button>
                                            </div>
                                        </div>
                                    )}
                                </SwipeableCard>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default memo(VirtualWordList);
