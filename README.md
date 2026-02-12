# Vocab Tracker

A multi-language vocabulary learning app powered by AI. Enter a word and get Chinese translations, contextual examples, etymology analysis, and natural voice pronunciation — all generated automatically.

![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?logo=tailwind-css)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5--mini-412991?logo=openai)

## Features

- **AI Translation** — Automatic Chinese translations via OpenAI GPT-5-mini
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
- **CSV Export** — Export vocabulary data
- **Cloud Sync** — Supabase backend for cross-device sync
- **PWA + Offline** — Full offline access via Service Worker + IndexedDB; offline edits auto-sync when back online

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.0+ (recommended) or Node.js 19+
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

## macOS App

Download **VocabTracker.dmg** from the [Releases](https://github.com/aaajiao/vocab-tracker/releases) page.

## Deployment (Vercel)

Push to your Git repository. Vercel will auto-detect Vite and deploy. Configure these environment variables in the Vercel dashboard:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4
- **Backend / Storage**: Supabase (Auth + Postgres)
- **AI**: OpenAI GPT-5-mini (translation & examples), OpenAI TTS (audio)
- **Runtime**: Bun

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

Other top-level files: `CLAUDE.md` (agent dev guide), `SUPABASE_SETUP.md`, `vite.config.js`, `package.json`, `bun.lock`.

## Supabase Setup

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for database schema and configuration.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
