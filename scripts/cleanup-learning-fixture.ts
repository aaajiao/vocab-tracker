#!/usr/bin/env bun
import { createClient } from '@supabase/supabase-js';
import { unlink } from 'node:fs/promises';

const fixturePath = 'artifacts/qa-fixture.json';
if (!await Bun.file(fixturePath).exists()) { console.log('No retained fixture.'); process.exit(0); }
const fixture = await Bun.file(fixturePath).json();
if (typeof fixture.email !== 'string' || !/^codex-qa-[0-9a-f-]+@example\.invalid$/.test(fixture.email)) throw new Error('Refusing to clean a non-test account');
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const account = await db.auth.admin.getUserById(fixture.userId);
if (account.error || account.data.user?.email !== fixture.email) throw new Error('Test account identity does not match retained fixture');
for (const table of ['saved_sentences', 'words']) {
    const { error } = await db.from(table).delete().eq('user_id', fixture.userId);
    if (error) throw new Error(`Could not clean test ${table}`);
}
const { error } = await db.auth.admin.deleteUser(fixture.userId);
if (error) throw new Error('Could not remove test account');
await unlink(fixturePath);
await unlink('artifacts/browser-login.js').catch(() => {});
console.log('Isolated test account, records and retained credentials removed.');
