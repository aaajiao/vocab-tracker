import { useState, useEffect, useCallback } from 'react';
import type { DeletedItem } from '../hooks/useUndo';

interface UndoToastProps {
    deletedItem: DeletedItem | null;
    onUndo: () => void;
    onDismiss: () => void;
    duration?: number;
}

// Generic Undo Toast - works for any deletable item type
function UndoToast({ deletedItem, onUndo, onDismiss, duration = 5000 }: UndoToastProps) {
    const [visible, setVisible] = useState(true);
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        if (!deletedItem) {
            setVisible(false);
            return;
        }

        setVisible(true);
        setProgress(100);

        const startTime = Date.now();
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
            setProgress(remaining);

            if (remaining <= 0) {
                clearInterval(timer);
                setVisible(false);
                onDismiss();
            }
        }, 50);

        return () => clearInterval(timer);
    }, [deletedItem, duration, onDismiss]);

    const handleUndo = useCallback(() => {
        setVisible(false);
        onUndo();
    }, [onUndo]);

    if (!visible || !deletedItem) return null;

    // Get display text based on type
    const getDisplayText = () => {
        const label = deletedItem.label.length > 20
            ? deletedItem.label.slice(0, 20) + '...'
            : deletedItem.label;

        return deletedItem.type === 'word'
            ? `${label} 已删除`
            : `"${label}" 已移除`;
    };

    return (
        <div className="fixed bottom-6 left-0 right-0 z-50 flex justify-center px-4 animate-slide-up">
            <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 w-full max-w-sm relative overflow-hidden">
                <div className="flex-1 text-sm">
                    <span className="font-medium">{getDisplayText()}</span>
                </div>
                <button
                    onClick={handleUndo}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
                >
                    撤销
                </button>
                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700/50 dark:bg-slate-300/50">
                    <div
                        className="h-full bg-amber-500 transition-all duration-100 ease-linear"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
}

export default UndoToast;
