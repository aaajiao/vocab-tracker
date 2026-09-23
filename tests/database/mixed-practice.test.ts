// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';

const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const WORD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EN_WORD='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SENTENCE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EN_SENTENCE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN_WORD='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FOREIGN_SENTENCE='ffffffff-ffff-4fff-8fff-ffffffffffff';
let db:PGlite;
type Row=Record<string,unknown>;
interface Materials { data:({kind:'word';word:Row;state:Row}|{kind:'sentence';sentence:Row})[];meta:{available:number;count:number;words_available:number;sentences_available:number;timezone:string;selection:{due:number;ahead:number;sentences:number}} }
interface SavedWord {word:Row;created:boolean;duplicate:boolean;replayed:boolean}
async function call<T>(fn:string,...args:unknown[]):Promise<T>{
    const result=await db.query<{result:T}>(`SELECT public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS result`,args);
    return result.rows[0].result;
}
function materials(language:string|null=null,limit=10,timezone:string|null=null){return call<Materials>('learning_get_practice_materials',OWNER,language,timezone,limit);}
function saveWord(patch:Row={},owner=OWNER){return call<SavedWord>('learning_save_word',owner,{id:randomUUID(),word:'Wohnung',meaning:'公寓',language:'de',...patch});}
function session(patch:Row={}){return {id:randomUUID(),language:'mixed',mode:'conversation',word_ids:[WORD],sentence_ids:[EN_SENTENCE],...patch};}

beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`SET timezone='UTC'; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;`);
    const canonical=readFileSync(new URL('../../schema.sql',import.meta.url),'utf8');
    const migration=readFileSync(new URL('../../supabase/migrations/20260923172843_mixed_practice_and_word_writes.sql',import.meta.url),'utf8');
    expect(canonical).toContain(migration);
    await db.exec(canonical.slice(0,canonical.indexOf('-- 6. 混合练习')));
    await db.exec(migration);
},30_000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
    await db.exec(`RESET ROLE; TRUNCATE auth.users CASCADE;
        INSERT INTO auth.users(id) VALUES('${OWNER}'),('${OTHER}'); SET ROLE service_role;`);
    await db.query(`INSERT INTO public.words(id,user_id,word,meaning,language) VALUES
        ($1,$2,'Haus','房子','de'),($3,$2,'house','房子','en'),($4,$5,'private','别人的词','en')`,[WORD,OWNER,EN_WORD,FOREIGN_WORD,OTHER]);
    await db.query(`INSERT INTO public.saved_sentences(id,user_id,sentence,language,source_type) VALUES
        ($1,$2,'Ich suche ein Haus.','de','input'),($3,$2,'I need a house.','en','input'),($4,$5,'Private sentence.','en','input')`,[SENTENCE,OWNER,EN_SENTENCE,FOREIGN_SENTENCE,OTHER]);
});

