import { describe, it, expect } from 'vitest';
import {
    addDays,
    initReviewState,
    applyGrade,
    previewIntervals,
    type ReviewState,
} from './srs';

const TODAY = '2026-07-07';
const NOW = '2026-07-07T10:00:00.000Z';

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
    return {
        wordId: 'w1',
        due: '2026-07-08',
        intervalDays: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
        lastReviewedAt: null,
        updatedAt: NOW,
        ...overrides,
    };
}

describe('srs', () => {
    describe('addDays（本地时区安全）', () => {
        it('adds days within a month', () => {
            expect(addDays('2026-07-07', 1)).toBe('2026-07-08');
            expect(addDays('2026-07-07', 3)).toBe('2026-07-10');
        });

        it('rolls over month boundaries', () => {
            expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
            expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); // 2026 非闰年
        });

        it('rolls over year boundaries', () => {
            expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
            expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
        });

        it('handles leap years', () => {
            expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 是闰年
            expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
        });

        it('subtracts days', () => {
            expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
        });
    });

    describe('initReviewState', () => {
        it('starts with interval 0, ease 2.5, due tomorrow', () => {
            const s = initReviewState('word-1', TODAY, NOW);
            expect(s.wordId).toBe('word-1');
            expect(s.intervalDays).toBe(0);
            expect(s.ease).toBe(2.5);
            expect(s.reps).toBe(0);
            expect(s.lapses).toBe(0);
            expect(s.lastReviewedAt).toBeNull();
            expect(s.updatedAt).toBe(NOW);
            expect(s.due).toBe('2026-07-08'); // TODAY + 1
        });
    });

    describe('applyGrade — forgot', () => {
        it('resets reps, bumps lapses, lowers ease by 0.2, interval = 1', () => {
            const s = makeState({ intervalDays: 20, ease: 2.5, reps: 3, lapses: 1 });
            const next = applyGrade(s, 'forgot', TODAY, NOW);
            expect(next.reps).toBe(0);
            expect(next.lapses).toBe(2);
            expect(next.ease).toBeCloseTo(2.3, 5);
            expect(next.intervalDays).toBe(1);
            expect(next.due).toBe('2026-07-08');
            expect(next.lastReviewedAt).toBe(NOW);
            expect(next.updatedAt).toBe(NOW);
        });

        it('clamps ease at the 1.3 floor', () => {
            const s = makeState({ ease: 1.4 });
            const next = applyGrade(s, 'forgot', TODAY, NOW);
            expect(next.ease).toBe(1.3); // max(1.3, 1.4 - 0.2 = 1.2)
        });

        it('does not mutate the input', () => {
            const s = makeState({ intervalDays: 20 });
            applyGrade(s, 'forgot', TODAY, NOW);
            expect(s.intervalDays).toBe(20);
        });
    });

    describe('applyGrade — fuzzy', () => {
        it('bumps reps, lowers ease by 0.15, interval = max(1, ceil(interval * 1.2))', () => {
            const s = makeState({ intervalDays: 10, ease: 2.5, reps: 2 });
            const next = applyGrade(s, 'fuzzy', TODAY, NOW);
            expect(next.reps).toBe(3);
            expect(next.ease).toBeCloseTo(2.35, 5);
            expect(next.intervalDays).toBe(12); // ceil(10 * 1.2)
        });

        it('interval never drops below 1 (from 0)', () => {
            const s = makeState({ intervalDays: 0 });
            const next = applyGrade(s, 'fuzzy', TODAY, NOW);
            expect(next.intervalDays).toBe(1); // max(1, ceil(0 * 1.2) = 0) = 1
        });

        it('clamps ease at the 1.3 floor', () => {
            const s = makeState({ ease: 1.4 });
            const next = applyGrade(s, 'fuzzy', TODAY, NOW);
            expect(next.ease).toBe(1.3); // max(1.3, 1.25)
        });
    });

    describe('applyGrade — known', () => {
        it('first known review yields exactly 3 days', () => {
            const s = makeState({ intervalDays: 0, ease: 2.5, reps: 0 });
            const next = applyGrade(s, 'known', TODAY, NOW);
            expect(next.reps).toBe(1);
            expect(next.ease).toBe(2.5); // unchanged
            expect(next.intervalDays).toBe(3);
            expect(next.due).toBe('2026-07-10');
        });

        it('subsequent known reviews grow by ease (ceil)', () => {
            const s = makeState({ intervalDays: 3, ease: 2.5, reps: 1 });
            const next = applyGrade(s, 'known', TODAY, NOW);
            expect(next.intervalDays).toBe(8); // ceil(3 * 2.5 = 7.5)
        });

        it('produces the expected consecutive-known interval sequence', () => {
            let s = initReviewState('w', TODAY, NOW); // interval 0, ease 2.5
            const seq: number[] = [];
            for (let i = 0; i < 8; i++) {
                s = applyGrade(s, 'known', TODAY, NOW);
                seq.push(s.intervalDays);
            }
            // 3 → ceil(3*2.5)=8 → ceil(8*2.5)=20 → 50 → 125 → ceil(125*2.5)=313 → capped 365 → 365
            expect(seq).toEqual([3, 8, 20, 50, 125, 313, 365, 365]);
        });

        it('caps the interval at 365 days', () => {
            const s = makeState({ intervalDays: 300, ease: 2.5 });
            const next = applyGrade(s, 'known', TODAY, NOW);
            expect(next.intervalDays).toBe(365); // ceil(300 * 2.5 = 750) capped at 365
            expect(next.due).toBe(addDays(TODAY, 365));
        });
    });

    describe('previewIntervals', () => {
        it('returns the interval each grade would produce without mutating', () => {
            const s = makeState({ intervalDays: 10, ease: 2.5 });
            const preview = previewIntervals(s, TODAY);
            expect(preview.forgot).toBe(1);
            expect(preview.fuzzy).toBe(12); // ceil(10 * 1.2)
            expect(preview.known).toBe(25); // ceil(10 * 2.5)
            // 输入未被修改
            expect(s.intervalDays).toBe(10);
        });

        it('previews a fresh word: forgot 1 / fuzzy 1 / known 3', () => {
            const s = initReviewState('w', TODAY, NOW);
            const preview = previewIntervals(s, TODAY);
            expect(preview).toEqual({ forgot: 1, fuzzy: 1, known: 3 });
        });
    });
});
