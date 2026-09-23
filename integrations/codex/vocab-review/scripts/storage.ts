import { mkdir, lstat, readFile, writeFile, rename, unlink, readdir, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ClientError, normalizeApiUrl, requireUuid, type JsonObject } from './client.ts';

export interface Config { api_url: string; storage: 'keychain' | 'file' }
export interface PendingRequest {
    id: string; api_url: string; user_id: string; method: 'POST' | 'PATCH'; path: string;
    body: JsonObject; created_at: string;
}
export interface SessionHandle { id: string; api_url: string; user_id: string; version: number; status: string }

// 目录仅存连接设置、尚未确认成功的写入和会话句柄；不保存云端词库副本。
export class SecureStore {
    constructor(readonly directory = process.env.VOCAB_CONFIG_DIR ?? join(homedir(), '.config', 'vocab-tracker-codex')) {}

    async initialize(): Promise<void> {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const stat = await lstat(this.directory);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new ClientError('UNSAFE_STORAGE', '凭据目录必须是当前用户拥有的本地真实目录。');
        await chmod(this.directory, 0o700);
    }

    async read<T>(name: string): Promise<T | null> {
        await this.initialize();
        const path = this.path(name);
        try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
                throw new ClientError('UNSAFE_STORAGE', '本地连接文件权限不安全，要求 0600。');
            }
            return JSON.parse(await readFile(path, 'utf8')) as T;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            if (error instanceof ClientError) throw error;
            throw new ClientError('STORAGE_ERROR', '无法读取本地连接文件。');
        }
    }

    async write(name: string, value: unknown, createOnly = false): Promise<void> {
        await this.initialize();
        const path = this.path(name);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
            if (createOnly) { await link(temporary, path); await unlink(temporary); }
            else await rename(temporary, path);
        } catch (error) {
            await unlink(temporary).catch(() => {});
            if (createOnly && (error as NodeJS.ErrnoException).code === 'EEXIST') throw new ClientError('REQUEST_PENDING', '此请求已在本地保存，请用原请求 ID 恢复。');
            throw new ClientError('STORAGE_ERROR', '无法安全保存连接或待写入请求。');
        }
    }

    async remove(name: string): Promise<void> {
        await unlink(this.path(name)).catch(error => { if (error.code !== 'ENOENT') throw new ClientError('STORAGE_ERROR', '无法删除本地连接文件。'); });
    }

    private path(name: string): string {
        if (!/^[a-z0-9.-]+$/.test(name)) throw new ClientError('STORAGE_ERROR', '本地文件名无效。');
        return join(this.directory, name);
    }

    async pending(): Promise<PendingRequest[]> {
        await this.initialize();
        const names = (await readdir(this.directory)).filter(n => /^pending-[a-f0-9-]+\.json$/.test(n));
        const requests = await Promise.all(names.map(n => this.read<PendingRequest>(n)));
        return requests.filter((p): p is PendingRequest => p !== null).sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    savePending(request: PendingRequest) { return this.write(`pending-${requireUuid(request.id)}.json`, request, true); }
    getPending(id: string) { return this.read<PendingRequest>(`pending-${requireUuid(id)}.json`); }
    clearPending(id: string) { return this.remove(`pending-${requireUuid(id)}.json`); }
    saveSession(handle: SessionHandle) { return this.write(`session-${requireUuid(handle.id)}.json`, handle); }
}

const KEYCHAIN_SERVICE = 'com.vocab-tracker.codex';
function account(url: string) { return createHash('sha256').update(normalizeApiUrl(url)).digest('hex'); }

// Security.framework 助手通过 stdin 收取 JSON，令牌不进入 argv 或 shell 历史。
// get 的私密输出只在父进程内解析，绝不透传子进程日志。
export async function keychain(operation: 'get' | 'set' | 'delete', url: string, token?: string, testService?: string): Promise<string> {
    if (process.platform !== 'darwin') throw new ClientError('KEYCHAIN_UNAVAILABLE', '此系统无 macOS Keychain；请明确选择 --storage file。');
    if (operation === 'set' && (!token || !/^vt_[A-Za-z0-9_-]{16,}$/.test(token))) {
        throw new ClientError('INVALID_TOKEN', '请粘贴网站生成的 vt_ 个人访问令牌。');
    }
    const service = testService ?? KEYCHAIN_SERVICE;
    if (testService && !/^com\.vocab-tracker\.codex\.test-[a-z0-9-]+$/.test(testService)) throw new ClientError('KEYCHAIN_ERROR', '测试 Keychain 服务名无效。');
    const helper = fileURLToPath(new URL('./keychain.swift', import.meta.url));
    return new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/swift', [helper], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        const timer = setTimeout(() => { child.kill(); reject(new ClientError('KEYCHAIN_ERROR', 'Keychain 操作超时；未输出凭据。')); }, 45000);
        child.stdout.on('data', data => { if (stdout.length < 32000) stdout += String(data); });
        child.stderr.resume();
        child.stdin.on('error', () => { /* 由 close/error 返回统一错误，不记录输入。 */ });
        child.on('error', () => { clearTimeout(timer); reject(new ClientError('KEYCHAIN_ERROR', '无法使用 Keychain。')); });
        child.on('close', code => {
            clearTimeout(timer);
            let response: { ok?: boolean; token?: string; status?: number };
            try { response = JSON.parse(stdout); } catch { response = {}; }
            if (code !== 0 || response.ok !== true) {
                reject(new ClientError('KEYCHAIN_ERROR', 'Keychain 操作失败，请检查系统授权或重新连接。'));
            } else if (operation === 'get') {
                if (typeof response.token !== 'string' || !/^vt_[A-Za-z0-9_-]{16,}$/.test(response.token)) reject(new ClientError('KEYCHAIN_ERROR', 'Keychain 中未找到有效访问令牌。'));
                else resolve(response.token);
            } else resolve('');
        });
        child.stdin.end(JSON.stringify({ operation, service, account: account(url), ...(operation === 'set' ? { token } : {}) }));
    });
}

export async function loadCredentials(store: SecureStore, env: NodeJS.ProcessEnv = process.env): Promise<{ api_url: string; token: string; storage: string }> {
    if (env.VOCAB_API_URL || env.VOCAB_API_TOKEN) {
        if (!env.VOCAB_API_URL || !env.VOCAB_API_TOKEN) throw new ClientError('NOT_CONFIGURED', '环境变量必须同时提供 VOCAB_API_URL 和 VOCAB_API_TOKEN。');
        return { api_url: normalizeApiUrl(env.VOCAB_API_URL), token: env.VOCAB_API_TOKEN, storage: 'environment' };
    }
    const config = await store.read<Config>('config.json');
    if (!config) throw new ClientError('NOT_CONFIGURED', '尚未连接生词本，请先 configure。');
    const api_url = normalizeApiUrl(config.api_url);
    if (config.storage !== 'keychain' && config.storage !== 'file') throw new ClientError('STORAGE_ERROR', '未知凭据保存方式。');
    const file = config.storage === 'file' ? await store.read<{ api_url: string; token: string }>('credentials.json') : null;
    if (file && file.api_url !== api_url) throw new ClientError('STORAGE_ERROR', '凭据与网站不匹配。');
    const token = config.storage === 'keychain' ? await keychain('get', api_url) : file?.token;
    if (!token) throw new ClientError('NOT_CONFIGURED', '未找到访问令牌，请重新 configure。');
    return { api_url, token, storage: config.storage };
}
