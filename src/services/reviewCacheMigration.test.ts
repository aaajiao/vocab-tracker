import { describe, expect, it } from 'vitest';

describe('v1 review cache upgrade', () => {
    it('preserves unowned pending data as an exportable backup without adopting it into an account', async () => {
        const legacyState = { wordId: 'legacy-word', due: '2026-09-23', intervalDays: 8, ease: 2.5, reps: 2, lapses: 0, lastReviewedAt: '2026-09-22T12:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z', syncStatus: 'pending_upsert' as const };
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('vocab-tracker-review-cache', 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore('review_states', { keyPath: 'wordId' });
                store.createIndex('syncStatus', 'syncStatus');
                store.createIndex('due', 'due');
                store.add(legacyState);
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { request.result.close(); resolve(); };
        });
        const cache = await import('./reviewCache');
        expect(await cache.getAll('new-user')).toEqual([]);
        expect(await cache.getPending()).toEqual([legacyState]);
        expect((await cache.getLegacyReviewBackup()).states).toEqual([legacyState]);
        await cache.upsert({ ...legacyState, reps: 9 }, 'synced', 'new-user');
        expect((await cache.get('legacy-word'))?.reps).toBe(2);
        expect((await cache.get('legacy-word', 'new-user'))?.reps).toBe(9);
        await cache.discardLegacyReviewBackup();
        expect((await cache.getLegacyReviewBackup()).states).toEqual([]);
        expect((await cache.get('legacy-word', 'new-user'))?.reps).toBe(9);
    });
});
