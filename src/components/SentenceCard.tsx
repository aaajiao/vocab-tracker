import { useState, memo } from 'react';
import type { SentenceAnalysis, SentenceKeyword } from '../types';
import { Icons } from './Icons';
import { CATEGORY_CONFIG } from '../constants';

interface SentenceCardProps {
    draft: SentenceAnalysis;          // 句子分析结果（含临时占位）
    loading: boolean;                 // AI 解析中 → 显示骨架
    needsConnection: boolean;         // 离线或 AI 失败 → 提示需联网
    speaking: boolean;                // 当前朗读中
    cached: boolean;                  // 该句音频是否已缓存
    saving: boolean;                  // 保存中
    onSpeak: () => void;
    onTranslationChange: (value: string) => void;
    onAddKeyword: (kw: SentenceKeyword) => void;
    isKeywordAdded: (word: string) => boolean;
    onSave: () => void;
    onCancel: () => void;
}

// 句子输入卡片：展示原句、可编辑整句翻译、重点词（可加入生词本）、语法点，并提供收藏/取消
function SentenceCard({
    draft, loading, needsConnection, speaking, cached, saving,
    onSpeak, onTranslationChange, onAddKeyword, isKeywordAdded, onSave, onCancel
}: SentenceCardProps) {
    const [grammarOpen, setGrammarOpen] = useState(true);

    const langBadge = draft.language === 'en' ? '🇬🇧' : '🇩🇪';
    const regConf = draft.register ? CATEGORY_CONFIG[draft.register] : null;

    return (
        <div className="space-y-3">
            {/* 原句 + 朗读 */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                    <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-relaxed break-words">
                        {draft.sentence}
                    </div>
                    <button
                        className={`shrink-0 p-2 rounded-lg active:scale-90 transition-all ${speaking
                            ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 animate-pulse-ring'
                            : cached
                                ? 'text-blue-400/80 dark:text-blue-400/60 hover:bg-slate-100 dark:hover:bg-slate-700'
                                : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                        onClick={onSpeak}
                        title="朗读整句"
                    >
                        <Icons.Speaker playing={speaking} cached={cached} />
                    </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-xs text-slate-400">{langBadge}</span>
                    {regConf && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${regConf.style}`}>{regConf.label}</span>
                    )}
                </div>
            </div>

            {/* 离线 / AI 失败提示 */}
            {needsConnection && !loading && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40 rounded-lg px-3 py-2">
                    整句解析需要联网，可手动填写翻译后离线保存
                </div>
            )}

            {/* 整句翻译（可编辑） */}
            {loading ? (
                <div className="h-10 bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse rounded-lg flex items-center px-3 text-sm text-slate-400 gap-2">
                    <Icons.Sparkles /> GPT 解析中...
                </div>
            ) : (
                <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">整句翻译</label>
                    <textarea
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-800 dark:text-slate-100 resize-none"
                        rows={2}
                        placeholder="整句中文翻译"
                        value={draft.translation}
                        onChange={e => onTranslationChange(e.target.value)}
                    />
                </div>
            )}

            {/* 重点词 */}
            {!loading && draft.keywords.length > 0 && (
                <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">重点词</div>
                    <div className="space-y-2">
                        {draft.keywords.map((kw, i) => {
                            const added = isKeywordAdded(kw.word);
                            return (
                                <div
                                    key={`${kw.word}-${i}`}
                                    className="flex items-center justify-between gap-2 p-2.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-slate-800 dark:text-slate-100 break-words">{kw.word}</span>
                                            {kw.partOfSpeech && (
                                                <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded">{kw.partOfSpeech}</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-300 break-words">{kw.meaning}</div>
                                    </div>
                                    <button
                                        className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${added
                                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 active:scale-95'
                                            }`}
                                        onClick={() => { if (!added) onAddKeyword(kw); }}
                                        disabled={added}
                                    >
                                        {added ? '已在生词本' : (<><Icons.Plus /> 加入生词本</>)}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 语法点（可折叠，德语常有 1-3 条） */}
            {!loading && draft.grammar.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <button
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-900/50 text-left"
                        onClick={() => setGrammarOpen(o => !o)}
                    >
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">语法点 ({draft.grammar.length})</span>
                        <span className="text-slate-400 text-xs">{grammarOpen ? '▲' : '▼'}</span>
                    </button>
                    {grammarOpen && (
                        <div className="px-3 py-2 space-y-2">
                            {draft.grammar.map((g, i) => (
                                <div key={`${g.point}-${i}`}>
                                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 break-words">{g.point}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words">{g.explanation}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 底部操作 */}
            <div className="flex gap-2 pt-1">
                <button
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 active:scale-95 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={onSave}
                    disabled={loading || saving || !draft.translation.trim()}
                >
                    <Icons.Star filled={false} /> {saving ? '保存中...' : '保存到收藏'}
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
}

export default memo(SentenceCard);
