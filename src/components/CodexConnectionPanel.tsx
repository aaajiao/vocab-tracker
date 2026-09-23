import { useState, useEffect, useRef, useCallback, memo, type FormEvent } from 'react';
import { learningApi, learningErrorMessage, type AccessTokenMetadata, type LearningScope } from '../services/learningApi';

const fieldClass = 'w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100';
const buttonClass = 'px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const scopeLabels: Record<LearningScope, string> = {
    'vocabulary:read': '读取生词本和学习记录',
    'practice:write': '保存练习结果',
    'vocabulary:write': '添加新单词',
    'sentences:write': '收藏新句子',
};
const defaultScopes: LearningScope[] = ['vocabulary:read', 'practice:write', 'vocabulary:write', 'sentences:write'];

function formatTime(value: string | null): string {
    if (!value) return '尚未使用';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleDateString('zh-CN');
}

function AccountConnectionPanel({ userId }: { userId: string }) {
    const [tokens, setTokens] = useState<AccessTokenMetadata[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [name, setName] = useState('我的 Codex');
    const [expiryDays, setExpiryDays] = useState(90);
    const [scopes, setScopes] = useState<LearningScope[]>(defaultScopes);
    const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const busyRef = useRef(false);
    const mountedRef = useRef(false);
    const loadRef = useRef<AbortController | null>(null);
    const actionRef = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        loadRef.current?.abort();
        const controller = new AbortController();
        loadRef.current = controller;
        setLoading(true);
        try {
            const result = await learningApi.getTokens(userId, controller.signal);
            if (!controller.signal.aborted && mountedRef.current) {
                setTokens(result.data);
                setError('');
            }
        } catch (cause) {
            if (!controller.signal.aborted && mountedRef.current) setError(learningErrorMessage(cause));
        } finally {
            if (!controller.signal.aborted && mountedRef.current) setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        mountedRef.current = true;
        void load();
        const onFocus = () => { if (!busyRef.current) void load(); };
        window.addEventListener('focus', onFocus);
        return () => {
            mountedRef.current = false;
            loadRef.current?.abort();
            actionRef.current?.abort();
            window.removeEventListener('focus', onFocus);
        };
    }, [load]);

    const runAction = useCallback(async (key: string, action: (signal: AbortSignal) => Promise<void>) => {
        // 同步锁阻止连续点击在 React 更新前提交第二次。
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(key);
        setError('');
        setMessage('');
        loadRef.current?.abort();
        setLoading(false);
        const controller = new AbortController();
        actionRef.current = controller;
        try {
            await action(controller.signal);
        } catch (cause) {
            if (!controller.signal.aborted && mountedRef.current) setError(learningErrorMessage(cause));
        } finally {
            if (!controller.signal.aborted && mountedRef.current) {
                busyRef.current = false;
                setBusy(null);
            }
        }
    }, []);

    const createToken = useCallback((event: FormEvent) => {
        event.preventDefault();
        if (secret || !name.trim()) return;
        void runAction('create', async (signal) => {
            const result = await learningApi.createToken(userId, { name: name.trim(), scopes, expires_in_days: expiryDays }, signal);
            if (signal.aborted || !mountedRef.current) return;
            setSecret({ id: result.data.token.id, value: result.data.access_token });
            setCopied(false);
            setTokens((previous) => [result.data.token, ...previous.filter((token) => token.id !== result.data.token.id)]);
        });
    }, [userId, name, scopes, expiryDays, secret, runAction]);

    const revokeToken = useCallback((id: string) => {
        void runAction(`revoke:${id}`, async (signal) => {
            await learningApi.revokeToken(userId, id, signal);
            if (signal.aborted || !mountedRef.current) return;
            setTokens((previous) => previous.map((token) => token.id === id ? { ...token, revoked_at: new Date().toISOString() } : token));
            setSecret((previous) => previous?.id === id ? null : previous);
            setMessage('连接已撤销。');
        });
    }, [runAction, userId]);

    const enableWordSaving = useCallback((token: AccessTokenMetadata) => {
        void runAction(`scope:${token.id}`, async (signal) => {
            const updatedScopes = [...new Set<LearningScope>([...token.scopes, 'vocabulary:write'])];
            const result = await learningApi.updateTokenScopes(userId, token.id, updatedScopes, signal);
            if (signal.aborted || !mountedRef.current) return;
            setTokens((previous) => previous.map((item) => item.id === token.id ? result.data : item));
            setMessage('已允许这个连接保存新单词，无需重新连接 Codex。');
        });
    }, [runAction, userId]);

    const copySecret = useCallback(async () => {
        if (!secret) return;
        try {
            await navigator.clipboard.writeText(secret.value);
            if (mountedRef.current) setCopied(true);
        } catch {
            if (mountedRef.current) setError('无法自动复制，请选中令牌后手动复制。');
        }
    }, [secret]);

    return (
        <section className="space-y-3" aria-labelledby="codex-connection-title">
            <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 id="codex-connection-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Codex 练习</h3>
                    <button type="button" onClick={() => void load()} disabled={loading || !!busy} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50 px-2 py-1 rounded">{loading ? '刷新中…' : '刷新连接'}</button>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">按记忆曲线优先复习到期单词，结合收藏句子，自动安排 10 项练习。德语和英语一起练，练法和语境随对话变化。</p>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 mt-1">连接后直接说“开始复习”，也可以用语音。想调整练习时，在对话中告诉 Codex 就好。</p>
            </div>
            {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {message && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
            {secret && <div className="space-y-2">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">令牌只显示这一次，请复制后在本机连接流程中保存，不要发进聊天。</p>
                <textarea aria-label="新创建的连接令牌" value={secret.value} readOnly rows={3} autoComplete="off" spellCheck={false} className={`${fieldClass} font-mono text-xs break-all resize-none`} onFocus={(event) => event.currentTarget.select()} />
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void copySecret()} className={buttonClass}>{copied ? '已复制' : '复制令牌'}</button>
                    <button type="button" onClick={() => { setSecret(null); setCopied(false); setMessage(''); }} className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">已保存，关闭显示</button>
                </div>
            </div>}
            {tokens.length > 0 && <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                {tokens.map((token) => {
                    const expired = new Date(token.expires_at).getTime() <= Date.now();
                    const inactive = !!token.revoked_at || expired;
                    return <li key={token.id} className="py-2 first:pt-0 last:pb-0 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="text-sm text-slate-800 dark:text-slate-100 break-words">{token.name}</p><p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{token.revoked_at ? '已撤销' : expired ? '已过期' : `有效至 ${formatTime(token.expires_at)}`} · {token.last_used_at ? `最近使用 ${formatTime(token.last_used_at)}` : '尚未使用'}</p></div>
                            {!inactive && <button type="button" onClick={() => revokeToken(token.id)} disabled={!!busy} aria-label={`撤销 ${token.name}`} className="shrink-0 px-2 py-1 text-xs rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">{busy === `revoke:${token.id}` ? '撤销中…' : '撤销'}</button>}
                        </div>
                        {!inactive && !token.scopes.includes('vocabulary:write') && <button type="button" onClick={() => enableWordSaving(token)} disabled={!!busy} aria-label={`允许 ${token.name} 保存新词`} className="text-xs text-slate-600 dark:text-slate-300 underline underline-offset-2 py-1 disabled:opacity-50">{busy === `scope:${token.id}` ? '更新中…' : '允许保存新词'}</button>}
                        <details className="text-xs text-slate-400 dark:text-slate-500"><summary className="cursor-pointer py-1">连接信息</summary><p className="mt-1 leading-relaxed">{token.prefix}… · {token.scopes.map((scope) => scopeLabels[scope]).join('、')}</p></details>
                    </li>;
                })}
            </ul>}
            <form onSubmit={createToken}>
                <fieldset disabled={loading || !!busy || !!secret} className="space-y-2 disabled:opacity-60">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="submit" className={buttonClass} disabled={!name.trim()}>{busy === 'create' ? '创建中…' : tokens.some((token) => !token.revoked_at && new Date(token.expires_at).getTime() > Date.now()) ? '添加另一个连接' : '创建 Codex 连接'}</button>
                        <span className="text-xs text-slate-400 dark:text-slate-500">可随时撤销</span>
                    </div>
                    <details className="text-xs text-slate-500 dark:text-slate-400">
                        <summary className="cursor-pointer py-1">连接选项</summary>
                        <div className="space-y-3 mt-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="block text-xs text-slate-500 dark:text-slate-400">名称<input name="connection-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className={`${fieldClass} mt-1`} /></label>
                                <label className="block text-xs text-slate-500 dark:text-slate-400">有效期<select value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))} className={`${fieldClass} mt-1`}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>1 年</option></select></label>
                            </div>
                            <div className="space-y-2">
                                {(Object.keys(scopeLabels) as LearningScope[]).map((scope) => <label key={scope} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400"><input type="checkbox" className="mt-0.5 accent-slate-700 dark:accent-slate-300" checked={scopes.includes(scope)} disabled={scope === 'vocabulary:read'} onChange={(event) => setScopes((previous) => event.target.checked ? [...previous, scope] : previous.filter((item) => item !== scope))} /><span>{scopeLabels[scope]}{scope === 'vocabulary:read' ? '（基础权限）' : ''}</span></label>)}
                            </div>
                        </div>
                    </details>
                </fieldset>
            </form>
            <details className="text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer py-1">如何连接 Codex</summary>
                <ol className="list-decimal pl-5 mt-2 space-y-2 leading-relaxed">
                    <li>在项目目录运行 <code className="rounded bg-slate-200/70 dark:bg-slate-900 px-1 py-0.5">bun run codex:install</code> 安装复习 Skill。</li>
                    <li>创建连接令牌，在安装说明中的本机连接流程里输入网站地址和令牌。</li>
                    <li>在 Codex 中说“开始复习”。词库和学习记录都保存在生词本。</li>
                </ol>
            </details>
        </section>
    );
}

function CodexConnectionPanel({ userId }: { userId: string }) {
    // 切换账号立即销毁包含一次性凭据的组件，旧请求无法更新新账号视图。
    return <AccountConnectionPanel key={userId} userId={userId} />;
}

export default memo(CodexConnectionPanel);
