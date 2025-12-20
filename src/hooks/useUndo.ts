import { useState, useCallback } from 'react';

export interface DeletedItem {
    id: string;
    type: 'word' | 'sentence';
    label: string;
    restore: () => Promise<void>;
}

interface UseUndoReturn {
    deletedItem: DeletedItem | null;
    markDeleted: (item: DeletedItem) => void;
    handleUndo: () => Promise<void>;
    dismiss: () => void;
}

export function useUndo(): UseUndoReturn {
    const [deletedItem, setDeletedItem] = useState<DeletedItem | null>(null);

    const markDeleted = useCallback((item: DeletedItem) => {
        setDeletedItem(item);
    }, []);

    const handleUndo = useCallback(async () => {
        if (deletedItem) {
            await deletedItem.restore();
            setDeletedItem(null);
        }
    }, [deletedItem]);

    const dismiss = useCallback(() => {
        setDeletedItem(null);
    }, []);

    return {
        deletedItem,
        markDeleted,
        handleUndo,
        dismiss
    };
}

export default useUndo;
