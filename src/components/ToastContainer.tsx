import { Icons } from './Icons';
import type { Toast as ToastType } from '../hooks/useToast';

interface ToastContainerProps {
    toasts: ToastType[];
    onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`
                        flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg animate-slide-in
                        ${toast.type === 'success' ? 'bg-emerald-500 text-white' : ''}
                        ${toast.type === 'error' ? 'bg-red-500 text-white' : ''}
                        ${toast.type === 'info' ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-800' : ''}
                    `}
                >
                    <span className="text-sm flex-1">{toast.message}</span>
                    <button
                        onClick={() => onDismiss(toast.id)}
                        className="p-1 rounded-lg hover:bg-white/20 transition-colors"
                    >
                        <Icons.Close />
                    </button>
                </div>
            ))}
        </div>
    );
}

export default ToastContainer;
