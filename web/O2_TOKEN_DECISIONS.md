# O2 Token Migration — Decision Register

> Companion to `O2_TOKEN_MIGRATION_PLAN.md` and `O2_TOKEN_MIGRATION_PENDING.md`.
> Every item here is a **design/product decision** that blocks the final migration
> phases (E and G). Once each is answered, the migration is 100% executable with
> no further judgment calls. **Nothing here is engineering-blocked — only decision-blocked.**
>
> How to use: take each decision to the named owner, view it on the listed page to
> confirm the current look, record the answer in the **Decision** box, and hand back.
> The **Migration** line says exactly what eng does once you've answered.
>
> Status legend: 🎨 design-owned · 📊 data-viz-owned · 🏷️ brand-owned · ⚙️ eng-owned (fast call)

Owner routing at a glance:

| Group | Decisions | Ask |
|---|---|---|
| Categorical / data-viz palettes | D1–D5 | 📊 data-viz + 🎨 design |
| Code-syntax highlighting | D6 | 🎨 design (+ eng for editor parity) |
| Bespoke / always-dark component surfaces | D7–D11 | 🎨 design + feature owners (traces, AI) |
| Brand / fixed-color exceptions | D12–D14 | 🏷️ brand + 🎨 design |
| Scale & policy | D15–D18 | 🎨 design (quick) |
| Mechanism confirmations | D19–D20 | ⚙️ eng (fast, near self-serve) |

---

## Group 1 — Categorical / data-viz palettes 📊🎨

These are **multi-hue categorical palettes** (one color per category), not semantic single-purpose colors. The question for each is the same: **(a)** promote it into the token layer as a dedicated `--color-*` family (light+dark), or **(b)** formally allowlist the source file as a "palette home" so the ratchet ignores it. Register (a) when the palette is consumed across components or should follow theme; allowlist (b) when it's a single-file self-contained lookup.

### D1 — Trace DAG node-type palette 📊
- **What / why:** 14 LLM-span node types (`generation`, `embedding`, `agent`, `tool`, `retrieval`, …) each with its own border/bg/text color, light **and** dark. Already theme-correct via `dark:`. ~**97 hex** across ~42 logical colors.
- **Files:** `src/plugins/traces/TraceDAG.vue` (lines 446–465, the node-type + text maps).
- **Where to verify:** **Traces** → open any LLM/GenAI trace → **DAG / graph tab**. Route `/traces` → select a trace with spans. Toggle light/dark.
- **Recommendation:** **(a) register** `--color-dag-node-{type}-{border,bg,text}` (~42 tokens). It's a first-class viz surface and already has both themes; tokenizing kills 97 hex and makes it themeable. Large but mechanical.
- **Decision:** ______  (register / allowlist)  — owner: __________
- **Migration:** add the 42 tokens (light in `semantic.css`, dark in `dark.css`, register in `component.css`); replace the two JS maps with token classes. Visual no-op.

### D2 — Incident icon-category chips 🎨
- **What / why:** 5 category icons (alert=amber, notification=blue, service=purple, schedule=green, chart=rose), each a themed bg+text pair (`~500/10%` dark, `~50/600` light). **~38 occurrences.** No semantic token exists for purple/rose categories.
- **Files:** `src/components/alerts/IncidentDetailDrawer.vue` (lines 218–301).
- **Where to verify:** **Alerts → Incidents** → open an incident → the summary header icon chips. Route `/alerts` (Incidents tab) → open one.
- **Recommendation:** **(a) register** a small `--color-incident-cat-{alert,notification,service,schedule,metric}-{bg,text}` family. They're a fixed semantic-ish set (category → color) reused per incident.
- **Decision:** ______  — owner: __________
- **Migration:** register the 5×2 tokens, collapse each theme ternary to a single token class (dark handled by the token).

### D3 — Incident timeline event-badge palette 📊
- **What / why:** `getEventBadgeColor()` returns one of 6 hues (red/amber/purple/blue/green/pink) per event type; badges composite it as bg (alpha) + border (alpha) + white text in dark. **13 theme-ternary sites** + a 6-color JS array.
- **Files:** `src/components/alerts/IncidentTimeline.vue` (palette at lines 430–436; badge styles 124–185).
- **Where to verify:** **Alerts → Incidents** → open incident → **Timeline** section (event badges down the timeline).
- **Recommendation:** **(a) register** `--color-event-{type}` (6 tokens) + move the alpha-composite into a tiny helper that reads the token via `chartColor()`. Removes the 13 `theme===dark` reads (mechanism win too).
- **Decision:** ______  — owner: __________
- **Migration:** 6 tokens; replace `getEventBadgeColor` hex returns with token reads; badge bg/border via `color-mix(... token ...)`; dark handled by token so the ternaries collapse.

