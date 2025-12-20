import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Icons } from './Icons';
import type { AuthFormProps } from '../types';

// Auth Component
function AuthForm({ onAuth }: AuthFormProps) {
    const [view, setView] = useState<'login' | 'signup' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            if (view === 'login') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else if (view === 'signup') {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setMessage('注册成功！请查看邮箱确认链接。');
            } else if (view === 'forgot') {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin,
                });
                if (error) throw error;
                setMessage('重置链接已发送！请查看您的邮箱。');
            }
        } catch (err: any) {
            setError(err.message);
        }
        setLoading(false);
    };

    return (
        <div className="max-w-md mx-auto p-4 py-20">
            <div className="flex items-center justify-center gap-3 mb-8">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-amber-500/30">
                    <Icons.Book />
                </div>
                <div>
                    <div className="text-xl font-bold text-slate-800 dark:text-slate-100">词汇本</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Icons.Cloud /> 云端同步版
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm mb-6 max-w-sm mx-auto">
                <h3 className="text-base font-semibold mb-4 text-center text-slate-800 dark:text-slate-100">
                    {view === 'login' && '登录'}
                    {view === 'signup' && '注册'}
                    {view === 'forgot' && '重置密码'}
                </h3>

                <form onSubmit={handleSubmit}>
                    <input
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100"
                        type="email"
                        placeholder="邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="username"
                    />
                    {view !== 'forgot' && (
                        <input
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100"
                            type="password"
                            placeholder="密码"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            autoComplete="current-password"
                        />
                    )}

                    {error && (
                        <div style={{ fontSize: '0.75rem', color: '#ef4444', marginBottom: '0.5rem' }}>
                            {error}
                        </div>
                    )}

                    {message && (
                        <div style={{ fontSize: '0.75rem', color: '#059669', marginBottom: '0.5rem' }}>
                            {message}
                        </div>
                    )}

                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2" disabled={loading}>
                        {loading ? '处理中...' : (
                            view === 'login' ? '登录' : (view === 'signup' ? '注册' : '发送重置链接')
                        )}
                    </button>
                </form>

                <div className="text-center mt-4 text-sm flex flex-col gap-2">
                    {view === 'login' && (
                        <>
                            <button
                                onClick={() => { setView('forgot'); setError(''); setMessage(''); }}
                                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            >
                                忘记密码？
                            </button>
                            <div>
                                <span className="text-slate-500 dark:text-slate-400">没有账户？</span>
                                <button
                                    onClick={() => { setView('signup'); setError(''); setMessage(''); }}
                                    className="bg-transparent border-none text-blue-600 hover:text-blue-700 font-medium cursor-pointer ml-1"
                                >
                                    注册
                                </button>
                            </div>
                        </>
                    )}
                    {view === 'signup' && (
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">已有账户？</span>
                            <button
                                onClick={() => { setView('login'); setError(''); setMessage(''); }}
                                className="bg-transparent border-none text-blue-600 hover:text-blue-700 font-medium cursor-pointer ml-1"
                            >
                                登录
                            </button>
                        </div>
                    )}
                    {view === 'forgot' && (
                        <button
                            onClick={() => { setView('login'); setError(''); setMessage(''); }}
                            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                        >
                            返回登录
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default AuthForm;
