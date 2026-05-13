# Changelog

## v1.6.2 (2026-05-13)
- **AI Model**: Switched from `gpt-5-mini` (reasoning) to `gpt-4.1` (non-reasoning) for faster responses and simpler API parameters.
- **Export Format**: Changed vocabulary export from CSV to Markdown for better readability.
- **Word Normalization**: Added input normalization — words are now lowercased on add to prevent case-sensitive duplicates.
- **Supabase Hardening**: Added explicit `GRANT` for `authenticated`/`service_role` to comply with Supabase's 2026-10-30 default-grant policy change. Revoked all `anon` grants on `words` / `saved_sentences` (defense in depth — RLS already blocks anon, but app never needs anonymous data access).
- **Docs**: Added canonical `schema.sql` as single source of truth and `migrations/` directory for historical SQL changes.
- **Tests**: Introduced Vitest + fake-indexeddb. Initial coverage: OpenAI request shape, JSON response parsing, audio cache key contract, and words cache pending-op preservation across server refresh.

## v1.6.1 (2026-02-12)
- Migrated AI model from GPT-4o-mini to GPT-5-mini for improved translation quality.
- Published macOS app (VocabTracker.dmg) as GitHub Release asset.
- Cleaned up repository: removed tracked binary and lock file, rewrote README.

## v1.6.0 (2026-01-03)
- **PWA Offline Support**: Full offline capability with Service Worker and IndexedDB.
  - Service Worker caches all static assets (JS, CSS, HTML, fonts) for offline app access.
  - IndexedDB caches vocabulary and sentence data locally.
  - Offline add/delete operations are queued and auto-synced when back online.
  - Network status indicators show offline mode and pending sync count.
  - Settings panel now displays data cache statistics with clear options.
  - Added offline fallback page for complete network failures.
- **Vocabulary Expansion**: Generate related words from existing vocabulary for contextual learning.
- **Multi-meaning Words**: AI generates multiple common meanings for polysemous words (e.g., "einheit" → "单位; 统一; 团结").
- **Bug Fix**: Fixed blank rendering issue when batch adding words via vocabulary expansion.

## v1.5.1 (2025-12-22)
- **Code Refactoring**: Eliminated code duplication in OpenAI service.
  - Extracted common API call logic into a unified `callOpenAI` wrapper function.
  - Added utility functions for language name conversion and JSON parsing.
  - Reduced code complexity and improved maintainability.

## v1.5.0 (2025-12-21)
- **Etymology Support**: Analyzes word origins (e.g., Latin, Greek roots) with collapsible UI in word cards. Supports both English and German.
- **UI Improvements**: Improved word card layout with collapsible sections.

## v1.4.4 (2025-12-21)
- **Persistent Audio Cache**: TTS audio cached in IndexedDB for offline playback across sessions.
- **Cache Management**: Settings panel shows cache stats (count + size) with clear button.
- **Auto Cache Cleanup**: Deleting a word/sentence also removes its cached audio.

## v1.4.3 (2025-12-21)
- **Constants Extraction**: Centralized magic values (timing, categories, storage keys) into `constants.ts`.
- **Skeleton Loading**: Professional loading screen with animated placeholders instead of "Loading..." text.

## v1.4.2 (2025-12-21)
- **Unified Undo System**: Combined word and sentence undo into a single `useUndo` hook + generic `UndoToast`.
- **Sentence Undo**: Now can undo when removing saved sentences.

## v1.4.1 (2025-12-21)
- **Swipe Delete for Saved Sentences**: Mobile users can now swipe to remove saved sentences.
- **Smart Device Detection**: Uses hover capability detection instead of screen width for desktop/mobile UI.

## v1.4.0 (2025-12-21)
- **Custom Hooks**: Extracted `useAuth`, `useWords`, `useSentences`, `useDebounce`, `useToast` for cleaner code.
- **Search Debounce**: Added 300ms delay for smoother search experience.
- **Toast Notifications**: Success/error/info feedback for all operations.

## v1.3.0 (2025-12-20)
- **TypeScript Migration**: Full codebase migration to TypeScript for better type safety and IDE support.
- **Type Definitions**: Added comprehensive type definitions for all components and services.

## v1.2.0 (2025-12-20)
- **Code Refactoring**: Modularized codebase into components, services, and hooks.
- **Performance**: Added `React.memo`, `useCallback`, and `useMemo` optimizations.
- **Undo Delete**: Added 5-second undo toast for accidental deletions.
- **Error Boundary**: Added graceful error handling with recovery option.
- **Theme Persistence**: User theme choice now persists across sessions.

## v1.1.0 (2025-12-20)
- **Dark Mode**: Added manual theme toggle with persistent storage.
- **Virtual Scrolling**: Implemented window-level virtualization for improved performance.
- **UI/UX Enhancements**: Added visual indicators for audio generation and updated brand assets.
- **PWA Optimization**: Added adaptive Apple Touch Icons for Dark Mode.

## v1.0.0 (2025-12-20)
- **Initial Release**: Complete vocabulary tracking with English and German support.
- **AI Integration**: Translation, example generation, and TTS via OpenAI.
- **Cloud Sync**: Supabase integration for cross-device data persistence.