### D4 — Eval dimension palette 📊
- **What / why:** `DIM_COLOR_*` 13-dimension categorical palette for eval scoring viz.
- **Files:** `src/plugins/traces/TraceEvaluationsView.vue` (+ 11 raw palette utils there too).
- **Where to verify:** **Traces → Evaluations** view (enterprise/online-evals). Route `/traces` → Evaluations tab.
- **Recommendation:** **(a) register** `--color-eval-dim-{1..13}` OR allowlist if it's purely internal debug viz. Lower traffic than D1–D3 — team's call.
- **Decision:** ______  — owner: __________
- **Migration:** register 13 tokens or add file to the `tsHex` allowlist; convert the 11 raw utils regardless.

### D5 — Confirm existing `.ts` palette homes 📊
- **What / why:** Three files are **already** `tsHex`-allowlisted as declared palette sources: `utils/traces/traceColors.ts` (70), `utils/dashboard/colorPalette.ts` (50), `constants/themes.ts` (36). Just needs sign-off that they **stay** the canonical palette homes (vs. moving values into the token layer).
- **Where to verify:** dashboard panels (series colors), trace service colors — any chart with categorical series.
- **Recommendation:** **keep allowlisted.** 50-color series palettes are noise in CSS; a declared JS home is the pragmatic norm.
- **Decision:** ______  — owner: __________
- **Migration:** none if confirmed (already allowlisted); document them as the official palette homes.

---

## Group 2 — Code-syntax highlighting 🎨

### D6 — One shared `--color-syntax-*` set (or per-component) 🎨
- **What / why:** Three places hand-roll a code/stacktrace syntax-highlight theme (keyword/string/number/comment/punctuation colors), each with its own hex set: the `hljs` theme in the AI chat, the VS-Code-style stacktrace palette (`.stack-*`), and the code block. **Question:** design ONE canonical `--color-syntax-{keyword,string,number,comment,func,punctuation,…}` family (light+dark) shared by all three, or accept them as separate documented sub-themes?
- **Files:** `src/components/O2AIChat.vue` (hljs block, part of its 159 hex), `src/plugins/traces/components/TraceErrorTab.vue` (`.stack-*`, ~28 hex), `src/lib/core/Code/OCodeBlock.vue` (~31 hex).
- **Where to verify:** **(1)** AI chat → send a message with a code block (toggle from top bar / logs toolbar). **(2)** Traces → open a trace with an **error/exception** → Error tab stacktrace. **(3)** anywhere `OCodeBlock` renders (ingestion snippets, code viewers).
- **Recommendation:** **one shared `--color-syntax-*` family.** Syntax colors should be consistent app-wide; three drifting themes is exactly the debt we're removing. Design ~10 tokens × light/dark once.
- **Decision:** ______  (shared / per-component)  — owner: __________
- **Migration:** register the family; point all three components at it; delete their private hex. Biggest single visual-review surface — verify each of the 3 spots in both themes.

---

## Group 3 — Bespoke / always-dark component surfaces 🎨

### D7 — Service-graph side panels: always-dark or theme-aware? 🎨
- **What / why:** The graph Edge/Node inspector panels are styled with **fixed dark** values (`#0f1419`, `#1a1f2e`, `#2d3548`, `#60a5fa`, …) with **no light variant** — likely an intentional "glass panel over the graph canvas" look. **~128 hex** (Edge) + **22** (Node) + translucent `rgba()` tooltips.
- **Files:** `src/plugins/traces/ServiceGraphEdgeSidePanel.vue`, `src/plugins/traces/ServiceGraphNodeSidePanel.vue`.
- **Where to verify:** **Traces → Service Map / service graph** → click a **node** (node panel) or an **edge** (edge panel). Switch app to light mode and confirm whether the panel is *meant* to stay dark.
- **Recommendation:** decide intent: **(a)** theme-aware → register `--color-graph-panel-*` with a light treatment (design must supply light values); **(b)** intentionally always-dark → register an **always-dark** `--color-graph-panel-*` set (fixed values in both themes) so it stops using raw hex but keeps the look. Either way it gets tokenized; the question is whether light values are needed.
- **Decision:** ______  (theme-aware / always-dark)  — owner: __________
- **Migration:** register `--color-graph-panel-*`; if always-dark, both `:root` and `.dark` hold the same values; replace hex. Also decide the tooltip `rgba()` treatment.

