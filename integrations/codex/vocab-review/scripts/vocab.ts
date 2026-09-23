#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ApiClient, ClientError, normalizeApiUrl, objectInput, prepareBody, requireUuid, redact, type ApiResult, type JsonObject } from './client.ts';
import { SecureStore, loadCredentials, keychain, type Config, type PendingRequest } from './storage.ts';

const HELP = `Vocab Tracker · Codex API helper
configure --url https://your-site --storage keychain|file  (令牌在终端隐藏输入)
status | logout | pending | retry <request-id> | discard <request-id>
words | review | sentences | preferences | sessions | events  [--language de ...]
resume <session-id>
start | event | save-sentence | preferences-set  --json <file|->
finish <session-id> --json <file|->
列表参数: --limit --offset --language --q --category --ids --mode --timezone --status --word-id --session-id
正文只接受 JSON 文件或标准输入；不接受令牌命令行参数。
`;

interface Args { command: string; positional: string[]; flags: Record<string, string> }
function parseArgs(args: string[]): Args {
    const [command = 'help', ...rest] = args;
    const flags: Record<string, string> = {};
    const positional: string[] = [];
    const allowed = new Set(['url', 'storage', 'json', 'limit', 'offset', 'language', 'q', 'category', 'ids', 'mode', 'timezone', 'status', 'word-id', 'session-id']);
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (!allowed.has(key) || key in flags || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new ClientError('INVALID_ARGUMENT', '参数无效；使用 help 查看用法。');
            flags[key] = rest[++i];
        } else positional.push(arg);
    }
    return { command, positional, flags };
}

async function hiddenToken(): Promise<string> {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
        throw new ClientError('INTERACTIVE_REQUIRED', '请在交互终端执行 configure 并粘贴令牌；不要把令牌放进命令、聊天或文件参数。');
    }
    process.stdout.write('粘贴个人访问令牌（不会显示）：');
    return new Promise((resolve, reject) => {
        let value = '';
        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.resume();
        const finish = (error?: Error) => {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(wasRaw);
            process.stdin.pause();
            process.stdout.write('\n');
            if (error) reject(error); else resolve(value.trim());
        };
        const onData = (chunk: Buffer) => {
            for (const character of chunk.toString('utf8')) {
                if (character === '\u0003' || character === '\u0004') { finish(new ClientError('CANCELLED', '连接已取消。')); return; }
                if (character === '\r' || character === '\n') { finish(); return; }
                if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
                else if (/^[A-Za-z0-9_-]$/.test(character) && value.length < 4096) value += character;
            }
        };
        process.stdin.on('data', onData);
    });
}

async function bodyFromFile(path: string | undefined): Promise<JsonObject> {
    if (!path) throw new ClientError('INVALID_INPUT', '写入需要 --json 文件路径或 --json -。');
    let text: string;
    try {
        if (path === '-') {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of process.stdin) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += bytes.length;
                if (size > 128000) throw new ClientError('INVALID_INPUT', 'JSON 输入过大。');
                chunks.push(bytes);
            }
            text = Buffer.concat(chunks).toString('utf8');
        } else text = await readFile(path, 'utf8');
    } catch (error) {
        if (error instanceof ClientError) throw error;
        throw new ClientError('INVALID_INPUT', '无法读取 JSON 输入。');
    }
    if (text.length > 128000) throw new ClientError('INVALID_INPUT', 'JSON 输入过大。');
    try { return objectInput(JSON.parse(text)); } catch (error) {
        if (error instanceof ClientError) throw error;
        throw new ClientError('INVALID_INPUT', '输入不是有效 JSON。');
    }
}

async function rememberIdentity(client: ApiClient, store: SecureStore, result: ApiResult): Promise<string> {
    const userId = requireUuid(objectInput(result.data).id);
    await store.write(`identity-${client.identityKey()}.json`, { api_url: client.baseUrl, user_id: userId });
    return userId;
}

export async function currentUser(client: ApiClient, store?: SecureStore, allowCached = false): Promise<string> {
    // 此身份按网站 + 凭据摘要绑定；写入仍由服务器验权，先落盘不依赖网络可用。
    if (allowCached && store) {
        const cached = await store.read<{ api_url: string; user_id: string }>(`identity-${client.identityKey()}.json`);
        if (cached?.api_url === client.baseUrl) return requireUuid(cached.user_id);
    }
    const result = await client.request('GET', '/me');
    return store ? rememberIdentity(client, store, result) : requireUuid(objectInput(result.data).id);
}

