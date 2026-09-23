export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}

export const SCOPES = ['vocabulary:read', 'vocabulary:write', 'practice:write', 'sentences:write'] as const;
export const DEFAULT_PREFERENCES = { language: 'de', timezone: 'Europe/Berlin', session_size: 10, duration_minutes: 10, correction_style: 'after_answer', interests: [] as string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function invalid(message: string): never { throw new ApiError(400, 'invalid_input', message); }
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请求内容必须是 JSON 对象');
    return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key))) invalid('请求包含不支持的字段');
}
export function str(value: unknown, name: string, max = 500, optional = false): string {
    if (optional && (value === undefined || value === null)) return '';
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) invalid(`${name} 格式不正确`);
    return value.trim();
}
export function integer(value: unknown, name: string, min: number, max: number, fallback?: number): number {
    if (value === undefined || value === null) { if (fallback !== undefined) return fallback; invalid(`${name} 必填`); }
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') invalid(`${name} 必须为整数`);
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) invalid(`${name} 必须在 ${min} 到 ${max} 之间`);
    return n;
}
export function choice<T extends string>(value: unknown, name: string, options: readonly T[], fallback?: T): T {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || !options.includes(value as T)) invalid(`${name} 不支持这个值`);
    return value as T;
}
export function uuid(value: unknown, name = 'id'): string {
    if (typeof value !== 'string' || !UUID.test(value)) invalid(`${name} 必须为 UUID`);
    return value.toLowerCase();
}
export function strings(value: unknown, name: string, maxCount: number, maxLength = 100): string[] {
    if (!Array.isArray(value) || value.length > maxCount) invalid(`${name} 列表过长或格式错误`);
    return value.map(v => str(v, name, maxLength));
}
export function timezone(value: unknown): string {
    const zone = str(value, 'timezone', 80);
    try {
        const normalized = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
        if (/^[+-]/.test(normalized)) invalid('请使用 Europe/Berlin 这样的命名时区');
        return normalized;
    } catch { invalid('时区无效'); }
}
export function timestamp(value: unknown): string {
    const raw = str(value, 'practiced_at', 40);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) invalid('practiced_at 必须为带时区的 ISO 时间');
    if (Date.parse(raw) > Date.now() + 5 * 60_000) invalid('练习时间不能在未来');
    return new Date(raw).toISOString();
}

export function calendarDate(value: unknown): string {
    const raw = str(value, 'date', 10);
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith('0000') || !Number.isFinite(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== raw) invalid('date 必须为有效的 YYYY-MM-DD 日期');
    return raw;
}

export function tokenScopes(value: unknown): string[] {
    const scopes = [...new Set(strings(value, 'scopes', SCOPES.length))];
    if (!scopes.includes('vocabulary:read') || scopes.some(scope => !(SCOPES as readonly string[]).includes(scope))) {
        invalid('连接必须包含读词权限，且只能选择支持的权限');
    }
    return scopes;
}

export function sentenceAnnotations(value: unknown, kind: 'keywords' | 'grammar'): Record<string, string>[] {
    const list = value ?? [];
    if (!Array.isArray(list) || list.length > 50) invalid(`${kind} 格式错误或数量过多`);
    return list.map((entry): Record<string, string> => {
        const item = object(entry);
        if (kind === 'keywords') {
            keys(item, ['word', 'meaning', 'partOfSpeech']);
            return { word: str(item.word, 'word', 200), meaning: str(item.meaning, 'meaning', 1000),
                ...(item.partOfSpeech === undefined ? {} : { partOfSpeech: str(item.partOfSpeech, 'partOfSpeech', 80, true) }) };
        }
        keys(item, ['point', 'explanation']);
        return { point: str(item.point, 'point', 200), explanation: str(item.explanation, 'explanation', 2000) };
    });
}

export function createdTimestamp(value: unknown): string {
    const raw = str(value, 'created_at', 40);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) invalid('created_at 必须为带时区的 ISO 时间');
    return new Date(raw).toISOString();
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'content_type', '请发送 application/json');
    const reader = request.body?.getReader();
    if (!reader) invalid('缺少请求内容');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 32_768) { await reader.cancel(); throw new ApiError(413, 'too_large', '请求内容过大'); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return object(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
        if (error instanceof ApiError) throw error;
        invalid('JSON 格式不正确');
    } finally { reader.releaseLock(); }
}

export function validateEvent(body: Record<string, unknown>): Record<string, unknown> {
    keys(body, ['id', 'word_id', 'session_id', 'grade', 'source', 'practiced_at', 'timezone', 'answer', 'feedback', 'error_tags', 'hint_count']);
    return {
        id: uuid(body.id), word_id: uuid(body.word_id, 'word_id'), session_id: body.session_id ? uuid(body.session_id, 'session_id') : null,
        grade: choice(body.grade, 'grade', ['forgot', 'fuzzy', 'known']), source: choice(body.source, 'source', ['web', 'codex']),
        practiced_at: timestamp(body.practiced_at), timezone: timezone(body.timezone),
        answer: str(body.answer, 'answer', 4000, true), feedback: str(body.feedback, 'feedback', 4000, true),
        error_tags: strings(body.error_tags ?? [], 'error_tags', 12, 80), hint_count: integer(body.hint_count, 'hint_count', 0, 20, 0),
    };
}
