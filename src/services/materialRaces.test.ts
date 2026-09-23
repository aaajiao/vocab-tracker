import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Word } from '../types';
import {
    acknowledgeMaterial, claimMaterial, discardMaterialOperation, enqueueMaterial,
    failMaterial, getMaterialOperations, materialConfirmed, readMaterials, replaceMaterials,
} from './materialStore';
import { syncMaterialOperations } from './materialQueue';
import { wordBody } from './wordsCache';

const request = vi.hoisted(() => vi.fn());
vi.mock('./learningApi', async original => ({ ...await original<typeof import('./learningApi')>(), learningRequest: request }));
vi.mock('../supabaseClient', () => ({ supabase: { auth: {} } }));

const word = (patch: Partial<Word> = {}): Word => ({
    id: crypto.randomUUID(), word: 'Haus', meaning: '房子', language: 'de',
    example: 'Das Haus ist groß.', exampleCn: '这房子很大。', category: 'daily',
    date: '2026-09-23', timestamp: Date.parse('2026-09-23T10:00:00Z'), ...patch,
});
const enqueueAdd = (owner: string, value: Word) => enqueueMaterial({
    id: value.id, user_id: owner, kind: 'word', action: 'add', record_id: value.id,
    record: value, body: wordBody(value),
});
const enqueueEdit = (owner: string, id: string, value: Word, dependsOn?: string) => enqueueMaterial({
    id, user_id: owner, kind: 'word', action: 'update', record_id: value.id,
    record: { ...value, example: 'Ich kaufe ein Haus.', exampleCn: '我买一所房子。' },
    body: { example: 'Ich kaufe ein Haus.', example_cn: '我买一所房子。' }, depends_on: dependsOn,
});

describe('material outbox race recovery', () => {
    let owner: string;
    beforeEach(() => { owner = crypto.randomUUID(); request.mockReset(); });

    it('discards an unsent descendant chain without sending orphan updates or deletes', async () => {
        const value = word(); const edit = crypto.randomUUID(); const deletion = crypto.randomUUID();
        await enqueueAdd(owner, value);
        const addition = (await getMaterialOperations(owner))[0];
        await failMaterial(addition, '请求冲突', true);
        await enqueueEdit(owner, edit, value, addition.id);
        await enqueueMaterial({ id: deletion, user_id: owner, kind: 'word', action: 'delete',
            record_id: value.id, record: value, body: {}, depends_on: edit });

        await discardMaterialOperation(owner, addition.id);

        expect(await getMaterialOperations(owner)).toEqual([]);
        expect((await syncMaterialOperations(owner)).synced).toBe(0);
        expect(request).not.toHaveBeenCalled();
        expect(await readMaterials(owner, 'word')).toEqual([]);
    });

    it('keeps the entire chain when a descendant was already attempted', async () => {
        const value = word(); const edit = crypto.randomUUID();
        await enqueueAdd(owner, value);
        await enqueueEdit(owner, edit, value, value.id);
        // A crash/recovered queue can contain an attempted child; deleting its lineage is unsafe.
        await claimMaterial(owner, edit);

        await expect(discardMaterialOperation(owner, value.id)).rejects.toBeDefined();
        expect((await getMaterialOperations(owner)).map(op => op.id)).toEqual([value.id, edit]);
    });

    it('pauses an orphan dependency unless its parent has a durable receipt', async () => {
        const value = word(); const missingParent = crypto.randomUUID();
        await replaceMaterials(owner, 'word', [value]);
        await enqueueEdit(owner, crypto.randomUUID(), value, missingParent);

        const result = await syncMaterialOperations(owner);

        expect(result.deadLettered).toBe(1);
        expect(request).not.toHaveBeenCalled();
        expect((await getMaterialOperations(owner))[0]).toMatchObject({ status: 'failed', attempted: false });
    });

    it('resolves a deduplicated add receipt when delete is enqueued after its ACK', async () => {
        const original = word(); const canonical = { ...original, id: crypto.randomUUID() };
        await enqueueAdd(owner, original);
        const addition = await claimMaterial(owner, original.id);
        expect(addition).toBeDefined();
        // Delete has already read original; the server's duplicate response arrives before enqueue.
        await acknowledgeMaterial(addition!, canonical);
        const deletion = crypto.randomUUID();
        await enqueueMaterial({ id: deletion, user_id: owner, kind: 'word', action: 'delete',
            record_id: original.id, record: original, body: {} });
        expect(await readMaterials(owner, 'word')).toEqual([]);
        expect((await getMaterialOperations(owner))[0].record_id).toBe(canonical.id);

        request.mockResolvedValue({ data: { id: canonical.id, deleted: true } });
        expect((await syncMaterialOperations(owner)).synced).toBe(1);

        expect(request).toHaveBeenCalledWith(`/words/${canonical.id}`, expect.objectContaining({ userId: owner, method: 'DELETE' }));
        expect(await materialConfirmed(owner, deletion)).toBe(true);
        expect(await readMaterials(owner, 'word')).toEqual([]);
    });

    it('projects only edited fields over refreshed cloud data and retains a fallback after cache clear', async () => {
        const original = word(); const current = { ...original, meaning: '服务器新释义', date: '2026-09-24', etymology: '服务器补全词源' };
        await replaceMaterials(owner, 'word', [current]);
        await enqueueEdit(owner, crypto.randomUUID(), original);

        expect((await readMaterials<Word>(owner, 'word'))[0]).toMatchObject({
            meaning: current.meaning, date: current.date, etymology: current.etymology,
            example: 'Ich kaufe ein Haus.', exampleCn: '我买一所房子。',
        });
        await replaceMaterials(owner, 'word', []);
        expect((await readMaterials<Word>(owner, 'word'))[0]).toMatchObject({
            id: original.id, word: original.word, meaning: original.meaning, example: 'Ich kaufe ein Haus.',
        });
    });
});
