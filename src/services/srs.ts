// SRS（间隔重复）纯函数服务
// 简化版 SM-2，三键自评（forgot / fuzzy / known）。
// 全部为纯函数，时间由参数传入以保证可测性。

export type ReviewGrade = 'forgot' | 'fuzzy' | 'known';

export interface ReviewState {
    wordId: string;
    due: string;                    // YYYY-MM-DD（本地时区）
    intervalDays: number;
    ease: number;
    reps: number;                   // 连续成功次数
    lapses: number;                 // 遗忘次数
    lastReviewedAt: string | null;  // ISO
    updatedAt: string;              // ISO，用于 LWW 合并
}

// ease 下限与 interval 上限
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;
const INITIAL_EASE = 2.5;

// 在 YYYY-MM-DD 上加减天数，全程走本地时区，避免用 Date(ISO) 解析被当成 UTC 而换日错位。
export function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    // 用本地时间构造，setDate 自动处理跨月 / 跨年进位
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// 新词初始状态：interval 0、ease 2.5、reps 0、lapses 0、due = 次日。
export function initReviewState(wordId: string, today: string, nowIso: string): ReviewState {
    return {
        wordId,
        due: addDays(today, 1),
        intervalDays: 0,
        ease: INITIAL_EASE,
        reps: 0,
        lapses: 0,
        lastReviewedAt: null,
        updatedAt: nowIso,
    };
}

// 应用一次评级，返回全新对象（不可变）。
export function applyGrade(
    state: ReviewState,
    grade: ReviewGrade,
    today: string,
    nowIso: string,
): ReviewState {
    let intervalDays = state.intervalDays;
    let ease = state.ease;
    let reps = state.reps;
    let lapses = state.lapses;

    if (grade === 'forgot') {
        // 不认识：连续成功清零、遗忘 +1、ease 下调 0.2、间隔回到 1
        reps = 0;
        lapses = lapses + 1;
        ease = Math.max(MIN_EASE, ease - 0.2);
        intervalDays = 1;
    } else if (grade === 'fuzzy') {
        // 模糊：算作一次成功、ease 小幅下调 0.15、间隔轻微拉长
        reps = reps + 1;
        ease = Math.max(MIN_EASE, ease - 0.15);
        intervalDays = Math.max(1, Math.ceil(intervalDays * 1.2));
    } else {
        // 认识：算作一次成功、ease 不变；首次固定 3 天，之后按 ease 增长
        reps = reps + 1;
        intervalDays = intervalDays < 1 ? 3 : Math.ceil(intervalDays * ease);
    }

    // 间隔封顶 365 天
    intervalDays = Math.min(MAX_INTERVAL, intervalDays);

    return {
        ...state,
        intervalDays,
        ease,
        reps,
        lapses,
        due: addDays(today, intervalDays),
        lastReviewedAt: nowIso,
        updatedAt: nowIso,
    };
}

// 三个按钮下的「下次间隔」预览（天数）。复用 applyGrade 保证与实际评级完全一致。
export function previewIntervals(
    state: ReviewState,
    today: string,
): { forgot: number; fuzzy: number; known: number } {
    // nowIso 传空串：预览只读取 intervalDays，不关心时间戳字段
    return {
        forgot: applyGrade(state, 'forgot', today, '').intervalDays,
        fuzzy: applyGrade(state, 'fuzzy', today, '').intervalDays,
        known: applyGrade(state, 'known', today, '').intervalDays,
    };
}
