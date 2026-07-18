# Font Consistency Audit

Date: 2026-07-18 · Branch: `fix/token` · Scope: `web/`

**Goal:** the app should render in exactly two families — one sans, one mono — both
reached only through `var(--font-sans)` / `var(--font-mono)`.

**Verdict:** the token layer is correct and the target architecture *already exists*.
Almost nothing honours it. The app currently renders in a set of fonts that **varies by
operating system**, loads **5 families to use 2**, and its two highest-surface-area
components (code editors, dashboard charts) are off-token entirely.

This is a **cleanup, not a build** — see §2.

---

## 1. What fonts are used today

Three distinct categories, which is why the picture looks messy:

### A. Loaded and used — 2
`Geist` (via `--font-sans`), `Geist Mono` (via `--font-mono`). 138 KB, 2 variable files.

### B. Loaded but referenced by nothing — 3
`Nunito Sans`, `IBM Plex Sans`, `IBM Plex Mono`. 49 dead `@font-face` blocks,
24 orphaned `.woff2`. Detail in §4.

### C. Referenced but never loaded — ~19
No font file ships for any of these. They resolve to whatever the visitor's OS has:

> SF Mono · Monaco · Menlo · Consolas · Courier New · Inconsolata · Fira Code ·
> Droid Sans Mono · Ubuntu Mono · source-code-pro · JetBrains Mono · Segoe UI ·
> Roboto · Oxygen · Ubuntu · Cantarell · Arial · SF Pro Text ·
> `-apple-system`/`BlinkMacSystemFont`

### D. Engine defaults — 2
Monaco's built-in stack and ECharts' `sans-serif`. Neither is configured. See §3.

### The practical consequence

Because category C resolves per-machine, **there is no single answer to "what font does
the user see."** Approximately:

| OS | Fonts actually rendered |
|---|---|
| macOS | Geist, Geist Mono, SF Pro, SF Mono, Monaco, Menlo, Courier New, Helvetica |
| Windows | Geist, Geist Mono, Segoe UI, Consolas, Courier New, Arial |
| Linux | Geist, Geist Mono, Ubuntu/Cantarell/Oxygen, Ubuntu Mono, DejaVu |

That cross-OS divergence — not the raw count — is the real defect.

---

## 2. The target architecture already exists

`src/lib/styles/tokens/base.css:506-507`