async function rememberSession(store: SecureStore, request: PendingRequest, result: ApiResult) {
    if (!request.path.startsWith('/sessions') || !result.data || typeof result.data !== 'object') return;
    const data = result.data as JsonObject;
    if (typeof data.id === 'string' && typeof data.version === 'number' && typeof data.status === 'string') {
        await store.saveSession({ id: requireUuid(data.id), api_url: request.api_url, user_id: request.user_id, version: data.version, status: data.status });
    }
}

export async function sendPending(client: ApiClient, store: SecureStore, request: PendingRequest, userId: string): Promise<ApiResult & { request_id: string }> {
    if (request.api_url !== client.baseUrl || request.user_id !== userId) throw new ClientError('ACCOUNT_MISMATCH', '此待写入请求属于其他网站或账号；请连接原账号后重试。', 0, request.id);
    try {
        const result = await client.request(request.method, request.path, request.body);
        await rememberSession(store, request, result);
        await store.clearPending(request.id);
        return { ...result, request_id: request.id };
    } catch (error) {
        if (error instanceof ClientError) { error.requestId = request.id; throw error; }
        throw new ClientError('WRITE_UNCONFIRMED', '写入结果未确认；请求已保留，使用原请求 ID 恢复。', 0, request.id);
    }
}

export async function writeRequest(client: ApiClient, store: SecureStore, method: 'POST' | 'PATCH', path: string, body: JsonObject): Promise<ApiResult & { request_id: string }> {
    const userId = await currentUser(client, store, true);
    const request: PendingRequest = {
        id: typeof body.id === 'string' ? requireUuid(body.id) : randomUUID(),
        api_url: client.baseUrl, user_id: userId, method, path, body, created_at: new Date().toISOString(),
    };
    const existing = await store.getPending(request.id);
    if (existing) throw new ClientError('REQUEST_PENDING', '此请求尚未确认；用 retry 和原请求 ID 恢复，不要创建另一条作答。', 0, request.id);
    try { await store.savePending(request); }
    catch (error) { if (error instanceof ClientError) error.requestId = request.id; throw error; }
    return sendPending(client, store, request, userId);
}

