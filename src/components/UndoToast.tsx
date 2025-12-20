import { useState, useEffect, useCallback } from 'react';
import type { UndoToastProps } from '../types';

// UndoToast Component - Shows after delete with undo option
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

    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
            <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px]">
                <div className="flex-1 text-sm">
                    <span className="font-medium">"{deletedItem.word}"</span>
                    <span className="text-slate-400 dark:text-slate-500 ml-1">已删除</span>
                </div>
                <button
                    onClick={handleUndo}
                    className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    撤销
                </button>
            </div>
            {/* Progress bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700 dark:bg-slate-300 rounded-b-xl overflow-hidden">
                <div
                    className="h-full bg-amber-500 transition-all duration-100 ease-linear"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}

export default UndoToast;
