import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        // Each test file gets its own module graph so module-level state
        // (e.g. cached IndexedDB connection in services/*Cache.ts) doesn't leak.
        isolate: true,
    },
});