export async function run(args: string[]): Promise<unknown> {
    const { command, positional, flags } = parseArgs(args);
    if (command === 'help' || command === '--help') return { help: HELP };
    const store = new SecureStore();
    if (command === 'configure') {
        if (positional.length || Object.keys(flags).some(key => !['url', 'storage'].includes(key))) throw new ClientError('INVALID_ARGUMENT', 'configure 只接受 --url 和 --storage。');
        const api_url = normalizeApiUrl(flags.url ?? '');
        const storage = flags.storage ?? (process.platform === 'darwin' ? 'keychain' : '');
        if (storage !== 'keychain' && storage !== 'file') throw new ClientError('INVALID_ARGUMENT', '请选择 --storage keychain 或明确选择 --storage file。');
        const token = await hiddenToken();
        if (!/^vt_[A-Za-z0-9_-]{16,}$/.test(token)) throw new ClientError('INVALID_TOKEN', '请使用网站生成的 vt_ 个人访问令牌。');
        const client = new ApiClient(api_url, token);
        const me = await client.request('GET', '/me');
        const previous = await store.read<Config>('config.json');
        if (storage === 'keychain') await keychain('set', api_url, token);
        else await store.write('credentials.json', { api_url, token });
        await store.write('config.json', { api_url, storage });
        await rememberIdentity(client, store, me);
        if (storage === 'keychain') await store.remove('credentials.json');
        if (previous?.storage === 'keychain' && (storage !== 'keychain' || previous.api_url !== api_url)) await keychain('delete', previous.api_url);
        return { data: { connected: true, api_url, storage, account: me.data } };
    }
    if (command === 'logout') {
        const config = await store.read<Config>('config.json');
        if (config?.storage === 'keychain') await keychain('delete', config.api_url);
        await store.remove('credentials.json');
        await store.remove('config.json');
        return { data: { disconnected: true, note: '已移除本地凭据；云端令牌可在网站撤销。待写入请求仍保留且绑定原账号。' } };
    }
    if (command === 'pending') {
        return { data: (await store.pending()).map(p => ({
            request_id: p.id, api_url: p.api_url, user_id: p.user_id, method: p.method, path: p.path, created_at: p.created_at,
            ...(typeof p.body.word_id === 'string' ? { word_id: p.body.word_id } : {}),
            ...(typeof p.body.session_id === 'string' ? { session_id: p.body.session_id } : {}),
            ...(p.path === '/sessions' && typeof p.body.id === 'string' ? { session_id: p.body.id } : {}),
        })) };
    }
    if (command === 'discard') {
        await store.clearPending(requireUuid(positional[0]));
        return { data: { discarded: positional[0], note: '仅删除本地待写入请求，不撤销已到达服务器的结果。' } };
    }
    const credentials = await loadCredentials(store);
    const client = new ApiClient(credentials.api_url, credentials.token);
    if (command === 'status') {
        const me = await client.request('GET', '/me');
        await rememberIdentity(client, store, me);
        return { data: { connected: true, api_url: client.baseUrl, storage: credentials.storage, account: me.data, pending_count: (await store.pending()).length } };
    }
    if (command === 'retry') {
        const request = await store.getPending(requireUuid(positional[0]));
        if (!request) throw new ClientError('NOT_FOUND', '未找到待写入请求；它可能已确认成功。');
        return sendPending(client, store, request, await currentUser(client, store));
    }
    if (command === 'resume') {
        const id = requireUuid(positional[0]);
        const result = await client.request('GET', `/sessions/${id}`);
        const data = objectInput(result.data);
        if (!data.session || typeof data.session !== 'object' || Array.isArray(data.session)) throw new ClientError('INVALID_RESPONSE', '会话数据格式无效。');
        const session = data.session as JsonObject;
        const userId = await currentUser(client, store);
        if (typeof session.version === 'number' && typeof session.status === 'string') await store.saveSession({ id, api_url: client.baseUrl, user_id: userId, version: session.version, status: session.status });
        return result;
    }
    const reads: Record<string, string[]> = {
        words: ['language', 'q', 'category', 'ids', 'limit', 'offset'],
        review: ['language', 'mode', 'timezone', 'limit', 'offset'],
        sentences: ['language', 'q', 'limit', 'offset'], preferences: [],
        sessions: ['status', 'limit', 'offset'], events: ['word-id', 'session-id', 'limit', 'offset'],
    };
    if (command in reads) {
        if (positional.length || Object.keys(flags).some(key => !reads[command].includes(key))) throw new ClientError('INVALID_ARGUMENT', '此查询不接受给定参数。');
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(flags)) query.set(key.replaceAll('-', '_'), value);
        return client.request('GET', `/${command}${query.size ? `?${query}` : ''}`);
    }
    const writes: Record<string, { method: 'POST' | 'PATCH'; path: string }> = {
        start: { method: 'POST', path: '/sessions' }, event: { method: 'POST', path: '/events' },
        'save-sentence': { method: 'POST', path: '/sentences' }, 'preferences-set': { method: 'PATCH', path: '/preferences' },
        finish: { method: 'PATCH', path: `/sessions/${command === 'finish' ? requireUuid(positional[0]) : ''}` },
    };
    if (!(command in writes)) throw new ClientError('INVALID_ARGUMENT', '未知命令；使用 help 查看用法。');
    if (Object.keys(flags).some(key => key !== 'json') || positional.length !== (command === 'finish' ? 1 : 0)) throw new ClientError('INVALID_ARGUMENT', '写入命令只接受 --json 和所需会话 ID。');
    const body = prepareBody(command, await bodyFromFile(flags.json));
    const operation = writes[command];
    return writeRequest(client, store, operation.method, operation.path, body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run(process.argv.slice(2)).then(result => {
        process.stdout.write(`${redact(JSON.stringify(result), process.env.VOCAB_API_TOKEN)}\n`);
    }).catch(error => {
        const safe = error instanceof ClientError ? error : new ClientError('CLIENT_ERROR', '操作未完成；未输出可能包含凭据的底层错误。');
        process.stderr.write(`${redact(JSON.stringify({ error: { code: safe.code, message: safe.message, ...(safe.status ? { status: safe.status } : {}), ...(safe.requestId ? { request_id: safe.requestId } : {}) } }), process.env.VOCAB_API_TOKEN)}\n`);
        process.exitCode = 1;
    });
}
