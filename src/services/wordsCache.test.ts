import { describe, it, expect } from 'vitest';
import type { Word } from '../types';
import { addPendingWord, setCachedWords, getAllCachedWords, getPendingOperations, markWordDeleted, clearWordsCache, selectWordsToMigrate } from './wordsCache';
import { acknowledgeMaterial, cancelUnsentMaterial, claimMaterial, enqueueMaterial, getMaterialOperations, materialRevision, discardMaterialOperation } from './materialStore';
const word = (id: string = crypto.randomUUID(), patch: Partial<Word> = {}): Word => ({ id, word: 'Haus', meaning: '房子', language: 'de', example: 'Alt', exampleCn: '旧', category: '', date: '2026-09-23', timestamp: 1, ...patch });

describe('账号隔离的词汇缓存与操作', () => {
    it('无账号无法读到任何材料；相同记录ID在两个账号中互不覆盖', async () => {
        const a = crypto.randomUUID(), b = crypto.randomUUID(), id = crypto.randomUUID();
        await setCachedWords([word(id)], a); await setCachedWords([word(id, { meaning: 'B自己的释义' })], b);
        expect(await getAllCachedWords()).toEqual([]);
        expect((await getAllCachedWords(a))[0].meaning).toBe('房子');
        expect((await getAllCachedWords(b))[0].meaning).toBe('B自己的释义');
        await expect(addPendingWord(word())).rejects.toThrow();
        await clearWordsCache(a); expect(await getAllCachedWords(a)).toEqual([]); expect(await getAllCachedWords(b)).toHaveLength(1);
    });
    it('空云端是有效快照，但不会移除待新增，云端旧行也不能复活待删除', async () => {
        const owner = crypto.randomUUID(), old = word(), added = word(undefined, { word: 'neu' });
        await setCachedWords([old], owner); await markWordDeleted(old.id, owner); await addPendingWord(added, owner);
        await setCachedWords([old], owner); expect((await getAllCachedWords(owner)).map(item => item.id)).toEqual([added.id]);
        await setCachedWords([], owner); expect((await getAllCachedWords(owner)).map(item => item.id)).toEqual([added.id]);
        expect(await getPendingOperations(owner)).toHaveLength(2);
    });
    it('尚未发送的新增/删除可原子取消，已尝试新增则保留后续幂等删除', async () => {
        const owner = crypto.randomUUID(), value = word();
        await addPendingWord(value, owner); await markWordDeleted(value.id, owner);
        expect(await getPendingOperations(owner)).toEqual([]);
        await addPendingWord(value, owner); await claimMaterial(owner, value.id); await markWordDeleted(value.id, owner);
        const operations = await getPendingOperations(owner);
        expect(operations).toHaveLength(2); expect(operations[1].depends_on).toBe(value.id);
        expect(await getAllCachedWords(owner)).toEqual([]);
        expect(await cancelUnsentMaterial(owner, 'word', value.id, 'delete')).toBe(true);
        expect(await getAllCachedWords(owner)).toHaveLength(1);
    });
    it('清缓存仍显示待更新内容，并仅修改例句而不覆盖其他最新字段', async () => {
        const owner = crypto.randomUUID(), initial = word();
        await setCachedWords([initial], owner);
        await enqueueMaterial({ id: crypto.randomUUID(), user_id: owner, kind: 'word', action: 'update', record_id: initial.id, record: initial, body: { example: 'Neu', example_cn: '新' } });
        await setCachedWords([{ ...initial, meaning: '云端新释义', etymology: '新词源' }], owner);
        expect((await getAllCachedWords(owner))[0]).toMatchObject({ meaning: '云端新释义', etymology: '新词源', example: 'Neu' });
        await clearWordsCache(owner); expect((await getAllCachedWords(owner))[0]).toMatchObject({ id: initial.id, example: 'Neu' });
        expect(await getPendingOperations(owner)).toHaveLength(1);
    });
    it('快照与新增回执交错时，过期读取不会移除刚确认的词', async () => {
        const owner = crypto.randomUUID(), value = word(); const revision = await materialRevision(owner, 'word');
        await addPendingWord(value, owner); const op = (await getPendingOperations(owner))[0]; await acknowledgeMaterial(op, value);
        expect(await setCachedWords([], owner, revision)).toBe(false); expect(await getAllCachedWords(owner)).toHaveLength(1);
    });
    it('去重回执无论早于还是晚于后继入队，都使用云端真实ID', async () => {
        for (const late of [false, true]) {
            const owner = crypto.randomUUID(), value = word(), canonical = word();
            await addPendingWord(value, owner); const add = (await getPendingOperations(owner))[0];
            if (!late) await acknowledgeMaterial(add, canonical);
            const updateId = crypto.randomUUID();
            await enqueueMaterial({ id: updateId, user_id: owner, kind: 'word', action: 'update', record_id: value.id, record: value, body: { example: 'n', example_cn: '新' }, depends_on: add.id });
            if (late) await acknowledgeMaterial(add, canonical);
            expect((await getPendingOperations(owner))[0].record_id).toBe(canonical.id);
        }
    });
    it('丢弃失败新增一并移除未发送的依赖请求，不留下404链条', async () => {
        const owner = crypto.randomUUID(), value = word(); await addPendingWord(value, owner);
        await enqueueMaterial({ id: crypto.randomUUID(), user_id: owner, kind: 'word', action: 'update', record_id: value.id, record: value, body: { example: 'n', example_cn: '' } });
        await discardMaterialOperation(owner, value.id); expect(await getMaterialOperations(owner)).toEqual([]); expect(await getAllCachedWords(owner)).toEqual([]);
    });
    it('旧数据去重纯函数仍保持词形并区分语言', () => {
        const items = [word('1', { word: 'Haus' }), word('2', { word: 'haus' }), word('3', { word: 'Haus', language: 'en' })];
        expect(selectWordsToMigrate(items, [])).toHaveLength(2);
    });
});