### D8 — O2AIChat chat surfaces 🎨
- **What / why:** Beyond its code theme (D6), the AI chat has fine chat-surface shades (input box bg/border, message bubbles, gradient panels) + its own `.light-mode`/`.dark-mode` class mechanism. **~159 hex total** (largest single file).
- **Files:** `src/components/O2AIChat.vue`.
- **Where to verify:** open the **AI assistant** slide-over (top bar / logs toolbar), send messages, both themes.
- **Recommendation:** register `--color-chat-{input-bg,input-border,bubble-user,bubble-assistant,…}`; migrate `.light-mode`/`.dark-mode` → `.dark`. Do **after** D6 (shares the code theme).
- **Decision:** ______  (dedicated token set / documented exception)  — owner: __________
- **Migration:** register chat tokens; convert style block to tokens + `.dark`; keep gradients per D14.

### D9 — Thread/LLM chat bubble aesthetic 🎨
- **What / why:** Bespoke per-role accent bubbles for the LLM thread view, plus its own dark mechanism. **~64 hex** across the two files.
- **Files:** `src/plugins/traces/ThreadView.vue`, `src/plugins/traces/ThreadToolCalls.vue`.
- **Where to verify:** **Traces** → open a GenAI/LLM trace → **Thread** view (tool calls + messages).
- **Recommendation:** register `--color-thread-{role}-{bg,border,text}`; decouple its dark mechanism to `.dark`.
- **Decision:** ______  — owner: __________
- **Migration:** register the role tokens; tokenize + `.dark`.

### D10 — SetupCardRenderer private token system 🎨
- **What / why:** Invents a **private** design system in its style block: `--clay`, `--clay-bright/soft`, `--panel/-2`, `--border/-2`, `--text-1/2/3`, `--ok/-soft`, `--warn/-soft/-ink`, `--primary/-ink`, `--track` — each hardcoded light+dark. **~37 hex.** Most map 1:1 to global tokens.
- **Files:** `src/components/ingestion/setupCard/SetupCardRenderer.vue` (lines ~813–855).
- **Where to verify:** **Ingestion** → a setup card (the guided data-source setup). Route `/ingestion` → pick a source.
- **Recommendation:** **map its private vars → global tokens** (`--panel`→`--color-surface-base`, `--border`→`--color-border-default`, `--text-1/2/3`→`--color-text-primary/secondary/…`, `--ok`→`--color-status-positive`, `--warn`→`--color-status-warning-*`). No new tokens needed — it's a rename.
- **Decision:** ______  (map to global / bless as scoped sub-system)  — owner: __________
- **Migration:** delete the private block; point consumers at global tokens; verify the card in both themes.

### D11 — TraceDetailsSidebar residual greys 🎨 (low-decision)
- **What / why:** Mixed surface/border greys + a few status colors; **~59 hex**. Mostly mechanically tokenizable — only flag is confirming a couple of chip accent colors.
- **Files:** `src/plugins/traces/TraceDetailsSidebar.vue`.
- **Where to verify:** **Traces** → open a trace → the **details sidebar** (span attributes, toolbar chips).
- **Recommendation:** **mostly mechanical** — schedule as a focused Phase-E pass; only the LLM-chip category accents may need a token call (fold into D6/D9 if shared).
- **Decision:** ______  — owner: __________
- **Migration:** tokenize greys → surface/border/text tokens; `.body--dark` twins collapse; scope the block.

---

## Group 4 — Brand / fixed-color exceptions 🏷️🎨

### D12 — Destination preview brand replicas 🏷️
- **What / why:** Pixel-accurate **Slack / Teams / Email** message replicas — the colors are those products' brand colors and **must stay fixed** (theme-independent). **~89 hex.**
- **Files:** `src/components/alerts/DestinationPreview.vue`.
- **Where to verify:** **Alerts → Destinations** → add/edit a destination → the **preview** pane (Slack/Teams/Email mock).
- **Recommendation:** **allowlist** (documented permanent exception). Do NOT tokenize — these replicate external brands.
- **Decision:** ______  (allowlist confirmed?)  — owner: __________
- **Migration:** add file to the design-consistency allowlist with a comment; no color changes.

