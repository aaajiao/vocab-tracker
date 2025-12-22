// OpenAI API service functions
import type { AIContent, DetectedContent, RegeneratedExample, CombinedSentence, Word } from '../types';

// Constants
const OPENAI_API_ENDPOINT = "/api/openai/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

// Types for internal use
interface OpenAIMessage {
    role: "system" | "user";
    content: string;
}

interface OpenAIResponse {
    error?: { message: string };
    choices?: Array<{
        message?: {
            content: string;
        };
    }>;
}

// Utility: Convert language code to full language name
function getLanguageName(langCode: string): string {
    return langCode === 'en' ? 'English' : 'German';
}

// Utility: Parse and clean JSON response from OpenAI
function parseJSONResponse<T>(content: string): T | null {
    try {
        // Remove markdown code blocks if present
        const cleanedContent = content.trim().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleanedContent);
    } catch (e) {
        console.error('JSON parsing error:', e);
        return null;
    }
}

// Core API call wrapper
async function callOpenAI<T>(
    messages: OpenAIMessage[],
    apiKey: string,
    maxTokens: number = 400
): Promise<T | null> {
    try {
        const response = await fetch(OPENAI_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                max_tokens: maxTokens,
                messages
            })
        });

        const data: OpenAIResponse = await response.json();

        if (data.error) {
            console.error('API Error:', data.error);
            return null;
        }

        if (data.choices?.[0]?.message?.content) {
            return parseJSONResponse<T>(data.choices[0].message.content);
        }

        return null;
    } catch (e) {
        console.error('OpenAI API error:', e);
        return null;
    }
}

// Get translation and contextual example
export async function getAIContent(text: string, sourceLang: string, apiKey: string): Promise<AIContent | null> {
    const langName = getLanguageName(sourceLang);

    return callOpenAI<AIContent>(
        [
            { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
            {
                role: "user",
                content: `For this ${langName} word/phrase: "${text}"

Please provide:
1. Chinese translation (concise, include article for German nouns)
2. One example sentence in ${langName} with Chinese translation
3. Etymology (词源) - Brief origin explanation in 1-2 sentences

IMPORTANT: Match the example to the word's nature:
- If it's an everyday/casual word (like "cool", "hang out", "Gemütlich"), use a casual, daily-life context
- If it's a technical/professional term (like "algorithm", "Rechtsprechung", "derivative"), use an appropriate professional/academic context
- If it's formal vocabulary, use formal context

Respond in this exact JSON format only, no other text:
{"translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal", "etymology": "Brief origin (e.g., 'From Latin pro- + crastinus')"}`
            }
        ],
        apiKey,
        400
    );
}

// Detect language and get content
export async function detectAndGetContent(text: string, apiKey: string): Promise<DetectedContent | null> {
    return callOpenAI<DetectedContent>(
        [
            { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
            {
                role: "user",
                content: `Analyze this word/phrase: "${text}"

1. Detect whether it is primarily English or German.
2. Provide Chinese translation (concise).
3. Provide one example sentence in the detected language with Chinese translation.
4. Provide etymology (词源) - Brief origin explanation.

IMPORTANT: Match the example to the word's nature (daily/professional/formal).

Respond in this exact JSON format only:
{"language": "en|de", "translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal", "etymology": "Brief origin"}`
            }
        ],
        apiKey,
        400
    );
}

// Regenerate example
export async function regenerateExample(word: string, meaning: string, sourceLang: string, apiKey: string): Promise<RegeneratedExample | null> {
    const langName = getLanguageName(sourceLang);

    return callOpenAI<RegeneratedExample>(
        [
            { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
            {
                role: "user",
                content: `Generate a NEW, different example sentence for this ${langName} word: "${word}" (meaning: ${meaning})

Match the context to the word's nature:
- Everyday words → casual, daily-life scenarios
- Technical terms → professional/academic context
- Formal words → formal context

Respond in this exact JSON format only:
{"example": "New example sentence in ${langName}", "exampleCn": "例句中文翻译"}`
            }
        ],
        apiKey,
        200
    );
}

// Generate combined sentence using multiple words
export async function generateCombinedSentence(selectedWords: Word[], language: string, apiKey: string): Promise<CombinedSentence | null> {
    const langName = getLanguageName(language);
    const wordList = selectedWords.map(w => {
        const cat = w.category ? ` [${w.category}]` : '';
        return `"${w.word}" (${w.meaning})${cat}`;
    }).join(', ');

    return callOpenAI<CombinedSentence>(
        [
            { role: "system", content: "You are a language learning assistant. Always respond with valid JSON only." },
            {
                role: "user",
                content: `Create a natural, grammatically correct ${langName} sentence that uses ALL of these words/phrases: ${wordList}

Requirements:
- The sentence must use each word correctly according to its meaning
- The sentence should be natural and make logical sense
- Keep the sentence concise but meaningful
- Choose an appropriate scene/context based on the word categories (daily, professional, formal)

Respond in this exact JSON format only:
{"scene": "场景名称（如：日常对话/职场交流/正式写作/学术讨论等，用中文）", "sentence": "The ${langName} sentence", "sentenceCn": "中文翻译"}`
            }
        ],
        apiKey,
        400
    );
}
