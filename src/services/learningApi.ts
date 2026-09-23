import type { ReviewGrade } from './srs';
import { supabase } from '../supabaseClient';

export type LearningScope = 'vocabulary:read' | 'practice:write' | 'vocabulary:write' | 'sentences:write';
export type CorrectionStyle = 'after_answer' | 'end_of_session';

export interface LearningPreferences {
    language: 'en' | 'de';
    timezone: string;
    session_size: number;
    duration_minutes: number;
    correction_style: CorrectionStyle;
    interests: string[];
}

export interface AccessTokenMetadata {
    id: string;
    name: string;
    prefix: string;
    scopes: LearningScope[];
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

export interface PracticeSession {
    id: string;
    language: 'en' | 'de' | 'mixed';
    mode: 'conversation' | 'recall' | 'cloze';
    topic: string;
    word_ids: string[];
    sentence_ids: string[];
    target_minutes: number;
    status: 'active' | 'completed' | 'abandoned';
    summary: string | null;
    version: number;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

export interface PracticeEvent {
    id: string;
    word_id: string;
    session_id: string | null;
    grade: ReviewGrade;
    source: 'web' | 'codex';
    practiced_at: string;
    timezone: string;
    answer: string | null;
    feedback: string | null;
    error_tags: string[];
    hint_count: number;
    scheduling_applied: boolean;
    state_after: ApiReviewState;
    created_at: string;
    word_snapshot: { id: string; word: string; meaning: string; language: 'en' | 'de' } | null;
}

export interface LearningApiResult<T> {
    data: T;
    meta?: { has_more?: boolean; next_offset?: number | null; [key: string]: unknown };
}

export class LearningApiError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 0) {
        super(message);
        this.name = 'LearningApiError';
    }
}

interface LearningRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    userId?: string;
}

function authError(): LearningApiError {
    return new LearningApiError('unauthorized', '登录已失效，请重新登录后再试。', 401);
}

function responseError(status: number, code?: string): LearningApiError {
    // 只显示受控文案，避免将代理响应、凭据或内部数据库错误渲染到页面。
    const messages: Record<number, string> = {
        400: '提交的信息不符合要求，请检查后再试。',
        401: '登录已失效，请重新登录后再试。',
        403: '当前账号没有权限执行这项操作。',
        404: '没有找到这条记录，请刷新后再试。',
        409: '记录已发生变化，请刷新后再试。',
        429: '操作过于频繁，请稍后再试。',
        503: '学习服务尚未就绪，请稍后再试。',
    };
    return new LearningApiError(code || 'request_failed', messages[status] || '学习服务暂时不可用，请稍后再试。', status);
}

export function learningErrorMessage(error: unknown): string {
    return error instanceof LearningApiError ? error.message : '连接失败，请检查网络后再试。';
}

/** 使用网站登录会话访问同源 API；个人令牌只在创建时返回，不在浏览器持久化。 */
async function performLearningRequest<T>(path: string, options: LearningRequestOptions = {}): Promise<LearningApiResult<T>> {
    if (!/^\/[a-z][a-z0-9/?=&,%_:-]*$/i.test(path) || path.includes('//')) {
        throw new LearningApiError('invalid_path', '无效的学习服务地址。');
    }
    const { signal, userId } = options;
    signal?.throwIfAborted();
    const { data: { session }, error } = await supabase.auth.getSession();
    signal?.throwIfAborted();
    if (error || !session?.access_token || (userId && session.user.id !== userId)) throw authError();

    const send = async (accessToken: string): Promise<Response> => {
        try {
            return await fetch(`/api/v1${path}`, {
                method: options.method || 'GET',
                headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal,
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'error',
            });
        } catch (cause) {
            if (signal?.aborted) throw signal.reason;
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
            throw new LearningApiError('network_error', '连接失败，请检查网络后再试。');
        }
    };
    let response = await send(session.access_token);
    if (response.status === 401) {
        // 一次明确的鉴权失败才刷新登录；不对可能已成功的写入做网络重试。
        const current = await supabase.auth.getSession();
        signal?.throwIfAborted();
        if (current.error || current.data.session?.user.id !== session.user.id) throw authError();
        const refreshed = await supabase.auth.refreshSession();
        signal?.throwIfAborted();
        if (refreshed.error || !refreshed.data.session?.access_token || refreshed.data.session.user.id !== session.user.id) throw authError();
        response = await send(refreshed.data.session.access_token);
    }
    signal?.throwIfAborted();
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        if (!response.ok) throw responseError(response.status);
        throw new LearningApiError('invalid_response', '学习服务返回了无效内容，请刷新后再试。');
    }
    signal?.throwIfAborted();
    if (!response.ok) {
        const code = typeof payload === 'object' && payload !== null && 'error' in payload
            && typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error
            && typeof payload.error.code === 'string' && /^[a-z_]{1,50}$/i.test(payload.error.code)
            ? payload.error.code : undefined;
        throw responseError(response.status, code);
    }
    if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
        throw new LearningApiError('invalid_response', '学习服务返回了无效内容，请刷新后再试。');
    }
    return payload as LearningApiResult<T>;
}

