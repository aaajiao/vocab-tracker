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
let rpcResult: unknown;
let preferenceRow: Record<string, unknown> | null;
let lastInserted: Record<string, unknown>;
let handler: ReturnType<typeof createHandler>;

beforeEach(() => {
    calls = []; rows = []; rpcError = null; rpcResult = undefined; preferenceRow = null; lastInserted = {};
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
            else if (url.pathname.includes('/rpc/')) { data = rpcError || rpcResult || { event: body?.p_event, state: { word_id: WORD }, replayed: false }; if (rpcError) status = 400; }
            else if (url.pathname.endsWith('/api_access_tokens')) {
                if (method === 'GET') data = url.searchParams.has('token_hash') ? token : [{ id: EVENT, name: 'Codex' }];
                else if (method === 'POST') { lastInserted = body; data = { id: body.id, name: body.name, prefix: body.prefix, scopes: body.scopes }; }
                else if (body?.scopes) data = token && !token.revoked_at && Date.parse(String(token.expires_at)) > Date.now()
                    && url.searchParams.get('id') === `eq.${token.id}` ? { ...token, scopes: body.scopes } : null;
                else data = { id: EVENT };
            } else if (url.pathname.endsWith('/learning_preferences')) data = preferenceRow;
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
    it('keeps browser deletion owner-scoped and idempotent without granting delete to add-only tokens', async () => {
        token!.scopes = ['vocabulary:read', 'vocabulary:write', 'sentences:write'];
        expect((await request(`words/${WORD}`, 'DELETE')).status).toBe(403);
        expect((await request(`sentences/${WORD}`, 'DELETE')).status).toBe(403);
        for (const kind of ['words', 'sentences']) {
            expect((await request(`${kind}/${WORD}`, 'DELETE', undefined, 'session-jwt')).status).toBe(200);
            expect((await request(`${kind}/${WORD}`, 'DELETE', undefined, 'session-jwt')).status).toBe(200);
        }
        const deletes = calls.filter(call => call.method === 'DELETE');
        expect(deletes).toHaveLength(4);
        deletes.forEach(call => {
            expect(call.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
            expect(call.url.searchParams.get('id')).toBe(`eq.${WORD}`);
        });
    });
    it('validates browser example edits and preserves ownership', async () => {
        expect((await request(`words/${WORD}`, 'PATCH', { example: 'Hello' })).status).toBe(403);
        expect((await request(`words/${WORD}`, 'PATCH', { user_id: WORD }, 'session-jwt')).status).toBe(400);
        expect((await request(`words/${WORD}`, 'PATCH', {}, 'session-jwt')).status).toBe(400);
        rows = [{ id: WORD, word: 'Haus', example: 'Das Haus.', user_id: USER }];
        const response = await request(`words/${WORD}`, 'PATCH', { example: 'Das Haus.', example_cn: '这所房子。' }, 'session-jwt');
        expect(response.status).toBe(200);
        const update = calls.find(call => call.method === 'PATCH' && call.url.pathname.endsWith('/words'))!;
        expect(update.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
        expect(update.body).toEqual({ example: 'Das Haus.', example_cn: '这所房子。' });
        expect(JSON.stringify(await response.json())).not.toContain('user_id');
    });
    it('preserves sentence analysis and original timestamp through the shared API', async () => {
        const body = { id: EVENT, sentence: 'Das Haus ist groß.', sentence_cn: '这房子很大。', language: 'de',
            source_type: 'input', keywords: [{ word: 'Haus', meaning: '房子', partOfSpeech: 'noun' }],
            grammar: [{ point: '主系表', explanation: 'ist 连接主语与形容词。' }], created_at: '2026-09-01T12:00:00+02:00' };
        expect((await request('sentences', 'POST', body, 'session-jwt')).status).toBe(200);
        const call = calls.find(call => call.url.pathname.endsWith('/learning_save_sentence'))!;
        expect(call.body).toMatchObject({ p_user_id: USER, p_sentence: { ...body, created_at: '2026-09-01T10:00:00.000Z' } });
        for (const patch of [{ keywords: [{ word: 'Haus' }] }, { grammar: [{ point: 'x', explanation: 'x', injection: 'y' }] }, { created_at: 'yesterday' }]) {
            expect((await request('sentences', 'POST', { ...body, ...patch }, 'session-jwt')).status).toBe(400);
        }
    });
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

    it('defaults mixed practice to 10 and never applies old language or size preferences', async () => {
        preferenceRow = { language: 'de', session_size: 1, timezone: 'Pacific/Honolulu' };
        rpcResult = { data: [
            { kind: 'word', word: { id: WORD, language: 'en', user_id: USER }, state: { due: '2026-01-01', user_id: USER } },
            { kind: 'sentence', sentence: { id: EVENT, language: 'de', user_id: USER } },
        ], meta: { available: 200, count: 2, words_available: 190, sentences_available: 10,
            selection: { due: 1, ahead: 0, sentences: 1 }, timezone: 'Pacific/Honolulu' } };
        const response = await request('practice-materials');
        expect(response.status).toBe(200);
        const call = calls.find(c => c.url.pathname.endsWith('/learning_get_practice_materials'))!;
        expect(call.body).toEqual({ p_user_id: USER, p_language: null, p_timezone: 'Pacific/Honolulu', p_limit: 10 });
        const output = await response.json();
        expect(output.meta.selection).toEqual({ due: 1, ahead: 0, sentences: 1 });
        expect(JSON.stringify(output)).not.toContain('user_id');
    });

    it('only filters practice language when explicitly requested and validates sample bounds', async () => {
        rpcResult = { data: [], meta: { available: 0, count: 0 } };
        expect((await request('practice-materials?language=en&limit=8&timezone=UTC')).status).toBe(200);
        expect(calls.find(c => c.url.pathname.endsWith('/learning_get_practice_materials'))?.body)
            .toEqual({ p_user_id: USER, p_language: 'en', p_timezone: 'UTC', p_limit: 8 });
        for (const query of ['language=mixed', 'limit=0', 'limit=101', 'offset=10', 'timezone=Invalid/Zone']) {
            expect((await request(`practice-materials?${query}`)).status).toBe(400);
        }
    });

    it('requires vocabulary:write separately and preserves the immutable add-word input', async () => {
        const word = { id: EVENT, word: '  Straße  ', meaning: '街道', language: 'de' };
        token!.scopes = ['vocabulary:read', 'practice:write', 'sentences:write'];
        expect((await request('words', 'POST', word)).status).toBe(403);
        token!.scopes = ['vocabulary:read', 'vocabulary:write'];
        rpcResult = { word: { id: EVENT, word: 'Straße', meaning: '街道', user_id: USER }, created: true, duplicate: false, replayed: false };
        const response = await request('words', 'POST', word);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { id: EVENT, word: 'Straße', meaning: '街道' }, meta: { created: true, duplicate: false, replayed: false } });
        const call = calls.find(c => c.url.pathname.endsWith('/learning_save_word'))!;
        expect(call.body).toEqual({ p_user_id: USER, p_word: { id: EVENT, word: 'Straße', meaning: '街道', language: 'de', example: '', example_cn: '', category: '', etymology: '' } });
        expect((call.body as { p_word: Record<string, unknown> }).p_word).not.toHaveProperty('date');
    });

    it('returns duplicate metadata and rejects invalid word dates, ownership and category', async () => {
        token!.scopes = ['vocabulary:read', 'vocabulary:write'];
        const word = { id: EVENT, word: 'HAUS', meaning: '房屋', language: 'de' };
        rpcResult = { word: { id: WORD, word: 'Haus', meaning: '房子' }, created: false, duplicate: true, replayed: true };
        const response = await request('words', 'POST', word);
        expect(await response.json()).toEqual({ data: { id: WORD, word: 'Haus', meaning: '房子' }, meta: { created: false, duplicate: true, replayed: true } });
        const rpcCount = () => calls.filter(c => c.url.pathname.includes('/rpc/')).length;
        const count = rpcCount();
        for (const changes of [{ date: '2026-02-30' }, { date: '20260210' }, { category: 'wrong' }, { user_id: WORD }, { word: '' }]) {
            expect((await request('words', 'POST', { ...word, ...changes })).status).toBe(400);
        }
        expect(rpcCount()).toBe(count);
    });

    it('only the website session can change scopes of an active own token', async () => {
        const body = { scopes: ['vocabulary:read', 'vocabulary:write', 'practice:write', 'sentences:write'] };
        expect((await request(`tokens/${EVENT}`, 'PATCH', body)).status).toBe(403);
        const response = await request(`tokens/${EVENT}`, 'PATCH', body, 'session-jwt');
        expect(response.status).toBe(200);
        expect((await response.json()).data.scopes).toEqual(body.scopes);
        const update = calls.find(c => c.method === 'PATCH' && (c.body as Record<string, unknown>)?.scopes)!;
        expect(update.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
        expect(update.url.searchParams.get('revoked_at')).toBe('is.null');
        expect(update.url.searchParams.get('expires_at')).toMatch(/^gt\./);
        expect(update.body).toEqual(body);
        expect((await request(`tokens/${WORD}`, 'PATCH', body, 'session-jwt')).status).toBe(404);
        token!.revoked_at = '2026-01-01';
        expect((await request(`tokens/${EVENT}`, 'PATCH', body, 'session-jwt')).status).toBe(404);
        token!.revoked_at = null; token!.expires_at = '2001-01-01';
        expect((await request(`tokens/${EVENT}`, 'PATCH', body, 'session-jwt')).status).toBe(404);
        expect((await request(`tokens/${EVENT}`, 'PATCH', { scopes: ['admin'] }, 'session-jwt')).status).toBe(400);
    });

    it('issues four-scope tokens and accepts mixed or sentence-only sessions without invented words', async () => {
        const scopes = ['vocabulary:read', 'vocabulary:write', 'practice:write', 'sentences:write'];
        expect((await request('tokens', 'POST', { name: 'Full practice', scopes }, 'session-jwt')).status).toBe(201);
        expect(lastInserted.scopes).toEqual(scopes);
        token!.scopes = scopes;
        const common = { id: EVENT, language: 'mixed', mode: 'conversation', sentence_ids: [EVENT] };
        expect((await request('sessions', 'POST', common)).status).toBe(200);
        const call = calls.find(c => c.url.pathname.endsWith('/learning_create_session'))!;
        expect(call.body).toMatchObject({ p_user_id: USER, p_session: { language: 'mixed', word_ids: [], sentence_ids: [EVENT] } });
        expect((await request('sessions', 'POST', { ...common, word_ids: [WORD] })).status).toBe(200);
        expect((await request('sessions', 'POST', { ...common, sentence_ids: [] })).status).toBe(400);
        expect((await request('sessions', 'POST', { ...common, sentence_ids: [EVENT, EVENT] })).status).toBe(400);
        rows = [{ id: EVENT, language: 'mixed', sentence_ids: [WORD] }];
        expect((await request('sessions')).status).toBe(200);
        expect(calls.find(c => c.method === 'GET' && c.url.pathname.endsWith('/practice_sessions'))?.url.searchParams.get('select')).toContain('sentence_ids');
    });
});
