import { memo, useRef, useEffect } from 'react';
import { Icons } from './Icons';

interface NewWord {
    word: string;
    meaning: string;
    language: 'en' | 'de';
    example: string;
    exampleCn: string;
    category: 'daily' | 'professional' | 'formal' | '';
    etymology?: string;
}

interface AddWordFormProps {
    newWord: NewWord;
    setNewWord: React.Dispatch<React.SetStateAction<NewWord>>;
    aiLoading: boolean;
    syncing: boolean;
    onSave: () => void;
    onCancel: () => void;
}

export const AddWordForm = memo(function AddWordForm({
    newWord,
    setNewWord,
    aiLoading,
    syncing,
    onSave,
    onCancel
}: AddWordFormProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input when form is shown
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleLanguageChange = (lang: 'en' | 'de') => {
        setNewWord(p => ({
            ...p,
            language: lang,
            word: '',
            meaning: '',
            example: '',
            exampleCn: '',
            category: '',
            etymology: ''
        }));
    };

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6 shadow-sm">
            {/* Language Selector */}
            <div className="flex gap-2 mb-4 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg w-fit">
                <button
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        newWord.language === 'en'
                            ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                    }`}
                    onClick={() => handleLanguageChange('en')}
                >
                    🇬🇧 英语
                </button>
                <button
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        newWord.language === 'de'
                            ? 'bg-white dark:bg-slate-600 text-green-600 dark:text-green-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                    }`}
                    onClick={() => handleLanguageChange('de')}
                >
                    🇩🇪 德语
                </button>
            </div>

            {/* Word Input */}
            <input
                ref={inputRef}
                className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 mb-2 text-slate-800 dark:text-slate-100 font-medium"
                placeholder="输入单词或短语"
                value={newWord.word}
                onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))}
            />

            {/* AI Loading or Translation Input */}
            {aiLoading ? (
                <>
                    <div className="h-10 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg flex items-center px-3 text-sm text-slate-400 gap-2 mb-2">
                        <Icons.Sparkles /> GPT 分析中...
                    </div>
                    <div className="h-16 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg mb-2" />
                </>
            ) : (
                <>
                    <div className="relative mb-2">
                        <input
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100"
                            placeholder="中文翻译"
                            value={newWord.meaning}
                            onChange={e => setNewWord(p => ({ ...p, meaning: e.target.value }))}
                        />
                        {newWord.meaning && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500">
                                <Icons.Sparkles />
                            </div>
                        )}
                    </div>
                    {newWord.example && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-4">
                            <div className="text-sm text-slate-700 dark:text-slate-300 mb-1">{newWord.example}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{newWord.exampleCn}</div>
                        </div>
                    )}
                </>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
                <button
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 active:scale-95 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={onSave}
                    disabled={!newWord.word.trim() || !newWord.meaning.trim() || aiLoading || syncing}
                >
                    {syncing ? '保存中...' : '保存'}
                </button>
                <button
                    className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium"
                    onClick={onCancel}
                >
                    取消
                </button>
            </div>
        </div>
    );
});

export default AddWordForm;
