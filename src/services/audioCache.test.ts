import { describe, it, expect } from 'vitest';
import { generateCacheKey } from './audioCache';

describe('generateCacheKey', () => {
    it('formats key as "{language}_{text}"', () => {
        expect(generateCacheKey('en', 'hello')).toBe('en_hello');
        expect(generateCacheKey('de', 'hallo')).toBe('de_hallo');
    });

    it('lowercases the text portion', () => {
        expect(generateCacheKey('en', 'Hello')).toBe('en_hello');
        expect(generateCacheKey('en', 'HELLO')).toBe('en_hello');
        expect(generateCacheKey('de', 'GeMüTlIcH')).toBe('de_gemütlich');
    });

    it('trims surrounding whitespace from the text portion', () => {
        expect(generateCacheKey('en', '  hello  ')).toBe('en_hello');
        expect(generateCacheKey('en', '\thello\n')).toBe('en_hello');
    });

    it('produces the same key regardless of case or surrounding whitespace', () => {
        // Locks the contract App.tsx and TTS playback both depend on:
        // adding a word and looking it up later must yield identical cache keys.
        const a = generateCacheKey('en', '  Hello  ');
        const b = generateCacheKey('en', 'hello');
        const c = generateCacheKey('en', 'HELLO');
        expect(a).toBe(b);
        expect(b).toBe(c);
    });
});
