// Sync Queue Service
// Handles synchronization of offline operations when network is restored

import { supabase } from '../supabaseClient';
import {
    getPendingOperations,
    removePendingOperation,
    markWordSynced,
    removeFromCache,
    incrementOperationRetry,
} from './wordsCache';
import {
    getPendingSentenceOperations,
    removePendingSentenceOperation,
    markSentenceSynced,
    removeFromSentenceCache,
    incrementSentenceOperationRetry,
} from './sentencesCache';

// 单个待同步操作的最大重试次数。达到上限后跳过（不再尝试、不计入待同步数），
// 但数据保留在 IndexedDB 中不删除，避免徽标永挂、定时器空转与数据丢失。
export const MAX_SYNC_RETRIES = 5;

export interface SyncResult {
    success: boolean;
    synced: number;
    failed: number;
    // 本次同步中重试次数刚跨过上限（此后不再重试）的操作数，便于上层提示用户。
    deadLettered: number;
    errors: string[];
}

// Supabase rejects with plain `{message, code}` objects, not Error instances.
// Falling back to `String(error)` for those yields "[object Object]" and loses the message.
function formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

// Process all pending word operations
async function processWordOperations(userId: string): Promise<{ synced: number; failed: number; deadLettered: number; errors: string[] }> {
    const operations = await getPendingOperations();
    let synced = 0;
    let failed = 0;
    let deadLettered = 0;
    const errors: string[] = [];

    for (const op of operations) {
        // 已达重试上限：跳过，不再尝试，也不计入 synced/failed；数据保留在 IndexedDB。
        if ((op.retryCount || 0) >= MAX_SYNC_RETRIES) {
            continue;
        }
        try {
            if (op.type === 'add_word') {
                const word = op.data as import('./wordsCache').CachedWord;
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
        } catch (error: unknown) {
            failed++;
            errors.push(`Word op ${op.type}: ${formatError(error)}`);
            console.error(`Failed to sync word operation:`, op, error);
            // 递增并持久化重试次数；若刚跨过上限，记为 deadLettered 供上层提示。
            const retryCount = await incrementOperationRetry(op.id);
            if (retryCount >= MAX_SYNC_RETRIES) {
                deadLettered++;
            }
        }
    }

    return { synced, failed, deadLettered, errors };
}

// Process all pending sentence operations
async function processSentenceOperations(userId: string): Promise<{ synced: number; failed: number; deadLettered: number; errors: string[] }> {
    const operations = await getPendingSentenceOperations();
    let synced = 0;
    let failed = 0;
    let deadLettered = 0;
    const errors: string[] = [];

    for (const op of operations) {
        // 已达重试上限：跳过，不再尝试，也不计入 synced/failed；数据保留在 IndexedDB。
        if ((op.retryCount || 0) >= MAX_SYNC_RETRIES) {
            continue;
        }
        try {
            if (op.type === 'add_sentence') {
                const sentence = op.data as import('../types').SavedSentence;
                const { data, error } = await supabase.from('saved_sentences').insert({
                    user_id: userId,
                    sentence: sentence.sentence,
                    sentence_cn: sentence.sentence_cn,
                    language: sentence.language,
                    scene: sentence.scene || null,
                    source_type: sentence.source_type,
                    source_words: sentence.source_words || [],
                    keywords: sentence.keywords || [],
                    grammar: sentence.grammar || []
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
        } catch (error: unknown) {
            failed++;
            errors.push(`Sentence op ${op.type}: ${formatError(error)}`);
            console.error(`Failed to sync sentence operation:`, op, error);
            // 递增并持久化重试次数；若刚跨过上限，记为 deadLettered 供上层提示。
            const retryCount = await incrementSentenceOperationRetry(op.id);
            if (retryCount >= MAX_SYNC_RETRIES) {
                deadLettered++;
            }
        }
    }

    return { synced, failed, deadLettered, errors };
}

// 模块级 in-flight 互斥锁：并发调用复用同一个 Promise，保证同一批 pending 只处理一次，
// 避免（如 React 状态锁在同一提交批次内被双入时）重复插入。hook 层的 isSyncing 仅用于 UI 展示。
let inFlightSync: Promise<SyncResult> | null = null;

async function runSync(userId: string): Promise<SyncResult> {
    try {
        const wordResult = await processWordOperations(userId);
        const sentenceResult = await processSentenceOperations(userId);

        const totalSynced = wordResult.synced + sentenceResult.synced;
        const totalFailed = wordResult.failed + sentenceResult.failed;
        const totalDeadLettered = wordResult.deadLettered + sentenceResult.deadLettered;
        const allErrors = [...wordResult.errors, ...sentenceResult.errors];

        return {
            success: totalFailed === 0,
            synced: totalSynced,
            failed: totalFailed,
            deadLettered: totalDeadLettered,
            errors: allErrors
        };
    } catch (error: unknown) {
        return {
            success: false,
            synced: 0,
            failed: 0,
            deadLettered: 0,
            errors: [error instanceof Error ? error.message : 'Sync failed']
        };
    }
}

// Main sync function - call when network is restored
export async function syncPendingOperations(userId: string): Promise<SyncResult> {
    if (!userId) {
        return { success: false, synced: 0, failed: 0, deadLettered: 0, errors: ['No user ID'] };
    }

    // 已有同步进行中：复用同一 Promise，不再重复发起。
    if (inFlightSync) {
        return inFlightSync;
    }

    inFlightSync = runSync(userId);
    try {
        return await inFlightSync;
    } finally {
        inFlightSync = null;
    }
}

// Get total pending operations count.
// 排除已达重试上限的操作，避免徽标永挂、30 秒定时器空转反复重试注定失败的请求。
export async function getPendingCount(): Promise<number> {
    const wordOps = await getPendingOperations();
    const sentenceOps = await getPendingSentenceOperations();
    const active = (retryCount: number | undefined) => (retryCount || 0) < MAX_SYNC_RETRIES;
    const wordActive = wordOps.filter(op => active(op.retryCount)).length;
    const sentenceActive = sentenceOps.filter(op => active(op.retryCount)).length;
    return wordActive + sentenceActive;
}
