import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useUndo } from './useUndo';

let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useUndo>;
function Probe() { current = useUndo(); return null; }
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('keeps a failed restore available and clears only after confirmed success', async () => {
    const restore = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => current.markDeleted({ id: 'one', type: 'word', label: 'Haus', restore }));
    await act(async () => { expect(await current.handleUndo()).toBe(false); });
    expect(current.deletedItem?.id).toBe('one');
    await act(async () => { expect(await current.handleUndo()).toBe(true); });
    expect(current.deletedItem).toBeNull();
});

it('does not erase a newer undo action when an earlier restore completes late', async () => {
    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    await act(async () => current.markDeleted({ id: 'one', type: 'word', label: 'Haus', restore: () => pending }));
    let attempt!: Promise<boolean>;
    await act(async () => { attempt = current.handleUndo(); });
    await act(async () => current.markDeleted({ id: 'two', type: 'word', label: 'Tag', restore: async () => true }));
    await act(async () => { resolve(true); await attempt; });
    expect(current.deletedItem?.id).toBe('two');
});
