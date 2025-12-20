// ==================== Timing Constants ====================
export const DEBOUNCE_DELAY = 300;          // Search debounce in ms
export const AI_TYPING_DELAY = 800;         // AI fetch delay after typing in ms
export const UNDO_DURATION = 5000;          // Undo toast auto-dismiss in ms
export const PROGRESS_INTERVAL = 50;        // Progress bar update interval in ms

// ==================== Language Configuration ====================
export const LANGUAGES = ['en', 'de'] as const;
export type Language = typeof LANGUAGES[number];

export const LANGUAGE_CONFIG = {
    en: { label: '🇬🇧 英语', shortLabel: '🇬🇧', name: '英语' },
    de: { label: '🇩🇪 德语', shortLabel: '🇩🇪', name: '德语' }
} as const;

// ==================== Category Configuration ====================
export const CATEGORIES = ['daily', 'professional', 'formal', ''] as const;
export type Category = typeof CATEGORIES[number];

export const CATEGORY_CONFIG = {
    daily: {
        label: '日常',
        style: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'
    },
    professional: {
        label: '专业',
        style: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'
    },
    formal: {
        label: '正式',
        style: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
    },
    '': {
        label: '',
        style: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
    }
} as const;

// ==================== LocalStorage Keys ====================
export const STORAGE_KEYS = {
    API_KEY: 'vocab-api-key',
    API_KEY_DELETED: 'vocab-api-key-deleted',
    THEME: 'theme'
} as const;

// ==================== Tab Configuration ====================
export const TABS = [
    { id: 'all' as const, label: '全部' },
    { id: 'en' as const, label: '🇬🇧 英语' },
    { id: 'de' as const, label: '🇩🇪 德语' },
    { id: 'saved' as const, label: '⭐ 收藏' }
] as const;

export type TabId = 'all' | 'en' | 'de' | 'saved';

// ==================== Sentence Source Types ====================
export const SOURCE_TYPES = {
    word: '单词例句',
    combined: '组合造句'
} as const;
