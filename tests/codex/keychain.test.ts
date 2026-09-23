import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { keychain } from '../../integrations/codex/vocab-review/scripts/storage.ts';

// 明确启用才使用系统 Keychain；只建立专用测试 service/account，finally 清理。
// 所有值均随机生成的无效测试令牌，不接触用户凭据。
test.skipIf(process.platform !== 'darwin' || process.env.VOCAB_TEST_KEYCHAIN !== '1')('native macOS Keychain stores, retrieves, updates, and deletes dummy credentials via stdin', async () => {
    const service = `com.vocab-tracker.codex.test-${randomUUID()}`;
    const url = `https://keychain-test-${randomUUID()}.invalid`;
    const first = `vt_dummy_${randomUUID().replaceAll('-', '')}`;
    const second = `vt_dummy_${randomUUID().replaceAll('-', '')}`;
    try {
        await keychain('set', url, first, service);
        expect((await keychain('get', url, undefined, service)) === first).toBe(true);
        await keychain('set', url, second, service);
        expect((await keychain('get', url, undefined, service)) === second).toBe(true);
        await keychain('delete', url, undefined, service);
        await expect(keychain('get', url, undefined, service)).rejects.toMatchObject({ code: 'KEYCHAIN_ERROR' });
        await keychain('delete', url, undefined, service);
    } finally {
        await keychain('delete', url, undefined, service);
    }
}, 120000);
