// Sync Queue Service
// Handles synchronization of offline operations when network is restored

import { supabase } from '../supabaseClient';
import {
    getPendingOperations,
    removePendingOperation,
    markWordSynced,
    removeFromCache,
    type PendingOperation
} from './wordsCache';
import {
    getPendingSentenceOperations,
    removePendingSentenceOperation,
    markSentenceSynced,
    removeFromSentenceCache,
    type PendingSentenceOperation
} from './sentencesCache';

export interface SyncResult {
    success: boolean;
    synced: number;
    failed: number;
    errors: string[];
}

// Process all pending word operations
async function processWordOperations(userId: string): Promise<{ synced: number; failed: number; errors: string[] }> {
    const operations = await getPendingOperations();
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const op of operations) {
        try {
            if (op.type === 'add_word') {
                const word = op.data;
                const { data, error } = await supabase.from('words').insert({
                    user_id: userId,
                    word: word.word,
                    meaning: word.meaning,
                    language: word.language,
                    example: word.example,
                    example_cn: word.exampleCn,
                    category: word.category,
                    etymology: word.etymology,
                    date: word.date
                }).select().single();

                if (error) {
                    throw error;
                }

                // Update local cache with server ID
                await markWordSynced(word.id, data.id);
                await removePendingOperation(op.id);
                synced++;
            } else if (op.type === 'delete_word') {
                const { error } = await supabase.from('words').delete().eq('id', op.data.id);

                if (error && error.code !== 'PGRST116') { // PGRST116 = not found, which is ok
                    throw error;
                }

                await removeFromCache(op.data.id);
                await removePendingOperation(op.id);
                synced++;
            }
        } catch (error: any) {
            failed++;
            errors.push(`Word op ${op.type}: ${error.message || 'Unknown error'}`);
            console.error(`Failed to sync word operation:`, op, error);
        }
    }

    return { synced, failed, errors };
}

// Process all pending sentence operations
async function processSentenceOperations(userId: string): Promise<{ synced: number; failed: number; errors: string[] }> {
    const operations = await getPendingSentenceOperations();
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const op of operations) {
        try {
            if (op.type === 'add_sentence') {
                const sentence = op.data;
                const { data, error } = await supabase.from('saved_sentences').insert({
                    user_id: userId,
                    sentence: sentence.sentence,
                    sentence_cn: sentence.sentence_cn,
                    language: sentence.language,
                    scene: sentence.scene || null,
                    source_type: sentence.source_type,
                    source_words: sentence.source_words || []
                }).select().single();

                if (error) {
                    throw error;
                }

                await markSentenceSynced(sentence.id, data.id);
                await removePendingSentenceOperation(op.id);
                synced++;
            } else if (op.type === 'delete_sentence') {
                const { error } = await supabase.from('saved_sentences').delete().eq('id', op.data.id);

                if (error && error.code !== 'PGRST116') {
                    throw error;
                }

                await removeFromSentenceCache(op.data.id);
                await removePendingSentenceOperation(op.id);
                synced++;
            }
        } catch (error: any) {
            failed++;
            errors.push(`Sentence op ${op.type}: ${error.message || 'Unknown error'}`);
            console.error(`Failed to sync sentence operation:`, op, error);
        }
    }

    return { synced, failed, errors };
}

// Main sync function - call when network is restored
export async function syncPendingOperations(userId: string): Promise<SyncResult> {
    if (!userId) {
        return { success: false, synced: 0, failed: 0, errors: ['No user ID'] };
    }

    try {
        const wordResult = await processWordOperations(userId);
        const sentenceResult = await processSentenceOperations(userId);

        const totalSynced = wordResult.synced + sentenceResult.synced;
        const totalFailed = wordResult.failed + sentenceResult.failed;
        const allErrors = [...wordResult.errors, ...sentenceResult.errors];

        return {
            success: totalFailed === 0,
            synced: totalSynced,
            failed: totalFailed,
            errors: allErrors
        };
    } catch (error: any) {
        return {
            success: false,
            synced: 0,
            failed: 0,
            errors: [error.message || 'Sync failed']
        };
    }
}

// Get total pending operations count
export async function getPendingCount(): Promise<number> {
    const wordOps = await getPendingOperations();
    const sentenceOps = await getPendingSentenceOperations();
    return wordOps.length + sentenceOps.length;
}
