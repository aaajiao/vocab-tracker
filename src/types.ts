/// <reference types="vite/client" />

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
}

// Saved sentence type
export interface SavedSentence {
    id: string;
    sentence: string;
    sentence_cn: string;
    language: 'en' | 'de';
    scene: string | null;
    source_type: 'word' | 'combined';
    source_words: string[];
    created_at: string;
}

// AI response types
export interface AIContent {
    translation: string;
    example: string;
    exampleCn: string;
    category: 'daily' | 'professional' | 'formal';
}

export interface DetectedContent extends AIContent {
    language: 'en' | 'de';
}

export interface RegeneratedExample {
    example: string;
    exampleCn: string;
}

export interface CombinedSentence {
    scene: string;
    sentence: string;
    sentenceCn: string;
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
    saveSentence: (sentenceObj: SentenceInput) => Promise<void>;
    unsaveSentence: (id: string) => Promise<void>;
    isSentenceSaved: (sentence: string) => boolean;
    getSavedSentenceId: (sentence: string) => string | null;
    savingId: string | null;
}

export interface SentenceInput {
    sentence: string;
    sentenceCn: string;
    language: 'en' | 'de';
    scene: string | null;
    sourceType: 'word' | 'combined';
    sourceWords: string[];
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
    onAuth: (user: any) => void;
}

// Speaker icon props
export interface SpeakerIconProps {
    playing: boolean;
    cached: boolean;
}

export interface StarIconProps {
    filled: boolean;
}
