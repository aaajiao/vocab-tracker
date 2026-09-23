import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SettingsDialogProps { onClose: () => void; children: ReactNode; title?: string }

export default function SettingsDialog({ onClose, children, title = '设置' }: SettingsDialogProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const portal = useMemo(() => document.createElement('div'), []);

    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.append(portal);
        const backgrounds = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portal).map((element) => ({ element, inert: element.inert }));
        backgrounds.forEach(({ element }) => { element.inert = true; });
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || []).filter((element) => {
                if (element.closest('[hidden], [inert]')) return false;
                const detail = element.closest('details:not([open])');
                return !detail || element === detail.querySelector('summary');
            });
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
            if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            backgrounds.forEach(({ element, inert }) => { element.inert = inert; });
            document.body.style.overflow = previousOverflow;
            portal.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [portal]);

    return createPortal(<div className="fixed inset-0 z-[60] bg-slate-950/40 flex justify-end" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="w-full max-w-md h-full overflow-y-auto overscroll-contain bg-slate-50 dark:bg-slate-900 shadow-2xl">
            <div className="sticky top-0 z-10 flex justify-between items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                <h2 id={titleId} className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
                <button ref={closeRef} type="button" onClick={onClose} aria-label={`关闭${title}`} className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800">关闭</button>
            </div>
            <div className="p-5 pb-12">{children}</div>
        </div>
    </div>, portal);
}
