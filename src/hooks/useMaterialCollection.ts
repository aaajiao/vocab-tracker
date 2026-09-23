import { useCallback, useEffect, useRef, useState } from 'react';
import { learningRequest, learningErrorMessage } from '../services/learningApi';
import { getMaterialOperations, materialRevision, replaceMaterials, readMaterials, type MaterialKind, type MaterialValue } from '../services/materialStore';

export function useMaterialCollection<T extends MaterialValue>({ userId, isOnline, kind, decode, onError, onLoadComplete }: {
    userId: string | undefined; isOnline: boolean; kind: MaterialKind;
    decode: (row: Record<string, unknown>) => T; onError?: (message: string) => void; onLoadComplete?: () => void;
}) {
    const [view, setView] = useState<{ owner?: string; values: T[]; pendingIds: string[] }>({ owner: userId, values: [], pendingIds: [] });
    const [loading, setLoading] = useState(true);
    const owner = useRef(userId); owner.current = userId;
    const mounted = useRef(true); const controller = useRef<AbortController | null>(null);
    const localGeneration = useRef(0);
    const readyOwner = useRef<string | undefined>(undefined);
    const callbacks = useRef({ onError, onLoadComplete }); callbacks.current = { onError, onLoadComplete };
    const values = view.owner === userId ? view.values : [];
    const valuesRef = useRef(values); valuesRef.current = values;
    const isCurrent = useCallback(() => mounted.current && owner.current === userId && Boolean(userId), [userId]);
    const loadLocal = useCallback(async () => {
        if (!userId) return;
        const generation = ++localGeneration.current;
        const next = await readMaterials<T>(userId, kind);
        const pendingIds = (await getMaterialOperations(userId)).filter(op => op.kind === kind).map(op => op.record_id);
        next.sort((a, b) => (('timestamp' in b ? b.timestamp : Date.parse(b.created_at)) - ('timestamp' in a ? a.timestamp : Date.parse(a.created_at))));
        if (isCurrent() && generation === localGeneration.current) {
            readyOwner.current = userId; valuesRef.current = next; setView({ owner: userId, values: next, pendingIds }); setLoading(false);
        }
    }, [userId, kind, isCurrent]);
    const refreshFromServer = useCallback(async () => {
        if (!userId) return;
        controller.current?.abort(); const active = new AbortController(); controller.current = active;
        const valid = () => isCurrent() && !active.signal.aborted;
        if (valid() && readyOwner.current !== userId) setLoading(true);
        try {
            await loadLocal(); if (!valid() || !isOnline) return;
            const revision = await materialRevision(userId, kind); const rows: T[] = []; let offset = 0;
            for (;;) {
                const page = await learningRequest<Record<string, unknown>[]>(`/${kind === 'word' ? 'words' : 'sentences'}?limit=100&offset=${offset}`, { userId, signal: active.signal });
                if (!valid()) return;
                rows.push(...page.data.map(decode));
                if (!page.meta?.has_more) break;
                const next = page.meta.next_offset;
                if (typeof next !== 'number' || !Number.isInteger(next) || next <= offset) throw new Error('分页无效');
                offset = next;
            }
            if (!valid()) return;
            await replaceMaterials(userId, kind, rows, revision);
            if (valid()) await loadLocal();
        } catch (error) { if (valid()) callbacks.current.onError?.(learningErrorMessage(error)); }
        finally { if (valid()) { setLoading(false); callbacks.current.onLoadComplete?.(); } }
    }, [userId, kind, isOnline, decode, isCurrent, loadLocal]);
    useEffect(() => {
        mounted.current = true;
        if (userId) void refreshFromServer(); else setLoading(false);
        return () => { mounted.current = false; controller.current?.abort(); };
    }, [userId, refreshFromServer]);
    useEffect(() => {
        const listener = (event: Event) => { const changed = (event as CustomEvent<{ userId?: string }>).detail?.userId; if (!changed || changed === userId) void loadLocal(); };
        window.addEventListener('vocab-material-change', listener);
        return () => window.removeEventListener('vocab-material-change', listener);
    }, [userId, loadLocal]);
    return { values, valuesRef, pendingIds: new Set(view.owner === userId ? view.pendingIds : []), loading: userId && readyOwner.current !== userId ? loading || view.owner !== userId : loading, isCurrent, loadLocal, refreshFromServer };
}
