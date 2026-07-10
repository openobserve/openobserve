# Frontend Perf Improvements — Entry-Chunk Diet

**Source:** benchmark of `main` (reka-ui + O2) vs `75bda12998` (pre-tabs-migration Quasar baseline, 2026-05-06).
**Owner:** _(assign)_  ·  **Status:** ready to execute async.

---

## TL;DR — there is exactly one problem

Every **vendor** chunk (monaco, echarts, highlight.js, maps, moment, lodash…) is **byte-identical**
between the two builds. **100% of the size regression is in the main entry chunk `index.js`**, which is
parsed **before first paint**:

| | Baseline (Quasar) | Current (reka) | Δ |
|---|---|---|---|
| Entry `index.js` (gzip) | 960 KB | **1755 KB** | **+795 KB (+83%)** |
| Entry (rendered) | 4995 KB | 9350 KB | +4355 KB |
| All assets (gzip) | 5198 KB | 5933 KB | +14% |
| **CSS (gzip)** | 432 KB | **239 KB** | **−45% ✅** (Quasar→Tailwind win) |

**Runtime impact (Playwright, authenticated, median):** FCP +50–90 ms, JS heap up (dashboards 28→64 MB).
Lighthouse *perf scores* actually **improved** (better LCP on heavy pages) — but the bloated entry is what
drags FCP/heap/first-load. Shrinking the entry improves all three.

> ⚠️ **Confound:** the baseline is ~2 months older, so part of this growth is genuine feature work, not the
> migration. Don't attribute the whole +795 KB to reka. The *fixes* below are valid regardless of cause.

---

## Evidence — what's in the entry chunk (per-package Δ, rendered KB)

Measured by diffing `stats.html` from both builds (script in the Appendix). Biggest growth first:

| Δ rendered | Package | Category | Notes |
|---:|---|---|---|
| **+1483** | `src/locales` (now **3344 KB**) | config | **All 13 languages loaded eagerly** into the entry |
| **+729** | `src/lib` (O2 components) | migration | Whole component lib in entry, no splitting |
| +538 | `src/assets` | config | Inlined SVGs / assets in entry |
| +537 | `src/enterprise` | config | Enterprise code eager |
| **+391** | `reka-ui` | migration | Primitives eager |
| +146 | `zod` | migration | New; heavy schema usage |
| +140 | `src/components` | mixed | |
| +117 | `@tanstack/table-core` | migration | New |
| +104 | `vue-draggable-next` | migration | Route-specific (drag), eager |
| +100 | `@internationalized/date` | migration | New (date pickers) |
| +90 | `js-yaml` | migration | New |
| +75 | `@tanstack/form-core` | migration | New |
| +28 | `@tanstack/virtual-core` | migration | New |
| **−582** | `quasar` | — | Removed ✅ |

**Reading:** the migration removed 582 KB of Quasar but added ~1.9 MB of new eager code
(O2 lib + reka + the tanstack/zod/date stack), and the entry was *already* carrying all locales +
enterprise + assets eagerly. **Nothing is code-split** — it all ships on first paint.

---

## Action items (ranked by leverage)

### 1. Lazy-load locales — 🥇 biggest win, ~3 MB rendered off the entry
**Problem:** all 13 language files in `src/locales/languages/*` are bundled into the entry (3344 KB rendered).
Users need exactly one.
**Do:** load only the active locale, dynamically. In the i18n setup (search `createI18n` / `messages`),
replace the static `import ... from "./languages/xx.json"` map + `messages` object with lazy loading:
```ts
// pattern
const loadLocale = (l: string) => import(`./languages/${l}.json`);
// set the initial locale's messages, then i18n.global.setLocaleMessage on switch
```
Vite will emit one chunk per language, fetched on demand.
**Expected:** entry gzip drops sharply (locales are the single largest contributor). Helps **both** old & new.
**Effort:** M · **Risk:** M (verify locale switching + SSR-less hydration of the active language on boot).
**Verify:** `npm run bench:bundle` (no backend) → entry gzip + `src/locales` should collapse in `stats.html`.

### 2. Route-level code splitting — enterprise, views, most components
**Problem:** `src/enterprise` (+537), `src/views` and most of `src/components` are in the entry instead of
per-route chunks.
**Do:** ensure router route components use dynamic import (`component: () => import('...')`) rather than
static imports, and wrap heavy non-route components in `defineAsyncComponent`. Audit `src/enterprise`
imports that are pulled in eagerly from always-loaded modules (main.ts, MainLayout, stores).
**Expected:** large entry reduction; per-route chunks load on navigation.
**Effort:** M–L · **Risk:** M (watch for components needed on first paint — keep those eager).
**Verify:** entry breakdown script — `src/enterprise` / `src/views` should shrink toward ~0 in the entry.

