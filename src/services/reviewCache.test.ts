import { describe, it, expect, beforeEach } from 'vitest';
import {
    getAll,
    get,
    upsert,
    markSynced,
    remove,
    getPending,
    clear,
    toReviewRow,
    fromReviewRow,
    type ReviewRow,
} from './reviewCache';
import type { ReviewState } from './srs';

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
    return {
        wordId: 'word-1',
        due: '2026-07-08',
        intervalDays: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
        lastReviewedAt: null,
        updatedAt: '2026-07-07T10:00:00.000Z',
        ...overrides,
    };
}

describe('reviewCache', () => {
    beforeEach(async () => {
        await clear();
    });

    describe('upsert / get / getAll', () => {
        it('stores a state with its syncStatus and reads it back', async () => {
            await upsert(makeState({ wordId: 'w1' }), 'pending_upsert');

            const one = await get('w1');
            expect(one).toBeDefined();
            expect(one?.wordId).toBe('w1');
            expect(one?.syncStatus).toBe('pending_upsert');

            const all = await getAll();
            expect(all).toHaveLength(1);
        });

        it('overwrites an existing state by wordId', async () => {
            await upsert(makeState({ wordId: 'w1', intervalDays: 3 }), 'synced');
            await upsert(makeState({ wordId: 'w1', intervalDays: 8 }), 'pending_upsert');

            const all = await getAll();
            expect(all).toHaveLength(1);
            expect(all[0].intervalDays).toBe(8);
            expect(all[0].syncStatus).toBe('pending_upsert');
        });

        it('returns undefined for a missing key', async () => {
            expect(await get('nope')).toBeUndefined();
        });
    });

    describe('getPending', () => {
        it('returns only pending_upsert states', async () => {
            await upsert(makeState({ wordId: 'w1' }), 'synced');
            await upsert(makeState({ wordId: 'w2' }), 'pending_upsert');
            await upsert(makeState({ wordId: 'w3' }), 'pending_upsert');

            const pending = await getPending();
            expect(pending.map(s => s.wordId).sort()).toEqual(['w2', 'w3']);
        });
    });

    describe('markSynced', () => {
        it('flips pending_upsert to synced and writes the server updatedAt', async () => {
            await upsert(makeState({ wordId: 'w1', updatedAt: '2026-07-07T10:00:00.000Z' }), 'pending_upsert');

            await markSynced('w1', '2026-07-07T12:00:00.000Z');

            const one = await get('w1');
            expect(one?.syncStatus).toBe('synced');
            expect(one?.updatedAt).toBe('2026-07-07T12:00:00.000Z');
            expect(await getPending()).toHaveLength(0);
        });

        it('is a no-op for a missing key', async () => {
            await markSynced('ghost', '2026-07-07T12:00:00.000Z');
            expect(await getAll()).toHaveLength(0);
        });
    });

    describe('remove', () => {
        it('deletes a state by wordId', async () => {
            await upsert(makeState({ wordId: 'w1' }), 'synced');
            await remove('w1');
            expect(await get('w1')).toBeUndefined();
            expect(await getAll()).toHaveLength(0);
        });
    });

    describe('toReviewRow / fromReviewRow（纯映射）', () => {
        it('maps camelCase state to snake_case row', () => {
            const state = makeState({
                wordId: 'w1',
                due: '2026-07-10',
                intervalDays: 3,
                ease: 2.35,
                reps: 2,
                lapses: 1,
                lastReviewedAt: '2026-07-07T10:00:00.000Z',
                updatedAt: '2026-07-07T10:00:00.000Z',
            });
            const row = toReviewRow(state, 'user-9');
            expect(row).toEqual({
                word_id: 'w1',
                user_id: 'user-9',
                due: '2026-07-10',
                interval_days: 3,
                ease: 2.35,
                reps: 2,
                lapses: 1,
                last_reviewed_at: '2026-07-07T10:00:00.000Z',
                updated_at: '2026-07-07T10:00:00.000Z',
            });
        });

        it('maps a snake_case row back to a state, normalizing timestamps to Z form', () => {
            const row: ReviewRow = {
                word_id: 'w1',
                user_id: 'user-9',
                due: '2026-07-10',
                interval_days: 3,
                ease: 2.35,
                reps: 2,
                lapses: 1,
                last_reviewed_at: '2026-07-07T10:00:00+00:00', // Postgres 风格
                updated_at: '2026-07-07T10:00:00+00:00',
            };
            const state = fromReviewRow(row);
            expect(state.wordId).toBe('w1');
            expect(state.intervalDays).toBe(3);
            expect(state.due).toBe('2026-07-10');
            // 归一化为 Z 结尾的规范 ISO
            expect(state.updatedAt).toBe('2026-07-07T10:00:00.000Z');
            expect(state.lastReviewedAt).toBe('2026-07-07T10:00:00.000Z');
        });

        it('keeps null last_reviewed_at as null', () => {
            const row: ReviewRow = {
                word_id: 'w1',
                user_id: 'user-9',
                due: '2026-07-08',
                interval_days: 0,
                ease: 2.5,
                reps: 0,
                lapses: 0,
                last_reviewed_at: null,
                updated_at: '2026-07-07T10:00:00+00:00',
            };
            expect(fromReviewRow(row).lastReviewedAt).toBeNull();
        });
    });
});
