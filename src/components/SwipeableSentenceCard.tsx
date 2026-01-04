import { memo } from 'react';
import { Icons } from './Icons';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import type { SavedSentence } from '../types';

interface SwipeableSentenceCardProps {
    sentence: SavedSentence;
    onDelete: () => void;
    onSpeak: () => void;
    speakingId: string | null;
}

// Swipeable Sentence Card - swipe delete on mobile, hover delete on desktop
function SwipeableSentenceCard({ sentence, onDelete, onSpeak, speakingId }: SwipeableSentenceCardProps) {
    const {
        hovering,
        setHovering,
        touchHandlers,
        style,
        deleteOpacity
    } = useSwipeGesture({ onDelete });

    const s = sentence;

    return (
        <div
            className="relative overflow-hidden rounded-xl mb-3"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {/* Swipe delete background (mobile) */}
            <div
                className="absolute inset-y-0 right-0 w-24 bg-red-500 flex items-center justify-center text-white"
                style={{ opacity: deleteOpacity }}
            >
                <Icons.Trash />
                <span className="ml-1 text-sm font-medium">移除</span>
            </div>
            <div
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 shadow-sm"
                style={style}
                {...touchHandlers}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.language === 'en' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'}`}>
                            {s.language === 'en' ? '🇬🇧' : '🇩🇪'}
                        </span>
                        {s.scene && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                📍 {s.scene}
                            </span>
                        )}
                        <span className="text-xs text-slate-400">{s.source_type === 'combined' ? '组合造句' : '单词例句'}</span>
                    </div>
                    {/* Desktop delete button (hover devices only) */}
                    <button
                        className={`p-1.5 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all hover-device-show ${hovering ? 'opacity-100' : 'opacity-0'}`}
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        title="移除收藏"
                    >
                        <Icons.Trash />
                    </button>
                </div>
                <div className="text-base text-slate-800 dark:text-slate-200 mb-1 leading-relaxed">{s.sentence}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">{s.sentence_cn}</div>
                {s.source_words && s.source_words.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {s.source_words.map((w, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">{w}</span>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all text-sm"
                        onClick={onSpeak}
                    >
                        <Icons.Speaker playing={speakingId === s.id} cached={false} /> 朗读
                    </button>
                </div>
            </div>
        </div>
    );
}

export default memo(SwipeableSentenceCard);
