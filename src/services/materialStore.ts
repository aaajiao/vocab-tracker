import type { Word, SavedSentence } from '../types';

export type MaterialKind = 'word' | 'sentence';
export type MaterialValue = Word | SavedSentence;
export interface MaterialOperation {
    sequence?: number;
    id: string;
    user_id: string;
    kind: MaterialKind;
    action: 'add' | 'delete' | 'update';
    record_id: string;
    record: MaterialValue;
    body: Record<string, unknown>;
    status: 'pending' | 'failed';
    attempted: boolean;
    attempts: number;
    error?: string;
    created_at: string;
    depends_on?: string;
    restore_of?: string;
}
interface StoredRecord { key: string; user_id: string; kind: MaterialKind; value: MaterialValue }
interface Receipt { key: string; user_id: string; id: string; result_id: string; body: string }
const NAME = 'vocab-tracker-materials-v2';
let database: Promise<IDBDatabase> | null = null;
const key = (owner: string, kind: MaterialKind, id: string) => `${owner}:${kind}:${id}`;
const ownerRequired = (owner: string) => { if (!owner) throw new Error('请先登录，再保存本机数据。'); };
function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('本机数据未保存')); });
    void promise.catch(() => {}); return promise;
}
async function db() {
    if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(NAME, 1);
        opening.onerror = () => { database = null; reject(opening.error); };
        opening.onsuccess = () => { const value = opening.result; value.onversionchange = () => { value.close(); database = null; }; resolve(value); };
        opening.onupgradeneeded = () => {
            const records = opening.result.createObjectStore('records', { keyPath: 'key' });
            records.createIndex('owner_kind', ['user_id', 'kind']);
            const operations = opening.result.createObjectStore('operations', { keyPath: 'sequence', autoIncrement: true });
            operations.createIndex('owner', 'user_id');
            operations.createIndex('identity', ['user_id', 'id'], { unique: true });
            opening.result.createObjectStore('revisions', { keyPath: 'key' });
            const receipts = opening.result.createObjectStore('receipts', { keyPath: 'key' });
            receipts.createIndex('owner', 'user_id');
        };
    });
    return database;
}
async function bump(tx: IDBTransaction, owner: string, kind: MaterialKind) {
    const store = tx.objectStore('revisions'); const id = `${owner}:${kind}`;
    const previous = await request<{ key: string; value: number } | undefined>(store.get(id));
    store.put({ key: id, value: (previous?.value || 0) + 1 });
}
export async function materialRevision(owner: string, kind: MaterialKind): Promise<number> {
    ownerRequired(owner);
    return (await request<{ value: number } | undefined>((await db()).transaction('revisions').objectStore('revisions').get(`${owner}:${kind}`)))?.value || 0;
}
export async function getMaterialOperations(owner: string): Promise<MaterialOperation[]> {
    if (!owner) return [];
    return (await request<MaterialOperation[]>((await db()).transaction('operations').objectStore('operations').index('owner').getAll(owner)))
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
}
export async function materialOperation(owner: string, id: string): Promise<MaterialOperation | undefined> {
    if (!owner) return undefined;
    return request((await db()).transaction('operations').objectStore('operations').index('identity').get([owner, id]));
}
export async function materialConfirmed(owner: string, id: string): Promise<boolean> {
    if (!owner) return false;
    return Boolean(await request((await db()).transaction('receipts').objectStore('receipts').get(`${owner}:${id}`)));
}
export async function readMaterials<T extends MaterialValue>(owner: string, kind: MaterialKind): Promise<T[]> {
    if (!owner) return [];
    const tx = (await db()).transaction(['records', 'operations']);
    const [rows, operations] = await Promise.all([
        request<StoredRecord[]>(tx.objectStore('records').index('owner_kind').getAll([owner, kind])),
        request<MaterialOperation[]>(tx.objectStore('operations').index('owner').getAll(owner)),
    ]);
    const values = new Map(rows.map(row => [row.value.id, row.value]));
    for (const op of operations.sort((a, b) => (a.sequence || 0) - (b.sequence || 0))) {
        if (op.kind !== kind) continue;
        if (op.action === 'delete') values.delete(op.record_id);
        else if (op.action === 'add') values.set(op.record_id, op.record);
        else {
            const base = values.get(op.record_id) || op.record;
            // PATCH 只修改例句，不让过期的操作快照覆盖新释义/词源；清缓存后仍可显示完整待编辑材料。
            values.set(op.record_id, op.kind === 'word'
                ? { ...base, example: String(op.body.example ?? ''), exampleCn: String(op.body.example_cn ?? '') } as Word
                : base);
        }
    }
    return [...values.values()] as T[];
}
/** 快照只替换当前账号已同步缓存。待新增/删除/更新始终从队列投影。 */
export async function replaceMaterials(owner: string, kind: MaterialKind, values: MaterialValue[], expectedRevision?: number): Promise<boolean> {
    ownerRequired(owner);
    const tx = (await db()).transaction(['records', 'revisions'], 'readwrite'); const done = complete(tx);
    const revisions = tx.objectStore('revisions'); const revisionKey = `${owner}:${kind}`;
    const revision = (await request<{ value: number } | undefined>(revisions.get(revisionKey)))?.value || 0;
    if (expectedRevision !== undefined && revision !== expectedRevision) { await done; return false; }
    const store = tx.objectStore('records');
    const existing = await request<IDBValidKey[]>(store.index('owner_kind').getAllKeys([owner, kind]));
    existing.forEach(id => store.delete(id));
    for (const value of values) store.put({ key: key(owner, kind, value.id), user_id: owner, kind, value });
    revisions.put({ key: revisionKey, value: revision + 1 });
    await done; return true;
}
export async function enqueueMaterial(op: Omit<MaterialOperation, 'sequence' | 'status' | 'attempted' | 'attempts' | 'created_at'>): Promise<void> {
    ownerRequired(op.user_id);
    const tx = (await db()).transaction(['operations', 'receipts', 'revisions'], 'readwrite'); const done = complete(tx);
    const store = tx.objectStore('operations');
    const [existing, receipt] = await Promise.all([
        request<MaterialOperation | undefined>(store.index('identity').get([op.user_id, op.id])),
        request<Receipt | undefined>(tx.objectStore('receipts').get(`${op.user_id}:${op.id}`)),
    ]);
    if (existing || receipt) {
        if ((existing ? JSON.stringify(existing.body) : receipt!.body) !== JSON.stringify(op.body)) { tx.abort(); await done; }
        else await done;
        return;
    }
    const alias = op.action === 'add' ? undefined : await request<Receipt | undefined>(tx.objectStore('receipts').get(`${op.user_id}:${op.record_id}`));
    const resolved = alias ? { ...op, record_id: alias.result_id, record: { ...op.record, id: alias.result_id } } : op;
    const prior = (await request<MaterialOperation[]>(store.index('owner').getAll(op.user_id)))
        .filter(item => item.kind === resolved.kind && item.record_id === resolved.record_id).sort((a, b) => (b.sequence || 0) - (a.sequence || 0))[0];
    store.add({ ...resolved, depends_on: resolved.depends_on || prior?.id, status: 'pending', attempted: false, attempts: 0, created_at: new Date().toISOString() });
    await bump(tx, op.user_id, op.kind); await done;
}
/** 与取消操作共享同一个事务锁，已取消的未发送请求绝不会被发送。 */
export async function claimMaterial(owner: string, id: string): Promise<MaterialOperation | undefined> {
    ownerRequired(owner);
    const tx = (await db()).transaction('operations', 'readwrite'); const done = complete(tx);
    const store = tx.objectStore('operations');
    const op = await request<MaterialOperation | undefined>(store.index('identity').get([owner, id]));
    if (!op || op.status !== 'pending') { await done; return undefined; }
    op.attempted = true; op.attempts++; store.put(op); await done; return op;
}
export async function failMaterial(op: MaterialOperation, message: string, permanent: boolean): Promise<void> {
    const tx = (await db()).transaction('operations', 'readwrite'); const done = complete(tx); const store = tx.objectStore('operations');
    const current = await request<MaterialOperation | undefined>(store.index('identity').get([op.user_id, op.id]));
    if (current) store.put({ ...current, status: permanent ? 'failed' : 'pending', error: message });
    await done;
}
/** 回执、缓存和移除队列在同一事务内，磁盘失败时仍能用原 UUID 恢复。 */
export async function acknowledgeMaterial(op: MaterialOperation, value?: MaterialValue): Promise<void> {
    const tx = (await db()).transaction(['records', 'operations', 'receipts', 'revisions'], 'readwrite'); const done = complete(tx);
    const operations = tx.objectStore('operations'); const records = tx.objectStore('records');
    const current = await request<MaterialOperation | undefined>(operations.index('identity').get([op.user_id, op.id]));
    if (!current) { await done; return; }
    if (op.action === 'delete') records.delete(key(op.user_id, op.kind, op.record_id));
    else if (value) {
        records.delete(key(op.user_id, op.kind, op.record_id));
        records.put({ key: key(op.user_id, op.kind, value.id), user_id: op.user_id, kind: op.kind, value });
        if (value.id !== op.record_id) {
            for (const later of await request<MaterialOperation[]>(operations.index('owner').getAll(op.user_id))) {
                if (later.sequence === op.sequence || later.kind !== op.kind || later.record_id !== op.record_id) continue;
                operations.put({ ...later, record_id: value.id, record: { ...later.record, id: value.id } });
            }
        }
    }
    tx.objectStore('receipts').put({ key: `${op.user_id}:${op.id}`, user_id: op.user_id, id: op.id, result_id: value?.id || op.record_id, body: JSON.stringify(op.body) });
    operations.delete(current.sequence!); await bump(tx, op.user_id, op.kind); await done;
}
export async function cancelUnsentMaterial(owner: string, kind: MaterialKind, recordId: string, action: 'add' | 'delete'): Promise<boolean> {
    ownerRequired(owner);
    const tx = (await db()).transaction(['operations', 'revisions'], 'readwrite'); const done = complete(tx); const store = tx.objectStore('operations');
    const entries = await request<MaterialOperation[]>(store.index('owner').getAll(owner));
    const found = entries.find(op => op.kind === kind && op.record_id === recordId && op.action === action);
    if (!found || found.attempted) { await done; return false; }
    // 取消未发送的新增时，一并移除尚未发送的依赖编辑。
    for (const op of entries) if (op.kind === kind && op.record_id === recordId && (action === 'add' || op.id === found.id)) store.delete(op.sequence!);
    await bump(tx, owner, kind); await done; return true;
}
export async function retryFailedMaterialOperations(owner: string): Promise<void> {
    ownerRequired(owner);
    const tx = (await db()).transaction('operations', 'readwrite'); const done = complete(tx); const store = tx.objectStore('operations');
    for (const op of await request<MaterialOperation[]>(store.index('owner').getAll(owner))) if (op.status === 'failed') store.put({ ...op, status: 'pending', error: undefined });
    await done;
}
export async function discardMaterialOperation(owner: string, id: string): Promise<void> {
    ownerRequired(owner);
    const tx = (await db()).transaction(['operations', 'revisions'], 'readwrite'); const done = complete(tx); const store = tx.objectStore('operations');
    const current = await request<MaterialOperation | undefined>(store.index('identity').get([owner, id]));
    if (current) {
        const entries = await request<MaterialOperation[]>(store.index('owner').getAll(owner));
        const discarded = new Set([current.id]);
        for (let changed = true; changed;) { changed = false; for (const op of entries) if (op.depends_on && discarded.has(op.depends_on) && !discarded.has(op.id)) { discarded.add(op.id); changed = true; } }
        if (entries.some(op => op.id !== current.id && discarded.has(op.id) && op.attempted)) { tx.abort(); await done; return; }
        for (const op of entries) if (discarded.has(op.id)) store.delete(op.sequence!);
        await bump(tx, owner, current.kind);
    }
    await done;
}
export async function updateMaterialCache(owner: string, kind: MaterialKind, id: string, patch: Partial<MaterialValue>): Promise<void> {
    ownerRequired(owner);
    const tx = (await db()).transaction(['records', 'revisions'], 'readwrite'); const done = complete(tx); const store = tx.objectStore('records');
    const current = await request<StoredRecord | undefined>(store.get(key(owner, kind, id)));
    if (current) store.put({ ...current, value: { ...current.value, ...patch } });
    await bump(tx, owner, kind); await done;
}
export async function removeMaterialCache(owner: string, kind: MaterialKind, id: string): Promise<void> {
    ownerRequired(owner);
    const tx = (await db()).transaction(['records', 'revisions'], 'readwrite'); const done = complete(tx);
    tx.objectStore('records').delete(key(owner, kind, id)); await bump(tx, owner, kind); await done;
}

