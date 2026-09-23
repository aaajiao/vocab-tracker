// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { normalizeApiRequest } from './routing';

describe('Vercel API routing', () => {
    it('preserves multi-segment paths, auth, body and filters through a rewrite', async () => {
        const request = new Request('https://vocab.test/api/learning?__route=sessions%2Fabc-123&limit=10', { method: 'PATCH', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: '{"summary":"继续练习"}' });
        const result = normalizeApiRequest(request);
        expect(new URL(result.url).pathname).toBe('/api/v1/sessions/abc-123');
        expect(new URL(result.url).search).toBe('?limit=10');
        expect(result.headers.get('authorization')).toBe('Bearer test');
        expect(result.method).toBe('PATCH');
        expect(await result.json()).toEqual({ summary: '继续练习' });
    });
    it('leaves local direct routes unchanged and prevents traversing outside the API', () => {
        const direct = new Request('http://localhost/api/v1/words');
        expect(normalizeApiRequest(direct)).toBe(direct);
        for (const path of ['../tokens', '//attacker.test', 'sessions/../tokens', '%2ftokens']) {
            const normalized = normalizeApiRequest(new Request(`https://vocab.test/api/learning?__route=${encodeURIComponent(path)}`));
            expect(new URL(normalized.url).pathname).toBe('/api/v1/invalid-route');
        }
    });
});
