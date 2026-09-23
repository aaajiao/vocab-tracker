// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
type Row = Record<string, unknown>;
const sentence = (patch: Row = {}): Row & { id: string } => ({ id: randomUUID(), sentence: 'Das Haus ist groß.', sentence_cn: '这房子很大。', language: 'de', scene: '', source_words: ['Haus'], ...patch });
async function save(payload: Row, owner = OWNER) {
    const result = await db.query<{ result: Row }>('SELECT public.learning_save_sentence($1,$2) AS result', [owner, payload]);
    return result.rows[0].result;
}
beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;`);
    const canonical = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../../supabase/migrations/20260923180008_browser_material_reliability.sql', import.meta.url), 'utf8');
    expect(canonical).toContain(migration);
    await db.exec(canonical.slice(0, canonical.indexOf('-- 7. 网页词句可靠写入')));
    await db.exec(migration);
}, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
    await db.exec(`RESET ROLE; TRUNCATE auth.users CASCADE; INSERT INTO auth.users(id) VALUES('${OWNER}'),('${OTHER}'); SET ROLE service_role;`);
});

it('preserves full sentence metadata and replays one row with the original date', async () => {
    const payload = sentence({ source_type: 'input', created_at: '2026-01-02T10:00:00Z',
        keywords: [{ word: 'Haus', meaning: '房子', partOfSpeech: 'noun' }], grammar: [{ point: '主系表', explanation: 'ist 连接主语和形容词。' }] });
    const first = await save(payload);
    expect(first).toMatchObject({ source_type: 'input', keywords: payload.keywords, grammar: payload.grammar });
    expect(Date.parse(String(first.created_at))).toBe(Date.parse(String(payload.created_at)));
    expect(await save(payload)).toEqual(first);
    expect((await db.query('SELECT * FROM public.saved_sentences')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM public.sentence_write_requests')).rows).toHaveLength(1);
    await expect(save({ ...payload, grammar: [] })).rejects.toMatchObject({ code: 'PT409' });
});
it('keeps omitted created_at stable across retries and rejects replay after deletion', async () => {
    const payload = sentence();
    const first = await save(payload);
    expect(await save(payload)).toEqual(first);
    await db.query('DELETE FROM public.saved_sentences WHERE id=$1', [payload.id]);
    await expect(save(payload)).rejects.toMatchObject({ code: 'PT404' });
    expect((await db.query('SELECT * FROM public.saved_sentences')).rows).toHaveLength(0);
    expect(await save({ ...payload, id: randomUUID() })).toMatchObject({ sentence: payload.sentence });
});
it('accepts an equivalent legacy row without overwriting it', async () => {
    const payload = sentence();
    await db.query(`INSERT INTO public.saved_sentences(id,user_id,sentence,sentence_cn,language,scene,source_type,source_words)
        VALUES($1,$2,$3,$4,'de','','combined',$5)`, [payload.id, OWNER, payload.sentence, payload.sentence_cn, JSON.stringify(payload.source_words)]);
    expect(await save(payload)).toMatchObject({ id: payload.id, source_type: 'combined' });
    expect((await db.query('SELECT * FROM public.sentence_write_requests')).rows).toHaveLength(1);
});
it('rejects foreign IDs and malformed analysis without creating partial rows', async () => {
    const payload = sentence();
    await save(payload);
    await expect(save(payload, OTHER)).rejects.toMatchObject({ code: 'PT409' });
    for (const patch of [{ keywords: [{ word: 'Haus' }] }, { grammar: [{ point: 'x' }] }, { source_type: 'other' }, { created_at: 'invalid' }, { keywords: [null] }, { keywords: [{ word: null, meaning: 'x' }] }]) {
        await expect(save(sentence(patch))).rejects.toMatchObject({ code: 'PT400' });
    }
    expect((await db.query('SELECT * FROM public.saved_sentences')).rows).toHaveLength(1);
});
it('keeps receipts and the mutation RPC unavailable to browser database roles', async () => {
    for (const role of ['anon', 'authenticated']) {
        await db.exec(`RESET ROLE; SET ROLE ${role};`);
        await expect(db.query('SELECT * FROM public.sentence_write_requests')).rejects.toMatchObject({ code: '42501' });
        await expect(save(sentence())).rejects.toMatchObject({ code: '42501' });
    }
    await db.exec('RESET ROLE; SET ROLE service_role');
});
