import { memo } from 'react';
import { Icons } from './Icons';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import type { SwipeableCardProps } from '../types';

// Swipeable Card Component - touch swipe on mobile, hover delete on desktop
function SwipeableCard({ children, onDelete, className }: SwipeableCardProps) {
    const {
        hovering,
        setHovering,
        touchHandlers,
        style,
        deleteOpacity
    } = useSwipeGesture({ onDelete });

    return (
        <div
            className="relative overflow-hidden rounded-xl w-full"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {/* Swipe delete background (mobile) */}
            <div
                className="absolute inset-y-0 right-0 w-24 bg-red-500 flex items-center justify-center text-white"
                style={{ opacity: deleteOpacity }}
            >
                <Icons.Trash />
                <span className="ml-1 text-sm font-medium">删除</span>
            </div>
            <div
                className={className}
                style={style}
                {...touchHandlers}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        {children}
                    </div>
                    {/* Desktop delete button (hover devices only) */}
                    <button
                        className={`p-2.5 rounded-lg text-slate-300 dark:text-slate-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 active:scale-90 transition-all hover-device-show ${hovering ? 'opacity-100' : 'opacity-0'}`}
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        title="删除单词"
                    >
                        <Icons.Trash />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default memo(SwipeableCard);
