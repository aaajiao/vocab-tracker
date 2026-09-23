#!/usr/bin/env bun
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const MARKER = '.vocab-review-install.json';
const owner = { schema: 1, owner: 'aaajiao/vocab-tracker', skill: 'vocab-review' };

// 比较完整目录，额外的本地文件和人工改动也会触发保留旧版备份。
async function inventory(directory: string, prefix = ''): Promise<Record<string, string>> {
    const entries: Record<string, string> = {};
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!prefix && entry.name === MARKER) continue;
        const relative = `${prefix}${entry.name}`;
        const full = join(directory, entry.name);
        if (entry.isSymbolicLink()) entries[relative] = `link:${await readlink(full)}`;
        else if (entry.isDirectory()) {
            entries[`${relative}/`] = 'directory';
            Object.assign(entries, await inventory(full, `${relative}/`));
        } else if (entry.isFile()) entries[relative] = createHash('sha256').update(await readFile(full)).digest('hex');
        else entries[relative] = 'special';
    }
    return entries;
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../integrations/codex/vocab-review');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--destination')) throw new Error('Usage: bun scripts/install-codex-skill.ts [--destination /path/to/skills]');
const skillsDirectory = args[1] ? resolve(args[1]) : join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills');
const target = join(skillsDirectory, 'vocab-review');
const manifest = await readFile(join(source, 'SKILL.md'), 'utf8');
if (!manifest.startsWith('---\nname: vocab-review\n')) throw new Error('Skill source is invalid.');
await mkdir(skillsDirectory, { recursive: true });
const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Refusing to replace a symlink or non-directory skill.');
if (existing) {
    const markerPath = join(target, MARKER);
    const markerStat = await lstat(markerPath).catch(() => null);
    const marker = markerStat?.isFile() && !markerStat.isSymbolicLink()
        ? await readFile(markerPath, 'utf8').then(text => { try { return JSON.parse(text); } catch { return null; } }) : null;
    if (!marker || marker.schema !== owner.schema || marker.owner !== owner.owner || marker.skill !== owner.skill) {
        throw new Error('An existing vocab-review skill is not managed by this installer. Preserve or move it before installing; nothing was replaced.');
    }
    if (JSON.stringify(await inventory(source)) === JSON.stringify(await inventory(target))) {
        process.stdout.write(`${JSON.stringify({ installed: target, changed: false, connection: 'unchanged', note: 'Skill 已是当前版本；未修改本地文件。' })}\n`);
        process.exit(0);
    }
}
const staging = await mkdtemp(join(skillsDirectory, '.vocab-review-install-'));
const backup = join(skillsDirectory, `.vocab-review-backup-${randomUUID()}`);
let movedPrevious = false;
try {
    await cp(source, staging, { recursive: true, force: true });
    await writeFile(join(staging, MARKER), `${JSON.stringify(owner)}\n`, { mode: 0o644 });
    if (existing) { await rename(target, backup); movedPrevious = true; }
    try { await rename(staging, target); }
    catch (error) { if (movedPrevious) await rename(backup, target); throw error; }
    process.stdout.write(`${JSON.stringify({ installed: target, changed: true, ...(movedPrevious ? { previous_version_backup: backup } : {}), connection: 'unchanged', note: 'Skill 已安装；连接凭据单独保存，未修改。旧版本及其中的人工改动保留在备份中。新任务可发现 vocab-review。' })}\n`);
} finally {
    await rm(staging, { recursive: true, force: true });
}
