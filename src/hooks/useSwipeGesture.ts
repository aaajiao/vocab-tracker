import { useState, useRef, useCallback } from 'react';

interface SwipeGestureOptions {
    onDelete: () => void;
    deleteThreshold?: number;
    maxOffset?: number;
}

interface SwipeGestureReturn {
    offset: number;
    swiping: boolean;
    hovering: boolean;
    setHovering: (hovering: boolean) => void;
    touchHandlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: () => void;
    };
    style: React.CSSProperties;
    deleteOpacity: number;
}

export function useSwipeGesture({
    onDelete,
    deleteThreshold = 60,
    maxOffset = 100
}: SwipeGestureOptions): SwipeGestureReturn {
    const [offset, setOffset] = useState(0);
    const [swiping, setSwiping] = useState(false);
    const [hovering, setHovering] = useState(false);
    const [swipeDirection, setSwipeDirection] = useState<'horizontal' | 'vertical' | null>(null);
    
    const startX = useRef(0);
    const startY = useRef(0);
    const currentX = useRef(0);
    const currentY = useRef(0);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
        startY.current = e.touches[0].clientY;
        currentX.current = startX.current;
        currentY.current = startY.current;
        setSwiping(true);
        setSwipeDirection(null);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
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

        // Only update offset for horizontal swipes (left swipe only)
        if (swipeDirection === 'horizontal' && diffX < 0) {
            setOffset(Math.max(diffX, -maxOffset));
        }
    }, [swiping, swipeDirection, maxOffset]);

    const handleTouchEnd = useCallback(() => {
        setSwiping(false);
        setSwipeDirection(null);

        if (offset < -deleteThreshold) {
            setOffset(-maxOffset);
            setTimeout(() => onDelete(), 200);
        } else {
            setOffset(0);
        }
    }, [offset, deleteThreshold, maxOffset, onDelete]);

    return {
        offset,
        swiping,
        hovering,
        setHovering,
        touchHandlers: {
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
        },
        style: {
            transform: `translateX(${offset}px)`,
            transition: swiping ? 'none' : 'transform 0.2s ease-out'
        },
        deleteOpacity: Math.min(1, Math.abs(offset) / deleteThreshold)
    };
}

export default useSwipeGesture;