// 旧库无账号字段，只能导出或由用户明确丢弃。绝不自动上传、合并或归给当前账号。
async function legacyDatabase(name: string): Promise<IDBDatabase | null> {
    if (indexedDB.databases && !(await indexedDB.databases()).some(item => item.name === name)) return null;
    const opening = indexedDB.open(name);
    return new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
}
export async function readLegacyMaterialData(): Promise<{ words: unknown[]; word_operations: unknown[]; sentences: unknown[]; sentence_operations: unknown[]; local_storage_words: unknown }> {
    const read = async (name: string, store: string) => {
        const database = await legacyDatabase(name); if (!database) return [];
        try { return database.objectStoreNames.contains(store) ? await request<unknown[]>(database.transaction(store).objectStore(store).getAll()) : []; }
        finally { database.close(); }
    };
    let local: unknown = null;
    if (typeof localStorage !== 'undefined') { const text = localStorage.getItem('vocab-words-v4'); if (text) { try { local = JSON.parse(text); } catch { local = text; } } }
    const [words, word_operations, sentences, sentence_operations] = await Promise.all([
        read('vocab-tracker-words-cache', 'words'), read('vocab-tracker-words-cache', 'pending_operations'),
        read('vocab-tracker-sentences-cache', 'sentences'), read('vocab-tracker-sentences-cache', 'pending_operations'),
    ]);
    return { words, word_operations, sentences, sentence_operations, local_storage_words: local };
}
export async function discardLegacyMaterialData(): Promise<void> {
    for (const name of ['vocab-tracker-words-cache', 'vocab-tracker-sentences-cache']) {
        const database = await legacyDatabase(name); if (!database) continue;
        try { const stores = [...database.objectStoreNames]; if (stores.length) { const tx = database.transaction(stores, 'readwrite'); const done = complete(tx); stores.forEach(store => tx.objectStore(store).clear()); await done; } }
        finally { database.close(); }
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem('vocab-words-v4');
}
