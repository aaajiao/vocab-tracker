import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseJSONResponse, getAIContent, detectAndAnalyze, sanitizeCategory } from './openai';

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

describe('detectAndAnalyze', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    function mockContent(content: string) {
        return new Response(JSON.stringify({
            choices: [{ message: { content } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it('sends model "gpt-4.1" with max_tokens 2048 and a system prompt', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockContent('{"inputType":"word","language":"en","translation":"你好","example":"hi","exampleCn":"你好","category":"daily","etymology":"none"}')
        );

        await detectAndAnalyze('hello', 'sk-test-key');

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [, init] = fetchSpy.mock.calls[0];
        const body = JSON.parse(init!.body as string);

        expect(body.model).toBe('gpt-4.1');
        expect(body.max_tokens).toBe(2048);
        expect(body.max_completion_tokens).toBeUndefined();
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1].content).toContain('hello');
    });

    it('parses the word branch into a discriminated result', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockContent('{"inputType":"word","language":"de","translation":"房子（das Haus）","example":"Das Haus ist groß.","exampleCn":"这房子很大。","category":"daily","etymology":"来自古高地德语"}')
        );

        const result = await detectAndAnalyze('Haus', 'sk-test-key');

        expect(result).not.toBeNull();
        expect(result!.inputType).toBe('word');
        if (result!.inputType === 'word') {
            expect(result!.language).toBe('de');
            expect(result!.category).toBe('daily');
        }
    });

    it('parses the sentence branch with keywords and grammar', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockContent('{"inputType":"sentence","language":"de","sentence":"Ich liebe dich.","translation":"我爱你。","keywords":[{"word":"lieben","meaning":"爱","partOfSpeech":"verb"}],"grammar":[{"point":"宾格","explanation":"dich 是 du 的宾格形式"}],"register":"daily"}')
        );

        const result = await detectAndAnalyze('Ich liebe dich.', 'sk-test-key');

        expect(result).not.toBeNull();
        expect(result!.inputType).toBe('sentence');
        if (result!.inputType === 'sentence') {
            expect(result!.sentence).toBe('Ich liebe dich.');
            expect(result!.keywords).toHaveLength(1);
            expect(result!.keywords[0].word).toBe('lieben');
            expect(result!.grammar[0].point).toBe('宾格');
            expect(result!.register).toBe('daily');
        }
    });

    it('returns null when API responds with error envelope', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const result = await detectAndAnalyze('hello', 'sk-test-key');
        expect(result).toBeNull();
    });
});

describe('sanitizeCategory', () => {
    it('lets the three valid categories pass through unchanged', () => {
        expect(sanitizeCategory('daily')).toBe('daily');
        expect(sanitizeCategory('professional')).toBe('professional');
        expect(sanitizeCategory('formal')).toBe('formal');
    });

    it('keeps the empty string as empty (valid under the DB CHECK)', () => {
        expect(sanitizeCategory('')).toBe('');
    });

    it('falls back to "" for out-of-enum values (e.g. AI returns "casual")', () => {
        expect(sanitizeCategory('casual')).toBe('');
        expect(sanitizeCategory('DAILY')).toBe('');
        expect(sanitizeCategory(' daily ')).toBe('');
    });

    it('falls back to "" for non-string inputs', () => {
        expect(sanitizeCategory(undefined)).toBe('');
        expect(sanitizeCategory(null)).toBe('');
        expect(sanitizeCategory(42)).toBe('');
        expect(sanitizeCategory({})).toBe('');
    });
});

describe('callOpenAI error dispatch (via getAIContent onError)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it('maps HTTP 401 to an invalid-key message and returns null', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            })
        );
        const onError = vi.fn();

        const result = await getAIContent('hello', 'en', 'sk-bad', onError);

        expect(result).toBeNull();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith('API Key 无效或已过期');
    });

    it('maps HTTP 429 to a rate-limit message', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'slow down' } }), {
                status: 429, headers: { 'Content-Type': 'application/json' }
            })
        );
        const onError = vi.fn();

        await getAIContent('hello', 'en', 'sk-test', onError);

        expect(onError).toHaveBeenCalledWith('请求过于频繁，请稍后再试');
    });

    it('maps other HTTP failures (500) to the generic message', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('upstream error', { status: 500 })
        );
        const onError = vi.fn();

        await getAIContent('hello', 'en', 'sk-test', onError);

        expect(onError).toHaveBeenCalledWith('AI 服务暂时不可用，请稍后再试');
    });

    it('reports the generic message when the network throws', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
        const onError = vi.fn();

        const result = await getAIContent('hello', 'en', 'sk-test', onError);

        expect(result).toBeNull();
        expect(onError).toHaveBeenCalledWith('AI 服务暂时不可用，请稍后再试');
    });

    it('reports the generic message when the model content is not valid JSON', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), {
                status: 200, headers: { 'Content-Type': 'application/json' }
            })
        );
        const onError = vi.fn();

        const result = await getAIContent('hello', 'en', 'sk-test', onError);

        expect(result).toBeNull();
        expect(onError).toHaveBeenCalledWith('AI 服务暂时不可用，请稍后再试');
    });

    it('does not invoke onError on a successful call', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                choices: [{ message: { content: '{"translation":"你好","example":"hi","exampleCn":"你好","category":"daily","etymology":"none"}' } }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
        const onError = vi.fn();

        const result = await getAIContent('hello', 'en', 'sk-test', onError);

        expect(result).not.toBeNull();
        expect(onError).not.toHaveBeenCalled();
    });
});
