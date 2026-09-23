import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { learningApi, learningRequest, learningErrorMessage } from './learningApi';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: { auth } }));

function session(userId = 'user-a', token = 'session-token') {
    return { data: { session: { user: { id: userId }, access_token: token } }, error: null };
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('learning API transport', () => {
    const fetchMock = vi.fn<typeof fetch>();

    beforeEach(() => {
        vi.clearAllMocks();
        auth.getSession.mockResolvedValue(session());
        auth.refreshSession.mockResolvedValue(session('user-a', 'refreshed-token'));
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockResolvedValue(json({ data: [] }));
    });

    afterEach(() => vi.unstubAllGlobals());

    it('uses same-origin session authorization and excludes secrets from URLs and storage', async () => {
        const storage = vi.spyOn(Storage.prototype, 'setItem');
        await learningApi.createToken('user-a', { name: '学习', scopes: ['vocabulary:read'], expires_in_days: 30 });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/v1/tokens');
        expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error' });
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer session-token', 'Content-Type': 'application/json' });
        expect(JSON.parse(init?.body as string)).toEqual({ name: '学习', scopes: ['vocabulary:read'], expires_in_days: 30 });
        expect(storage).not.toHaveBeenCalled();
        storage.mockRestore();
    });

    it('rejects missing sessions before sending any request', async () => {
        auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects stale views after the signed-in account changes', async () => {
        await expect(learningApi.getTokens('user-b')).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes an expired access token once and preserves the request', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: { code: 'unauthorized' } }, 401)).mockResolvedValueOnce(json({ data: ['saved'] }));
        await expect(learningApi.getTokens('user-a')).resolves.toEqual({ data: ['saved'] });
        expect(auth.refreshSession).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer refreshed-token' });
    });

    it('does not send refreshed credentials when refresh changed accounts', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: { code: 'unauthorized' } }, 401));
        auth.refreshSession.mockResolvedValueOnce(session('user-b', 'different-account-secret'));
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not refresh after the account signs out during the first request', async () => {
        auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce({ data: { session: null }, error: null });
        fetchMock.mockResolvedValueOnce(json({ error: { code: 'unauthorized' } }, 401));
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ status: 401 });
        expect(auth.refreshSession).not.toHaveBeenCalled();
    });

    it('stops after a second unauthorized response instead of looping', async () => {
        fetchMock.mockImplementation(async () => json({ error: { code: 'unauthorized' } }, 401));
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(auth.refreshSession).toHaveBeenCalledOnce();
    });

    it('does not retry a write after ambiguous network failure', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('connection ended after server committed'));
        await expect(learningApi.createToken('user-a', { name: 'test', scopes: ['vocabulary:read'], expires_in_days: 7 })).rejects.toMatchObject({ code: 'network_error' });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(auth.refreshSession).not.toHaveBeenCalled();
    });

    it('does not surface raw server errors or secrets', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: { code: 'internal_error', message: 'secret-database-password' } }, 500));
        try {
            await learningApi.getTokens('user-a');
        } catch (error) {
            expect(learningErrorMessage(error)).toBe('学习服务暂时不可用，请稍后再试。');
            expect(String(error)).not.toContain('secret-database-password');
        }
    });

    it('rejects an HTML fallback that would otherwise appear successful', async () => {
        fetchMock.mockResolvedValueOnce(new Response('<html>SPA index</html>', { status: 200 }));
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('keeps pagination metadata', async () => {
        fetchMock.mockResolvedValueOnce(json({ data: [], meta: { has_more: true, next_offset: 20 } }));
        await expect(learningApi.getSessions('user-a', 10)).resolves.toMatchObject({ meta: { next_offset: 20 } });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/sessions?limit=10&offset=10');
    });

    it('honors cancellation after auth resolution before fetch', async () => {
        const controller = new AbortController();
        auth.getSession.mockImplementationOnce(async () => { controller.abort(); return session(); });
        await expect(learningApi.getTokens('user-a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('loads every token page so older active connections stay revocable', async () => {
        fetchMock.mockResolvedValueOnce(json({ data: [{ id: 'newer' }], meta: { has_more: true, next_offset: 100 } }))
            .mockResolvedValueOnce(json({ data: [{ id: 'older' }], meta: { has_more: false } }));
        await expect(learningApi.getTokens('user-a')).resolves.toEqual({ data: [{ id: 'newer' }, { id: 'older' }] });
        expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tokens?limit=100&offset=100');
    });

    it('rejects nonadvancing token pagination instead of looping', async () => {
        fetchMock.mockResolvedValueOnce(json({ data: [], meta: { has_more: true, next_offset: 0 } }));
        await expect(learningApi.getTokens('user-a')).rejects.toMatchObject({ code: 'invalid_response' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects external paths before reading credentials', async () => {
        await expect(learningRequest('https://external.example/tokens')).rejects.toMatchObject({ code: 'invalid_path' });
        await expect(learningRequest('//external.example/tokens')).rejects.toMatchObject({ code: 'invalid_path' });
        expect(auth.getSession).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
