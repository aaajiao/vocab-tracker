# Vocab Tracker Development Guide

This document outlines the development workflows, code style, and conventions for the Vocab Tracker project.

## 🛠️ Build & Verification

This project uses **Vite** with **React** and **TypeScript**.

### Key Commands

- **Development Server:** `bun run dev` (or `npm run dev`)
  - Starts the local development server at `http://localhost:5173`.
- **Build:** `bun run build` (or `npm run build`)
  - Compiles the application to the `dist` directory.
- **Preview Build:** `bun run preview` (or `npm run preview`)
  - Previews the production build locally.
- **Type Check:** `bun x tsc` (or `npx tsc`)
  - Runs the TypeScript compiler to check for type errors.
  - *Note:* There is no strict linting script (eslint) configured in `package.json`. Rely on TypeScript for code correctness.

### Testing
- Currently, there are **no automated tests** (Jest/Vitest) set up for this project.
- Manual verification is required for UI changes.

## 📂 Project Structure

- **`src/components/`**: UI components (functional, mostly controlled).
- **`src/services/`**: API integration (OpenAI, Supabase, TTS). Business logic often resides here.
- **`src/hooks/`**: Custom React hooks (`useAuth`, `useWords`, etc.) for managing state and side effects.
- **`src/types.ts`**: Centralized TypeScript definitions.
- **`src/constants.ts`**: App-wide constants (magic numbers, config).

## 📝 Code Style & Conventions

### Language & Localization
- **Codebase Language:** TypeScript.
- **Comments & UI:** Primary language for comments and UI text is **Chinese (Simplified)**, as the app targets Chinese speakers learning English/German.
- **Variable/Function Names:** English (CamelCase).

### TypeScript
- **Strict Mode:** Enabled. Avoid `any` where possible.
- **Interfaces:** Define props and data structures in `types.ts` if shared, or locally if private.
- **Type Inference:** Prefer inference for simple state (e.g., `useState(false)`), explicit types for complex objects.

### React Components
- **Functional Components:** Use `function ComponentName() {}` syntax.
- **Hooks:** Extensive use of custom hooks to separate logic from UI.
- **Memoization:** Use `React.memo`, `useMemo`, and `useCallback` proactively for performance, especially in lists (e.g., `VirtualWordList`).
- **Imports:** Group imports: React -> Types -> Components -> Constants -> Services -> Hooks.
- **State Management:** Local state + Supabase for persistence.

### Styling (Tailwind CSS)
- Use **Tailwind v4** utility classes directly in `className`.
- **Dark Mode:** Support `dark:` prefix for all color-dependent classes.
- **Responsive:** Use `sm:`, `md:`, `lg:` prefixes.
- **Icons:** Use the `Icons` component wrapper (lucide-react or similar SVG icons).

### API & Services
- **Supabase:** Used for backend/auth. Client is initialized in `supabaseClient.ts`.
- **OpenAI:** All AI interaction logic is encapsulated in `src/services/openai.ts`.
- **Error Handling:** Use `try/catch` in async services and return `null` or structured error objects.

### Naming Conventions
- **Files:** PascalCase for React components (`AuthForm.tsx`), camelCase for utilities/hooks (`useAuth.ts`, `openai.ts`).
- **Components:** PascalCase (`VirtualWordList`).
- **Functions:** camelCase (`getAIContent`).
- **Constants:** UPPER_CASE (`STORAGE_KEYS`).

## ⚠️ Important Rules
1. **Supabase & AI Keys:** Never hardcode API keys. Use environment variables or local storage (as implemented).
2. **Offline Support:** The app is a PWA with offline capabilities (IndexedDB/Service Worker). Ensure changes respect offline/online states.
3. **Immutability:** Treat state as immutable.

## 🚀 Environment & Deployment (2026 Update)

### Running in OrbStack / Docker (Bun Environment)

This project runs in a specialized Docker environment based on `oven/bun`.

- **Runtime:** Bun (Node.js & npm are **NOT** installed).
- **Package Manager:** Use `bun` instead of `npm`.
  - Install: `bun install`
  - Run Dev: `bun run dev`
  - Build: `bun run build`

### Configuration Fixes & Troubleshooting

#### 1. Host Access (`vite.config.js`)
To allow access via `opencode.orb.local`, the `server.allowedHosts` configuration must be set. This fixes the "Blocked request" error.

```javascript
server: {
  host: true,
  allowedHosts: ['opencode.orb.local'], 
  // ...
}
```

#### 2. Environment Variables (`.env`)
The application requires a `.env` file in the project root (`vocab-tracker/`) to connect to Supabase.

**Required Variables:**
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```
If missing, duplicate `.env.example` to `.env` and fill in your actual credentials.

### How to Run & Access

1.  **Start Server (Background):**
    ```bash
    nohup bun run dev > server.log 2>&1 &
    ```
2.  **Access URL:**
    [http://opencode.orb.local:5173/](http://opencode.orb.local:5173/)
3.  **Logs:**
    Check `server.log` for output if the server fails to start.
