import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseJSONResponse, getAIContent } from './openai';

describe('parseJSONResponse', () => {
    it('parses raw JSON without code fences', () => {
        const result = parseJSONResponse<{ a: number }>('{"a": 1}');
        expect(result).toEqual({ a: 1 });
    });

    it('strips ```json fences and trailing ```', () => {
        const wrapped = '```json\n{"translation": "你好"}\n```';
        const result = parseJSONResponse<{ translation: string }>(wrapped);
        expect(result).toEqual({ translation: '你好' });
    });

    it('strips fences with surrounding whitespace', () => {
        const wrapped = '   ```json{"x": 42}```   ';
        const result = parseJSONResponse<{ x: number }>(wrapped);
        expect(result).toEqual({ x: 42 });
    });

    it('returns null on malformed JSON', () => {
        const result = parseJSONResponse<unknown>('not json at all');
        expect(result).toBeNull();
    });

    it('returns null on truncated JSON', () => {
        const result = parseJSONResponse<unknown>('{"a": 1');
        expect(result).toBeNull();
    });
});

describe('callOpenAI request body (via getAIContent)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                choices: [{ message: { content: '{"translation":"测试","example":"test","exampleCn":"测试","category":"daily","etymology":"none"}' } }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('sends model "gpt-4.1" and uses max_tokens (NOT max_completion_tokens)', async () => {
        await getAIContent('hello', 'en', 'sk-test-key');

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [, init] = fetchSpy.mock.calls[0];
        const body = JSON.parse(init!.body as string);

        expect(body.model).toBe('gpt-4.1');
        expect(body.max_tokens).toBeTypeOf('number');
        expect(body.max_completion_tokens).toBeUndefined();
        expect(body.reasoning_effort).toBeUndefined();
    });

    it('sends Authorization header with bearer token', async () => {
        await getAIContent('hello', 'en', 'sk-test-key');

        const [, init] = fetchSpy.mock.calls[0];
        const headers = init!.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk-test-key');
    });

    it('returns null when API responds with error envelope', async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const result = await getAIContent('hello', 'en', 'sk-test-key');
        expect(result).toBeNull();
    });

    it('returns null when fetch itself throws', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('network down'));

        const result = await getAIContent('hello', 'en', 'sk-test-key');
        expect(result).toBeNull();
    });
});
