import { memo } from 'react';

export type TabId = 'all' | 'en' | 'de' | 'saved';

interface Stats {
    total: number;
    en: number;
    de: number;
    today: number;
    saved: number;
}

interface StatsGridProps {
    stats: Stats;
    activeTab: TabId;
    todayFilter: boolean;
    onTabChange: (tab: TabId) => void;
    onTodayFilterToggle: () => void;
}

export const StatsGrid = memo(function StatsGrid({
    stats,
    activeTab,
    todayFilter,
    onTabChange,
    onTodayFilterToggle
}: StatsGridProps) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <button
                className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-slate-400 dark:hover:border-slate-500 active:scale-95 ${activeTab === 'all' ? 'border-slate-400 dark:border-slate-500 ring-1 ring-slate-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                onClick={() => onTabChange('all')}
            >
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.total}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">总计</div>
            </button>
            <button
                className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-blue-400 dark:hover:border-blue-500 active:scale-95 ${activeTab === 'en' ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                onClick={() => onTabChange('en')}
            >
                <div className="text-2xl font-bold text-blue-600">{stats.en}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">英语</div>
            </button>
            <button
                className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-green-400 dark:hover:border-green-500 active:scale-95 ${activeTab === 'de' ? 'border-green-400 dark:border-green-500 ring-1 ring-green-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                onClick={() => onTabChange('de')}
            >
                <div className="text-2xl font-bold text-green-600">{stats.de}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">德语</div>
            </button>
            <button
                className={`bg-white dark:bg-slate-800 border rounded-xl p-3 shadow-sm text-left transition-all hover:border-amber-400 dark:hover:border-amber-500 active:scale-95 ${todayFilter ? 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-400/20' : 'border-slate-200 dark:border-slate-700'}`}
                onClick={onTodayFilterToggle}
            >
                <div className="text-2xl font-bold text-amber-600">{stats.today}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">今日</div>
            </button>
        </div>
    );
});

export default StatsGrid;