```css
--font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

`src/styles/base-elements.css`

```css
body { font-family: var(--font-sans); }                             /* :119 — global default */
code { font-family: var(--font-mono); }                             /* :211 */
pre, kbd, samp, .log-line { font-family: var(--font-mono); }        /* :222 */
```

That is exactly the intended end state: **a global sans default plus a mono utility
where needed.** Both tokens are registered for Tailwind v4 at
`component.css:1737-1738`, so the `font-sans` / `font-mono` utilities work — 237 usages,
all correct. Zero `font-serif` usages.

**Therefore the ~70 literal declarations in §5 are local overrides fighting a default
that is already right.** Deleting them makes elements fall through to the correct token.
Nothing new needs designing.

### Keep the token names

Do **not** rename to `--font-primary`. `--font-sans`/`--font-mono` are the Tailwind v4
convention and generate the `font-sans`/`font-mono` utilities for free; renaming touches
237 working call sites for no benefit.

### Remove `'JetBrains Mono'` from the mono stack

It has no `@font-face`, so it only resolves if the *user* has it installed locally —
which developers frequently do and customers do not. **The team may be seeing a
different font than production users.** This silently undermines the consistency the
whole effort is buying. Delete it.

---

## 3. Highest impact: two components ignore the tokens completely

Invisible to a `font-family` grep, and together they cover more pixels than all ~70 CSS
deviations combined.

| Component | Where | Renders in | Should be |
|---|---|---|---|
| **Monaco editor** | `src/components/CodeQueryEditor.vue:651` | Monaco's built-in default (`Menlo, Monaco, 'Courier New', monospace` on macOS) | `var(--font-mono)` |
| **ECharts** (all dashboard panels) | no chart config sets it | ECharts default `sans-serif` | `var(--font-sans)` |

`monaco.editor.create()` passes no `fontFamily`, and neither `defineTheme` call
(`:579`, `:593`) sets one. Verified: **zero** `fontFamily` keys exist in
`src/utils/dashboard/` or `src/components/dashboards/`.

Every query editor and every chart label, axis, legend and tooltip is off-brand before
any CSS is considered. Fix these first.

---

## 4. Font loading: 5 families loaded, 2 used

`src/lib/styles/tokens/base.css` declares **51 `@font-face` blocks**. Only 2 are reachable.

| Family | Blocks | Files | On disk | Referenced? |
|---|---|---|---|---|
| Geist | 1 (variable) | 1 | 68 KB | ✅ `--font-sans` |
| Geist Mono | 1 (variable) | 1 | 70 KB | ✅ `--font-mono` |
| Nunito Sans | 35 | 10 | 215 KB | ❌ nothing |
| IBM Plex Sans | 8 | 8 | 155 KB | ❌ nothing |
| IBM Plex Mono | 6 | 6 | 84 KB | ❌ nothing |

**49 dead blocks, 24 orphaned files, ~454 KB — 70% of `src/styles/fonts/`.**
A repo-wide grep for `Nunito` returns hits only inside `base.css` itself.

Runtime download cost is ~0 (browsers don't fetch unmatched faces), so this is bundle
and maintenance weight, not user-facing latency. Delete anyway.

**Bug inside the dead code:** the 35 Nunito blocks reference only 10 distinct files —
weights 300/400/600/700 of a given style all point at the *same* `src`. The weight axis
is fake. Harmless only because nothing uses it.

**Stale comments asserting the wrong font** (fossils of the pre-Geist migration):
- `src/lib/core/Typography/OText.vue:99` — "Uses IBM Plex Mono via `--font-mono`"
- `src/lib/core/Typography/OText.types.ts:34` — "12px IBM Plex Mono"

Both are wrong: `--font-mono` is Geist Mono.

Also missing: no `<link rel="preload">` for `Geist-Variable.woff2` despite it being the
critical first-paint face. `index.html` contains no font references at all.

---

## 5. Hardcoded literal stacks — ~70 declarations, 12 distinct

Every family named below is category C (§1) — referenced but never loaded.

| # | Literal stack | Count | Files | → becomes |
|---|---|---|---|---|
| 1 | bare `monospace` | 30 | 11 | `--font-mono` |
| 2 | `ui-monospace, SFMono-Regular, Menlo, monospace` | 15 | 3 | `--font-mono` |
| 3 | `'Courier New', monospace` | 5 | 3 | `--font-mono` |
| 4 | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif` | 4 | 3 | `--font-sans` |
| 5 | `'SF_Mono','Monaco','Inconsolata','Fira_Code','Droid_Sans_Mono',monospace` | 4 | 2 | `--font-mono` |
| 6 | `'Monaco','Consolas','Courier_New',monospace` | 3 | 1 | `--font-mono` |
| 7 | `Monaco,Menlo,'Ubuntu_Mono',Consolas,'source-code-pro',monospace` | 1 | 1 | `--font-mono` |
| 8 | `Monaco,Menlo,'Ubuntu_Mono',monospace` | 1 | 1 | `--font-mono` |
| 9 | `Monaco,Menlo,'Courier_New',monospace` | 1 | 1 | `--font-mono` |
| 10 | `JetBrains_Mono,Fira_Code,Monaco,Menlo,Ubuntu_Mono,monospace` | 1 | 1 | `--font-mono` |
| 11 | `-apple-system, …,'Oxygen','Ubuntu','Cantarell', sans-serif` | 1 | 1 | `--font-sans` |
| 12 | `-apple-system, BlinkMacSystemFont,'Segoe UI',Arial,sans-serif` | 1 | 1 | **keep** (§5.2) |

