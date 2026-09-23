# Vocab Tracker

A multi-language vocabulary learning app powered by AI. Enter a word and get Chinese translations, contextual examples, etymology analysis, and natural voice pronunciation — all generated automatically.

![React](https://img.shields.io/badge/React-19.3-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4.3-38B2AC?logo=tailwind-css)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4.1-412991?logo=openai)

## Features

- **AI Translation** — Automatic Chinese translations via OpenAI gpt-4.1
- **Contextual Examples** — Sentences generated based on word context (Daily / Professional / Formal)
- **Etymology Analysis** — Word origin breakdowns (Latin, Greek, etc.) with collapsible UI
- **Combined Sentences** — AI creates sentences using multiple saved words to reinforce memory
- **Scene Tags** — Sentences auto-tagged with applicable scenes (Daily Conversation, Workplace, etc.)
- **High-Quality TTS** — Natural pronunciation via OpenAI TTS with visual feedback
- **Bilingual Support** — English and German vocabulary
- **Saved Sentences** — Bookmark favorite examples and combined sentences, synced to cloud
- **Dark Mode** — Manual light/dark toggle with persistence
- **Virtual Scrolling** — Smooth performance for large vocabulary lists
- **Statistics** — Real-time vocabulary count by language and daily additions
- **Search** — Filter by word or translation
- **Date Grouping** — Vocabulary organized by addition date
- **Markdown Export** — Export vocabulary data as Markdown
- **Codex Practice** — Authenticated vocabulary API, personal review Skill, contextual conversations, saved practice history, and shared review scheduling
- **Cloud Sync** — Supabase backend for cross-device sync
- **PWA + Offline** — Full offline access via Service Worker + IndexedDB; offline edits auto-sync when back online

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.4.2 for package management and project scripts; Node.js 24 LTS for deployment-compatible Node tooling
- [OpenAI API Key](https://platform.openai.com/api-keys) (required for AI features)

### Install & Run

```bash
git clone https://github.com/aaajiao/vocab-tracker.git
cd vocab-tracker
bun install
```

Create a `.env` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Optional — can also be set in the app settings UI
VITE_OPENAI_API_KEY=sk-proj-xxxxx
```

```bash
bun run dev
```

Visit http://localhost:5173

## Codex vocabulary practice

Open **Settings → Codex 练习** to create a connection. Install the companion Skill with `bun run codex:install`, then connect in your terminal. Codex automatically builds 10 exercises from your words and saved sentences across English and German, prioritizing the same spaced-repetition schedule used on the website. It saves completed attempts and summaries, and can add words or sentences when you ask. No language, category, or session settings are required. See [setup, API, and deployment details](docs/codex-learning-api.md).

For local API development, run `bun run dev:api` alongside `bun run dev`. Set `SUPABASE_SERVICE_ROLE_KEY` in your ignored local environment and Vercel's server environment; never prefix this secret with `VITE_`.

## macOS App

Download **VocabTracker.dmg** from the [Releases](https://github.com/aaajiao/vocab-tracker/releases) page.

## Deployment (Vercel)

Push to your Git repository. Vercel will auto-detect Vite and deploy. Configure these environment variables in the Vercel dashboard:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Tech Stack

- **Frontend**: React 19, Vite 8, Tailwind CSS 4
- **Backend / Storage**: Supabase (Auth + Postgres)
- **AI**: OpenAI gpt-4.1 (translation & examples), OpenAI gpt-4o-mini-tts (audio)
- **Tooling / Runtime**: Bun 1.4.2, TypeScript 7 with TypeScript 6 API compatibility; Vercel functions run on Node.js 24. See [toolchain and local-network setup](docs/toolchain.md).

## Project Structure

```
src/
├── App.tsx              # Main application component
├── main.tsx             # Entry point
├── index.css            # Global styles + Tailwind
├── types.ts             # Shared TypeScript interfaces
├── constants.ts         # App-wide constants
├── supabaseClient.ts    # Supabase client
├── components/          # UI components
├── hooks/               # Custom React hooks
└── services/            # API integrations (OpenAI, TTS, caching)
```

Other top-level files: `CLAUDE.md` (agent dev guide), `SUPABASE_SETUP.md`, `schema.sql` (canonical DB schema), `migrations/` (one-shot SQL migrations), `vite.config.ts`, `package.json`, `bun.lock`.

## Supabase Setup

For a fresh project, run [`schema.sql`](./schema.sql) in the Supabase SQL Editor — it creates all tables, indexes, grants, and RLS policies in one shot. See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for the bilingual step-by-step walkthrough and explanations. Past schema changes live in [`migrations/`](./migrations/).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
