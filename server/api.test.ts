// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHandler } from './api';
import { newToken, tokenHash } from './auth';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAT = 'vt_' + 'a'.repeat(43);
type Call = { url: URL; method: string; body: unknown };
let calls: Call[];
let token: Record<string, unknown> | null;
let rows: unknown[];
let rpcError: { code: string; message: string } | null;
let lastInserted: Record<string, unknown>;
let handler: ReturnType<typeof createHandler>;

beforeEach(() => {
    calls = []; rows = []; rpcError = null; lastInserted = {};
    token = { id: EVENT, user_id: USER, scopes: ['vocabulary:read'], expires_at: '2099-01-01T00:00:00Z', revoked_at: null };
    const db = createClient('https://test.supabase.co', 'server-only-test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
            const method = init?.method || 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ url, method, body });
            let data: unknown = rows;
            let status = 200;
            if (url.pathname === '/auth/v1/user') data = { id: USER, email: 'learner@example.test' };
            else if (url.pathname.includes('/rpc/')) { data = rpcError || { event: body?.p_event, state: { word_id: WORD }, replayed: false }; if (rpcError) status = 400; }
            else if (url.pathname.endsWith('/api_access_tokens')) {
                if (method === 'GET') data = url.searchParams.has('token_hash') ? token : [{ id: EVENT, name: 'Codex' }];
                else if (method === 'POST') { lastInserted = body; data = { id: body.id, name: body.name, prefix: body.prefix, scopes: body.scopes }; }
                else data = { id: EVENT };
            } else if (url.pathname.endsWith('/learning_preferences')) data = null;
            return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
        }) as typeof fetch },
    });
    handler = createHandler(() => db);
});

function request(path = 'words', method = 'GET', body?: unknown, bearer: string | null = PAT) {
    return handler(new Request(`https://vocab.example/api/v1/${path}`, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }));
}
const event = () => ({ id: EVENT, word_id: WORD, grade: 'known', source: 'codex', practiced_at: '2026-01-01T12:00:00Z', timezone: 'Europe/Berlin' });

