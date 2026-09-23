import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SecureStore } from '../../integrations/codex/vocab-review/scripts/storage.ts';

const TOKEN = 'vt_test_materials_not_a_real_credential_abcdefgh';
const USER = '6114a13c-82e2-4a40-83c2-b41e842050dc';
const WORD = 'ead1e16b-92c3-4a5e-9eb4-3d2278b10313';
const SENTENCE = 'b8b4a0c7-d501-4b33-ae9d-744c45691a07';
const directories: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
    servers.splice(0).forEach(server => server.stop(true));
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(handler: (request: Request) => Response | Promise<Response>) {
    const directory = await mkdtemp(join(tmpdir(), 'vocab-materials-test-'));
    directories.push(directory);
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
    servers.push(server);
    const invoke = async (args: string[], body?: unknown) => {
        const child = Bun.spawn(['bun', resolve('integrations/codex/vocab-review/scripts/vocab.ts'), ...args], {
            env: { ...process.env, VOCAB_API_URL: `http://127.0.0.1:${server.port}`, VOCAB_API_TOKEN: TOKEN, VOCAB_CONFIG_DIR: directory },
            stdin: body === undefined ? 'ignore' : new Blob([JSON.stringify(body)]), stdout: 'pipe', stderr: 'pipe',
        });
        const stdout = await new Response(child.stdout).text();
        const stderr = await new Response(child.stderr).text();
        return { code: await child.exited, output: stdout ? JSON.parse(stdout) : null, error: stderr ? JSON.parse(stderr) : null };
    };
    return { invoke, store: new SecureStore(directory) };
}

test('materials defaults to ten with no language filter and preserves authoritative SRS selection', async () => {
    const requests: string[] = [];
    const materials = [
        { kind: 'word', word: { id: WORD, word: 'die Zusage', language: 'de' }, state: { due: '2026-09-21', reps: 2 } },
        { kind: 'sentence', sentence: { id: SENTENCE, sentence: 'I look forward to it.', language: 'en' } },
    ];
    const meta = { available: 2, count: 2, words_available: 1, sentences_available: 1, selection: { due: 1, ahead: 0, sentences: 1 }, timezone: 'Europe/Berlin' };
    const { invoke } = await fixture(request => {
        requests.push(new URL(request.url).pathname);
        expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
        expect(new URL(request.url).pathname).toBe('/api/v1/practice-materials');
        expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({ limit: '10' });
        return Response.json({ data: materials, meta });
    });
    const result = await invoke(['materials']);
    expect(result.code).toBe(0);
    expect(result.output).toEqual({ data: materials, meta });
    expect(requests).toEqual(['/api/v1/practice-materials']);
});

test('materials forwards only explicit language, count, and timezone choices', async () => {
    const { invoke } = await fixture(request => {
        expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({ limit: '4', language: 'en', timezone: 'Asia/Shanghai' });
        return Response.json({ data: [], meta: { available: 0, count: 0 } });
    });
    expect((await invoke(['materials', '--language', 'en', '--limit', '4', '--timezone', 'Asia/Shanghai'])).code).toBe(0);
    const invalid = await invoke(['materials', '--offset', '20']);
    expect(invalid.code).toBe(1);
    expect(invalid.error.error.code).toBe('INVALID_ARGUMENT');
});

test('add-word uses one stable UUID through a retry, preserves German casing, and creates no review event', async () => {
    const requests: string[] = [];
    const bodies: string[] = [];
    const { invoke, store } = await fixture(async request => {
        const path = new URL(request.url).pathname;
        requests.push(path);
        if (path === '/api/v1/me') return Response.json({ data: { id: USER, scopes: ['vocabulary:read', 'vocabulary:write'] } });
        expect(path).toBe('/api/v1/words');
        expect(request.method).toBe('POST');
        bodies.push(await request.text());
        if (bodies.length === 1) return Response.json({ error: { code: 'unavailable' } }, { status: 503 });
        return Response.json({ data: JSON.parse(bodies[0]), meta: { created: true, duplicate: false, replayed: false } });
    });
    const result = await invoke(['add-word', '--json', '-'], { word: 'die Zusage', meaning: '肯定答复；承诺', language: 'de' });
    expect(result.code).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(new Set(bodies).size).toBe(1);
    const body = JSON.parse(bodies[0]);
    expect(body.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body).toMatchObject({ word: 'die Zusage', meaning: '肯定答复；承诺', language: 'de', category: '' });
    expect(body.date).toBeUndefined();
    expect(result.output.request_id).toBe(body.id);
    expect(result.output.meta.created).toBe(true);
    expect(requests).toEqual(['/api/v1/me', '/api/v1/words', '/api/v1/words']);
    expect(await store.pending()).toHaveLength(0);
});

test('duplicate add-word keeps the server existing word ID and duplicate metadata', async () => {
    const { invoke } = await fixture(request => {
        if (request.url.endsWith('/me')) return Response.json({ data: { id: USER } });
        return Response.json({ data: { id: WORD, word: 'die Zusage', language: 'de', meaning: '已存在的释义' }, meta: { created: false, duplicate: true, replayed: false } });
    });
    const result = await invoke(['add-word', '--json', '-'], { word: 'DIE ZUSAGE', meaning: '答复', language: 'de' });
    expect(result.code).toBe(0);
    expect(result.output.data.id).toBe(WORD);
    expect(result.output.meta).toEqual({ created: false, duplicate: true, replayed: false });
    expect(result.output.data.meaning).toBe('已存在的释义');
});

test('add-word permission failure is reported once and the original request remains recoverable', async () => {
    let writes = 0;
    const { invoke, store } = await fixture(request => {
        if (request.url.endsWith('/me')) return Response.json({ data: { id: USER } });
        writes++;
        return Response.json({ error: { code: 'insufficient_scope', message: 'vocabulary:write required' } }, { status: 403 });
    });
    const result = await invoke(['add-word', '--json', '-'], { word: 'promise', meaning: '承诺', language: 'en' });
    expect(result.code).toBe(1);
    expect(result.output).toBeNull();
    expect(result.error.error.code).toBe('insufficient_scope');
    expect(writes).toBe(1);
    const pending = await store.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].path).toBe('/words');
    expect(pending[0].id).toBe(result.error.error.request_id);
    expect(pending[0].body.word).toBe('promise');
});

test('start supports mixed materials and sentence-only sessions without fabricating word IDs', async () => {
    const starts: Record<string, unknown>[] = [];
    const { invoke } = await fixture(async request => {
        if (request.url.endsWith('/me')) return Response.json({ data: { id: USER } });
        expect(new URL(request.url).pathname).toBe('/api/v1/sessions');
        const body = await request.json();
        starts.push(body);
        return Response.json({ data: { ...body, version: 1, status: 'active' } });
    });
    const mixed = await invoke(['start', '--json', '-'], { language: 'mixed', mode: 'conversation', word_ids: [WORD.toUpperCase()], sentence_ids: [SENTENCE.toUpperCase()] });
    const sentences = await invoke(['start', '--json', '-'], { language: 'en', mode: 'cloze', word_ids: [], sentence_ids: [SENTENCE] });
    expect(mixed.code).toBe(0);
    expect(sentences.code).toBe(0);
    expect(starts[0]).toMatchObject({ language: 'mixed', word_ids: [WORD], sentence_ids: [SENTENCE] });
    expect(starts[1]).toMatchObject({ language: 'en', word_ids: [], sentence_ids: [SENTENCE] });
    expect(starts[0].target_minutes).toBeUndefined();
});
