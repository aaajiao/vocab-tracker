import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, chmod, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ApiClient, ClientError, normalizeApiUrl, prepareBody, redact } from '../../integrations/codex/vocab-review/scripts/client.ts';
import { SecureStore, loadCredentials } from '../../integrations/codex/vocab-review/scripts/storage.ts';
import { currentUser, writeRequest, sendPending } from '../../integrations/codex/vocab-review/scripts/vocab.ts';

const TOKEN = 'vt_test_only_secret_abcdefghijklmnopqrstuvwxyz';
const USER = 'ba022425-0525-4dcc-8806-47c2b8e386b0';
const OTHER_USER = '6599b55e-de14-49c8-bdec-5b0e7b9e9ca0';
const WORD = '1786df3f-0d84-4a9d-ac58-aac31f1ee6b0';
const directories: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

async function store() {
    const dir = await mkdtemp(join(tmpdir(), 'vocab-codex-test-'));
    directories.push(dir);
    return new SecureStore(dir);
}
function server(handler: (request: Request) => Response | Promise<Response>) {
    const instance = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
    servers.push(instance);
    return `http://127.0.0.1:${instance.port}`;
}
function json(data: unknown, status = 200) { return Response.json({ data }, { status }); }
function client(url: string) { return new ApiClient(url, TOKEN, { sleep: async () => {}, timeoutMs: 100 }); }

afterEach(async () => {
    servers.splice(0).forEach(s => s.stop(true));
    await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('transport and authorization', () => {
    test('accepts a secure origin or local development but rejects embedded credentials and other paths', () => {
        expect(normalizeApiUrl('https://example.test/')).toBe('https://example.test/api/v1');
        expect(normalizeApiUrl('http://[::1]:8080/api/v1')).toBe('http://[::1]:8080/api/v1');
        for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/api/other', 'https://example.test/?token=x', 'file:///etc/passwd']) {
            expect(() => normalizeApiUrl(url)).toThrow(ClientError);
        }
    });

    test('sends one bearer to the correct API, preserves paging, and redacts an accidental secret echo', async () => {
        const url = server(request => {
            expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
            expect(new URL(request.url).pathname).toBe('/api/v1/words');
            expect(new URL(request.url).searchParams.get('q')).toBe('für');
            return Response.json({ data: [{ word: 'für', debug: TOKEN }], meta: { has_more: true, next_offset: 20 } });
        });
        const result = await client(url).request('GET', '/words?q=f%C3%BCr');
        expect(result.meta).toEqual({ has_more: true, next_offset: 20 });
        expect(JSON.stringify(result)).not.toContain(TOKEN);
    });

    test('never follows a redirect or sends credentials to its destination', async () => {
        let targetCalls = 0;
        const destination = server(() => { targetCalls++; return json([]); });
        const origin = server(() => new Response(null, { status: 302, headers: { Location: `${destination}/api/v1/words` } }));
        await expect(client(origin).request('GET', '/words')).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });
        expect(targetCalls).toBe(0);
    });

    test.each([401, 403, 409])('does not retry HTTP %s and does not expose server error text', async status => {
        let calls = 0;
        const url = server(() => { calls++; return Response.json({ error: { code: 'DENIED', message: `Bearer ${TOKEN}` } }, { status }); });
        const error = await client(url).request('GET', '/words').catch(e => e);
        expect(calls).toBe(1);
        expect(error.status).toBe(status);
        expect(error.message).not.toContain(TOKEN);
    });

    test('bounded retries preserve the exact POST body and UUID', async () => {
        const bodies: string[] = [];
        const url = server(async request => {
            bodies.push(await request.text());
            return bodies.length < 3 ? new Response('temporary', { status: 503 }) : json({ replayed: true });
        });
        const body = prepareBody('event', { word_id: WORD, grade: 'known' });
        await client(url).request('POST', '/events', body);
        expect(bodies).toHaveLength(3);
        expect(new Set(bodies).size).toBe(1);
        expect(JSON.parse(bodies[0]).id).toBe(body.id);
        expect(JSON.parse(bodies[0]).source).toBe('codex');
    });

    test('PATCH is not automatically retried', async () => {
        let calls = 0;
        const url = server(() => { calls++; return new Response('temporary', { status: 503 }); });
        await expect(client(url).request('PATCH', `/sessions/${WORD}`, { status: 'completed', expected_version: 1 })).rejects.toBeInstanceOf(ClientError);
        expect(calls).toBe(1);
    });

    test('network failures are bounded and transport exception details are redacted', async () => {
        let calls = 0;
        const api = new ApiClient('https://example.test', TOKEN, {
            fetch: (async () => { calls++; throw new Error(`Request with Bearer ${TOKEN} failed`); }) as typeof fetch,
            sleep: async () => {},
        });
        const error = await api.request('GET', '/words').catch(e => e);
        expect(calls).toBe(3);
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.message).not.toContain(TOKEN);
    });
});