Nine different ways to spell "monospace" (#1–#10).

### 5.1 Per-file detail

**#1 bare `monospace`**
- `src/styles/tailwind.css:129` — shared `.query-editor-placeholder-typewriter` rule
- `src/assets/styles/log-highlighting.css:4`, `:194`
- `src/plugins/logs/TenstackTable.vue:1324`
- `src/plugins/traces/LLMContentRenderer.vue:722`
- `[font-family:monospace]`: `alerts/DestinationPreview.vue:188`,
  `functions/AddFunction.vue:97`, `functions/TestFunction.vue:119`,
  `pipeline/NodeForm/ScheduledPipeline.vue:832`,
  `pipeline/NodeForm/Stream.vue:114`, `:115` (×2)
- `font-[monospace]`: `plugins/correlation/TelemetryCorrelationDashboard.vue:1157`
- inline `style=`: `components/settings/License.vue:451`
- JS-generated HTML: `src/utils/traces/treeTooltipHelpers.ts:232-239`, `:275-282`
  (16 inline `<span style="font-family: monospace">`)

**#2** `alerts/AlertSettingsHelpDrawer.vue:672,902,932,945`;
`enterprise/…/ScoreConfigDetail.vue:58,70,85,105,107,109,122,127,153`;
`enterprise/…/ProviderFormPage.vue:39,118`

**#3** `pipelines/PipelineHistory.vue:415,441` (HTML-entity-escaped);
`alerts/AlertHistory.vue:374,402`; `functions/AddFunction.vue:114`

**#4** `utils/traces/treeTooltipHelpers.ts:217,259`;
`utils/traces/treeVisualizationEngine.ts:361`;
`plugins/traces/ServiceGraph.vue:1067` (JS style assignment on an ECharts tooltip)

**#5** `rum/errorTracking/view/PrettyStackTrace.vue:123,211`;
`views/RUM/SourceMaps.vue:135,139`

**#6** `alerts/DestinationTestResult.vue:35,60,98`
**#7** `plugins/traces/components/TraceErrorTab.vue:204`
**#8** `pipeline/NodeForm/CreateDestinationForm.vue:370`
**#9** `components/RichTextInput.vue:34`
**#10** `pipeline/NodeForm/AssociateFunction.vue:104`
**#11** `alerts/IncidentRCAAnalysis.vue:162`
**#12** `utils/prebuilt-templates/email.ts:30`

### 5.2 Legitimate exception — do not "fix"

`src/utils/prebuilt-templates/email.ts:30` (#12) is an **email template**. Mail clients
cannot load a webfont, so a system stack is correct there. Leave it; add a comment
saying why, so the next audit doesn't re-flag it.

### 5.3 Borderline

`components/ai-assistant/welcome/WelcomeGreeting.vue:47,50,54` —
`font-[var(--font-mono,ui-monospace,…)]`. Works, but the redundant fallback should be
dropped for plain `font-mono`.

---

## 6. Canvas `ctx.font` — a correctness bug, not just cosmetics

| File | Line | Value |
|---|---|---|
| `src/composables/useLogs/logsUtils.ts` | 534 / 538 | `bold 14px sans-serif` / `12px monospace` |
| `src/plugins/correlation/CorrelatedLogsTable.vue` | 784 / 788 | `bold 14px sans-serif` / `12px monospace` |
| `src/utils/dashboard/chartDimensionUtils.ts` | 35 | `${fontSize} sans-serif` |

These feed `measureText()` to compute column widths. They measure in a **different font
than what renders**, so every computed width is subtly wrong — truncation and overflow
bugs that look random. Fix regardless of the consistency goal.

---

## 7. Why this drifted: no guard covers fonts

Four CSS guards run on every PR
(`.github/workflows/playwright.yml:141-150`, `build-pr-image.yml:58-64`):
`lint:tokens`, `lint:styles`, `lint:token-purity`, `lint:design`.

**None of them checks `font-family`.** `scripts/check-token-purity.mjs:122` explicitly
treats `@font-face` as sanctioned and skips it — which is why 49 dead blocks accumulated
invisibly.

`.stylelintrc.json` already bans hardcoded hex and legacy `--o2-*` via
`declaration-property-value-disallowed-list`, and already runs in CI. That is the
ready-made hook — no new tooling needed:

```json
"declaration-property-value-disallowed-list": [
  { "font-family": ["/^(?!.*var\\(--font-(sans|mono)\\)).*$/"] },
  { "message": "Use var(--font-sans) or var(--font-mono). No literal font stacks.",
    "severity": "error" }
]
```

Tailwind arbitrary values (`[font-family:monospace]`, `font-[Monaco,…]`) live in
`class` attributes and stylelint will **not** catch them — those need an ESLint rule or
a line in `check-design-consistency.mjs`. Both halves are required, or this regrows.

`DESIGN_TOKEN_STANDARD.md` §A9 covers font *weight* and *tracking* and marks them done.
It says nothing about family hygiene or `@font-face` — a genuine gap in the standard.

---

## 8. Disruption assessment

Lower than the raw file count suggests, because §2: most edits are **deletions that
converge on a default already in place**. 54 files touched.

| Tier | Scope | Risk | Why |
|---|---|---|---|
| **Zero** | 49 `@font-face` blocks, 24 `.woff2`, 2 stale comments | none | Nothing references them — provably no visual change |
| **Low** | ~5 sans literals (#4, #11) | low | Fall through to the global `body` rule; near-identical on macOS, an improvement on Windows |
| **Moderate** | ~65 mono literals (#1–#10) | visible diffs | Geist Mono's advance widths differ from Menlo/Monaco/Courier New |
| **High** | Monaco + ECharts + 5 canvas sites | coupled | Must land together — see below |

**Moderate tier:** anything measured in character counts reflows — log table columns,
stack traces, query previews, trace tooltips. Nothing breaks; expect visible diffs
across traces, alerts, pipelines, RUM and functions. Budget *review* time, not fix time.

**High tier is atomic.** Monaco, ECharts and the canvas `measureText` sites are coupled:
changing the render font without changing the measurement font (or vice versa) produces
**worse** column-width bugs than today. Ship them in one commit.

### Test impact — small

- Two specs assert literal font strings and need updating:
  `src/utils/traces/treeTooltipHelpers.spec.ts:427` (`-apple-system`) and `:431`
  (`font-family: monospace`).
- `measureText` is canvas-mocked in unit tests, so **no test breaks from metric changes**.
- No visual-regression suite exists, so nothing auto-detects the §8 moderate-tier diffs —
  they need human review.

### Risk to decide before starting: glyph coverage

Today log lines fall back to Menlo/Consolas, which have broad Unicode coverage.
Geist Mono's is narrower. **Log data is arbitrary user input** — CJK, box-drawing
characters, emoji in structured logs. Forcing Geist Mono everywhere risks tofu boxes in
exactly the surface where correctness matters most.

Verify Geist Mono's coverage against representative log data, and keep a broad fallback
in `--font-mono` rather than collapsing to a bare `monospace`.

**Effort:** roughly a day of mostly mechanical edits; review dominated by moderate-tier
visual diffs.

---

## 9. Recommended order of work

1. **Zero-risk deletion** — dead `@font-face`, `.woff2`, stale OText comments.
   Gives a clean baseline before any visual diff lands.
2. **Monaco + ECharts + canvas `ctx.font`** (atomic) — largest visual win, fixes real
   width-calculation bugs.
3. **Collapse the ~70 literals** per the mapping in §5.
4. **Remove `'JetBrains Mono'`** from `--font-mono` (§2).
5. **Add the guard** — stylelint rule *and* class-attribute check (§7). Same PR as any
   of the above, so it cannot regress.
6. **Preload `Geist-Variable.woff2`**; add the §5.2 exception comment to `email.ts`.

Steps 1–4 are behaviour-preserving except that text starts rendering in Geist — which is
the point.
