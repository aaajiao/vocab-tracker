import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiClient, prepareBody, requireUuid } from '../../integrations/codex/vocab-review/scripts/client.ts';
import { SecureStore } from '../../integrations/codex/vocab-review/scripts/storage.ts';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORD='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAKE_TOKEN=`vt_${'a'.repeat(43)}`;
const directories:string[]=[];
const servers:ReturnType<typeof Bun.serve>[]=[];

afterEach(async()=>{
    for(const server of servers.splice(0)) server.stop(true);
    await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));
});

describe('independent CLI regression review',()=>{
    test('accepts standard case-insensitive UUIDs across storage and resume transport',async()=>{
        const dir=await mkdtemp(join(tmpdir(),'vocab-review-case-'));
        directories.push(dir);
        const id=requireUuid(WORD.toUpperCase());
        expect(id).toBe(WORD);
        const store=new SecureStore(dir);
        await store.saveSession({id,api_url:'https://example.test/api/v1',user_id:USER,version:1,status:'active'});
        const client=new ApiClient('https://example.test',FAKE_TOKEN,{
            fetch:(async()=>Response.json({data:{id}})) as typeof fetch,
        });
        expect((await client.request('GET',`/sessions/${id}`)).data).toEqual({id:WORD});
    });

    test('accepts an explicitly absent session for an independent word attempt',()=>{
        const body=prepareBody('event',{word_id:WORD.toUpperCase(),session_id:null,grade:'known'});
        expect(body.word_id).toBe(WORD);
        expect(body.session_id).toBeNull();
    });

    test('preserves a Chinese answer when UTF-8 characters cross stdin chunk boundaries',async()=>{
        const dir=await mkdtemp(join(tmpdir(),'vocab-review-utf8-'));
        directories.push(dir);
        let submitted:Record<string,unknown>|undefined;
        const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
            if(new URL(request.url).pathname.endsWith('/me')) return Response.json({data:{id:USER}});
            submitted=await request.json() as Record<string,unknown>;
            return Response.json({data:{event:submitted,state:{},replayed:false}});
        }});
        servers.push(server);
        const child=Bun.spawn(['bun',resolve('integrations/codex/vocab-review/scripts/vocab.ts'),'event','--json','-'],{
            env:{...process.env,VOCAB_API_URL:`http://127.0.0.1:${server.port}`,VOCAB_API_TOKEN:FAKE_TOKEN,VOCAB_CONFIG_DIR:dir},
            stdin:'pipe',stdout:'pipe',stderr:'pipe',
        });
        const input=Buffer.from(JSON.stringify({word_id:WORD,grade:'fuzzy',answer:'我在找房子。'}));
        const split=input.indexOf(Buffer.from('我'))+1;
        child.stdin.write(input.subarray(0,split));
        await child.stdin.flush();
        // 让读取方真正收到首个半字符，避免测试只覆盖操作系统合并后的单个缓冲区。
        await Bun.sleep(150);
        child.stdin.write(input.subarray(split));
        child.stdin.end();
        const stderr=await new Response(child.stderr).text();
        const stdout=await new Response(child.stdout).text();
        expect(await child.exited,stderr).toBe(0);
        expect(submitted?.answer).toBe('我在找房子。');
        expect(stdout+stderr).not.toContain(FAKE_TOKEN);
    });
});
