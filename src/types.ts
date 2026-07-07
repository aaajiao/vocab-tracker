/// <reference types="vite/client" />

// 复习功能类型：单一定义在 services/srs.ts，这里 re-export 供全局按 '../types' 引用
export type { ReviewGrade, ReviewState } from './services/srs';

// Word type from database
export interface Word {
    id: string;
    word: string;
    meaning: string;
    language: 'en' | 'de';
    example: string;
    exampleCn: string;
    category: 'daily' | 'professional' | 'formal' | '';
    date: string;
    timestamp: number;
    etymology?: string;
}

// Saved sentence type
export interface SavedSentence {
    id: string;
    sentence: string;
    sentence_cn: string;
    language: 'en' | 'de';
    scene: string | null;
    source_type: 'word' | 'combined' | 'input';
    source_words: string[];
    keywords?: SentenceKeyword[];
    grammar?: GrammarPoint[];
    created_at: string;
}

// 句子中的重点词（学习者最可能不认识的词）
export interface SentenceKeyword {
    word: string;          // 词典原型：动词不定式、德语名词含冠词且首字母大写
    meaning: string;       // 中文释义
    partOfSpeech?: string; // 词性
}

// 句子中的语法点
export interface GrammarPoint {
    point: string;       // 语法点名称
    explanation: string; // 中文讲解
}

// 句子整体分析结果（句子输入分支）
export interface SentenceAnalysis {
    language: 'en' | 'de';
    sentence: string;    // 原句，原样保留大小写与标点
    translation: string; // 整句地道中译
    keywords: SentenceKeyword[];
    grammar: GrammarPoint[];
    register?: 'daily' | 'professional' | 'formal';
}

// AI response types
export interface AIContent {
    translation: string;
    example: string;
    exampleCn: string;
    category: 'daily' | 'professional' | 'formal';
    etymology?: string;
}

export interface DetectedContent extends AIContent {
    language: 'en' | 'de';
}

// 单次「分类 + 分析」结果：判别联合，按 inputType 区分单词 / 句子
export type DetectResult =
    | ({ inputType: 'word' } & DetectedContent)
    | ({ inputType: 'sentence' } & SentenceAnalysis);

export interface RegeneratedExample {
    example: string;
    exampleCn: string;
}

export interface CombinedSentence {
    scene: string;
    sentence: string;
    sentenceCn: string;
}

// Vocabulary expansion types
export interface ExpansionNewWord {
    word: string;
    meaning: string;
    sentence: string;
    sentenceCn: string;
    partOfSpeech?: string;
    relationType: string;  // synonym/antonym/collocation/thematic/related
}

export interface ExpansionPreviewItem extends ExpansionNewWord {
    selected: boolean;
}

// Sentence data for display
export interface SentenceData {
    words: Word[];
    scene: string;
    sentence: string;
    sentenceCn: string;
}

// Component props
export interface SwipeableCardProps {
    children: React.ReactNode;
    onDelete: () => void;
    className?: string;
}

export interface VirtualWordListProps {
    groupedByDate: Record<string, Word[]>;
    formatDate: (d: string) => string;
    deleteWord: (id: string) => void;
    speakWord: (text: string, language: string, setSpeakingId: (id: string | null) => void, wordId: string, apiKey: string, onCacheUpdate?: (key: string) => void) => Promise<void>;
    setSpeakingId: (id: string | null) => void;
    speakingId: string | null;
    apiKey: string;
    setCachedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
    cachedKeys: Set<string>;
    getCategoryClass: (cat: string) => string;
    getCategoryLabel: (cat: string) => string;
    handleRegenerate: (wordId: string) => void;
    regeneratingId: string | null;
    saveSentence: (sentenceObj: SentenceInput, successMessage?: string) => Promise<boolean>;
    // 取消收藏走带撤销的删除流程（markDeleted → undo toast），与收藏 tab 行为一致
    deleteSentence: (id: string) => void;
    isSentenceSaved: (sentence: string) => boolean;
    getSavedSentenceId: (sentence: string) => string | null;
    savingId: string | null;
}

export interface SentenceInput {
    sentence: string;
    sentenceCn: string;
    language: 'en' | 'de';
    scene: string | null;
    sourceType: 'word' | 'combined' | 'input';
    sourceWords: string[];
    keywords?: SentenceKeyword[];
    grammar?: GrammarPoint[];
}

export interface SettingsPanelProps {
    apiKey: string;
    setApiKey: (key: string) => void;
    userEmail?: string;
}

export interface UndoToastProps {
    deletedItem: Word | null;
    onUndo: () => void;
    onDismiss: () => void;
    duration?: number;
}

export interface AuthFormProps {
    onAuth: () => void;
}

// Speaker icon props
export interface SpeakerIconProps {
    playing: boolean;
    cached: boolean;
}

// 复习卡片 props：翻转模式（词→义）+ 例句挖空模式共用一张卡
export interface ReviewCardProps {
    word: Word;
    mode: 'flip' | 'cloze';                                        // 用户选择的复习模式
    // 该词三键的「下次间隔」天数预览（来自 useReview.previewFor）；无状态时为 null
    preview: { forgot: number; fuzzy: number; known: number } | null;
    onGrade: (grade: 'forgot' | 'fuzzy' | 'known') => void;        // 评级回调（推进 session）
    // TTS 三件套（复用现有管线与状态感知 SpeakerIcon）
    speakingId: string | null;
    setSpeakingId: (id: string | null) => void;
    apiKey: string;
    cachedKeys: Set<string>;
    setCachedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
    getCategoryClass: (cat: string) => string;
    getCategoryLabel: (cat: string) => string;
}

export interface StarIconProps {
    filled: boolean;
}
