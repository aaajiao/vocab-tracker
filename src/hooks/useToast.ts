import { useState, useCallback } from 'react';

export interface Toast {
    id: string;
    type: 'success' | 'error' | 'info';
    message: string;
}

interface UseToastReturn {
    toasts: Toast[];
    showToast: (type: Toast['type'], message: string) => void;
    dismissToast: (id: string) => void;
}

export function useToast(): UseToastReturn {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((type: Toast['type'], message: string) => {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newToast: Toast = { id, type, message };

        setToasts(prev => [...prev, newToast]);

        // Auto dismiss after 4 seconds
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return { toasts, showToast, dismissToast };
}

export default useToast;