describe('recoverable writes and safe local state', () => {
    test('an already connected user can retain an attempted answer when the network disappears before the next write', async () => {
        const local = await store();
        let online = true;
        const api = new ApiClient('https://example.test', TOKEN, {
            fetch: (async () => { if (!online) throw new Error('offline'); return json({ id: USER }); }) as typeof fetch,
            sleep: async () => {},
        });
        await currentUser(api, local);
        online = false;
        const body = prepareBody('event', { word_id: WORD, grade: 'fuzzy', answer: 'A real attempt.' });
        const error = await writeRequest(api, local, 'POST', '/events', body).catch(e => e);
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.requestId).toBe(body.id);
        expect((await local.pending())[0].body.answer).toBe('A real attempt.');
        const otherToken = new ApiClient('https://example.test', 'vt_different_credential_not_yet_verified', {
            fetch: (async () => { throw new Error('offline'); }) as typeof fetch, sleep: async () => {},
        });
        await expect(currentUser(otherToken, local, true)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    test('saves before sending, retains an uncertain write, and replays once with original identity', async () => {
        const local = await store();
        let working = false;
        let calls = 0;
        let eventId = '';
        const url = server(async request => {
            if (request.url.endsWith('/me')) return json({ id: USER });
            calls++;
            const body = await request.json();
            eventId ||= body.id;
            expect(body.id).toBe(eventId);
            const pending = await local.pending();
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe(eventId);
            return working ? json({ event: body, state: { due: '2026-09-26' }, replayed: true }) : new Response('temporary', { status: 503 });
        });
        const api = client(url);
        const body = prepareBody('event', { word_id: WORD, grade: 'known', answer: 'Eine Antwort.' });
        const failure = await writeRequest(api, local, 'POST', '/events', body).catch(e => e);
        expect(failure.requestId).toBe(eventId);
        expect(calls).toBe(3);
        const pending = (await local.pending())[0];
        const pendingPath = join(local.directory, `pending-${eventId}.json`);
        expect((await stat(pendingPath)).mode & 0o777).toBe(0o600);
        expect((await stat(local.directory)).mode & 0o777).toBe(0o700);
        expect(await readFile(pendingPath, 'utf8')).not.toContain(TOKEN);
        working = true;
        const recovered = await sendPending(api, local, pending, USER);
        expect(recovered.request_id).toBe(eventId);
        expect(calls).toBe(4);
        expect(await local.pending()).toHaveLength(0);
    });

    test('cannot replay an outstanding write against another account or origin', async () => {
        const local = await store();
        let calls = 0;
        const url = server(() => { calls++; return json({}); });
        const api = client(url);
        const request = { id: WORD, api_url: api.baseUrl, user_id: USER, method: 'POST' as const, path: '/events', body: { id: WORD }, created_at: new Date().toISOString() };
        await expect(sendPending(api, local, request, OTHER_USER)).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
        await expect(sendPending(api, local, { ...request, api_url: 'https://other.test/api/v1' }, USER)).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
        expect(calls).toBe(0);
    });

    test('refuses accidental duplicate local requests rather than replacing their evidence', async () => {
        const local = await store();
        const url = server(request => request.url.endsWith('/me') ? json({ id: USER }) : new Response('fail', { status: 503 }));
        const api = client(url);
        const body = prepareBody('event', { word_id: WORD, grade: 'fuzzy' });
        await writeRequest(api, local, 'POST', '/events', body).catch(() => {});
        await expect(writeRequest(api, local, 'POST', '/events', { ...body, grade: 'known' })).rejects.toMatchObject({ code: 'REQUEST_PENDING', requestId: body.id });
        expect((await local.pending())[0].body.grade).toBe('fuzzy');
    });

    test('rejects world-readable credentials and requires both environment overrides', async () => {
        const local = await store();
        await local.write('config.json', { api_url: 'https://example.test/api/v1', storage: 'file' });
        await local.write('credentials.json', { api_url: 'https://example.test/api/v1', token: TOKEN });
        expect((await loadCredentials(local, {})).token).toBe(TOKEN);
        await chmod(join(local.directory, 'credentials.json'), 0o644);
        await expect(loadCredentials(local, {})).rejects.toMatchObject({ code: 'UNSAFE_STORAGE' });
        await expect(loadCredentials(local, { VOCAB_API_URL: 'https://example.test' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    });

    test('writes only minimal session handles after a confirmed start', async () => {
        const local = await store();
        const url = server(request => request.url.endsWith('/me') ? json({ id: USER }) : json({ id: WORD, version: 1, status: 'active', topic: 'private topic', word_ids: [WORD] }));
        await writeRequest(client(url), local, 'POST', '/sessions', { id: WORD, language: 'de', word_ids: [WORD] });
        const handle = JSON.parse(await readFile(join(local.directory, `session-${WORD}.json`), 'utf8'));
        expect(Object.keys(handle).sort()).toEqual(['api_url', 'id', 'status', 'user_id', 'version']);
        expect(await local.pending()).toHaveLength(0);
    });
});

describe('CLI and installer', () => {
    test('reads JSON stdin and prints neither token nor unexpected API error content', async () => {
        const local = await store();
        const url = server(request => request.url.endsWith('/me') ? json({ id: USER }) : Response.json({ error: { code: 'INVALID', message: TOKEN } }, { status: 409 }));
        const child = Bun.spawn(['bun', resolve('integrations/codex/vocab-review/scripts/vocab.ts'), 'event', '--json', '-'], {
            env: { ...process.env, VOCAB_API_URL: url, VOCAB_API_TOKEN: TOKEN, VOCAB_CONFIG_DIR: local.directory },
            stdin: new Blob([JSON.stringify({ word_id: WORD, grade: 'known' })]), stdout: 'pipe', stderr: 'pipe',
        });
        const output = await new Response(child.stdout).text();
        const error = await new Response(child.stderr).text();
        expect(await child.exited).toBe(1);
        expect(output + error).not.toContain(TOKEN);
        expect(JSON.parse(error).error.request_id).toBeDefined();
        expect(await local.pending()).toHaveLength(1);
    });

    test('refuses token CLI arguments and noninteractive configure', async () => {
        for (const args of [['configure', '--url', 'https://example.test', '--token', TOKEN], ['configure', '--url', 'https://example.test', '--storage', 'file']]) {
            const child = Bun.spawn(['bun', resolve('integrations/codex/vocab-review/scripts/vocab.ts'), ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
            const stdout = await new Response(child.stdout).text();
            const stderr = await new Response(child.stderr).text();
            expect(await child.exited).toBe(1);
            expect(stdout + stderr).not.toContain(TOKEN);
        }
    });

    test('installer is repeatable and does not create credentials', async () => {
        const local = await store();
        for (let i = 0; i < 2; i++) {
            const child = Bun.spawn(['bun', resolve('scripts/install-codex-skill.ts'), '--destination', local.directory], { stdout: 'pipe', stderr: 'pipe' });
            expect(await child.exited).toBe(0);
            const output = JSON.parse(await new Response(child.stdout).text());
            expect(output.installed).toBe(join(local.directory, 'vocab-review'));
        }
        expect(await readdir(local.directory)).toEqual(['vocab-review']);
        expect(await readFile(join(local.directory, 'vocab-review', 'SKILL.md'), 'utf8')).toContain('name: vocab-review');
        expect(redact(`failure Bearer ${TOKEN}`, TOKEN)).not.toContain(TOKEN);
    });

    test('installer refuses an unrelated local skill without changing its files', async () => {
        const local = await store();
        await mkdir(join(local.directory, 'vocab-review'));
        await writeFile(join(local.directory, 'vocab-review', 'SKILL.md'), 'My separately maintained skill.');
        const child = Bun.spawn(['bun', resolve('scripts/install-codex-skill.ts'), '--destination', local.directory], { stdout: 'pipe', stderr: 'pipe' });
        expect(await child.exited).toBe(1);
        expect(await readFile(join(local.directory, 'vocab-review', 'SKILL.md'), 'utf8')).toBe('My separately maintained skill.');
        expect(await readdir(local.directory)).toEqual(['vocab-review']);
    });

    test('installer keeps the complete previous managed version including manual additions', async () => {
        const local = await store();
        const invoke = async () => {
            const child = Bun.spawn(['bun', resolve('scripts/install-codex-skill.ts'), '--destination', local.directory], { stdout: 'pipe', stderr: 'pipe' });
            expect(await child.exited).toBe(0);
            return JSON.parse(await new Response(child.stdout).text());
        };
        await invoke();
        await writeFile(join(local.directory, 'vocab-review', 'personal-notes.txt'), 'Preserve my notes.');
        await writeFile(join(local.directory, 'vocab-review', 'SKILL.md'), 'My local editing.');
        const update = await invoke();
        expect(update.previous_version_backup).toBeDefined();
        expect(await readFile(join(update.previous_version_backup, 'personal-notes.txt'), 'utf8')).toBe('Preserve my notes.');
        expect(await readFile(join(update.previous_version_backup, 'SKILL.md'), 'utf8')).toBe('My local editing.');
        expect(await readFile(join(local.directory, 'vocab-review', 'SKILL.md'), 'utf8')).toContain('name: vocab-review');
        const repeated = await invoke();
        expect(repeated.changed).toBe(false);
        expect(repeated.previous_version_backup).toBeUndefined();
    });
});
