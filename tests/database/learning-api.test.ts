// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyGrade, initReviewState, type ReviewGrade } from '../../src/services/srs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WORD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_WORD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: PGlite;

type Row = Record<string, unknown>;
interface State extends Row {
    word_id: string;
    user_id: string;
    due: string;
    interval_days: number;
    ease: number;
    reps: number;
    lapses: number;
    last_reviewed_at: string | null;
    updated_at: string;
}
interface EventResult {
    event: Row & { scheduling_applied: boolean; word_snapshot: Row };
    state: State | null;
    replayed: boolean;
}
interface ReviewResult {
    data: { word: Row; state: State }[];
    meta: { has_more: boolean; next_offset: number | null; counts: Record<string, number> };
}

async function call<T>(name: string, args: unknown[]): Promise<T> {
    const params = args.map((_, i) => `$${i + 1}`).join(',');
    const result = await db.query<{ result: T }>(`SELECT public.${name}(${params}) AS result`, args);
    return result.rows[0].result;
}
function event(overrides: Row = {}): Row {
    return { id: randomUUID(), word_id: WORD, grade: 'known', source: 'codex',
        practiced_at: '2025-06-15T12:00:00Z', timezone: 'Europe/Berlin', ...overrides };
}
function session(overrides: Row = {}): Row {
    return { id: randomUUID(), language: 'de', mode: 'conversation', topic: '租房',
        word_ids: [WORD], target_minutes: 10, ...overrides };
}
async function record(payload: Row, user = OWNER) {
    return call<EventResult>('learning_record_event', [user, payload]);
}
async function queryReview(overrides: Partial<{ language: string; mode: string; timezone: string; limit: number; offset: number }> = {}) {
    return call<ReviewResult>('learning_get_review', [OWNER, overrides.language ?? null, overrides.mode ?? 'due',
        overrides.timezone ?? 'Europe/Berlin', overrides.limit ?? 20, overrides.offset ?? 0]);
}
async function asRole<T>(role: 'anon' | 'authenticated', run: () => Promise<T>): Promise<T> {
    await db.exec(`RESET ROLE; SET ROLE ${role};`);
    try { return await run(); }
    finally { await db.exec('RESET ROLE; SET ROLE service_role;'); }
}

beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
        SET timezone = 'UTC';
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    `);
    // 先执行旧 schema，再执行真实增量迁移，覆盖升级路径。
    const canonical = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../../supabase/migrations/20260923162938_codex_learning_api.sql', import.meta.url), 'utf8');
    expect(canonical).toContain(migration);
    await db.exec(canonical.slice(0, canonical.indexOf('-- 4. Codex 学习 API')));
    await db.exec(migration);
}, 30_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => {
    await db.exec(`RESET ROLE;
        TRUNCATE auth.users CASCADE;
        INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${OTHER}');
        SET ROLE service_role;
    `);
    await db.query(`INSERT INTO public.words(id,user_id,word,meaning,language) VALUES
        ($1,$2,'Haus','房子','de'),($3,$4,'fremd','别人的词','de')`, [WORD, OWNER, FOREIGN_WORD, OTHER]);
});

describe('真实 PostgreSQL 学习 API 迁移', () => {
    it('新表全部开启 RLS，只有 service_role 能读写，RPC 无 SECURITY DEFINER', async () => {
        const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`
            SELECT relname,relrowsecurity FROM pg_class WHERE relname = ANY($1::text[])`,
        [['api_access_tokens','learning_preferences','practice_sessions','review_events']]);
        expect(tables.rows).toHaveLength(4);
        expect(tables.rows.every(t => t.relrowsecurity)).toBe(true);
        const functions = await db.query<{ proname: string; prosecdef: boolean; public_access: boolean; client_access: boolean }>(`
            SELECT p.proname,p.prosecdef,
                has_function_privilege('anon',p.oid,'EXECUTE') AS public_access,
                has_function_privilege('authenticated',p.oid,'EXECUTE') AS client_access
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE 'learning_%'`);
        expect(functions.rows).toHaveLength(7);
        for (const fn of functions.rows) {
            expect(fn, fn.proname).toMatchObject({ prosecdef: false, public_access: false, client_access: false });
        }
        for (const role of ['anon','authenticated'] as const) {
            await expect(asRole(role, () => db.query('SELECT * FROM public.api_access_tokens'))).rejects.toMatchObject({ code: '42501' });
            await expect(asRole(role, () => record(event()))).rejects.toMatchObject({ code: '42501' });
            await expect(asRole(role, () => db.query('SELECT * FROM public.review_events'))).rejects.toMatchObject({ code: '42501' });
        }
    });

    it('偏好和令牌约束拒绝无效时区、权限与超长设置', async () => {
        const defaults = await db.query<Row>('INSERT INTO public.learning_preferences(user_id) VALUES($1) RETURNING *', [OWNER]);
        expect(defaults.rows[0]).toMatchObject({ language:'de',timezone:'Europe/Berlin',session_size:10,
            duration_minutes:10,correction_style:'after_answer',interests:[] });
        await expect(db.query("UPDATE public.learning_preferences SET timezone='Invalid/Timezone' WHERE user_id=$1",[OWNER])).rejects.toMatchObject({code:'23514'});
        await expect(db.query('UPDATE public.learning_preferences SET session_size=100 WHERE user_id=$1',[OWNER])).rejects.toMatchObject({code:'23514'});
        await expect(db.query('UPDATE public.learning_preferences SET interests=$2 WHERE user_id=$1',[OWNER,['a'.repeat(81)]])).rejects.toMatchObject({code:'23514'});
        await expect(db.query(`INSERT INTO public.api_access_tokens(user_id,name,token_hash,prefix,scopes,expires_at)
            VALUES($1,'Codex',$2,'vt_test',ARRAY['admin'],now()+interval '30 days')`,[OWNER,'a'.repeat(64)])).rejects.toMatchObject({code:'23514'});
        await db.query(`INSERT INTO public.api_access_tokens(user_id,name,token_hash,prefix,scopes,expires_at)
            VALUES($1,'Codex',$2,'vt_test',ARRAY['vocabulary:read'],now()+interval '30 days')`,[OWNER,'a'.repeat(64)]);
    });

    it('45 个存量词按 20 个每天回填；分页、筛选与计数一致，不覆盖已有状态', async () => {
        await db.query(`INSERT INTO public.words(id,user_id,word,meaning,language,created_at)
            SELECT gen_random_uuid(),$1,'Wort ' || n,'词','de',now()-n*interval '1 minute' FROM generate_series(1,44) n`,[OWNER]);
        const first = await queryReview({limit:7});
        expect(first.data).toHaveLength(7);
        expect(first.meta).toEqual({has_more:true,next_offset:7,counts:{due:20,total_tracked:45,reviewed_today:0,tomorrow:20,ahead:25}});
        const second = await queryReview({limit:7,offset:7});
        expect(new Set([...first.data,...second.data].map(x=>x.word.id)).size).toBe(14);
        expect((await queryReview({mode:'ahead',limit:100})).data).toHaveLength(25);
        expect((await queryReview({mode:'all',limit:100})).data).toHaveLength(45);
        expect((await queryReview({language:'en'})).data).toEqual([]);
        expect(first.data.every(x=>x.word.user_id===OWNER && x.state.user_id===OWNER)).toBe(true);
        await record(event({practiced_at:new Date().toISOString()}));
        const after = await queryReview({mode:'all',limit:100});
        expect(after.data.find(x=>x.word.id===WORD)?.state.reps).toBe(1);
        expect(after.meta.counts.reviewed_today).toBe(1);
        expect(after.meta.counts.due).toBe(19);
    });

    it('时区决定回填日期；非法参数不会写入状态', async () => {
        await expect(queryReview({timezone:'Not/AZone'})).rejects.toMatchObject({code:'PT400'});
        await expect(queryReview({limit:101})).rejects.toMatchObject({code:'PT400'});
        await expect(queryReview({offset:-1})).rejects.toMatchObject({code:'PT400'});
        const count = await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.review_states');
        expect(count.rows[0].count).toBe(0);
        const result = await queryReview({timezone:'Pacific/Kiritimati'});
        const expected = await db.query<{today:string}>("SELECT to_char(now() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD') AS today");
        expect(result.data[0].state.due).toBe(expected.rows[0].today);
    });

    it('服务端 SRS 与前端纯函数在连续练习、ease 下限、间隔上限上保持一致', async () => {
        const grades: ReviewGrade[] = ['known','known','fuzzy','forgot',...Array<ReviewGrade>(12).fill('fuzzy'),
            ...Array<ReviewGrade>(25).fill('known'),...Array<ReviewGrade>(10).fill('forgot')];
        let expected = initReviewState(WORD,'2025-06-15','2025-06-15T12:00:00Z');
        for (let i=0;i<grades.length;i++) {
            const practiced = new Date(Date.UTC(2025,5,15,12,i)).toISOString();
            expected = applyGrade(expected,grades[i],'2025-06-15',practiced);
            const actual = await record(event({grade:grades[i],practiced_at:practiced}));
            expect(actual.state).toMatchObject({interval_days:expected.intervalDays,ease:expected.ease,
                reps:expected.reps,lapses:expected.lapses,due:expected.due});
            expect(new Date(actual.state!.last_reviewed_at!).toISOString()).toBe(practiced);
        }
    });

    it('相同 ID 重试仅记分一次，内容冲突不改变排期，返回当前状态而非旧快照', async () => {
        const payload = event();
        const first = await record(payload);
        expect(first.replayed).toBe(false);
        const retry = await record(payload);
        expect(retry.replayed).toBe(true);
        expect(retry.state).toEqual(first.state);
        expect(retry.event).not.toHaveProperty('request_payload');
        await expect(record({...payload,grade:'forgot'})).rejects.toMatchObject({code:'PT409'});
        const latest = await record(event({practiced_at:'2025-06-16T12:00:00Z'}));
        const oldRetry = await record(payload);
        expect(oldRetry.state).toEqual(latest.state);
        const rows = await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.review_events');
        expect(rows.rows[0].count).toBe(2);
    });

    it('迟到的离线作答保留历史但不倒退排期；不同 ID 的同时间作答按序处理', async () => {
        const newer = await record(event({practiced_at:'2025-06-16T12:00:00Z'}));
        const older = await record(event({practiced_at:'2025-06-15T12:00:00Z',grade:'forgot',source:'web'}));
        expect(older.event.scheduling_applied).toBe(false);
        expect(older.state).toEqual(newer.state);
        const sameTime = await record(event({practiced_at:'2025-06-16T12:00:00Z'}));
        expect(sameTime.event.scheduling_applied).toBe(true);
        expect(sameTime.state?.reps).toBe(2);
    });

    it('排队的重复请求只生成一次事件，首次状态写入不会重复初始化', async () => {
        // PGlite 单连接会排队；真实多连接竞争由 SQL 中的 advisory/行锁约束。
        const payload=event();
        const results=await Promise.all(Array.from({length:12},()=>record(payload)));
        expect(results.filter(x=>!x.replayed)).toHaveLength(1);
        expect(results.every(x=>x.state?.reps===1)).toBe(true);
        const next=await Promise.all(Array.from({length:3},()=>record(event())));
        expect(next.map(x=>x.state?.reps)).toEqual([2,3,4]);
    });

    it('跨账号词汇、会话与重放都被拒绝且不产生事件', async () => {
        await expect(record(event({word_id:FOREIGN_WORD}))).rejects.toMatchObject({code:'PT404'});
        const foreignSession=session({word_ids:[FOREIGN_WORD]});
        await call('learning_create_session',[OTHER,foreignSession]);
        await expect(record(event({session_id:foreignSession.id}))).rejects.toMatchObject({code:'PT404'});
        const payload=event();
        await record(payload);
        await expect(record(payload,OTHER)).rejects.toMatchObject({code:'PT409'});
        await expect(call('learning_create_session',[OWNER,session({word_ids:[FOREIGN_WORD]})])).rejects.toMatchObject({code:'PT404'});
        const rows=await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.review_events');
        expect(rows.rows[0].count).toBe(1);
    });

    it('会话创建幂等，更新使用版本校验，关闭后拒绝新作答但允许已保存事件重试', async () => {
        const payload=session();
        const created=await call<Row>('learning_create_session',[OWNER,payload]);
        expect(created).toMatchObject({status:'active',version:1});
        expect(created).not.toHaveProperty('initial_payload');
        expect(await call('learning_create_session',[OWNER,payload])).toEqual(created);
        await expect(call('learning_create_session',[OWNER,{...payload,topic:'different'}])).rejects.toMatchObject({code:'PT409'});
        const recorded=event({session_id:payload.id});
        await record(recorded);
        const completed=await call<Row>('learning_update_session',[OWNER,payload.id,{status:'completed',summary:'练习完毕',expected_version:1}]);
        expect(completed).toMatchObject({status:'completed',summary:'练习完毕',version:2});
        expect(completed.completed_at).toBeTruthy();
        await expect(call('learning_update_session',[OWNER,payload.id,{summary:'旧版本',expected_version:1}])).rejects.toMatchObject({code:'PT409'});
        await expect(call('learning_update_session',[OTHER,payload.id,{summary:'越权',expected_version:2}])).rejects.toMatchObject({code:'PT404'});
        await expect(call('learning_update_session',[OWNER,payload.id,{status:'active',expected_version:2}])).rejects.toMatchObject({code:'PT409'});
        await expect(record(event({session_id:payload.id}))).rejects.toMatchObject({code:'PT409'});
        expect((await record(recorded)).replayed).toBe(true);
        expect(await call('learning_create_session',[OWNER,payload])).toEqual(completed);
    });

    it('会话只能使用已选且同语言的词，失败写入全部回滚', async () => {
        const second=randomUUID();
        await db.query("INSERT INTO public.words(id,user_id,word,meaning,language) VALUES($1,$2,'rent','租金','en')",[second,OWNER]);
        await expect(call('learning_create_session',[OWNER,session({word_ids:[second]})])).rejects.toMatchObject({code:'PT404'});
        await expect(call('learning_create_session',[OWNER,session({word_ids:[WORD,WORD]})])).rejects.toMatchObject({code:'PT400'});
        const payload=session();
        await call('learning_create_session',[OWNER,payload]);
        await expect(record(event({session_id:payload.id,word_id:second}))).rejects.toMatchObject({code:'PT400'});
        const rows=await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.review_states');
        expect(rows.rows[0].count).toBe(0);
    });

    it('输入边界、未来时间与不存在的词不能改变权威状态', async () => {
        for (const changes of [{grade:'easy'}, {hint_count:101}, {timezone:'fake'},
            {answer:'a'.repeat(8001)}, {practiced_at:'infinity'}, {practiced_at:'2038-01-01T00:00:00Z'},
            {error_tags:['x'.repeat(81)]}, {id:'not-a-uuid'}, {user_id:OTHER}]) {
            await expect(record(event(changes)),JSON.stringify(changes).slice(0,100)).rejects.toMatchObject({code:'PT400'});
        }
        await expect(record(event({word_id:randomUUID()}))).rejects.toMatchObject({code:'PT404'});
        const rows=await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.review_states');
        expect(rows.rows[0].count).toBe(0);
    });

    it('收藏句保存幂等，冲突和跨账号 ID 不会覆盖现有内容', async () => {
        const payload={id:randomUUID(),sentence:'Ich suche ein Haus.',sentence_cn:'我在找房子。',language:'de',scene:'租房',source_words:['Haus']};
        const first=await call<Row>('learning_save_sentence',[OWNER,payload]);
        expect(first).toMatchObject({source_type:'combined',source_words:['Haus']});
        expect(await call('learning_save_sentence',[OWNER,payload])).toEqual(first);
        await expect(call('learning_save_sentence',[OWNER,{...payload,sentence:'anderer Satz'}])).rejects.toMatchObject({code:'PT409'});
        await expect(call('learning_save_sentence',[OTHER,payload])).rejects.toMatchObject({code:'PT409'});
        await expect(call('learning_save_sentence',[OWNER,{...payload,id:randomUUID(),source_words:[5]}])).rejects.toMatchObject({code:'PT400'});
    });

    it('删除词汇保留学习历史与快照，旧请求可重试，新请求报告不存在', async () => {
        const payload=event();
        await record(payload);
        await db.query('DELETE FROM public.words WHERE id=$1',[WORD]);
        const replay=await record(payload);
        expect(replay).toMatchObject({replayed:true,state:null,event:{word_snapshot:{word:'Haus',meaning:'房子'}}});
        await expect(record(event())).rejects.toMatchObject({code:'PT404'});
    });
});