describe('learning API boundary', () => {
    it('requires a credential and does not query the database without one', async () => {
        const response = await request('words', 'GET', undefined, null);
        expect(response.status).toBe(401); expect(calls).toHaveLength(0);
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
    it('rejects revoked, expired and unknown tokens', async () => {
        for (const value of [null, { ...token, revoked_at: '2026-01-01' }, { ...token, expires_at: '2001-01-01' }]) {
            token = value; const response = await request(); expect(response.status).toBe(401);
        }
        expect(calls.some(c => c.url.pathname.endsWith('/words'))).toBe(false);
    });
    it('hashes tokens and always scopes word queries to the authenticated owner', async () => {
        rows = [{ id: WORD, word: 'Haus', user_id: USER }];
        const response = await request('words?language=de&user_id=attacker');
        expect(response.status).toBe(200);
        const lookup = calls.find(c => c.url.searchParams.has('token_hash'))!;
        expect(lookup.url.searchParams.get('token_hash')).toBe(`eq.${tokenHash(PAT)}`);
        const query = calls.find(c => c.url.pathname.endsWith('/words'))!;
        expect(query.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
        expect(query.url.searchParams.get('language')).toBe('eq.de');
        const output = JSON.stringify(await response.json()); expect(output).not.toContain(PAT); expect(output).not.toContain('user_id');
    });
    it('returns stable bounded pagination and handles invalid limits', async () => {
        rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const response = await request('words?limit=2&offset=4');
        expect(await response.json()).toEqual({ data: [{ id: 1 }, { id: 2 }], meta: { has_more: true, next_offset: 6 } });
        expect((await request('words?limit=10000')).status).toBe(400);
        expect((await request('words?limit=1.5')).status).toBe(400);
        expect((await request('words?offset=-1')).status).toBe(400);
    });
    it('keeps punctuation inside quoted search values', async () => {
        await request('words?q=' + encodeURIComponent('Haus",user_id.eq.other'));
        const query = calls.find(c => c.url.pathname.endsWith('/words'))!;
        expect(query.url.searchParams.get('or')).toContain('Haus\\",user\\_id.eq.other');
        expect(query.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
    });
    it('read-only credentials cannot record attempts or manage credentials', async () => {
        expect((await request('events', 'POST', event())).status).toBe(403);
        expect((await request('tokens')).status).toBe(403);
        expect((await request(`tokens/${EVENT}`, 'DELETE')).status).toBe(403);
        expect(calls.some(c => c.url.pathname.includes('/rpc/'))).toBe(false);
    });
    it('generates random one-time tokens and stores only their digest', async () => {
        const response = await request('tokens', 'POST', { name: 'Codex', scopes: ['vocabulary:read'], expires_in_days: 30 }, 'session-jwt');
        expect(response.status).toBe(201);
        const { data } = await response.json();
        expect(data.access_token).toMatch(/^vt_[\w-]{43}$/);
        expect(lastInserted.token_hash).toBe(tokenHash(data.access_token));
        expect(JSON.stringify(lastInserted)).not.toContain(data.access_token);
        expect(JSON.stringify(data.token)).not.toContain('token_hash');
        expect(newToken().raw).not.toBe(newToken().raw);
    });
    it('rejects attempts to assign token owner or unsupported scopes', async () => {
        expect((await request('tokens', 'POST', { name: 'x', scopes: ['admin'] }, 'session-jwt')).status).toBe(400);
        expect((await request('tokens', 'POST', { name: 'x', scopes: ['vocabulary:read'], user_id: WORD }, 'session-jwt')).status).toBe(400);
    });
    it('validates writes before invoking an atomic database operation', async () => {
        token!.scopes = ['vocabulary:read', 'practice:write'];
        expect((await request('events', 'POST', { ...event(), due: '2099-01-01' })).status).toBe(400);
        expect((await request('events', 'POST', { ...event(), word_id: 'broken' })).status).toBe(400);
        expect((await request('events', 'POST', { ...event(), source: 'web' })).status).toBe(400);
        expect(calls.some(c => c.url.pathname.includes('/rpc/'))).toBe(false);
    });
    it('forwards stable event ID and trusted user identity; strips internal data', async () => {
        token!.scopes = ['vocabulary:read', 'practice:write'];
        expect((await request('events', 'POST', event())).status).toBe(200);
        const call = calls.find(c => c.url.pathname.endsWith('/learning_record_event'))!;
        expect(call.body).toMatchObject({ p_user_id: USER, p_event: { id: EVENT, word_id: WORD, hint_count: 0 } });
    });
    it('maps database conflict without leaking SQL or infrastructure details', async () => {
        token!.scopes = ['vocabulary:read', 'practice:write'];
        rpcError = { code: 'PT409', message: 'secret internal SQL details' };
        const response = await request('events', 'POST', event());
        expect(response.status).toBe(409); expect(await response.text()).not.toContain('secret');
    });
    it('rejects malformed JSON and overlong bodies', async () => {
        const malformed = await handler(new Request('https://vocab.example/api/v1/tokens', { method: 'POST', headers: { Authorization: 'Bearer session-jwt', 'Content-Type': 'application/json' }, body: '{' }));
        expect(malformed.status).toBe(400);
        expect((await request('tokens', 'POST', { name: 'a'.repeat(40000) }, 'session-jwt')).status).toBe(413);
    });
    it('uses independent permissions for saving sentences', async () => {
        token!.scopes = ['vocabulary:read', 'practice:write'];
        const body = { id: EVENT, sentence: 'Das Haus ist groß.', language: 'de' };
        expect((await request('sentences', 'POST', body)).status).toBe(403);
        token!.scopes = ['vocabulary:read', 'sentences:write'];
        expect((await request('sentences', 'POST', body)).status).toBe(200);
    });
    it('allows account sessions to record webpage events', async () => {
        expect((await request('events', 'POST', { ...event(), source: 'web' }, 'session-jwt')).status).toBe(200);
    });
    it('returns configuration failures safely', async () => {
        const failing = createHandler(() => { throw new Error('private key'); });
        const response = await failing(new Request('https://vocab.example/api/v1/me'));
        expect(response.status).toBe(500); expect(await response.text()).not.toContain('private');
    });
});
