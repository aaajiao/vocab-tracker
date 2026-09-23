import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodexConnectionPanel from './CodexConnectionPanel';
import PracticeHistoryPanel from './PracticeHistoryPanel';
import type { AccessTokenMetadata, LearningApiResult, LearningPreferences, PracticeSession, PracticeEvent } from '../services/learningApi';

const api = vi.hoisted(() => ({ getTokens: vi.fn(), getPreferences: vi.fn(), createToken: vi.fn(), revokeToken: vi.fn(), savePreferences: vi.fn(), getSessions: vi.fn(), getSession: vi.fn() }));
vi.mock('../services/learningApi', () => ({ learningApi: api, learningErrorMessage: () => '请求失败，请重试。' }));

const preferences: LearningPreferences = { language: 'de', timezone: 'Europe/Berlin', session_size: 10, duration_minutes: 10, correction_style: 'after_answer', interests: [] };
const token: AccessTokenMetadata = { id: 'token-a', name: '我的 Codex', prefix: 'vt_prefix', scopes: ['vocabulary:read'], expires_at: '2099-01-01T00:00:00Z', revoked_at: null, last_used_at: null, created_at: '2026-09-23T00:00:00Z' };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => { resolve = complete; });
    return { promise, resolve };
}

function practiceSession(id: string): PracticeSession {
    return { id, language: 'de', mode: 'conversation', topic: `练习 ${id}`, word_ids: [], target_minutes: 10, status: 'active', summary: null, version: 1, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z', completed_at: null };
}

describe('learning panels request lifecycle', () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        api.getTokens.mockResolvedValue({ data: [] });
        api.getPreferences.mockResolvedValue({ data: preferences });
        api.getSessions.mockResolvedValue({ data: [practiceSession('a'), practiceSession('b')], meta: { has_more: false, next_offset: null } });
        api.getSession.mockResolvedValue({ data: { session: practiceSession('a'), events: [] } });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('guards token creation against two submissions before the first render', async () => {
        const creation = deferred<LearningApiResult<{ token: AccessTokenMetadata; access_token: string }>>();
        api.createToken.mockReturnValue(creation.promise);
        await act(async () => root.render(<CodexConnectionPanel userId="user-a" />));
        const form = container.querySelector('form')!;
        await act(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(api.createToken).toHaveBeenCalledOnce();
        await act(async () => creation.resolve({ data: { token, access_token: 'vt_one_time_secret' } }));
        expect((container.querySelector('[aria-label="新创建的连接令牌"]') as HTMLTextAreaElement).value).toBe('vt_one_time_secret');
        const close = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '已保存，关闭显示')!;
        await act(async () => close.click());
        expect(container.querySelector('[aria-label="新创建的连接令牌"]')).toBeNull();
    });

    it('clears secrets immediately when switching accounts and ignores the old request', async () => {
        const creation = deferred<LearningApiResult<{ token: AccessTokenMetadata; access_token: string }>>();
        api.createToken.mockReturnValue(creation.promise);
        await act(async () => root.render(<CodexConnectionPanel userId="user-a" />));
        await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        const signal = api.createToken.mock.calls[0][2] as AbortSignal;
        await act(async () => root.render(<CodexConnectionPanel userId="user-b" />));
        expect(signal.aborted).toBe(true);
        await act(async () => creation.resolve({ data: { token, access_token: 'vt_old_account_secret' } }));
        expect(container.querySelector('[aria-label="新创建的连接令牌"]')).toBeNull();
        expect(container.textContent).not.toContain('vt_old_account_secret');
    });

    it('does not replace a newer selected session with a slower old detail response', async () => {
        const oldDetail = deferred<LearningApiResult<{ session: PracticeSession; events: PracticeEvent[] }>>();
        const newDetail = deferred<LearningApiResult<{ session: PracticeSession; events: PracticeEvent[] }>>();
        api.getSession.mockImplementation((_user: string, id: string) => id === 'a' ? oldDetail.promise : newDetail.promise);
        await act(async () => root.render(<PracticeHistoryPanel userId="user-a" />));
        const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'));
        await act(async () => buttons[0].click());
        const oldSignal = api.getSession.mock.calls[0][2] as AbortSignal;
        await act(async () => buttons[1].click());
        expect(oldSignal.aborted).toBe(true);
        await act(async () => newDetail.resolve({ data: { session: { ...practiceSession('b'), summary: '新的练习总结' }, events: [] } }));
        await act(async () => oldDetail.resolve({ data: { session: { ...practiceSession('a'), summary: '过期的练习总结' }, events: [] } }));
        expect(container.querySelector('#practice-session-detail')?.textContent).toContain('新的练习总结');
        expect(container.querySelector('#practice-session-detail')?.textContent).not.toContain('过期的练习总结');
    });

    it('refreshes practice lists and selected details when the page regains focus', async () => {
        await act(async () => root.render(<PracticeHistoryPanel userId="user-a" />));
        await act(async () => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(api.getSessions).toHaveBeenCalledTimes(2);
        expect(api.getSession).toHaveBeenCalledTimes(2);
    });
});
