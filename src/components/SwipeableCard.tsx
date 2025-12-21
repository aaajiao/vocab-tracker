import { useState, useRef, memo } from 'react';
import { Icons } from './Icons';
import type { SwipeableCardProps } from '../types';

// Swipeable Card Component - touch swipe on mobile, hover delete on desktop
function SwipeableCard({ children, onDelete, className }: SwipeableCardProps) {
    const [offset, setOffset] = useState(0);
    const [swiping, setSwiping] = useState(false);
    const [hovering, setHovering] = useState(false);
    const [swipeDirection, setSwipeDirection] = useState<'horizontal' | 'vertical' | null>(null);
    const startX = useRef(0);
    const startY = useRef(0);
    const currentX = useRef(0);
    const currentY = useRef(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
        startY.current = e.touches[0].clientY;
        currentX.current = startX.current;
        currentY.current = startY.current;
        setSwiping(true);
        setSwipeDirection(null);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!swiping) return;

        currentX.current = e.touches[0].clientX;
        currentY.current = e.touches[0].clientY;

        const diffX = currentX.current - startX.current;
        const diffY = currentY.current - startY.current;

        // Dead zone: ignore movements less than 10px
        const totalMove = Math.sqrt(diffX * diffX + diffY * diffY);
        if (totalMove < 10) return;

        // Direction locking: determine direction on first significant move
        if (swipeDirection === null) {
            const angle = Math.atan2(Math.abs(diffY), Math.abs(diffX)) * 180 / Math.PI;
            setSwipeDirection(angle < 30 ? 'horizontal' : 'vertical');
        }

        // Only update offset for horizontal swipes
        if (swipeDirection === 'horizontal' && diffX < 0) {
            setOffset(Math.max(diffX, -100));
        }
    };

    const handleTouchEnd = () => {
        setSwiping(false);
        setSwipeDirection(null);

        if (offset < -60) {
            setOffset(-100);
            setTimeout(() => onDelete(), 200);
        } else {
            setOffset(0);
        }
    };

    return (
        <div
            className="relative overflow-hidden rounded-xl w-full"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {/* Swipe delete background (mobile) */}
            <div
                className="absolute inset-y-0 right-0 w-24 bg-red-500 flex items-center justify-center text-white"
                style={{ opacity: Math.min(1, Math.abs(offset) / 60) }}
            >
                <Icons.Trash />
                <span className="ml-1 text-sm font-medium">删除</span>
            </div>
            <div
                className={className}
                style={{
                    transform: `translateX(${offset}px)`,
                    transition: swiping ? 'none' : 'transform 0.2s ease-out'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
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
