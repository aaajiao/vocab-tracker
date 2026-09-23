import { useState, useCallback, useRef } from 'react';

export interface DeletedItem {
    id: string;
    type: 'word' | 'sentence';
    label: string;
    restore: () => Promise<boolean>;
}

export function useUndo() {
    const [deletedItem, setDeletedItem] = useState<DeletedItem | null>(null);
    const restoringRef = useRef(false);
    const markDeleted = useCallback((item: DeletedItem) => setDeletedItem(item), []);
    const handleUndo = useCallback(async (): Promise<boolean> => {
        if (!deletedItem || restoringRef.current) return false;
        restoringRef.current = true;
        try {
            const restored = await deletedItem.restore();
            if (restored) setDeletedItem((current) => current === deletedItem ? null : current);
            return restored;
        } catch { return false; }
        finally { restoringRef.current = false; }
    }, [deletedItem]);
    const dismiss = useCallback(() => setDeletedItem(null), []);
    return { deletedItem, markDeleted, handleUndo, dismiss };
}

export default useUndo;