export const LEARNING_REQUEST_TIMEOUT_MS = 15000;
/** 一个请求（含登录读取、刷新和响应解析）共享期限；调用方取消仍立即生效。 */
export async function learningRequest<T>(path: string, options: LearningRequestOptions = {}): Promise<LearningApiResult<T>> {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel(); else options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new LearningApiError('timeout', '连接超时，请稍后重试；待同步请求仍保留原编号。')), LEARNING_REQUEST_TIMEOUT_MS);
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason);
        if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
        return await Promise.race([performLearningRequest<T>(path, { ...options, signal: controller.signal }), aborted]);
    } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', abort);
    }
}

export const learningApi = {
    getTokens: async (userId: string, signal?: AbortSignal): Promise<LearningApiResult<AccessTokenMetadata[]>> => {
        const tokens: AccessTokenMetadata[] = [];
        let offset = 0;
        for (;;) {
            const result = await learningRequest<AccessTokenMetadata[]>(`/tokens?limit=100&offset=${offset}`, { userId, signal });
            tokens.push(...result.data);
            if (!result.meta?.has_more) return { data: tokens };
            const next = result.meta.next_offset;
            if (typeof next !== 'number' || !Number.isInteger(next) || next <= offset) {
                throw new LearningApiError('invalid_response', '连接列表返回了无效分页，请刷新后再试。');
            }
            offset = next;
        }
    },
    createToken: (userId: string, body: { name: string; scopes: LearningScope[]; expires_in_days: number }, signal?: AbortSignal) =>
        learningRequest<{ token: AccessTokenMetadata; access_token: string }>('/tokens', { method: 'POST', userId, body, signal }),
    updateTokenScopes: (userId: string, id: string, scopes: LearningScope[], signal?: AbortSignal) =>
        learningRequest<AccessTokenMetadata>(`/tokens/${encodeURIComponent(id)}`, { method: 'PATCH', userId, body: { scopes }, signal }),
    revokeToken: (userId: string, id: string, signal?: AbortSignal) =>
        learningRequest<unknown>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE', userId, signal }),
    getPreferences: (userId: string, signal?: AbortSignal) => learningRequest<LearningPreferences>('/preferences', { userId, signal }),
    savePreferences: (userId: string, body: Partial<LearningPreferences>, signal?: AbortSignal) =>
        learningRequest<LearningPreferences>('/preferences', { method: 'PATCH', userId, body, signal }),
    getSessions: (userId: string, offset = 0, signal?: AbortSignal) =>
        learningRequest<PracticeSession[]>(`/sessions?limit=10&offset=${offset}`, { userId, signal }),
    getSession: (userId: string, id: string, signal?: AbortSignal) =>
        learningRequest<{ session: PracticeSession; events: PracticeEvent[] }>(`/sessions/${encodeURIComponent(id)}`, { userId, signal }),
};

export interface ApiReviewState {
    word_id: string;
    due: string;
    interval_days: number;
    ease: number;
    reps: number;
    lapses: number;
    last_reviewed_at: string | null;
    updated_at: string;
}

export type ReviewEventResult = { event: PracticeEvent; state: ApiReviewState | null; replayed: boolean };
