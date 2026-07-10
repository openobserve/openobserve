# OpenObserve Web Frontend Benchmark

Measures how much the frontend improved after migrating from **Quasar** to
**reka-ui + custom O2 components**. It builds two git states, serves each one
identically, and compares them across five dimensions:

| Dimension | Tool | Needs backend? | What it shows |
|---|---|---|---|
| **Bundle size** | Node zlib on `dist/` | No | JS/CSS transfer weight, Quasar vs reka weight, initial payload |
| **Lighthouse** | `lighthouse` (headless Chrome) | Yes | Perf/a11y scores, FCP, LCP, TBT, CLS, TTI, bootup time |
| **Runtime load** | Playwright | Yes | Real navigation/paint timings, JS heap, resource count |
| **Accessibility** | `axe-core` in-page | Yes | WCAG 2.1 A/AA violations per route |
| **Keyboard shortcuts** | static source scan | No | Registry presence, shortcut count, keydown coverage |

The two states (edit in [`config.mjs`](config.mjs)):

- **Baseline** `75bda12998` — right before `feat: ux improvement tabs and buttons (#11595)` (2026-05-06), the last pre-migration commit.
- **Current** `main` — reka-ui + O2 components.

## How it works

1. **Build** — each commit is checked out into an isolated `git worktree`, deps
   installed (`npm ci`), and built with `VITE_OPENOBSERVE_ENDPOINT=http://localhost:8199`
   so all API calls are same-origin. Your working tree is never touched.
2. **Serve** — a tiny static server hosts the built `dist/` at `/web/` and
   **proxies** every other path (`/api`, `/auth`, `/config`, …) to your real
   OpenObserve backend. Same-origin means the login cookie/session just works,
   and both commits hit identical live data.
3. **Measure** — log in once (reused via `storageState`), then run Lighthouse,
   axe, and Playwright timing probes on each route; measure `dist/` weight and
   scan source for the shortcut system.
4. **Report** — writes `results/results.json` and a self-contained, theme-aware
   `results/report.html` with signed deltas (green = improvement).

## Prerequisites

- Node 18+ and Git.
- A **running OpenObserve backend** with some ingested data (the same setup the
  Playwright suite uses). Bundle + shortcut steps work without it.
- Disk/time for two full production builds (each worktree gets its own
  `node_modules` + `dist`).

## Usage

```bash
cd web/benchmarks
cp .env.example .env      # fill in backend URL + root credentials
npm install               # also downloads a Chromium for Playwright

# full run (both commits, all dimensions)
npm run bench

# fast iteration — no backend needed (bundle + shortcuts only)
npm run bench:bundle

# reuse already-built worktrees instead of rebuilding
node run.mjs --reuse

# only some steps
node run.mjs --only=lighthouse,axe

# one commit only, or override refs
node run.mjs --commit=current
node run.mjs --baseline=<sha> --current=<sha>
```

Open `results/report.html` when it finishes.

## Fairness notes (important)

- **Same machine, unplugged from other load.** Perf numbers are relative.
- Lighthouse uses a **fixed CPU throttle** (`config.mjs → LIGHTHOUSE_THROTTLING`)
  and the **median of N runs** to control noise.
- Both commits are built with the **same Node/toolchain** and served identically.
- Routes in `config.mjs` assume seeded data in `ORGNAME`. Tune the paths and org
  to wherever your test data lives, or some routes will render empty.
- `build-only` is used (skips `vue-tsc`) so an old baseline builds under the
  current toolchain without type-check failures.

## Caveats

- The current `vite.config.ts` has `visualizer({ open: true })`, which pops a
  browser tab at the end of each build. Harmless; close it.
- If backend auth is **localStorage-based**, Lighthouse auth is injected into the
  shared Chrome profile before its runs (see `lib/measure-lighthouse.mjs`).
- Interaction probes are best-effort and guarded — a missing selector yields
  `null`, never a crash. Tune selectors in `lib/measure-runtime.mjs` for the
  specific components you care about.