### 3. Lazy the new per-route deps
**Problem:** these are only used on specific routes but load on first paint:
`@tanstack/vue-form` + `zod` (forms), `@tanstack/vue-table` (tables), `vue-draggable-next` (dashboards/pipeline
drag), `@internationalized/date` (date pickers), `js-yaml` (import/export/config).
**Do:** import them inside the route/feature that uses them (dynamic import) or the async route chunk, not from
shared always-loaded modules. `zod` especially — move schema modules behind the forms that use them.
**Expected:** ~450–550 KB rendered off the entry.
**Effort:** M · **Risk:** L–M.
**Verify:** these packages should disappear from the entry breakdown.

### 4. `manualChunks` for reka-ui + the O2 lib
**Problem:** `reka-ui` (+391) and `src/lib` (+729) sit in the entry. Even if some must load eagerly, splitting
them into their own chunks lets the browser download in parallel and cache them across route changes.
**Do:** in [`vite.config.ts`](../vite.config.ts) `build.rollupOptions.output.manualChunks`, add entries e.g.:
```ts
"reka-ui": ["reka-ui"],
// and a chunk for the O2 component library if it isn't route-split by step 2
```
**Expected:** entry shrinks; better caching (lib chunk stable across deploys that don't touch it).
**Effort:** S · **Risk:** L. **Verify:** new `reka-ui.*.js` chunk appears; entry gzip drops.

### 5. Verify reka-ui + icon tree-shaking
**Do:** confirm only *used* reka primitives are imported (no barrel `import * as`), and that `lucide-vue-next`
icons are imported individually (tree-shakeable), not as a set. Grep for broad imports.
**Effort:** S · **Risk:** L.

### 6. (Optional) Trim `src/assets` in the entry (+538)
Inlined SVGs/assets are in the entry. Import large/rarely-used SVGs as URLs (`?url`) or lazy, so they don't
inline into first-paint JS.

---

## How to verify (no backend needed for bundle work)

From `web/benchmarks/`:
```bash
# bundle + shortcut coverage only — builds both commits, no login/backend
npm run bench:bundle          # or: node run.mjs --only=bundle --reuse
open results/report.html      # CSS/JS gzip deltas
```

To inspect the **entry chunk composition** after a change, rebuild and run the breakdown script (Appendix).
Windows build gotchas discovered during benchmarking:
- Build from **`web/`**, and pass base without shell mangling: use `execFile`, or set `MSYS_NO_PATHCONV=1`.
- The build can OOM at default heap → `NODE_OPTIONS=--max_old_space_size=8192`.
- `vite.config.ts` has `visualizer({ open: true })` → emits `stats.html` (and pops a browser tab).

```bash
# one-off local build that matches the harness (from web/):
MSYS_NO_PATHCONV=1 NODE_OPTIONS=--max_old_space_size=8192 \
  VITE_OPENOBSERVE_ENDPOINT=http://localhost:8199 NODE_ENV= \
  DS_CONTENT_STRICT= DS_CONTENT_FORCE= npm run build-only -- --base /web/
```

**Suggested target:** get entry `index.js` gzip back under ~1 MB (from 1755 KB). Locales (step 1) alone should
get most of the way.

---

## Prevent regressions (CI budget — recommended)

Add a PR check that fails when the entry-chunk gzip grows beyond a threshold. The `stats.html` parser below
(or a direct `dist/assets/index-*.js` gzip measure) can drive it — deterministic, no backend. This would have
caught the +795 KB at review time.

---

## Appendix — entry-chunk breakdown script

Run after any build to see what's in the entry (`web/` cwd, points at the visualizer output):

```js
// node this file with the path to a build's stats.html
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const m = "const data = "; let i = html.indexOf(m) + m.length;
let depth = 0, start = i, inStr = false, esc = false;
for (; i < html.length; i++) { const ch = html[i];
  if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { i++; break; } } }
const data = JSON.parse(html.slice(start, i)), parts = data.nodeParts, metas = data.nodeMetas;
const entry = (data.tree.children || []).find(c => /index-.*\.js$/.test(c.name));
const by = {};
(function walk(n){ if (n.children) n.children.forEach(walk);
  else if (n.uid) { const p = parts[n.uid]; if (!p) return; const id = metas[p.metaUid]?.id || ""; let k;
    const nm = id.match(/node_modules\/((@[^/]+\/[^/]+)|([^/]+))/); if (nm) k = nm[1];
    else { const s = id.match(/src\/([^/]+)/); k = s ? "src/" + s[1] : "(other)"; }
    by[k] = (by[k] || 0) + (p.renderedLength || 0); } })(entry);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(String((v/1024).toFixed(0)).padStart(6) + "KB", k);
```