describe('SRS 逻辑下的混合材料',()=>{
    it('默认同时读两种语言、两种材料，少于10项就返回全部且不重复',async()=>{
        await db.query("INSERT INTO public.learning_preferences(user_id,language,session_size,timezone) VALUES($1,'de',1,'Pacific/Honolulu')",[OWNER]);
        const result=await materials();
        expect(result.meta).toEqual({available:4,count:4,words_available:2,sentences_available:2,timezone:'Pacific/Honolulu',selection:{due:2,ahead:0,sentences:2}});
        expect(result.data.filter(x=>x.kind==='word').map(x=>x.word.language).sort()).toEqual(['de','en']);
        expect(result.data.filter(x=>x.kind==='sentence').map(x=>x.sentence.language).sort()).toEqual(['de','en']);
        expect(result.data.every(x=>(x.kind==='word'?x.word:x.sentence).user_id===OWNER)).toBe(true);
        expect(new Set(result.data.map(x=>`${x.kind}:${(x.kind==='word'?x.word:x.sentence).id}`)).size).toBe(4);
    });

    it('复用线上初始化与时区、按最早到期优先，再以同到期日随机抽取',async()=>{
        await db.query(`INSERT INTO public.words(user_id,word,meaning,language,created_at)
            SELECT $1,'extra '||n,'词','de',now()-n*interval '1 minute' FROM generate_series(1,58) n`,[OWNER]);
        await call('learning_get_review',OWNER,null,'all','Europe/Berlin',100,0);
        await db.query("UPDATE public.review_states SET due=CASE WHEN word_id=$2 THEN DATE '2001-01-01' ELSE DATE '2002-01-01' END,reps=4,interval_days=20 WHERE user_id=$1",[OWNER,WORD]);
        const before=await db.query('SELECT * FROM public.review_states WHERE user_id=$1 ORDER BY word_id',[OWNER]);
        const selected=new Set<string>();
        for(let n=0;n<12;n++){
            const sample=await materials();
            expect(sample.meta.selection).toEqual({due:8,ahead:0,sentences:2});
            const words=sample.data.filter(x=>x.kind==='word');
            expect(words[0].word.id).toBe(WORD);
            expect(words).toHaveLength(8);
            words.forEach(x=>selected.add(String(x.word.id)));
        }
        // 59 个同优先级候选的完整库抽样，不固定为原查询前10项。
        expect(selected.size).toBeGreaterThan(20);
        expect((await db.query('SELECT * FROM public.review_states WHERE user_id=$1 ORDER BY word_id',[OWNER])).rows).toEqual(before.rows);
    });

    it('到期词不足才提前复习；句子名额不足会补成10词而不重置排期',async()=>{
        await db.query(`INSERT INTO public.words(user_id,word,meaning,language) SELECT $1,'word '||n,'词','en' FROM generate_series(1,12) n`,[OWNER]);
        await call('learning_get_review',OWNER,null,'all','Europe/Berlin',100,0);
        await db.query("UPDATE public.review_states SET due=CASE WHEN word_id=$2 THEN DATE '2001-01-01' ELSE DATE '2099-01-01' END WHERE user_id=$1",[OWNER,WORD]);
        const mixed=await materials();
        expect(mixed.meta.count).toBe(10);
        expect(mixed.meta.selection).toEqual({due:1,ahead:7,sentences:2});
        expect(mixed.data[0].kind==='word' && mixed.data[0].word.id).toBe(WORD);
        await db.query('DELETE FROM public.saved_sentences WHERE user_id=$1',[OWNER]);
        const onlyWords=await materials();
        expect(onlyWords.meta.selection).toEqual({due:1,ahead:9,sentences:0});
        expect(onlyWords.meta.count).toBe(10);
    });

    it('纯句子和空库均可自然返回，不创建虚构的词汇排期',async()=>{
        await db.query('DELETE FROM public.words WHERE user_id=$1',[OWNER]);
        await db.query(`INSERT INTO public.saved_sentences(user_id,sentence,language,source_type)
            SELECT $1,'Sentence '||n,'en','input' FROM generate_series(1,15) n`,[OWNER]);
        const onlySentences=await materials();
        expect(onlySentences.meta).toMatchObject({available:17,count:10,selection:{due:0,ahead:0,sentences:10}});
        expect(onlySentences.data.every(x=>x.kind==='sentence')).toBe(true);
        expect(new Set(onlySentences.data.map(x=>x.kind==='sentence' && x.sentence.id)).size).toBe(10);
        expect((await db.query('SELECT * FROM public.review_states WHERE user_id=$1',[OWNER])).rows).toHaveLength(0);
        await db.query('DELETE FROM public.saved_sentences WHERE user_id=$1',[OWNER]);
        expect(await materials()).toMatchObject({data:[],meta:{available:0,count:0,selection:{due:0,ahead:0,sentences:0}}});
    });

    it('语言只在明确指定时筛选，限制和时区始终校验',async()=>{
        const german=await materials('de',2);
        expect(german.meta.count).toBe(2);
        expect(german.data.every(x=>(x.kind==='word'?x.word:x.sentence).language==='de')).toBe(true);
        expect((await materials(null,1)).data).toHaveLength(1);
        for(const args of [[OWNER,'fr',null,10],[OWNER,null,null,0],[OWNER,null,null,101],[OWNER,null,'Invalid/Zone',10]]){
            await expect(call('learning_get_practice_materials',...args)).rejects.toMatchObject({code:'PT400'});
        }
    });
});

