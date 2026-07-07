// OpenAI API service functions
import type { AIContent, RegeneratedExample, CombinedSentence, Word, ExpansionNewWord, DetectResult } from '../types';

// Expansion response type
export interface ExpansionResponse {
    theme: string;
    expansions: ExpansionNewWord[];
}

// Constants
const OPENAI_API_ENDPOINT = "/api/openai/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1";

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

// 分类白名单校验：AI 可能返回枚举外的值（如 'casual'），非法一律回退为空串
// 空串在 DB CHECK 约束内合法，避免整条输入因非法 category 被拒绝
export function sanitizeCategory(v: unknown): 'daily' | 'professional' | 'formal' | '' {
    return v === 'daily' || v === 'professional' || v === 'formal' ? v : '';
}

// Utility: Parse and clean JSON response from OpenAI
export function parseJSONResponse<T>(content: string): T | null {
    try {
        // Remove markdown code blocks if present
        const cleanedContent = content.trim().replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleanedContent);
    } catch (e) {
        console.error('JSON parsing error:', e);
        return null;
    }
}

// 统一的错误提示文案（简体中文），供 onError 回调分发到 UI
const AI_GENERIC_ERROR = 'AI 服务暂时不可用，请稍后再试';

// Core API call wrapper
// onError：可选回调，失败时以中文提示分发到调用方（保持返回类型 T|null 不变、向后兼容）
async function callOpenAI<T>(
    messages: OpenAIMessage[],
    apiKey: string,
    maxTokens: number = 400,
    onError?: (message: string) => void
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

        // HTTP 层错误：按状态码区分（body 可能不是 JSON，先判 ok 再解析）
        if (!response.ok) {
            let message: string;
            if (response.status === 401) message = 'API Key 无效或已过期';
            else if (response.status === 429) message = '请求过于频繁，请稍后再试';
            else message = AI_GENERIC_ERROR;
            onError?.(message);
            console.error('API HTTP Error:', response.status);
            return null;
        }

        let data: OpenAIResponse;
        try {
            data = await response.json();
        } catch (e) {
            onError?.(AI_GENERIC_ERROR);
            console.error('OpenAI API error: failed to parse response body', e);
            return null;
        }

        // 应用层错误信封（HTTP 200 但含 error 字段）
        if (data.error) {
            onError?.(AI_GENERIC_ERROR);
            console.error('API Error:', data.error);
            return null;
        }

        if (data.choices?.[0]?.message?.content) {
            const parsed = parseJSONResponse<T>(data.choices[0].message.content);
            if (parsed === null) onError?.(AI_GENERIC_ERROR);
            return parsed;
        }

        onError?.(AI_GENERIC_ERROR);
        return null;
    } catch (e) {
        onError?.(AI_GENERIC_ERROR);
        console.error('OpenAI API error:', e);
        return null;
    }
}

