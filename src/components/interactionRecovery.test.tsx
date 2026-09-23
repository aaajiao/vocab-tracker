import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ReviewCard from './ReviewCard';
import SettingsDialog from './SettingsDialog';
import UndoToast from './UndoToast';
import type { Word } from '../types';

const word: Word = { id: 'word-a', word: 'Haus', meaning: '房子', language: 'de', example: 'Das Haus ist groß.', exampleCn: '房子很大。', category: '', date: '2026-09-23', timestamp: 1 };

describe('interaction recovery and keyboard access', () => {
    let host: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    });
    afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

    it('reenables rating after persistence fails and lets the user retry the same card', async () => {
        const grade = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await act(async () => root.render(<ReviewCard word={word} mode="flip" preview={null} onGrade={grade} speakingId={null} setSpeakingId={() => {}} apiKey="" cachedKeys={new Set()} setCachedKeys={() => {}} getCategoryClass={() => ''} getCategoryLabel={() => ''} />));
        const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes('✅'))!;
        await act(async () => button.click());
        expect(grade).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(false);
        await act(async () => button.click());
        expect(grade).toHaveBeenCalledTimes(2);
    });

    it('uses a native flip button with only the displayed face available to assistive technology', async () => {
        await act(async () => root.render(<ReviewCard word={word} mode="flip" preview={null} onGrade={async () => true} speakingId={null} setSpeakingId={() => {}} apiKey="" cachedKeys={new Set()} setCachedKeys={() => {}} getCategoryClass={() => ''} getCategoryLabel={() => ''} />));
        const flip = host.querySelector<HTMLButtonElement>('button[aria-label="查看答案"]')!;
        expect(flip).toBeTruthy();
        expect(flip.querySelector('button')).toBeNull();
        const back = host.querySelector<HTMLElement>('.review-flip-back')!;
        expect(back.getAttribute('aria-hidden')).toBe('true');
        expect(back.inert).toBe(true);
        await act(async () => flip.click());
        expect(back.getAttribute('aria-hidden')).toBe('false');
        expect(back.inert).toBe(false);
        expect(host.querySelector('button[aria-label="返回问题"]')).toBeTruthy();
    });

    it('keeps the undo action visible after failure and awaits retry success', async () => {
        const onUndo = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await act(async () => root.render(<UndoToast deletedItem={{ id: 'a', label: 'Haus', type: 'word', restore: async () => false }} onUndo={onUndo} onDismiss={() => {}} />));
        await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
        expect(host.textContent).toContain('恢复失败，请重试');
        const retry = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === '重试撤销')!;
        await act(async () => retry.click());
        expect(onUndo).toHaveBeenCalledTimes(2);
        expect(host.textContent).toBe('');
    });

    it('traps drawer focus, closes on Escape, and restores the opening control and page scrolling', async () => {
        function Harness() {
            const [open, setOpen] = useState(false);
            return <><button onClick={() => setOpen(true)}>设置入口</button>{open && <SettingsDialog onClose={() => setOpen(false)}><input aria-label="测试设置" /><button>最后一个控件</button></SettingsDialog>}</>;
        }
        await act(async () => root.render(<Harness />));
        const trigger = host.querySelector('button')!; trigger.focus();
        await act(async () => trigger.click());
        const dialog = document.querySelector('[role="dialog"]')!;
        const buttons = dialog.querySelectorAll<HTMLButtonElement>('button');
        expect(document.activeElement).toBe(buttons[0]);
        expect(host.inert).toBe(true);
        expect(document.body.style.overflow).toBe('hidden');
        buttons[buttons.length - 1].focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(buttons[0]);
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.inert).toBe(false);
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.overflow).toBe('');
    });
});
