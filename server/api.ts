import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './client.js';
import { authenticate, newToken, requireScope, requireSession, TOKEN_COLUMNS, type Identity } from './auth.js';
import { ApiError, DEFAULT_PREFERENCES, calendarDate, choice, integer, invalid, jsonBody, keys, str, strings, timezone, tokenScopes, uuid, validateEvent } from './validation.js';

const WORD_COLUMNS = 'id,word,meaning,language,example,example_cn,category,date,created_at,etymology';
const SENTENCE_COLUMNS = 'id,sentence,sentence_cn,language,scene,source_type,source_words,keywords,grammar,created_at';
const SESSION_COLUMNS = 'id,language,mode,topic,word_ids,sentence_ids,target_minutes,status,summary,version,created_at,updated_at,completed_at';
const EVENT_COLUMNS = 'id,word_id,session_id,grade,source,practiced_at,timezone,answer,feedback,error_tags,hint_count,scheduling_applied,state_after,word_snapshot,created_at';

function dbError(error: { code?: string } | null) {
    if (!error) return;
    const status = { PT400: 400, PT404: 404, PT409: 409, '23505': 409, '23503': 404, '23514': 400, '22P02': 400, '22023': 400 }[error.code || ''];
    if (status) throw new ApiError(status, status === 409 ? 'conflict' : status === 404 ? 'not_found' : 'invalid_input', status === 409 ? '记录已变化或此编号已用于其他内容，请重新读取后处理' : status === 404 ? '记录不存在或不属于当前账号' : '提交的数据不符合要求');
    throw new ApiError(503, 'unavailable', '学习服务暂时不可用，请稍后重试');
}
function publicData(data: unknown): unknown {
    if (Array.isArray(data)) return data.map(publicData);
    if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).filter(([key]) => !['token_hash', 'request_payload', 'initial_payload', 'user_id'].includes(key)).map(([key, value]) => [key, publicData(value)]));
    return data;
}
function result(data: unknown, meta?: Record<string, unknown>, status = 200) { return Response.json({ data: publicData(data), ...(meta ? { meta } : {}) }, { status }); }
function page(data: unknown[], limit: number, offset: number) { return result(data.slice(0, limit), { has_more: data.length > limit, next_offset: data.length > limit ? offset + limit : null }); }
function searchPattern(query: string) { return `"%${query.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&').replace(/"/g, '\\"')}%"`; }
async function rpc(db: SupabaseClient, name: string, userId: string, args: Record<string, unknown>) { const { data, error } = await db.rpc(name, { p_user_id: userId, ...args }); dbError(error); return data; }
async function preferences(db: SupabaseClient, userId: string) {
    const { data, error } = await db.from('learning_preferences').select('language,timezone,session_size,duration_minutes,correction_style,interests').eq('user_id', userId).maybeSingle();
    dbError(error); return data || { ...DEFAULT_PREFERENCES };
}