// Get translation and contextual example
export async function getAIContent(text: string, sourceLang: string, apiKey: string, onError?: (message: string) => void): Promise<AIContent | null> {
    const langName = getLanguageName(sourceLang);

    return callOpenAI<AIContent>(
        [
            { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
            {
                role: "user",
                content: `For this ${langName} word/phrase: "${text}"

Please provide:
1. Chinese translation - 如果该词有多个常用含义，用分号分隔列出（最多3个），如 "单位; 统一; 团结"。德语名词需包含冠词。
2. One example sentence in ${langName} with Chinese translation - 选择最能体现该词核心/最常用含义的例句
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
        2048,
        onError
    );
}

// 单次调用完成「分类 + 分析」：判断输入是单词还是句子，并返回对应的结构化结果
export async function detectAndAnalyze(text: string, apiKey: string, onError?: (message: string) => void): Promise<DetectResult | null> {
    return callOpenAI<DetectResult>(
        [
            {
                role: "system",
                content: "You are an English/German learning assistant for native Chinese speakers. Always respond with valid JSON only. All Chinese output must be Simplified Chinese."
            },
            {
                role: "user",
                content: `Analyze this input and respond with valid JSON only: "${text}"

STEP 1 — Classify inputType:
- "word": a single word, fixed phrase, or collocation (e.g. "cool", "hang out", "guten Morgen", "Rechtsschutzversicherung").
- "sentence": a complete sentence or clause with a subject and predicate, OR text ending with sentence-final punctuation, OR 5+ words.

STEP 2 — Detect language: "en" (English) or "de" (German).

STEP 3 — Produce output based on inputType.

If inputType is "word", respond EXACTLY in this shape:
{"inputType":"word","language":"en|de","translation":"中文翻译（若有多个常用含义用分号分隔，最多3个，如 '单位; 统一; 团结'；德语名词需含冠词）","example":"One example sentence in the detected language","exampleCn":"例句中文翻译","category":"daily|professional|formal","etymology":"简短词源（1-2 句）"}

If inputType is "sentence", respond EXACTLY in this shape:
{"inputType":"sentence","language":"en|de","sentence":"原句，原样保留大小写与标点，绝不小写化","translation":"整句地道中文翻译","keywords":[{"word":"词典原型（动词用不定式；德语名词含冠词且首字母大写）","meaning":"中文释义","partOfSpeech":"noun/verb/adjective/adverb/..."}],"grammar":[{"point":"语法点名称","explanation":"中文讲解"}],"register":"daily|professional|formal"}

Rules for the "sentence" branch:
- keywords: 2-5 items — the words a learner is MOST likely not to know. Always use the dictionary base form.
- grammar: for GERMAN, ALWAYS give 1-3 points (e.g. 格/case, 语序/word order, 可分动词/separable verbs). For ENGLISH, give 0-2 points only if genuinely noteworthy, otherwise an empty array [].
- Do NOT output "etymology". Do NOT output any extra "example". The "sentence" field must preserve the original casing and punctuation exactly.
- All Chinese text must be Simplified Chinese.

Respond with the single matching JSON object only, no other text.`
            }
        ],
        apiKey,
        2048,
        onError
    );
}

// Regenerate example
export async function regenerateExample(word: string, meaning: string, sourceLang: string, apiKey: string, onError?: (message: string) => void): Promise<RegeneratedExample | null> {
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
        1024,
        onError
    );
}

// Generate combined sentence using multiple words
export async function generateCombinedSentence(selectedWords: Word[], language: string, apiKey: string, onError?: (message: string) => void): Promise<CombinedSentence | null> {
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
        2048,
        onError
    );
}

// Generate vocabulary expansion from a source word
export async function generateVocabularyExpansion(
    sourceWord: Word,
    apiKey: string,
    onError?: (message: string) => void
): Promise<ExpansionResponse | null> {
    const langName = getLanguageName(sourceWord.language);

    return callOpenAI<ExpansionResponse>(
        [
            {
                role: "system",
                content: "You are a vocabulary learning assistant. Generate expansion vocabulary based on a source word. Always respond with valid JSON only."
            },
            {
                role: "user",
                content: `Based on this ${langName} word: "${sourceWord.word}" (meaning: ${sourceWord.meaning})

Generate 2-3 daily-use sentences that:
1. Each sentence uses the source word naturally
2. Each sentence introduces ONE new ${langName} word that the learner should know
3. New words should be related to the source word (synonyms, antonyms, collocations, or thematically related)
4. New words should be at a similar difficulty level and commonly used in daily life
5. Sentences should be practical and represent real-world usage scenarios

IMPORTANT:
- Focus on HIGH-FREQUENCY vocabulary that learners will encounter often
- Avoid overly technical or rare words
- Each new word should appear naturally in its sentence context
- Provide relationship type: "synonym", "antonym", "collocation", "thematic", or "related"

Respond in this exact JSON format only:
{
    "theme": "主题名称（用中文，如：工作效率/社交场景/日常生活）",
    "expansions": [
        {
            "word": "the new ${langName} word",
            "meaning": "中文翻译（简洁，德语名词需包含冠词）",
            "sentence": "A natural sentence using BOTH the source word and the new word",
            "sentenceCn": "例句中文翻译",
            "partOfSpeech": "noun/verb/adjective/adverb",
            "relationType": "synonym/antonym/collocation/thematic/related"
        }
    ]
}`
            }
        ],
        apiKey,
        4096,
        onError
    );
}
