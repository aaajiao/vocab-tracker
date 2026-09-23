import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, SCOPES } from './validation';

export interface Identity { userId: string; email?: string; scopes: string[]; kind: 'session' | 'token'; tokenId?: string }
export function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newToken() { const raw = `vt_${randomBytes(32).toString('base64url')}`; return { raw, hash: tokenHash(raw), id: randomUUID(), prefix: raw.slice(0, 11) }; }
export const TOKEN_COLUMNS = 'id,name,prefix,scopes,created_at,expires_at,revoked_at,last_used_at';

export async function authenticate(request: Request, db: SupabaseClient): Promise<Identity> {
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '');
    if (!match || match[1].length > 8192) throw new ApiError(401, 'unauthorized', '请连接生词本账号');
    const token = match[1];
    if (token.startsWith('vt_')) {
        if (!/^vt_[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'unauthorized', '访问令牌无效或已失效');
        const { data, error } = await db.from('api_access_tokens').select('id,user_id,scopes,expires_at,revoked_at').eq('token_hash', tokenHash(token)).maybeSingle();
        if (error) throw new ApiError(503, 'unavailable', '暂时无法验证访问令牌');
        if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) throw new ApiError(401, 'unauthorized', '访问令牌无效或已失效');
        // 用户删除后不可继续使用旧令牌；外键亦会清理令牌。
        await db.from('api_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
        return { userId: data.user_id, scopes: data.scopes, kind: 'token', tokenId: data.id };
    }
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) throw new ApiError(401, 'unauthorized', '登录已失效，请重新登录');
    return { userId: data.user.id, email: data.user.email, scopes: [...SCOPES], kind: 'session' };
}

export function requireScope(identity: Identity, scope: string) {
    if (!identity.scopes.includes(scope)) throw new ApiError(403, 'insufficient_scope', '当前连接未授权此操作');
}
export function requireSession(identity: Identity) {
    if (identity.kind !== 'session') throw new ApiError(403, 'session_required', '请在生词本设置中管理连接');
}
