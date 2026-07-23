import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // No explicit `target` (was 'es2019' pre-engine) — clint-engine's
    // engine/core/context.js uses a top-level `await Promise.all([import(...)])`
    // to load audio/speech/feedback without ever risking a hard import
    // failure (see that file's own header comment). Rolldown/esbuild can't
    // down-level top-level await for an es2019 target at all; the build
    // still produced a working dist/ (verified: real-browser smoke test
    // passed), but only via a "TOLERATED_TRANSFORM" warning shipping the
    // construct as-is anyway — i.e. es2019 was never actually enforced for
    // this file, just silently violated. Falling back to Vite's own
    // default target (same as netrunner/mail, the Vite-path precedent this
    // migration follows, both already proven against this engine) turns
    // that warning into a clean, honest pass. Nothing else in this
    // codebase needed es2019-specific down-leveling (checked: no syntax
    // elsewhere in src/ that Vite's default target would break).
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
  },
});
