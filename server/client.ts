import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './validation';

let client: SupabaseClient | undefined;
export function getServiceClient(): SupabaseClient {
    if (client) return client;
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new ApiError(503, 'not_configured', '学习服务尚未配置，请稍后再试');
    client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(15_000) })) as typeof fetch },
    });
    return client;
}
