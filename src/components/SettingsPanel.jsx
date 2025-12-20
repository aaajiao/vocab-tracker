import { Icons } from './Icons';

function SettingsPanel({ apiKey, setApiKey, userEmail }) {
    return (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100">Settings</h3>
            <label className="block text-xs text-slate-500 mb-1">OpenAI API Key</label>
            <div className="flex gap-2">
                <input
                    className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                    type="password"
                    placeholder="sk-proj-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                />
                <button
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    onClick={() => {
                        setApiKey('');
                        localStorage.removeItem('vocab-api-key');
                        localStorage.setItem('vocab-api-key-deleted', 'true');
                    }}
                    title="删除 API Key"
                >
                    <Icons.Trash /> 删除
                </button>
            </div>
            <div className="text-xs text-slate-400 mt-2">Key is stored locally. 账户: {userEmail}</div>
        </div>
    );
}

export default SettingsPanel;
