import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { STORAGE_KEYS } from './constants';

const mocks = vi.hoisted(() => ({ addWord: vi.fn(), addWords: vi.fn(), saveSentence: vi.fn(), showToast: vi.fn(), detectAndAnalyze: vi.fn(), syncNow: vi.fn(), generateVocabularyExpansion: vi.fn(), pendingCount: 0, failedCount: 0, wordsLoading: false, syncing: false, savingId: null as string | null, words: [] as unknown[], user: { id: 'user-a', email: 'test@example.invalid' } }));
const stable = vi.hoisted(() => ({ noop: () => {}, refresh: async () => {}, getFiltered: () => [], getGrouped: () => ({}) }));
vi.mock('./supabaseClient', () => ({ supabase: { auth: {} } }));
vi.mock('./hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: false, showPasswordUpdate: false, setShowPasswordUpdate: stable.noop, logout: stable.refresh }) }));
vi.mock('./hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: stable.noop }) }));
vi.mock('./hooks/useToast', () => ({ useToast: () => ({ toasts: [], showToast: mocks.showToast, dismissToast: stable.noop }) }));
vi.mock('./hooks/useWords', () => ({ useWords: () => ({ words: mocks.words, loading: mocks.wordsLoading, syncing: mocks.syncing, addWord: mocks.addWord, addWords: mocks.addWords, deleteWord: stable.refresh, updateWordExample: stable.refresh, restoreWord: stable.refresh, getFilteredWords: stable.getFiltered, getGroupedByDate: stable.getGrouped, stats: { total: mocks.words.length, en: mocks.words.length, de: 0, today: 0 }, refreshFromServer: stable.refresh, pendingWordIds: new Set() }) }));
vi.mock('./hooks/useSentences', () => ({ useSentences: () => ({ savedSentences: [], savingId: mocks.savingId, saveSentence: mocks.saveSentence, unsaveSentence: stable.refresh, restoreSentence: stable.refresh, isSentenceSaved: () => false, getSavedSentenceId: () => null, refreshFromServer: stable.refresh }) }));
vi.mock('./hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true, pendingCount: mocks.pendingCount, failedCount: mocks.failedCount, isSyncing: false, syncNow: mocks.syncNow, refreshPendingCount: stable.refresh }) }));
vi.mock('./hooks/useReview', () => ({ useReview: () => ({ loading: false, dueCount: 0, reviewedTodayCount: 0, totalTracked: 0, tomorrowDueCount: 0, aheadCount: 0, session: null, currentCard: null, isSessionFinished: false, summary: null, startSession: stable.noop, startAheadSession: stable.noop, nextRound: stable.noop, endSession: stable.noop, gradeWord: stable.refresh, previewFor: () => null, removeReviewState: stable.noop, refreshFromServer: stable.refresh, legacyPendingCount: 0, failedEventCount: 0 }) }));
vi.mock('./components/SettingsPanel', () => ({ default: () => <p>设置内容</p> }));
vi.mock('./services/openai', async (original) => ({ ...await original<typeof import('./services/openai')>(), getAIContent: vi.fn().mockResolvedValue(null), detectAndAnalyze: mocks.detectAndAnalyze, generateVocabularyExpansion: mocks.generateVocabularyExpansion }));

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('App draft and save recovery', () => {
    let root: Root;
    let host: HTMLDivElement;
    function button(label: string) { return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === label)!; }
    async function input(label: string, value: string) {
        const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
        expect(element).toBeTruthy();
        await act(async () => setValue(element, value));
    }
    beforeEach(() => {
        vi.clearAllMocks();
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, String(value)), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
        mocks.words = []; mocks.wordsLoading = false; mocks.syncing = false; mocks.savingId = null; mocks.pendingCount = 0; mocks.failedCount = 0; mocks.syncNow.mockResolvedValue(undefined);
        mocks.user = { id: 'user-a', email: 'test@example.invalid' };
        mocks.addWord.mockResolvedValue(false);
        mocks.saveSentence.mockResolvedValue(false);
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear(); localStorage.setItem(STORAGE_KEYS.API_KEY_DELETED, 'true');
        host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    });
    afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

    it('saves the currently edited sentence and clears stale translation after original text changes', async () => {
        await act(async () => root.render(<App />));
        await act(async () => button('添加').click());
        await act(async () => button('句子').click());
        await input('单词、短语或句子原文', 'I have an appointment.');
        await input('整句中文翻译', '我有一个预约。');
        await input('单词、短语或句子原文', 'I need a new appointment.');
        expect((host.querySelector('[aria-label="整句中文翻译"]') as HTMLTextAreaElement).value).toBe('');
        expect(button('保存到收藏').disabled).toBe(true);
        await input('整句中文翻译', '我需要一个新的预约。');
        await act(async () => button('保存到收藏').click());
        expect(mocks.saveSentence).toHaveBeenCalledWith(expect.objectContaining({ sentence: 'I need a new appointment.', sentenceCn: '我需要一个新的预约。', keywords: [], grammar: [] }), expect.any(String));
        expect((host.querySelector('[aria-label="单词、短语或句子原文"]') as HTMLInputElement).value).toBe('I need a new appointment.');
    });

    it('preserves a failed word draft and retries even when its pending projection appears in the list', async () => {
        await act(async () => root.render(<App />));
        await act(async () => button('添加').click());
        await input('单词、短语或句子原文', 'appointment');
        await input('中文翻译', '预约');
        await act(async () => button('保存').click());
        expect(mocks.addWord).toHaveBeenCalledTimes(1);
        expect((host.querySelector('[aria-label="单词、短语或句子原文"]') as HTMLInputElement).value).toBe('appointment');
        mocks.words = [{ id: 'pending-id', word: 'appointment', language: 'en' }];
        mocks.addWord.mockResolvedValueOnce(true);
        await act(async () => root.render(<App />));
        await act(async () => button('保存').click());
        expect(mocks.addWord).toHaveBeenCalledTimes(2);
        expect(mocks.addWord.mock.calls[1][0]).toEqual(mocks.addWord.mock.calls[0][0]);
        expect(host.querySelector('[aria-label="单词、短语或句子原文"]')).toBeNull();
        expect(mocks.showToast).not.toHaveBeenCalledWith('info', '该单词已存在');
    });

    it('clears another account’s draft and ignores a late AI result after account switch', async () => {
        localStorage.setItem(STORAGE_KEYS.API_KEY, 'sk-test-only');
        let resolve!: (value: unknown) => void;
        mocks.detectAndAnalyze.mockReturnValue(new Promise((done) => { resolve = done; }));
        await act(async () => root.render(<App />));
        await input('搜索词汇或输入新内容', 'This is private to account A.');
        await act(async () => button('添加').click());
        mocks.user = { id: 'user-b', email: 'second@example.invalid' };
        await act(async () => root.render(<App />));
        expect(host.querySelector('[aria-label="单词、短语或句子原文"]')).toBeNull();
        await act(async () => resolve({ inputType: 'sentence', language: 'en', sentence: 'This is private to account A.', translation: '旧账号的内容', keywords: [], grammar: [] }));
        expect(host.textContent).not.toContain('旧账号的内容');
        expect(host.textContent).not.toContain('This is private to account A.');
    });

    it('shows neutral pending status and gives failed operations an explicit retry and settings action', async () => {
        mocks.pendingCount = 1;
        await act(async () => root.render(<App />));
        expect(host.textContent).toContain('1 项待同步');
        expect(host.textContent).not.toContain('已恢复在线');
        await act(async () => button('立即同步').click());
        expect(mocks.syncNow).toHaveBeenLastCalledWith({ retryFailed: false });
        mocks.failedCount = 1;
        await act(async () => root.render(<App />));
        expect(host.textContent).toContain('1 项需要处理');
        await act(async () => button('重试同步').click());
        expect(mocks.syncNow).toHaveBeenLastCalledWith({ retryFailed: true });
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开同步设置"]')!.click());
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    it('keeps the cached application visible while a background collection refresh is pending', async () => {
        mocks.words = [{ id: 'cached-word', word: 'appointment', language: 'en' }];
        mocks.wordsLoading = true;
        await act(async () => root.render(<App />));
        expect(host.querySelector('[aria-label="搜索词汇或输入新内容"]')).toBeTruthy();
        expect(button('添加')).toBeTruthy();
    });

    it('disables original and translation editing while a save is in flight', async () => {
        await act(async () => root.render(<App />));
        await act(async () => button('添加').click());
        await input('单词、短语或句子原文', 'appointment');
        await input('中文翻译', '预约');
        mocks.syncing = true;
        await act(async () => root.render(<App />));
        expect((host.querySelector('[aria-label="单词、短语或句子原文"]') as HTMLInputElement).disabled).toBe(true);
        expect((host.querySelector('[aria-label="中文翻译"]') as HTMLInputElement).disabled).toBe(true);
        mocks.syncing = false;
        await act(async () => root.render(<App />));
        await act(async () => button('句子').click());
        mocks.savingId = 'appointment';
        await act(async () => root.render(<App />));
        expect((host.querySelector('[aria-label="整句中文翻译"]') as HTMLTextAreaElement).disabled).toBe(true);
    });

    it('toggles an expansion checkbox once instead of undoing its own click through bubbling', async () => {
        localStorage.setItem(STORAGE_KEYS.API_KEY, 'sk-test-only');
        mocks.words = [{ id: 'a', word: 'appointment', language: 'en', category: 'daily' }];
        mocks.generateVocabularyExpansion.mockResolvedValue({ theme: '预约', expansions: [{ word: 'meeting', meaning: '会议', sentence: 'We have a meeting.', sentenceCn: '我们有个会议。', relationType: 'thematic' }] });
        await act(async () => root.render(<App />));
        const english = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes('🇬🇧 英语'))!;
        await act(async () => english.click());
        const expand = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes('词汇扩展') && !item.disabled)!;
        expect(expand).toBeTruthy();
        await act(async () => expand.click());
        const checkbox = host.querySelector<HTMLInputElement>('[aria-label="选择 meeting"]')!;
        expect(checkbox.checked).toBe(true);
        await act(async () => checkbox.click());
        expect(checkbox.checked).toBe(false);
        expect(host.textContent).toContain('添加选中 (0)');
    });

    it('does not announce a failed keyword addition as successful', async () => {
        localStorage.setItem(STORAGE_KEYS.API_KEY, 'sk-test-only');
        mocks.detectAndAnalyze.mockResolvedValue({ inputType: 'sentence', language: 'en', sentence: 'I have an appointment.', translation: '我有一个预约。', keywords: [{ word: 'appointment', meaning: '预约' }], grammar: [] });
        await act(async () => root.render(<App />));
        await input('搜索词汇或输入新内容', 'I have an appointment.');
        await act(async () => button('添加').click());
        await act(async () => button('加入生词本').click());
        expect(mocks.addWord).toHaveBeenCalledOnce();
        expect(mocks.showToast).not.toHaveBeenCalledWith('success', '已加入生词本');
        expect(host.querySelector('[aria-label="单词、短语或句子原文"]')).toBeTruthy();
    });
});