describe('词汇创建与混合会话',()=>{
    it('新增词保留原文字形、按偏好时区生成日期，并支持独立词汇写权限',async()=>{
        await db.query("INSERT INTO public.learning_preferences(user_id,timezone) VALUES($1,'Pacific/Kiritimati')",[OWNER]);
        const saved=await saveWord({word:'  Straße  ',example:'Die Straße ist lang.',etymology:'词源'});
        expect(saved).toMatchObject({created:true,duplicate:false,replayed:false,word:{word:'Straße',meaning:'公寓',category:'',example:'Die Straße ist lang.',etymology:'词源'}});
        const day=await db.query<{day:string}>("SELECT to_char(now() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD') AS day");
        expect(saved.word.date).toBe(day.rows[0].day);
        await db.query(`INSERT INTO public.api_access_tokens(user_id,name,token_hash,prefix,scopes,expires_at)
            VALUES($1,'write',$2,'vt_test',ARRAY['vocabulary:read','vocabulary:write','practice:write','sentences:write'],now()+interval '1 day')`,[OWNER,'a'.repeat(64)]);
        await expect(db.query("UPDATE public.api_access_tokens SET scopes=ARRAY['vocabulary:read','admin'] WHERE user_id=$1",[OWNER])).rejects.toMatchObject({code:'23514'});
    });

    it('幂等收据不会因日期缺省、跨日或偏好变动改变；不同内容冲突',async()=>{
        const id=randomUUID();
        const first=await saveWord({id});
        const receipt=await db.query<{request_payload:Row}>('SELECT request_payload FROM public.word_write_requests WHERE id=$1',[id]);
        expect(receipt.rows[0].request_payload.date).toBeNull();
        // 改为旧日期模拟跨午夜之后重放，不能用今天覆盖它。
        await db.query("UPDATE public.words SET date='2020-01-01' WHERE id=$1",[id]);
        await db.query("INSERT INTO public.learning_preferences(user_id,timezone) VALUES($1,'Pacific/Honolulu')",[OWNER]);
        const replay=await saveWord({id});
        expect(replay).toMatchObject({created:true,duplicate:false,replayed:true,word:{id,date:'2020-01-01'}});
        expect(first.word.word).toBe(replay.word.word);
        await expect(saveWord({id,meaning:'不同释义'})).rejects.toMatchObject({code:'PT409'});
        await expect(saveWord({id,date:'2020-01-01'})).rejects.toMatchObject({code:'PT409'});
        expect((await db.query('SELECT * FROM public.word_write_requests WHERE id=$1',[id])).rows).toHaveLength(1);
    });

    it('同语言的大小写/首尾空格重复返回原词，绝不覆盖释义，并保存请求别名',async()=>{
        const id=randomUUID();
        const duplicate=await saveWord({id,word:'  HAUS ',meaning:'不能覆盖'});
        expect(duplicate).toMatchObject({created:false,duplicate:true,replayed:false,word:{id:WORD,word:'Haus',meaning:'房子'}});
        expect((await saveWord({id,word:'HAUS',meaning:'不能覆盖'})).replayed).toBe(true);
        await expect(saveWord({id,word:'HAUS',meaning:'另一个请求'})).rejects.toMatchObject({code:'PT409'});
        expect((await saveWord({word:'Haus',language:'en'})).created).toBe(true);
        const parallel=await Promise.all([saveWord({word:'new word'}),saveWord({word:'NEW WORD'})]);
        expect(parallel.filter(x=>x.created)).toHaveLength(1);
        expect(new Set(parallel.map(x=>x.word.id)).size).toBe(1);
    });

    it('所有权、请求ID冲突和删除后的重试不会跨账号写入或复活词汇',async()=>{
        await expect(saveWord({id:FOREIGN_WORD})).rejects.toMatchObject({code:'PT409'});
        const id=randomUUID(); await saveWord({id});
        await expect(saveWord({id},OTHER)).rejects.toMatchObject({code:'PT409'});
        await db.query('DELETE FROM public.words WHERE id=$1',[id]);
        await expect(saveWord({id})).rejects.toMatchObject({code:'PT404'});
        const separate=await saveWord({word:'Haus'},OTHER);
        expect(separate.created).toBe(true);
        expect(separate.word.user_id).toBe(OTHER);
        for(const patch of [{word:''},{meaning:''},{language:'mixed'},{category:'unknown'},{date:'2025-02-30'},{date:'20250101'},{word:'a'.repeat(201)},{user_id:OTHER}]){
            await expect(saveWord(patch)).rejects.toMatchObject({code:'PT400'});
        }
    });

    it('混合/纯句会话记录材料ID；真实词事件仍需会话成员，纯句只能写总结',async()=>{
        const mixedPayload=session();
        const mixed=await call<Row>('learning_create_session',OWNER,mixedPayload);
        expect(mixed).toMatchObject({language:'mixed',word_ids:[WORD],sentence_ids:[EN_SENTENCE]});
        expect(await call('learning_create_session',OWNER,mixedPayload)).toEqual(mixed);
        const onlySentence=await call<Row>('learning_create_session',OWNER,session({word_ids:[],sentence_ids:[SENTENCE]}));
        expect(onlySentence.word_ids).toEqual([]);
        await expect(call('learning_record_event',OWNER,{id:randomUUID(),word_id:WORD,session_id:onlySentence.id,grade:'known',source:'codex',practiced_at:'2025-01-01T00:00:00Z',timezone:'Europe/Berlin'})).rejects.toMatchObject({code:'PT400'});
        const finished=await call<Row>('learning_update_session',OWNER,onlySentence.id,{expected_version:1,status:'completed',summary:'练过租房句型，需继续练冠词。'});
        expect(finished.summary).toContain('冠词');
        expect((await db.query('SELECT * FROM public.review_events')).rows).toHaveLength(0);
    });

    it('词/句身份与语言必须匹配；旧创建请求仍能在升级后幂等重试',async()=>{
        for(const patch of [{sentence_ids:[FOREIGN_SENTENCE]},{word_ids:[FOREIGN_WORD]},
            {language:'de',sentence_ids:[EN_SENTENCE]}]){
            await expect(call('learning_create_session',OWNER,session(patch))).rejects.toMatchObject({code:'PT404'});
        }
        for(const patch of [{word_ids:[],sentence_ids:[]},{sentence_ids:[SENTENCE,SENTENCE]}]){
            await expect(call('learning_create_session',OWNER,session(patch))).rejects.toMatchObject({code:'PT400'});
        }
        const payload=session({language:'de',sentence_ids:[]});
        const original=await call<Row>('learning_create_session',OWNER,payload);
        await db.query("UPDATE public.practice_sessions SET initial_payload=initial_payload-'sentence_ids' WHERE id=$1",[payload.id]);
        const {sentence_ids:_,...oldPayload}=payload;
        expect(await call('learning_create_session',OWNER,oldPayload)).toEqual(original);
        await expect(call('learning_create_session',OWNER,{...payload,sentence_ids:[SENTENCE]})).rejects.toMatchObject({code:'PT409'});
    });

    it('RPC和收据只供服务端；网页现有新增与离线同步行为不受影响',async()=>{
        await db.exec('RESET ROLE');
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
        await db.exec('SET ROLE authenticated');
        try{
            await expect(call('learning_get_practice_materials',OWNER)).rejects.toMatchObject({code:'42501'});
            await expect(saveWord()).rejects.toMatchObject({code:'42501'});
            await expect(db.query('SELECT * FROM public.word_write_requests')).rejects.toMatchObject({code:'42501'});
            await db.query("INSERT INTO public.words(user_id,word,meaning,language) VALUES($1,'Fenster','窗户','de')",[OWNER]);
            await db.query("INSERT INTO public.words(user_id,word,meaning,language) VALUES($1,' HAUS ','旧同步路径','de')",[OWNER]);
            await expect(db.query("INSERT INTO public.words(user_id,word,meaning,language) VALUES($1,'stolen','越权','en')",[OTHER])).rejects.toMatchObject({code:'42501'});
        }finally{await db.exec('RESET ROLE; SET ROLE service_role');}
    });
});
