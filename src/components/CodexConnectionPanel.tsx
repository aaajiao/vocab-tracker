import { useState, useEffect, useRef, useCallback, memo, type FormEvent } from 'react';
import { learningApi, learningErrorMessage, type AccessTokenMetadata, type LearningPreferences, type LearningScope } from '../services/learningApi';

const fieldClass = 'w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-400';
const buttonClass = 'px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const scopeLabels: Record<LearningScope, string> = {
    'vocabulary:read': '读取词汇、句子与学习记录',
    'practice:write': '保存练习结果和学习偏好',
    'sentences:write': '收藏练习中产生的句子',
};

function formatTime(value: string | null): string {
    if (!value) return '尚未使用';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleDateString('zh-CN');
}

function AccountConnectionPanel({ userId }: { userId: string }) {
    const [tokens, setTokens] = useState<AccessTokenMetadata[]>([]);
    const [preferences, setPreferences] = useState<LearningPreferences | null>(null);
    const [interests, setInterests] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [name, setName] = useState('我的 Codex');
    const [expiryDays, setExpiryDays] = useState(90);
    const [scopes, setScopes] = useState<LearningScope[]>(['vocabulary:read', 'practice:write', 'sentences:write']);
    const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const mountedRef = useRef(false);
    const loadRef = useRef<AbortController | null>(null);
    const actionRef = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        loadRef.current?.abort();
        const controller = new AbortController();
        loadRef.current = controller;
        setLoading(true);
        const results = await Promise.allSettled([
            learningApi.getTokens(userId, controller.signal),
            learningApi.getPreferences(userId, controller.signal),
        ]);
        if (controller.signal.aborted || !mountedRef.current) return;
        const [tokenResult, preferenceResult] = results;
        if (tokenResult.status === 'fulfilled') setTokens(tokenResult.value.data);
        if (preferenceResult.status === 'fulfilled' && !dirtyRef.current) {
            setPreferences(preferenceResult.value.data);
            setInterests(preferenceResult.value.data.interests.join('，'));
        }
        const failed = results.find((result) => result.status === 'rejected');
        setError(failed?.status === 'rejected' ? learningErrorMessage(failed.reason) : '');
        setLoading(false);
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
            setMessage('连接令牌已创建。请现在复制并在本机完成连接。');
        });
    }, [userId, name, scopes, expiryDays, secret, runAction]);

    const revokeToken = useCallback((id: string) => {
        void runAction(id, async (signal) => {
            await learningApi.revokeToken(userId, id, signal);
            if (signal.aborted || !mountedRef.current) return;
            setTokens((previous) => previous.map((token) => token.id === id ? { ...token, revoked_at: new Date().toISOString() } : token));
            setSecret((previous) => previous?.id === id ? null : previous);
            setMessage('连接已撤销。使用此令牌的 Codex 无法再访问生词本。');
        });
    }, [runAction, userId]);

    const changePreference = useCallback(<K extends keyof LearningPreferences>(key: K, value: LearningPreferences[K]) => {
        dirtyRef.current = true;
        setPreferences((previous) => previous ? { ...previous, [key]: value } : previous);
    }, []);

    const savePreferences = useCallback((event: FormEvent) => {
        event.preventDefault();
        if (!preferences) return;
        const topics = [...new Set(interests.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
        if (topics.length > 20 || topics.some((item) => item.length > 80)) {
            setError('兴趣主题最多 20 项，每项不超过 80 个字。');
            return;
        }
        try {
            new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timezone });
        } catch {
            setError('请输入有效时区，例如 Europe/Berlin。');
            return;
        }
        void runAction('preferences', async (signal) => {
            const result = await learningApi.savePreferences(userId, { ...preferences, interests: topics }, signal);
            if (signal.aborted || !mountedRef.current) return;
            dirtyRef.current = false;
            setPreferences(result.data);
            setInterests(result.data.interests.join('，'));
            setMessage('学习偏好已保存，Codex 下次取词时会使用这些设置。');
        });
    }, [preferences, interests, runAction, userId]);

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
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 mb-6 space-y-5" aria-labelledby="codex-connection-title">
            <div>
                <div className="flex items-center justify-between gap-3">
                    <h3 id="codex-connection-title" className="font-semibold text-slate-800 dark:text-slate-100">连接 Codex</h3>
                    <button type="button" onClick={() => void load()} disabled={loading || !!busy} className="text-xs text-indigo-600 dark:text-indigo-400 disabled:opacity-50 px-2 py-1 rounded focus-visible:ring-2 focus-visible:ring-indigo-400">{loading ? '刷新中…' : '刷新'}</button>
                </div>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 mt-2">词库和学习记录保存在生词本。Codex 按权限读取已同步的内容，带你进行文字或语音练习，并将结果写回这里。</p>
                <ol className="list-decimal pl-5 mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <li>在项目目录运行 <code className="rounded bg-slate-200/70 dark:bg-slate-900 px-1 py-0.5">bun run codex:install</code> 安装复习 Skill。</li>
                    <li>创建连接令牌，在安装说明中的本机连接流程里输入网站地址和令牌。请勿将令牌发进聊天。</li>
                    <li>在 Codex 中说“用我的生词本陪我练习十分钟”，也可以在同一任务开启语音。</li>
                </ol>
            </div>
            {error && <div role="alert" className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-50 dark:bg-red-950/40 p-3">{error}</div>}
            {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            {secret && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-3">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">请保存此令牌，它只显示这一次</p>
                    <textarea aria-label="新创建的连接令牌" value={secret.value} readOnly rows={3} autoComplete="off" spellCheck={false} className={`${fieldClass} font-mono text-xs break-all resize-none`} onFocus={(event) => event.currentTarget.select()} />
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void copySecret()} className={buttonClass}>{copied ? '已复制' : '复制令牌'}</button>
                        <button type="button" onClick={() => { setSecret(null); setCopied(false); setMessage(''); }} className="px-3 py-2 rounded-lg text-sm border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200">已保存，关闭显示</button>
                    </div>
                </div>
            )}
            <form onSubmit={createToken} className="space-y-3">
                <fieldset disabled={!!busy || !!secret} className="space-y-3 disabled:opacity-60">
                    <legend className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-2">新建连接</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block text-xs text-slate-600 dark:text-slate-300">名称<input name="connection-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className={`${fieldClass} mt-1`} /></label>
                        <label className="block text-xs text-slate-600 dark:text-slate-300">有效期<select value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))} className={`${fieldClass} mt-1`}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>1 年</option></select></label>
                    </div>
                    <div className="space-y-2">
                        {(Object.keys(scopeLabels) as LearningScope[]).map((scope) => <label key={scope} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-0.5 accent-indigo-600" checked={scopes.includes(scope)} disabled={scope === 'vocabulary:read'} onChange={(event) => setScopes((previous) => event.target.checked ? [...previous, scope] : previous.filter((item) => item !== scope))} /><span>{scopeLabels[scope]}{scope === 'vocabulary:read' ? '（基础权限）' : ''}</span></label>)}
                    </div>
                    <button type="submit" className={buttonClass} disabled={!name.trim()}>{busy === 'create' ? '创建中…' : '创建连接令牌'}</button>
                </fieldset>
            </form>
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                <h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">已有连接</h4>
                {!loading && tokens.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">还没有连接。创建令牌后，就可以让 Codex 访问你的生词本。</p>}
                <ul className="space-y-2">
                    {tokens.map((token) => {
                        const expired = new Date(token.expires_at).getTime() <= Date.now();
                        const inactive = !!token.revoked_at || expired;
                        return <li key={token.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0"><p className="text-sm font-medium text-slate-800 dark:text-slate-100 break-words">{token.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{token.prefix}… · {token.revoked_at ? '已撤销' : expired ? '已过期' : `有效至 ${formatTime(token.expires_at)}`}</p></div>
                                {!inactive && <button type="button" onClick={() => revokeToken(token.id)} disabled={!!busy} aria-label={`撤销 ${token.name}`} className="shrink-0 px-2 py-1 text-xs rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50">{busy === token.id ? '撤销中…' : '撤销'}</button>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{token.scopes.map((scope) => scopeLabels[scope]).join(' · ')}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">最近使用：{formatTime(token.last_used_at)}</p>
                        </li>;
                    })}
                </ul>
            </div>
            <form onSubmit={savePreferences} className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">学习偏好</h4>
                {preferences ? <fieldset disabled={!!busy} className="space-y-3 disabled:opacity-60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs text-slate-600 dark:text-slate-300">练习语言<select value={preferences.language} onChange={(event) => changePreference('language', event.target.value as 'en' | 'de')} className={`${fieldClass} mt-1`}><option value="de">德语</option><option value="en">英语</option></select></label>
                        <label className="text-xs text-slate-600 dark:text-slate-300">时区<input value={preferences.timezone} onChange={(event) => changePreference('timezone', event.target.value)} required maxLength={80} placeholder="Europe/Berlin" className={`${fieldClass} mt-1`} /></label>
                        <label className="text-xs text-slate-600 dark:text-slate-300">每次词数<input type="number" min={1} max={50} required value={preferences.session_size || ''} onChange={(event) => changePreference('session_size', Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
                        <label className="text-xs text-slate-600 dark:text-slate-300">练习时长（分钟）<input type="number" min={1} max={60} required value={preferences.duration_minutes || ''} onChange={(event) => changePreference('duration_minutes', Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
                    </div>
                    <label className="block text-xs text-slate-600 dark:text-slate-300">纠错时机<select value={preferences.correction_style} onChange={(event) => changePreference('correction_style', event.target.value as LearningPreferences['correction_style'])} className={`${fieldClass} mt-1`}><option value="after_answer">每次回答后反馈</option><option value="end_of_session">练习结束后集中反馈</option></select></label>
                    <label className="block text-xs text-slate-600 dark:text-slate-300">兴趣主题<textarea value={interests} onChange={(event) => { dirtyRef.current = true; setInterests(event.target.value); }} rows={2} maxLength={1620} placeholder="例如：日常生活、艺术、租房沟通，用逗号分隔" className={`${fieldClass} mt-1 resize-y`} /></label>
                    <button type="submit" className={buttonClass}>{busy === 'preferences' ? '保存中…' : '保存学习偏好'}</button>
                </fieldset> : <p className="text-xs text-slate-500 dark:text-slate-400">{loading ? '正在读取偏好…' : '偏好尚未加载，请刷新重试。'}</p>}
            </form>
        </section>
    );
}

function CodexConnectionPanel({ userId }: { userId: string }) {
    // 切换账号立即销毁包含一次性凭据的组件，旧请求无法更新新账号视图。
    return <AccountConnectionPanel key={userId} userId={userId} />;
}

export default memo(CodexConnectionPanel);
