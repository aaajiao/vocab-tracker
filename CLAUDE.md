# Vocab Tracker - Agent Development Guide

## Quick Reference

| Action | Command |
|--------|---------|
| **Dev Server** | `bun run dev` |
| **Build** | `bun run build` |
| **Type Check** | `bun x tsc` |
| **Preview Build** | `bun run preview` |

> **Runtime**: Bun (Node.js is NOT installed). Use `bun` instead of `npm`.

## Build & Verification

### Commands
```bash
bun run dev       # Start dev server at http://localhost:5173
bun run build     # Production build to dist/
bun x tsc         # Type check only (no emit)
bun run preview   # Preview production build
```

### Pre-commit Checklist
1. Run `bun x tsc` - must have zero errors
2. Run `bun run build` - must complete successfully
3. Manual UI verification (no automated tests)

### No Linting/Formatting Tools
- No ESLint or Prettier configured
- Rely on TypeScript strict mode for correctness
- Follow existing code patterns for consistency

## Project Structure

```
src/
├── App.tsx              # Main application (~57k LOC, contains most UI logic)
├── main.tsx             # Entry point
├── index.css            # Global styles + Tailwind
├── types.ts             # Shared TypeScript interfaces
├── constants.ts         # App-wide constants (timing, categories, keys)
├── supabaseClient.ts    # Supabase initialization
├── components/          # Reusable UI components
├── hooks/               # Custom React hooks (useAuth, useWords, etc.)
└── services/            # API integrations (OpenAI, TTS, caching)
```

## Code Style & Conventions

### TypeScript
- **Strict mode enabled** - avoid `any` where possible
- Shared types go in `types.ts`; local types can be defined in-file
- Prefer type inference for simple values: `useState(false)` not `useState<boolean>(false)`
- Export interfaces for component props

### React Components
```typescript
// Use function declaration syntax
function ComponentName({ prop1, prop2 }: Props) {
    // ... component logic
}

export default memo(ComponentName);  // Wrap with memo for performance
```

- **Functional components only** - no class components
- Use `React.memo`, `useMemo`, `useCallback` proactively
- Custom hooks for reusable logic (see `src/hooks/`)

### Import Order
```typescript
import { useState, useEffect, memo } from 'react';    // 1. React
import type { Word, SavedSentence } from '../types';  // 2. Types
import { Icons } from './Icons';                       // 3. Components
import { STORAGE_KEYS, CATEGORIES } from '../constants'; // 4. Constants
import { getAIContent } from '../services/openai';    // 5. Services
import { useAuth } from '../hooks/useAuth';           // 6. Hooks
```

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `VirtualWordList.tsx` |
| Hooks | camelCase with `use` prefix | `useAuth.ts` |
| Services | camelCase | `openai.ts` |
| Constants | UPPER_SNAKE_CASE | `STORAGE_KEYS` |
| Functions | camelCase | `getAIContent` |
| Interfaces | PascalCase | `SwipeableCardProps` |

### Language & Localization
- **Code**: English (variables, functions, comments in code logic)
- **UI Text & User-facing Comments**: Chinese (Simplified) - the app targets Chinese speakers
- **Example**: `// 获取初始会话` for comments, but `getSession()` for function names

## Styling (Tailwind CSS v4)

### Usage
- Utility classes directly in `className`
- Dark mode: use `dark:` prefix for all color-dependent classes
- Responsive: use `sm:`, `md:`, `lg:` prefixes

```tsx
<div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl">
```

### Custom Animations
Defined in `index.css`:
- `.animate-pulse-ring` - for playing audio state
- `.animate-slide-up` - for undo toast
- `.animate-slide-in` - for notifications

### Device Detection (CSS)
Use capability-based detection, NOT screen width:
- `.hover-device-show` / `.hover-device-hide` - for mouse/trackpad devices
- `.touch-device-show` / `.touch-device-hide` - for touch devices

## API & Services

### Error Handling Pattern
```typescript
async function apiCall(): Promise<Result | null> {
    try {
        const response = await fetch(...);
        const data = await response.json();
        if (data.error) {
            console.error('API Error:', data.error);
            return null;
        }
        return parseResponse(data);
    } catch (e) {
        console.error('Request failed:', e);
        return null;
    }
}
```

### OpenAI Integration (`services/openai.ts`)
- All AI calls go through `callOpenAI<T>()` wrapper
- JSON responses cleaned of markdown code blocks before parsing
- Returns `null` on failure, typed result on success

### Supabase (`supabaseClient.ts`)
- Auth and data persistence
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Caching Services
- `audioCache.ts` - IndexedDB for TTS audio
- `wordsCache.ts` - IndexedDB for offline word storage
- `sentencesCache.ts` - IndexedDB for offline sentences
- `syncQueue.ts` - Queues offline operations for sync

## Important Rules

### DO
- Treat state as immutable
- Use environment variables for API keys
- Support offline/online states (PWA)
- Use existing Icons component for SVG icons
- Match existing patterns in similar files

### DON'T
- Hardcode API keys
- Use `any` type unless absolutely necessary
- Ignore TypeScript errors
- Break offline functionality
- Add new dependencies without justification

## Environment Setup

### Required `.env` Variables
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# Optional - can be set in app settings UI
VITE_OPENAI_API_KEY=sk-proj-xxxxx
```

### Docker/OrbStack
```bash
# Start dev server in background
nohup bun run dev > server.log 2>&1 &

# Access via OrbStack domain
# http://opencode.orb.local:5173/
```

The `vite.config.js` has `allowedHosts: true` for container access.

## Testing & Verification

No automated tests are configured. For changes:

1. **Type Safety**: `bun x tsc` must pass
2. **Build**: `bun run build` must succeed
3. **Manual Testing**: Verify UI changes in browser
4. **Offline Mode**: Test with DevTools Network → Offline
5. **Dark Mode**: Toggle and verify all color-dependent styles
