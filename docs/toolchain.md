# Toolchain and compatibility

The repository pins direct dependencies and commits `bun.lock`. Use Bun 1.4.2 and `bun install --frozen-lockfile` for repeatable installs. Node.js 24 is the deployment target; the host's global Node version is independent and should not be changed as part of a repository upgrade.

## TypeScript

- `@typescript/native` aliases `typescript@7.0.2` and provides the default `tsc` executable.
- `typescript` aliases `@typescript/typescript6@6.0.2`. Its API entry re-exports `@typescript/old`, locked to the real `typescript@6.0.3` implementation. The wrapper version and underlying compiler version are different.
- `bun run typecheck` uses TypeScript 7. `bun run typecheck:compat` uses `tsc6` and verifies compatibility with consumers of the previous compiler API.
- `tsconfig.json` explicitly declares its root and Node/Bun/Vite types, and checks app, server, API, scripts, database tests, the Codex CLI implementation, and Vite/Vitest configuration. Codex behavior tests run separately with Bun.

Do not replace the compatibility package with native TypeScript solely because a frontend build succeeds. Vercel's Node builder and other tooling may load `typescript` programmatically. Validate that `require('typescript')` exposes real `createProgram`, `transpileModule`, and `sys.readFile` functions, then check the actual Vercel build and function smoke tests when changing compilers.

The official [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) documents this side-by-side setup. Vite 8's bundler and plugin migration is covered in the [Vite migration guide](https://vite.dev/guide/migration).

## Local development access

Vite binds to `127.0.0.1` by default. To test from a phone or container explicitly enable LAN binding; list any custom hostnames that should be accepted:

```sh
VITE_DEV_LAN=1 VITE_DEV_ALLOWED_HOSTS=vocab.local bun run dev
```

The custom hostname list is comma-separated. Vite's normal localhost/IP rules still apply; `allowedHosts: true` is not used. The OpenAI development proxy validates HTTPS certificates.

## Upgrade checks

Run type checks, `bun run test:all`, `bun run build`, and `bun audit`. Check offline startup and Service Worker replacement after changing Vite, Tailwind, or Workbox. Test production API behavior under the Vercel Node runtime separately from local Bun execution. Fix vulnerable transitive dependencies through compatible upstream releases; do not force broad major-version overrides to silence audit output.
