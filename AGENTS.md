# AGENTS.md - Vocab Tracker

This document provides guidelines for AI coding agents working in this repository.

## Project Overview

Vocab Tracker is a multi-language vocabulary learning PWA built with React 19, Vite 7, and Tailwind CSS 4. It uses OpenAI for AI translation/TTS and Supabase for cloud storage. The app supports English and German vocabulary with offline capabilities via Service Worker and IndexedDB.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check (no emit, uses tsconfig.json)
npx tsc --noEmit
```

**Note**: This project does not have tests or linting configured. There is no ESLint or Prettier configuration.

## Project Structure

```
src/
├── App.tsx              # Main application component (1000+ lines)
├── main.tsx             # Entry point with React 19 createRoot
├── index.css            # Tailwind CSS imports
├── constants.ts         # Timing, language, category, storage key constants
├── types.ts             # TypeScript interfaces and types
├── supabaseClient.ts    # Supabase client configuration
├── components/          # React UI components
├── hooks/               # Custom React hooks
└── services/            # API and cache services
```

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** (`"strict": true` in tsconfig.json)
- Target ES2020 with ESNext modules
- Use `type` imports for type-only imports: `import type { Word } from './types'`
- Define interfaces for component props, hook options, and return types
- Use union types for string literals: `'en' | 'de'`, `'daily' | 'professional' | 'formal' | ''`
- Prefer `interface` for object shapes, `type` for unions and utility types

### React Patterns

- **Function components only** - no class components
- Use `React.memo()` for performance optimization on frequently re-rendered components
- Wrap callbacks in `useCallback` and computed values in `useMemo`
- Use refs (`useRef`) for mutable values that don't trigger re-renders
- AbortController pattern for cancellable async operations (see `aiAbortControllerRef` in App.tsx)

### Hooks

- Custom hooks follow `use*` naming: `useWords`, `useAuth`, `useSentences`, `useSwipeGesture`
- Hooks return typed objects with explicit interfaces:
  ```typescript
  interface UseWordsReturn {
      words: Word[];
      loading: boolean;
      addWord: (word: Omit<Word, 'id' | 'timestamp'>) => Promise<void>;
  }
  ```
- Use `useCallback` for all functions returned from hooks
- Accept options object as single parameter: `function useWords({ userId, isOnline }: UseWordsProps)`

### Imports

Order imports as follows (with blank line separating groups):
1. React core: `import { useState, useEffect, useCallback } from 'react'`
2. Type imports: `import type { Word, SavedSentence } from './types'`
3. Components: `import VirtualWordList from './components/VirtualWordList'`
4. Constants: `import { DEBOUNCE_DELAY, STORAGE_KEYS } from './constants'`
5. Services: `import { getAIContent } from './services/openai'`
6. Hooks: `import { useTheme } from './hooks/useTheme'`

### Naming Conventions

- **Components**: PascalCase (`SwipeableCard`, `VirtualWordList`)
- **Hooks**: camelCase with `use` prefix (`useSwipeGesture`, `useNetworkStatus`)
- **Services**: camelCase functions (`getAIContent`, `generateCacheKey`)
- **Constants**: UPPER_SNAKE_CASE (`DEBOUNCE_DELAY`, `STORAGE_KEYS`)
- **Types/Interfaces**: PascalCase (`Word`, `AIContent`, `UseWordsProps`)
- **Files**: Match export name - `SwipeableCard.tsx`, `useWords.ts`, `openai.ts`

### Component Structure

```typescript
import { memo } from 'react';
import { Icons } from './Icons';
import type { SwipeableCardProps } from '../types';

function SwipeableCard({ children, onDelete, className }: SwipeableCardProps) {
    // hooks first
    const { hovering, setHovering } = useSwipeGesture({ onDelete });
    
    // handlers
    const handleClick = useCallback(() => { ... }, []);
    
    // render
    return <div>...</div>;
}

export default memo(SwipeableCard);
```

### Styling

- **Tailwind CSS 4** with dark mode via `selector` strategy
- Dark mode classes: `dark:bg-slate-800`, `dark:text-slate-100`
- Use semantic color naming: `slate` (neutral), `amber` (accent), `blue` (English), `green` (German)
- Responsive: mobile-first, use `sm:` for larger screens
- Animation: `transition-all`, `active:scale-95`, `animate-pulse` for loading

### Error Handling

- Use try/catch in async service functions
- Return `null` on failure, let caller handle display
- Log errors to console: `console.error('Context:', error)`
- AbortError is expected and should not be logged:
  ```typescript
  if (e instanceof Error && e.name === 'AbortError') {
      return null;
  }
  ```
- Show user feedback via toast: `showToast?.('error', 'Message')`

### Async Patterns

- Service functions are `async` and return `Promise<T | null>`
- Use optional AbortSignal for cancellation: `signal?: AbortSignal`
- Optimistic UI updates with rollback on error
- Fire-and-forget for non-critical operations: `deleteCache().catch(() => {})`

### State Management

- Local state with `useState` for component state
- Custom hooks (`useWords`, `useSentences`) encapsulate data fetching and caching
- Supabase for server state, IndexedDB for offline cache
- No Redux/Zustand - hooks provide sufficient abstraction

### IndexedDB Services

Services in `src/services/` handle caching:
- `wordsCache.ts` - vocabulary caching
- `sentencesCache.ts` - saved sentences caching  
- `audioCache.ts` - TTS audio blob caching
- `syncQueue.ts` - offline operation queue

Pattern for IndexedDB operations:
```typescript
async function getData(key: string): Promise<Data | null> {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}
```

### API Service Pattern

OpenAI API calls use a wrapper function:
```typescript
async function callOpenAI<T>(
    messages: OpenAIMessage[],
    apiKey: string,
    maxTokens?: number,
    signal?: AbortSignal
): Promise<T | null>
```

### Constants

Magic values are centralized in `src/constants.ts`:
- Timing: `DEBOUNCE_DELAY`, `AI_TYPING_DELAY`, `UNDO_DURATION`
- Config objects: `LANGUAGE_CONFIG`, `CATEGORY_CONFIG`
- Storage keys: `STORAGE_KEYS.API_KEY`, `STORAGE_KEYS.THEME`

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app logic, state management |
| `src/types.ts` | All TypeScript interfaces |
| `src/constants.ts` | Configuration constants |
| `src/hooks/useWords.ts` | Vocabulary CRUD + caching |
| `src/services/openai.ts` | OpenAI API integration |
| `src/components/Icons.tsx` | SVG icon components |
| `vite.config.js` | Vite + PWA configuration |

## Environment Variables

```env
VITE_OPENAI_API_KEY=sk-proj-xxxxx     # OpenAI API key
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Common Gotchas

1. **No test suite** - manually verify changes
2. **Tailwind 4** - uses `@import "tailwindcss"` instead of directives
3. **React 19** - uses new `createRoot` API
4. **PWA caching** - changes may require cache clear during development
5. **Supabase RLS** - database has row-level security enabled
