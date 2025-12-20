// OpenAI API service functions

// Get translation and contextual example
export async function getAIContent(text, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
                    {
                        role: "user",
                        content: `For this ${langName} word/phrase: "${text}"

Please provide:
1. Chinese translation (concise, include article for German nouns)
2. One example sentence in ${langName} with Chinese translation

IMPORTANT: Match the example to the word's nature:
- If it's an everyday/casual word (like "cool", "hang out", "Gemütlich"), use a casual, daily-life context
- If it's a technical/professional term (like "algorithm", "Rechtsprechung", "derivative"), use an appropriate professional/academic context
- If it's formal vocabulary, use formal context

Respond in this exact JSON format only, no other text:
{"translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal"}`
                    }
                ]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('API Error', data.error);
            return null;
        }

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('OpenAI API error:', e);
        return null;
    }
}

// Detect language and get content
export async function detectAndGetContent(text, apiKey) {
    try {
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    { role: "system", content: "You are a translation assistant. Always respond with valid JSON only." },
                    {
                        role: "user",
                        content: `Analyze this word/phrase: "${text}"

1. Detect whether it is primarily English or German.
2. Provide Chinese translation (concise).
3. Provide one example sentence in the detected language with Chinese translation.

IMPORTANT: Match the example to the word's nature (daily/professional/formal).

Respond in this exact JSON format only:
{"language": "en|de", "translation": "中文翻译", "example": "Example sentence", "exampleCn": "例句中文翻译", "category": "daily|professional|formal"}`
                    }
                ]
            })
        });

        const data = await response.json();
        if (data.error) return null;

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Detection error:', e);
        return null;
    }
}

// Regenerate example
export async function regenerateExample(word, meaning, sourceLang, apiKey) {
    try {
        const langName = sourceLang === 'en' ? 'English' : 'German';
        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 200,
                messages: [
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
                ]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Regenerate error:', e);
        return null;
    }
}

// Generate combined sentence using multiple words
export async function generateCombinedSentence(selectedWords, language, apiKey) {
    try {
        const langName = language === 'en' ? 'English' : 'German';
        const wordList = selectedWords.map(w => {
            const cat = w.category ? ` [${w.category}]` : '';
            return `"${w.word}" (${w.meaning})${cat}`;
        }).join(', ');

        const response = await fetch("/api/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 400,
                messages: [
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
                ]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('API Error', data.error);
            return null;
        }

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const jsonStr = data.choices[0].message.content.trim().replace(/```json\n?|\n?```/g, '').trim();
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.error('Generate sentence error:', e);
        return null;
    }
}
