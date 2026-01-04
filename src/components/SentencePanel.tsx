import { memo } from 'react';
import { Icons } from './Icons';
import type { Word, SentenceData, SentenceInput } from '../types';

interface SentencePanelProps {
    activeTab: 'en' | 'de';
    sentenceData: SentenceData | null;
    sentenceLoading: boolean;
    speakingId: string | null;
    savingId: string | null;
    onClose: () => void;
    onRegenerate: () => void;
    onSpeak: (text: string, language: string, id: string) => void;
    isSentenceSaved: (sentence: string) => boolean;
    getSavedSentenceId: (sentence: string) => string | null;
    saveSentence: (sentence: SentenceInput) => void;
    unsaveSentence: (id: string) => void;
}

export const SentencePanel = memo(function SentencePanel({
    activeTab,
    sentenceData,
    sentenceLoading,
    speakingId,
    savingId,
    onClose,
    onRegenerate,
    onSpeak,
    isSentenceSaved,
    getSavedSentenceId,
    saveSentence,
    unsaveSentence
}: SentencePanelProps) {
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                    <Icons.Sparkles /> 组合造句
                </div>
                <button
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                    onClick={onClose}
                >
                    ✕
                </button>
            </div>

            {sentenceLoading ? (
                <div className="space-y-3">
                    <div className="h-8 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg" />
                    <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 animate-pulse rounded-lg" />
                </div>
            ) : sentenceData ? (
                <>
                    {/* Scene Tag */}
                    {sentenceData.scene && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                            <span>📍</span>
                            <span className="font-medium">{sentenceData.scene}</span>
                        </div>
                    )}

                    {/* Word Pills */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {sentenceData.words.map((w, i) => (
                            <span
                                key={i}
                                className={`px-2.5 py-1 rounded-full text-sm font-medium ${
                                    activeTab === 'en'
                                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                        : 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                }`}
                            >
                                {w.word}
                            </span>
                        ))}
                    </div>

                    {/* Sentence Display */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-3">
                        <div className="text-base text-slate-800 dark:text-slate-200 mb-1 leading-relaxed">
                            {sentenceData.sentence}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                            {sentenceData.sentenceCn}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                        <button
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all text-sm font-medium"
                            onClick={() => onSpeak(sentenceData.sentence, activeTab, 'sentence')}
                        >
                            <Icons.Speaker playing={speakingId === 'sentence'} cached={false} /> 朗读
                        </button>
                        <button
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg active:scale-95 transition-all text-sm font-medium ${
                                isSentenceSaved(sentenceData.sentence)
                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                            onClick={() => {
                                if (isSentenceSaved(sentenceData.sentence)) {
                                    unsaveSentence(getSavedSentenceId(sentenceData.sentence)!);
                                } else {
                                    saveSentence({
                                        sentence: sentenceData.sentence,
                                        sentenceCn: sentenceData.sentenceCn,
                                        language: activeTab,
                                        scene: sentenceData.scene,
                                        sourceType: 'combined',
                                        sourceWords: sentenceData.words.map(w => w.word)
                                    });
                                }
                            }}
                            disabled={savingId === sentenceData.sentence}
                        >
                            <Icons.Star filled={isSentenceSaved(sentenceData.sentence)} />{' '}
                            {isSentenceSaved(sentenceData.sentence) ? '已收藏' : '收藏'}
                        </button>
                        <button
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 active:scale-95 transition-all text-sm font-medium"
                            onClick={onRegenerate}
                        >
                            <Icons.Refresh /> 换一批
                        </button>
                    </div>
                </>
            ) : (
                <div className="text-center text-slate-400 py-4">生成失败，请重试</div>
            )}
        </div>
    );
});

export default SentencePanel;