### D13 — Webinar banner fixed amber 🏷️
- **What / why:** Fixed-amber promotional top banner + on-amber contrast colors — deliberately theme-independent promo art.
- **Files:** `src/components/WebinarBanner.vue` (+ `src/lib/core/Button/OButton.vue` `webinar-dismiss` variant, `text-[#1e3a8a]`).
- **Where to verify:** top-of-app banner when a webinar is active (may need to force-enable to see).
- **Recommendation:** **allowlist** as promo art, OR register `--color-promo-*` if we want it themeable. Lean allowlist (it's marketing art).
- **Decision:** ______  — owner: __________
- **Migration:** allowlist the file + the OButton variant, or register 2–3 promo tokens.

### D14 — Brand gradients 🏷️🎨
- **What / why:** Purple→pink **AI/brand gradients** used on AI buttons and panels, plus a red→pink notification gradient. No gradient token exists. Appears in: O2AIChat, `QueryEditor.vue`, `QueryEditorDialog.vue`, `License.vue`, `OrgStorage*`, `MenuLink.vue` (notification badge).
- **Files:** the above (`bg-[linear-gradient(...)]` / `[background:linear-gradient(...)]`).
- **Where to verify:** any **AI "generate" button** (logs/alerts query editors), the AI chat header, License/OrgStorage cards, the menu notification badge.
- **Recommendation:** **register gradient tokens** — `--color-gradient-ai` (purple→pink), `--color-gradient-notification`. One definition, reused everywhere; theme-independent by design. Better than allowlisting because it's reused ~8 places and should be consistent.
- **Decision:** ______  (gradient tokens / allowlist)  — owner: __________
- **Migration:** define the gradient tokens; replace the inline gradients with `[background:var(--color-gradient-ai)]`. Removes ~8 sites at once.

---

## Group 5 — Scale & policy 🎨 (fast calls)

### D15 — z-index ladder 🎨⚙️
- **What / why:** 49 arbitrary `z-[…]` values (`z-[1]`…`z-[10001]`) with no ladder. Need a role→step table so tooltip-under-dialog bugs stop.
- **Files:** ~12 files (MetricList, SearchBar ×2, ServiceGraphEdgeSidePanel, CustomNode, PipelineFlow, WebinarBanner, …).
- **Where to verify:** anywhere overlays stack — open a dialog with a tooltip/dropdown inside it.
- **Recommendation:** ladder = **raised 10 / sticky 20 / dropdown 30 / overlay 40 / modal 50 / toast 60**; confirm where **Quasar's own** stacking (dialog/menu/notify, which sit in the thousands) lands so app values stay below/above correctly.
- **Decision:** ladder values = ______ ; Quasar interop tier = ______  — owner: __________
- **Migration:** map all 49 sites onto the ladder; allowlist any genuine third-party-interop value by file.

### D16 — 10px micro-label floor 🎨
- **What / why:** ~88 `text-[10px]` sites. Keep 10px as a dedicated micro-label token, or lift to 11px app-wide?
- **Where to verify:** chart axis micro-labels, dense table meta text.
- **Recommendation:** add **`--text-3xs` (10px)** but **restrict to chart/axis micro-labels**; lift all non-chart 10px → `text-2xs` (11px). (13px `text-compact` and utility naming are already DECIDED.)
- **Decision:** ______  (dedicated 10px token / lift to 11px)  — owner: __________
- **Migration:** register `--text-3xs` if kept; convert the 88 sites accordingly.

### D17 — white / black after the palette kill 🎨⚙️
- **What / why:** Phase G disables Tailwind's default palette. `bg-white`/`text-black` etc. then need `--color-white`/`--color-black` re-registered, OR we ban them and force `text-text-inverse`/surface tokens.
- **Where to verify:** icon-on-accent buttons, a few reviewed-legit white/black uses.
- **Recommendation:** **re-register `--color-white`/`--color-black`** for the small reviewed-legit set (icon-on-colored-bg), ban raw white/black elsewhere via the guard.
- **Decision:** ______  (re-register / ban-and-force-tokens)  — owner: __________
- **Migration:** either add the 2 tokens to `@theme inline`, or codemod remaining white/black → semantic tokens.

### D18 — Ratify the accents I introduced ⚙️🎨
- **What / why:** I already registered, from **already-shipping values**, `--color-ai-accent` (#7B61FF), `--color-sql-accent` (#7C3AED light / #A78BFA dark), and `--color-lang-{sql,vrl,promql}-{text,bg}`. These unblocked Batch 1–2. Needs a quick ratify of **naming + values** (no visual change — values are what already shipped).
- **Where to verify:** AI welcome hero (lang chips), login onboarding, alert query editor dialog (stream-name badge / sql status bar).
- **Recommendation:** **keep as-is.** Rename only if the team has a naming convention preference.
- **Decision:** ______  (keep / rename to ______)  — owner: __________
- **Migration:** none unless renamed (then a token rename + ref update).

---

## Group 6 — Mechanism confirmations ⚙️ (fast, near self-serve)

### D19 — Editor `currentMode` theme strings ⚙️
- **What / why:** Several places map `theme === 'dark' ? 'dark' : 'light'` to a **Monaco/CodeMirror theme name** (not a color). This is a legit theme read, but it currently uses raw `store.state.theme`. Confirm the rule: route these through **`useTheme().isDark`** (the sanctioned JS seam), keeping the string mapping.
- **Files:** `src/components/settings/General.vue` (×5), `src/plugins/logs/SearchResult.vue`, `JsonPreview.vue`, `DetailTable.vue`, others.
- **Recommendation:** **allowed use, via `useTheme()`.** It's an editor-library theme name, not a hardcoded color — no token needed.
- **Decision:** ______  (route via useTheme — yes/no)  — owner: __________
- **Migration:** replace `store.state.theme === 'dark'` with `useTheme().isDark` at these sites; no color change.

### D20 — `.dark-theme` / `.xxx--dark` / `.dark-mode` / `.light-mode` → `.dark` ⚙️
- **What / why:** Many components toggle a **scoped** dark class (`dark-theme`, `hero-page--dark`, `feature-card--dark`, `storage-card--dark`, `o2-primary-button-dark/light`, `dark-mode-editor`) instead of the single `.dark` convention. This is the **dark-mechanism fragmentation** (already decided: one `.dark` way). Only needs confirmation that **no component intends a different look than plain dark mode** (i.e. the `--dark` class is purely "dark styling," not a distinct state).
- **Files:** logs (`SearchBar`, `TransformSelector`, `FunctionSelector`, `JsonPreview`, `DetailTable`), settings (`OrgStorageSettings`, `OrgStorageEditor`), `alerts/QueryEditorDialog.vue:285`, others (~40 sites).
- **Where to verify:** each surface in dark mode — logs toolbar, org-storage settings hero/cards, the alert query editor.
- **Recommendation:** **migrate all to `.dark`** (the enforced single mechanism). Confirm none of these classes encode a non-theme state.
- **Decision:** ______  (confirm pure-dark-styling — yes/any exceptions?)  — owner: __________
- **Migration:** per file, rewrite the scoped `.xxx--dark { }` rules under `.dark .xxx { }` (or `dark:` utilities) and drop the `:class` theme toggle; verify visually.

---

## Answer-tracking summary (fill in, hand back)

| # | Decision | Owner | Answer | Verified on page? |
|---|---|---|---|---|
| D1 | Trace DAG node palette | | | |
| D2 | Incident icon-category chips | | | |
| D3 | Incident event-badge palette | | | |
| D4 | Eval dimension palette | | | |
| D5 | Confirm .ts palette homes | | | |
| D6 | Shared code-syntax set | | | |
| D7 | Service-graph panels dark/theme | | | |
| D8 | O2AIChat chat surfaces | | | |
| D9 | Thread LLM bubbles | | | |
| D10 | SetupCardRenderer private vars | | | |
| D11 | TraceDetailsSidebar greys | | | |
| D12 | Destination brand replicas | | | |
| D13 | Webinar banner amber | | | |
| D14 | Brand gradients | | | |
| D15 | z-index ladder | | | |
| D16 | 10px floor | | | |
| D17 | white/black post-kill | | | |
| D18 | Ratify ai/sql/lang accents | | | |
| D19 | Editor currentMode via useTheme | | | |
| D20 | Scoped dark-class → .dark | | | |

Once D1–D20 are answered, Phases E and G unblock and the migration finishes with zero further judgment calls.
