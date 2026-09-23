import { createHash, randomUUID } from 'node:crypto';

export type JsonObject = Record<string, unknown>;
export interface ApiResult { data: unknown; meta?: unknown }
export class ClientError extends Error {
    constructor(public code: string, message: string, public status = 0, public requestId?: string) {
        super(message);
    }
}

export function redact(text: string, token = ''): string {
    const withoutToken = token ? text.split(token).join('[REDACTED]') : text;
    return withoutToken.replace(/\bvt_[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
        .replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
}

export function normalizeApiUrl(input: string): string {
    let url: URL;
    try { url = new URL(input); } catch { throw new ClientError('INVALID_URL', '请提供有效的网站 URL。'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        throw new ClientError('INVALID_URL', '网站必须使用 HTTPS；本机开发允许 HTTP。');
    }
    if (url.username || url.password || url.search || url.hash || !['', '/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
        throw new ClientError('INVALID_URL', 'URL 只能是网站根地址或 /api/v1，不能包含凭据或查询参数。');
    }
    return `${url.origin}/api/v1`;
}

export function objectInput(input: unknown): JsonObject {
    if (!input || Array.isArray(input) || typeof input !== 'object') {
        throw new ClientError('INVALID_INPUT', 'JSON 输入必须是对象。');
    }
    if ('user_id' in input) throw new ClientError('INVALID_INPUT', '账号由令牌确定，不能指定 user_id。');
    return input as JsonObject;
}

export function requireUuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new ClientError('INVALID_ID', '请提供有效的 UUID。');
    }
    return value.toLowerCase();
}

export function prepareBody(command: string, input: JsonObject): JsonObject {
    const body = { ...input };
    if (['start', 'event', 'save-sentence', 'add-word'].includes(command)) body.id = requireUuid(body.id ?? randomUUID());
    if (command === 'event') {
        body.word_id = requireUuid(body.word_id);
        if (body.session_id !== undefined && body.session_id !== null) body.session_id = requireUuid(body.session_id);
        if (!['forgot', 'fuzzy', 'known'].includes(String(body.grade))) throw new ClientError('INVALID_INPUT', 'grade 必须是 forgot / fuzzy / known。');
        body.source = 'codex';
        body.practiced_at ??= new Date().toISOString();
        body.timezone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    if (command === 'start') {
        if (Array.isArray(body.word_ids)) body.word_ids = body.word_ids.map(requireUuid);
        if (Array.isArray(body.sentence_ids)) body.sentence_ids = body.sentence_ids.map(requireUuid);
    }
    if (command === 'add-word' && body.category === undefined) body.category = '';
    if (command === 'finish') {
        if (!Number.isInteger(body.expected_version) || Number(body.expected_version) < 1) {
            throw new ClientError('INVALID_INPUT', '结束会话需要最新 expected_version；先 resume 读取。');
        }
        body.status ??= 'completed';
    }
    return body;
}

export class ApiClient {
    readonly baseUrl: string;
    constructor(url: string, private token: string, private options: {
        fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number;
    } = {}) {
        this.baseUrl = normalizeApiUrl(url);
        if (!token || /[\r\n]/.test(token)) throw new ClientError('INVALID_TOKEN', '访问令牌无效。');
    }

    // 仅用于把已验证身份绑定到此网站与凭据，不保存令牌本身。
    identityKey(): string { return createHash('sha256').update(`${this.baseUrl}\n${this.token}`).digest('hex'); }

    async request(method: string, path: string, body?: JsonObject): Promise<ApiResult> {
        if (!/^\/[a-z][a-z0-9/-]*(?:\?[^#]*)?$/.test(path) || path.includes('..') || path.includes('\\')) {
            throw new ClientError('INVALID_PATH', '无效的 API 路径。');
        }
        const url = new URL(`${this.baseUrl}${path}`);
        if (url.origin !== new URL(this.baseUrl).origin) throw new ClientError('INVALID_PATH', '不允许跨网站请求。');
        const textBody = body === undefined ? undefined : JSON.stringify(body);
        // 只有只读和已携带稳定事件 ID 的 POST 可自动重试；PATCH 先恢复会话再决定。
        const retryable = method === 'GET' || (method === 'POST' && typeof body?.id === 'string');
        const maxAttempts = retryable ? 3 : 1;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let response: Response;
            try {
                response = await (this.options.fetch ?? fetch)(url, {
                    method, redirect: 'manual',
                    headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(textBody ? { 'Content-Type': 'application/json' } : {}) },
                    body: textBody, signal: AbortSignal.timeout(this.options.timeoutMs ?? 10000),
                });
            } catch {
                if (attempt + 1 < maxAttempts) { await this.pause(attempt); continue; }
                throw new ClientError('NETWORK_ERROR', '连接失败或超时；待写入请求已保留，可用原请求 ID 重试。');
            }
            if (response.status >= 300 && response.status < 400) {
                throw new ClientError('REDIRECT_BLOCKED', '网站返回重定向；为保护令牌未继续。请确认正确的网站地址。', response.status);
            }
            if ((response.status === 429 || response.status >= 500) && attempt + 1 < maxAttempts) {
                await response.body?.cancel();
                await this.pause(attempt);
                continue;
            }
            let payload: unknown;
            try { payload = await response.json(); } catch {
                throw new ClientError('INVALID_RESPONSE', 'API 未返回有效 JSON；没有展示原始响应。', response.status);
            }
            if (!response.ok) {
                const messages: Record<number, string> = {
                    401: '令牌无效、已过期或被撤销，请在网站重新连接。',
                    403: '令牌缺少此操作所需的权限。',
                    409: '记录发生冲突；读取最新会话或事件后处理，不要生成新 ID 重复提交。',
                    429: '请求过于频繁，请稍后重试原请求。',
                };
                const error = payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : undefined;
                const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
                throw new ClientError(typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) && !code.includes(this.token) && !code.startsWith('vt_') ? code : `HTTP_${response.status}`,
                    messages[response.status] ?? 'API 拒绝了请求；请检查输入和服务状态。', response.status);
            }
            if (!payload || typeof payload !== 'object' || !('data' in payload)) {
                throw new ClientError('INVALID_RESPONSE', 'API 响应缺少 data。', response.status);
            }
            // 即使服务端错误地回显凭据，也不让它进入输出或本地会话元数据。
            return JSON.parse(redact(JSON.stringify(payload), this.token)) as ApiResult;
        }
        throw new ClientError('NETWORK_ERROR', '请求未完成。');
    }

    private pause(attempt: number) {
        return (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(250 * 2 ** attempt);
    }
}
