#!/usr/bin/env bun
// 使用隔离的临时账号验证真实部署；仅清理本脚本创建的账号和数据。
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';

const baseUrl = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) || 'http://127.0.0.1:3001';
const keep = process.argv.includes('--keep-fixture');
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing server configuration');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `codex-qa-${randomUUID()}@example.invalid`;
const password = `${randomUUID()}!aA1`;
let userId: string | undefined;
let retained = false;
let checks = 0;
function check(condition: unknown, name: string) { if (!condition) throw new Error(`Failed: ${name}`); checks++; console.log(`PASS ${name}`); }
async function call(path: string, token: string, method = 'GET', body?: unknown, expected = 200) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
    let data: any; try { data = await response.json(); } catch { throw new Error(`Non-JSON ${path} (${response.status})`); }
    check(response.status === expected, `${method} ${path.split('?')[0]} → ${expected}`);
    check(response.headers.get('cache-control')?.includes('no-store'), 'private response not cached');
    return data;
}
try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('Test account creation failed');
    userId = created.data.user.id;
    const login = await admin.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session) throw new Error('Test login failed');
    // 登录后的 client 会携带用户JWT；另建服务端 client 完成夹具和清理。
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const wordId = randomUUID();
    const seeded = await service.from('words').insert({ id: wordId, user_id: userId, word: 'Besichtigung', meaning: '看房；参观', language: 'de', category: 'daily', example: 'Wann ist die Besichtigung?', example_cn: '什么时候看房？', etymology: 'besichtigen：查看、参观' });
    if (seeded.error) throw new Error('Test word creation failed');
    const jwt = login.data.session.access_token;
    const me = await call('/me', jwt); check(me.data.id === userId, 'authenticated identity');
    const readOnly = await call('/tokens', jwt, 'POST', { name: 'QA read only', scopes: ['vocabulary:read'], expires_in_days: 1 }, 201);
    const readToken = readOnly.data.access_token;
    check(!JSON.stringify(readOnly.data.token).includes('token_hash'), 'token hash stays server-only');
    const words = await call('/words?language=de&limit=1&q=Besichtigung', readToken);
    check(words.data.length === 1 && words.data[0].id === wordId, 'search scoped to fixture');
    const review = await call('/review?language=de&timezone=Europe%2FBerlin', readToken);
    check(review.data[0].word.id === wordId && review.meta.counts.due === 1, 'review initialization and due count');
    await call('/sessions', readToken, 'POST', {}, 403);
    const full = await call('/tokens', jwt, 'POST', { name: 'QA Codex', scopes: ['vocabulary:read', 'practice:write', 'sentences:write'], expires_in_days: 1 }, 201);
    const accessToken = full.data.access_token;
    const sessionId = randomUUID();
    const session = { id: sessionId, language: 'de', mode: 'conversation', topic: '租房沟通（自动化测试）', word_ids: [wordId], target_minutes: 10 };
    await call('/sessions', accessToken, 'POST', session);
    await call('/sessions', accessToken, 'POST', session);
    const event = { id: randomUUID(), word_id: wordId, session_id: sessionId, source: 'codex', grade: 'known', practiced_at: new Date().toISOString(), timezone: 'Europe/Berlin', answer: 'Ich möchte einen Termin für die Besichtigung vereinbaren.', feedback: '表达自然，正确使用目标词。', error_tags: [], hint_count: 0 };
    const first = await call('/events', accessToken, 'POST', event);
    const replay = await call('/events', accessToken, 'POST', event);
    check(!first.data.replayed && replay.data.replayed && first.data.state.reps === replay.data.state.reps, 'retry records one attempt');
    await call('/events', accessToken, 'POST', { ...event, grade: 'forgot' }, 409);
    await call('/events', accessToken, 'POST', { ...event, id: randomUUID(), word_id: randomUUID(), session_id: null }, 404);
    const sentence = { id: randomUUID(), sentence: event.answer, sentence_cn: '我想约一个看房时间。', language: 'de', scene: '租房沟通', source_words: ['Besichtigung'] };
    await call('/sentences', accessToken, 'POST', sentence);
    await call('/sentences', accessToken, 'POST', sentence);
    const detail = await call(`/sessions/${sessionId}`, accessToken);
    check(detail.data.events.length === 1 && detail.data.events[0].word_snapshot.word === 'Besichtigung', 'history includes actual word and one attempt');
    await call(`/sessions/${sessionId}`, accessToken, 'PATCH', { expected_version: detail.data.session.version, status: 'completed', summary: '成功完成看房沟通练习，独立使用 Besichtigung。' });
    await call(`/sessions/${sessionId}`, accessToken, 'PATCH', { expected_version: detail.data.session.version, summary: 'stale' }, 409);
    // 独立 HTTP 请求经 Supabase 的连接池竞争同一词行，验证真实并发重试。
    const concurrentEvent = { ...event, id: randomUUID(), session_id: null, practiced_at: new Date().toISOString() };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => call('/events', accessToken, 'POST', concurrentEvent)));
    check(concurrent.filter(value => !value.data.replayed).length === 1, 'parallel requests apply exactly once');
    check(new Set(concurrent.map(value => value.data.state.reps)).size === 1, 'parallel replay sees one authoritative state');
    // 已有令牌不会自动获得新词写权限；网页登录可以原地授权，无需泄露/重发令牌。
    const newWord = { id: randomUUID(), word: 'appointment', meaning: '预约；约会', language: 'en', example: 'I have an appointment tomorrow.', example_cn: '我明天有个预约。' };
    await call('/words', readToken, 'POST', newWord, 403);
    await call('/words', accessToken, 'POST', newWord, 403);
    const scopes = ['vocabulary:read', 'vocabulary:write', 'practice:write', 'sentences:write'];
    await call(`/tokens/${full.data.token.id}`, accessToken, 'PATCH', { scopes }, 403);
    await call(`/tokens/${full.data.token.id}`, jwt, 'PATCH', { scopes });
    const added = await call('/words', accessToken, 'POST', newWord);
    check(added.data.word === newWord.word && added.meta.created && !added.meta.replayed, 'new word stored with confirmed creation');
    const retriedWord = await call('/words', accessToken, 'POST', newWord);
    check(retriedWord.data.id === added.data.id && retriedWord.meta.replayed, 'word retry keeps one record');
    await call('/words', accessToken, 'POST', { ...newWord, meaning: 'changed' }, 409);
    const duplicate = await call('/words', accessToken, 'POST', { ...newWord, id: randomUUID(), word: 'Appointment', meaning: 'do not overwrite' });
    check(duplicate.data.id === added.data.id && duplicate.data.meaning === newWord.meaning && duplicate.meta.duplicate, 'normalized duplicate returns original unchanged');
    await call('/preferences', accessToken, 'PATCH', { language: 'de', session_size: 1 });
    const batch = await call('/practice-materials', accessToken);
    check(batch.data.length === 3 && batch.meta.selection.sentences === 1, 'materials include words and saved sentences');
    check(batch.data.filter((item: any) => item.kind === 'word').map((item: any) => item.word.language).sort().join(',') === 'de,en', 'default practice has no language filter');
    check(batch.data.find((item: any) => item.kind === 'word').word.id === added.data.id, 'new due word precedes already practiced future word');
    check(batch.meta.selection.due === 1 && batch.meta.selection.ahead === 1 && batch.meta.timezone === 'Europe/Berlin', 'materials report online schedule and timezone');
    const deBatch = await call('/practice-materials?language=de', accessToken);
    check(deBatch.data.every((item: any) => (item.word || item.sentence).language === 'de'), 'explicit language request remains supported');
    const mixedSession = { id: randomUUID(), language: 'mixed', mode: 'cloze', word_ids: [wordId, added.data.id], sentence_ids: [sentence.id] };
    const mixed = await call('/sessions', accessToken, 'POST', mixedSession);
    check(mixed.data.language === 'mixed' && mixed.data.sentence_ids[0] === sentence.id, 'mixed practice preserves sentence targets');
    await call('/sessions', accessToken, 'POST', mixedSession);
    const onlySentences = await call('/sessions', accessToken, 'POST', { id: randomUUID(), language: 'de', mode: 'cloze', sentence_ids: [sentence.id] });
    check(onlySentences.data.word_ids.length === 0, 'sentence practice needs no fabricated word target');
    const parallelWords = Array.from({ length: 3 }, () => ({ id: randomUUID(), word: 'availability', meaning: '可用性；空闲时间', language: 'en' }));
    const savedWords = await Promise.all(parallelWords.map(body => call('/words', accessToken, 'POST', body)));
    check(savedWords.filter(value => value.meta.created).length === 1 && new Set(savedWords.map(value => value.data.id)).size === 1, 'parallel additions create one normalized word');
    await call(`/words/${savedWords[0].data.id}`, accessToken, 'DELETE', undefined, 403);
    await call(`/words/${savedWords[0].data.id}`, jwt, 'PATCH', { example: 'What is your availability?', example_cn: '您什么时候有空？' });
    await call(`/words/${savedWords[0].data.id}`, jwt, 'DELETE');
    await call(`/words/${savedWords[0].data.id}`, jwt, 'DELETE');
    await call('/words', accessToken, 'POST', parallelWords[0], 404);
    const browserSentence = { id: randomUUID(), sentence: 'Ich möchte den Termin ändern.', sentence_cn: '我想更改预约。', language: 'de', source_type: 'input',
        keywords: [{ word: 'Termin', meaning: '预约', partOfSpeech: 'noun' }], grammar: [{ point: '情态动词', explanation: 'möchte 后接动词原形。' }], created_at: '2026-01-01T12:00:00Z' };
    const savedSentence = await call('/sentences', jwt, 'POST', browserSentence);
    check(savedSentence.data.source_type === 'input' && savedSentence.data.keywords[0].word === 'Termin' && savedSentence.data.grammar.length === 1, 'web sentence preserves analysis metadata');
    const retrySentence = await call('/sentences', jwt, 'POST', browserSentence);
    check(retrySentence.data.created_at === savedSentence.data.created_at, 'sentence retry preserves original timestamp');
    await call(`/sentences/${browserSentence.id}`, accessToken, 'DELETE', undefined, 403);
    await call(`/sentences/${browserSentence.id}`, jwt, 'DELETE');
    await call('/sentences', jwt, 'POST', browserSentence, 404);
    await call(`/tokens/${readOnly.data.token.id}`, jwt, 'DELETE');
    await call(`/tokens/${readOnly.data.token.id}`, jwt, 'PATCH', { scopes }, 404);
    await call('/words', readToken, 'GET', undefined, 401);
    if (keep) {
        await mkdir('artifacts', { recursive: true });
        await Bun.write('artifacts/qa-fixture.json', JSON.stringify({ userId, email, session: login.data.session, accessToken, wordId, sessionId, baseUrl }));
        await chmod('artifacts/qa-fixture.json', 0o600);
        await Bun.write('artifacts/browser-login.js', `localStorage.setItem(${JSON.stringify(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`)}, ${JSON.stringify(JSON.stringify(login.data.session))}); 'test session ready';`);
        await chmod('artifacts/browser-login.js', 0o600);
        retained = true;
        console.log('Isolated browser fixture retained in ignored, private artifacts directory.');
    }
    console.log(`Verified ${checks} live checks.`);
} finally {
    if (userId && !retained) {
        const cleanup = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        for (const table of ['saved_sentences', 'words']) { const { error } = await cleanup.from(table).delete().eq('user_id', userId); if (error) console.error(`Fixture cleanup failed: ${table}`); }
        const { error } = await cleanup.auth.admin.deleteUser(userId); if (error) console.error('Fixture account cleanup failed');
    }
}