export async function route(request: Request, db: SupabaseClient, identity: Identity): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '');
    const method = request.method.toUpperCase();
    const params = url.searchParams;
    const limit = integer(params.get('limit'), 'limit', 1, 100, path === 'practice-materials' ? 10 : 20);
    const offset = integer(params.get('offset'), 'offset', 0, 100_000, 0);
    const userId = identity.userId;
    const read = () => requireScope(identity, 'vocabulary:read');
    const write = () => requireScope(identity, 'practice:write');

    if (path === 'me' && method === 'GET') { read(); return result({ id: userId, email: identity.email, scopes: identity.scopes, preferences: await preferences(db, userId) }); }
    if (path === 'tokens' || path.startsWith('tokens/')) {
        requireSession(identity);
        if (path === 'tokens' && method === 'GET') {
            const { data, error } = await db.from('api_access_tokens').select(TOKEN_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).order('id').range(offset, offset + limit);
            dbError(error); return page(data || [], limit, offset);
        }
        if (path === 'tokens' && method === 'POST') {
            const body = await jsonBody(request); keys(body, ['name', 'scopes', 'expires_in_days']);
            const scopes = tokenScopes(body.scopes);
            const token = newToken();
            const { data, error } = await db.from('api_access_tokens').insert({ id: token.id, user_id: userId, name: str(body.name, 'name', 80), prefix: token.prefix, token_hash: token.hash, scopes, expires_at: new Date(Date.now() + integer(body.expires_in_days, 'expires_in_days', 1, 365, 90) * 86400_000).toISOString() }).select(TOKEN_COLUMNS).single();
            dbError(error); return result({ token: data, access_token: token.raw }, undefined, 201);
        }
        if (/^tokens\/[^/]+$/.test(path) && method === 'PATCH') {
            const body = await jsonBody(request); keys(body, ['scopes']);
            const scopes = tokenScopes(body.scopes);
            const { data, error } = await db.from('api_access_tokens').update({ scopes })
                .eq('id', uuid(path.split('/')[1])).eq('user_id', userId)
                .is('revoked_at', null).gt('expires_at', new Date().toISOString()).select(TOKEN_COLUMNS).maybeSingle();
            dbError(error); if (!data) throw new ApiError(404, 'not_found', '连接不存在、已撤销或已过期');
            return result(data);
        }
        if (/^tokens\/[^/]+$/.test(path) && method === 'DELETE') {
            const { data, error } = await db.from('api_access_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', uuid(path.split('/')[1])).eq('user_id', userId).select('id').maybeSingle();
            dbError(error); if (!data) throw new ApiError(404, 'not_found', '连接不存在'); return result({ revoked: true, id: data.id });
        }
    }
    if (path === 'words' && method === 'GET') {
        read(); let query = db.from('words').select(WORD_COLUMNS).eq('user_id', userId);
        if (params.has('language')) query = query.eq('language', choice(params.get('language'), 'language', ['en', 'de']));
        if (params.has('category')) query = query.eq('category', choice(params.get('category'), 'category', ['daily', 'professional', 'formal', '']));
        if (params.has('q')) { const pattern = searchPattern(str(params.get('q'), 'q', 150)); query = query.or(`word.ilike.${pattern},meaning.ilike.${pattern}`); }
        if (params.has('ids')) { const ids = str(params.get('ids'), 'ids', 3700).split(',').map(v => uuid(v)); if (ids.length > 100) invalid('一次最多查询 100 个词'); query = query.in('id', ids); }
        for (const name of ['since', 'until']) if (params.has(name)) { const date = str(params.get(name), name, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid('日期必须为 YYYY-MM-DD'); query = name === 'since' ? query.gte('date', date) : query.lte('date', date); }
        const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit);
        dbError(error); return page(data || [], limit, offset);
    }
    if (path === 'words' && method === 'POST') {
        requireScope(identity, 'vocabulary:write'); const body = await jsonBody(request);
        keys(body, ['id', 'word', 'meaning', 'language', 'example', 'example_cn', 'category', 'date', 'etymology']);
        const word = {
            id: uuid(body.id), word: str(body.word, 'word', 200), meaning: str(body.meaning, 'meaning', 4000),
            language: choice(body.language, 'language', ['en', 'de']), example: str(body.example, 'example', 4000, true),
            example_cn: str(body.example_cn, 'example_cn', 4000, true),
            category: choice(body.category ?? '', 'category', ['daily', 'professional', 'formal', '']),
            etymology: str(body.etymology, 'etymology', 8000, true),
            ...(body.date === undefined || body.date === null ? {} : { date: calendarDate(body.date) }),
        };
        const data = await rpc(db, 'learning_save_word', userId, { p_word: word });
        return result(data.word, { created: data.created, duplicate: data.duplicate, replayed: data.replayed });
    }
    if (path === 'practice-materials' && method === 'GET') {
        read(); if (offset !== 0) invalid('混合练习自动选取一组材料，不支持分页偏移');
        const prefs = await preferences(db, userId);
        const data = await rpc(db, 'learning_get_practice_materials', userId, {
            p_language: params.has('language') ? choice(params.get('language'), 'language', ['en', 'de']) : null,
            p_timezone: timezone(params.get('timezone') || prefs.timezone), p_limit: limit,
        });
        return result(data.data, data.meta);
    }
    if (path === 'sentences' && method === 'GET') {
        read(); let query = db.from('saved_sentences').select(SENTENCE_COLUMNS).eq('user_id', userId);
        if (params.has('language')) query = query.eq('language', choice(params.get('language'), 'language', ['en', 'de']));
        if (params.has('q')) { const pattern = searchPattern(str(params.get('q'), 'q', 150)); query = query.or(`sentence.ilike.${pattern},sentence_cn.ilike.${pattern}`); }
        const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit);
        dbError(error); return page(data || [], limit, offset);
    }
    if (path === 'sentences' && method === 'POST') {
        requireScope(identity, 'sentences:write'); const body = await jsonBody(request);
        keys(body, ['id', 'sentence', 'sentence_cn', 'language', 'scene', 'source_words']);
        const sentence = { id: uuid(body.id), sentence: str(body.sentence, 'sentence', 4000), sentence_cn: str(body.sentence_cn, 'sentence_cn', 4000, true), language: choice(body.language, 'language', ['en', 'de']), scene: str(body.scene, 'scene', 100, true), source_words: strings(body.source_words ?? [], 'source_words', 50, 200) };
        return result(await rpc(db, 'learning_save_sentence', userId, { p_sentence: sentence }));
    }
    if (path === 'review' && method === 'GET') {
        read(); const prefs = await preferences(db, userId);
        const zone = timezone(params.get('timezone') || prefs.timezone);
        const data = await rpc(db, 'learning_get_review', userId, { p_language: params.has('language') ? choice(params.get('language'), 'language', ['en', 'de']) : null, p_mode: choice(params.get('mode') ?? undefined, 'mode', ['due', 'ahead', 'all'], 'due'), p_timezone: zone, p_limit: limit, p_offset: offset });
        return result(data.data, { ...data.meta, timezone: zone });
    }
    if (path === 'preferences' && method === 'GET') { read(); return result(await preferences(db, userId)); }
    if (path === 'preferences' && method === 'PATCH') {
        write(); const body = await jsonBody(request); keys(body, Object.keys(DEFAULT_PREFERENCES));
        const patch: Record<string, unknown> = {};
        if (body.language !== undefined) patch.language = choice(body.language, 'language', ['en', 'de']);
        if (body.timezone !== undefined) patch.timezone = timezone(body.timezone);
        if (body.session_size !== undefined) patch.session_size = integer(body.session_size, 'session_size', 1, 50);
        if (body.duration_minutes !== undefined) patch.duration_minutes = integer(body.duration_minutes, 'duration_minutes', 1, 60);
        if (body.correction_style !== undefined) patch.correction_style = choice(body.correction_style, 'correction_style', ['after_answer', 'end_of_session']);
        if (body.interests !== undefined) patch.interests = strings(body.interests, 'interests', 20, 80);
        // 先保证默认行存在，再局部 UPDATE，避免并发 PATCH 覆盖未修改字段。
        const init = await db.from('learning_preferences').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true }); dbError(init.error);
        if (Object.keys(patch).length) { const update = await db.from('learning_preferences').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId); dbError(update.error); }
        return result(await preferences(db, userId));
    }
    if (path === 'sessions' && method === 'GET') {
        read(); let query = db.from('practice_sessions').select(SESSION_COLUMNS).eq('user_id', userId);
        if (params.has('status')) query = query.eq('status', choice(params.get('status'), 'status', ['active', 'completed', 'abandoned']));
        const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit); dbError(error); return page(data || [], limit, offset);
    }
    if (path === 'sessions' && method === 'POST') {
        write(); const body = await jsonBody(request); keys(body, ['id', 'language', 'mode', 'topic', 'word_ids', 'sentence_ids', 'target_minutes']);
        const wordIds = strings(body.word_ids ?? [], 'word_ids', 100, 36).map(v => uuid(v, 'word_ids'));
        const sentenceIds = strings(body.sentence_ids ?? [], 'sentence_ids', 100, 36).map(v => uuid(v, 'sentence_ids'));
        if (wordIds.length + sentenceIds.length < 1 || wordIds.length + sentenceIds.length > 100
            || new Set(wordIds).size !== wordIds.length || new Set(sentenceIds).size !== sentenceIds.length) invalid('会话需包含 1–100 项不重复的词汇或句子');
        return result(await rpc(db, 'learning_create_session', userId, { p_session: { id: uuid(body.id), language: choice(body.language, 'language', ['en', 'de', 'mixed']), mode: choice(body.mode, 'mode', ['conversation', 'recall', 'cloze']), topic: str(body.topic, 'topic', 200, true), word_ids: wordIds, sentence_ids: sentenceIds, target_minutes: integer(body.target_minutes, 'target_minutes', 1, 60, 10) } }));
    }
    if (/^sessions\/[^/]+$/.test(path)) {
        const id = uuid(path.split('/')[1]);
        if (method === 'GET') {
            read(); const { data, error } = await db.from('practice_sessions').select(SESSION_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle(); dbError(error);
            if (!data) throw new ApiError(404, 'not_found', '练习不存在');
            const events = await db.from('review_events').select(EVENT_COLUMNS, { count: 'exact' }).eq('session_id', id).eq('user_id', userId).order('practiced_at').order('id').limit(1000); dbError(events.error);
            return result({ session: data, events: events.data || [] }, { events_truncated: (events.count || 0) > (events.data?.length || 0) });
        }
        if (method === 'PATCH') {
            write(); const body = await jsonBody(request); keys(body, ['status', 'summary', 'expected_version']);
            const patch: Record<string, unknown> = { expected_version: integer(body.expected_version, 'expected_version', 1, 2147483647) };
            if (body.status !== undefined) patch.status = choice(body.status, 'status', ['active', 'completed', 'abandoned']);
            if (body.summary !== undefined) patch.summary = str(body.summary, 'summary', 8000, true);
            return result(await rpc(db, 'learning_update_session', userId, { p_session_id: id, p_patch: patch }));
        }
    }
    if (path === 'events' && method === 'GET') {
        read(); let query = db.from('review_events').select(EVENT_COLUMNS).eq('user_id', userId);
        if (params.has('word_id')) query = query.eq('word_id', uuid(params.get('word_id'), 'word_id'));
        if (params.has('session_id')) query = query.eq('session_id', uuid(params.get('session_id'), 'session_id'));
        const { data, error } = await query.order('practiced_at', { ascending: false }).order('id').range(offset, offset + limit); dbError(error); return page(data || [], limit, offset);
    }
    if (path === 'events' && method === 'POST') {
        write(); const body = validateEvent(await jsonBody(request));
        if (identity.kind === 'token' && body.source !== 'codex') invalid('外部连接的练习来源必须为 codex');
        return result(await rpc(db, 'learning_record_event', userId, { p_event: body }));
    }
    throw new ApiError(404, 'not_found', '接口不存在或不支持此方法');
}

export function createHandler(getDb: () => SupabaseClient = getServiceClient) {
    return async (request: Request): Promise<Response> => {
        let response: Response;
        try {
            const url = new URL(request.url);
            if (!url.pathname.startsWith('/api/v1/')) throw new ApiError(404, 'not_found', '接口不存在');
            if (request.method === 'OPTIONS') return new Response(null, { status: 405 });
            const db = getDb();
            const identity = await authenticate(request, db);
            response = await route(request, db, identity);
        } catch (error) {
            const safe = error instanceof ApiError ? error : new ApiError(500, 'internal_error', '请求未能完成，请稍后再试');
            response = Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status });
            if (safe.status === 401) response.headers.set('WWW-Authenticate', 'Bearer');
        }
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Authorization');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        return response;
    };
}
export const handleRequest = createHandler();
