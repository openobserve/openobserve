---
name: ui-architect
description: >-
  Authoring guardrails for building ANY new frontend UI in the OpenObserve web
  app (web/) — new views, pages, panels, dialogs, feature components, or edits
  to existing ones. Enforce six house rules the moment you write Vue/template
  markup: (1) use OPageHeader for every page/module header, (2) build UI from
  O2 library components in web/src/lib — never bare HTML controls when an O2
  equivalent exists, (3) NEVER write px — always rem, including inside Tailwind class
  arbitrary values ([320px] is banned; 1rem = 16px, so px/16 = rem and px/4 = the
  Tailwind step). px is allowed ONLY where it is the genuinely correct unit —
  hairlines, shadow/ring widths, query conditions, IntersectionObserver rootMargin,
  zero inside calc()/clamp(), user-facing copy, canvas/email consumers — and there it
  MUST carry an eslint-disable-next-line local/no-hardcoded-px with a `-- <reason>` at
  the site, never a side-file exemption (in a <style> block the directive goes inside
  the block as a CSS comment). The local/no-hardcoded-px rule runs in CI, so an
  unannotated px fails the build and cannot reach main;
  and corner radius uses only the two-tier scale rounded-default
  (4px controls) / rounded-surface (12px surfaces) / rounded-full — never
  rounded-[..] or the retired rounded-sm/md/lg/xl, (4) no scoped-CSS blocks and no
  inline style="", (5) never hardcode colors/sizes and never reach a token by raw
  var() in a component — use the modern registered --color-* design tokens through
  their utility class (bg-x/text-x), register a new --color-* token if one is
  missing; the legacy --o2-* token vocabulary is BANNED (never write var(--o2-*),
  never define one, never add a .body--dark block — migrate any --o2-* you touch to
  its --color-* equivalent); all of this is CI-enforced and fails the build,
  (6) no hardcoded user-facing text — every label, title, placeholder, and
  message comes from i18n (useI18nTyped t(), never useI18n from vue-i18n, which
  is banned) with keys added to web/src/locales/languages/en-US.json; text-carrying
  props/fields are typed I18nText and i18n keys stored as data are typed I18nKey,
  and the ONLY opt-out for a genuinely non-translatable string is raw() — never an
  eslint-disable. It also settles the recurring
  structural decisions: use OTable for any tabular data, follow the
  view → service → Vuex/local-ref layering for fetching list data, choose the
  right form container (ConfirmDialog vs ODialog vs ODrawer vs a full in-page
  view) by the weight of the interaction, and build every validated form with
  OForm + a colocated Zod schema (single-source-of-truth name-bound fields, no
  v-model/ref mirrors, automatic submit/loading, correct field-array keys).
  Trigger this whenever the user asks to create, add, build, scaffold, lay out,
  validate, or restyle any screen, component, header, table, list, dialog,
  drawer, form, field, or panel in the web frontend, or asks where a
  form/table/fetch should live, how to validate a form, how to add a keyboard
  shortcut, how to build a new reusable/common O2 component when nothing existing
  fits (create one in web/src/lib instead of assembling divs and classes),
  whether something belongs in a dialog or a drawer, or where a new page should be
  listed in navigation — the left-rail menu, a Settings/IAM sub-menu, or a
  hover-flyout — how to register its route, and how to gate it for cloud /
  enterprise / RBAC — even if they don't mention
  these rules by name. If you are
  about to type <template>, a page title, a hex color, a px value, or
  <style scoped>, this skill applies.
---

# UI Architect — Frontend UI Guardrails (OpenObserve `web/`)

Use this skill whenever you build or modify user-facing UI in `web/`. It is a
**pre-flight contract**: apply it before and while you write template markup, not
as a cleanup pass afterward. The goal is that every new screen looks like it was
built by the same team on the same day — one header, one component library, one
token system, one spacing scale.

This skill governs **feature/app UI** — views under `web/src/views` and components
under `web/src/components` — built from the shared **O2 component library** in
`web/src/lib`. This page is the **contract + map**: the six laws and the
recurring structural decisions, each in a line or two, each pointing to the
reference that carries the full rationale, examples, and per-component detail.
Open the linked reference before you implement that specific thing — don't guess a
prop, a class string, or a path.

---

## The six house rules

The always-true laws. Each is stated here in brief; the full **what / why / how +
code** for all six is in [references/house-rules.md](references/house-rules.md) —
read it once, it is the backbone of everything below.

1. **Every page/module header is `OPageHeader`** — never a hand-rolled
   `<div class="header">…<h1>` or a `q-toolbar`. One header contract keeps the
   title in the same place across list → detail → edit.
2. **Build from O2 components in `web/src/lib`** — never a bare HTML control
   (`<button>`, `<input>`) or a third-party UI primitive when an `O*` equivalent
   exists. Drive them by **intent**
   (`variant` / `size` / state), never by appearance overrides.
3. **No hardcoded `px`** — size with `rem` / `%` / `vh` / `vw`, or Tailwind's
   rem-based scale. This applies **inside class arbitrary values too** (`w-[320px]`,
   `text-[13px]`, `gap-[6px]` are all banned — convert to `rem`).
   **The rule is simple: never write `px`. Write `rem`.** The only exceptions are the
   positions in the table below, where rem is wrong or does not resolve at all — and
   there the px must carry an `eslint-disable-next-line local/no-hardcoded-px --
   <reason>` at the site. **A px with no annotation fails CI.** That is the whole
   contract: new px cannot enter the codebase unnoticed, and a px that is genuinely
   correct only passes once someone has written down why.
   **CI-enforced by `local/no-hardcoded-px`** (eslint, defined in `web/eslint.config.js`),
   run by `lint:ci` over `src/**/*.{vue,ts,js,css}`. It reports line:column with the rem value
   and the Tailwind step, and surfaces in the editor as you type.
   - **Conversion:** `1rem = 16px` (the app sets no `html { font-size }`, so root is
     the browser default). So `px ÷ 16` → rem, and `px ÷ 4` → the Tailwind scale
     step: `300px` → `18.75rem` → `w-75`. Fractional steps are valid (`w-62.5`).
   - **`px` IS correct in these positions — do NOT "fix" them.** rem there is either
     wrong or does not resolve at all. The rule holds **no exemption list**: annotate the
     site instead, and say why.
     ```js
     // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin
     // parses px/% only — a rem value throws SyntaxError
     { rootMargin: "200px 0px" },
     ```
     The `-- <reason>` is required, not decoration: it is the only record of why, and
     ESLint flags the directive once it stops suppressing anything, so a stale exemption
     surfaces instead of lingering. Where a plain next-line directive will not fit:
     - **`<style>` block** — put the directive *inside the block*, in CSS-comment form.
       The rule parses style blocks itself and honours these, and reports one that
       suppresses nothing or omits its reason:
       ```css
       /* eslint-disable-next-line local/no-hardcoded-px -- hairline: 1 device pixel */
       border-bottom: 1px solid var(--color-border-default);
       ```
       Do **not** hoist it to `<script>`, and do not park a blanket `eslint-disable`
       above the block — that form runs to end of file and silences px nobody reviewed.
     - **Multi-line opening tag** — wrap it in `<!-- eslint-disable … -->` /
       `<!-- eslint-enable … -->`; a comment inside the tag is invalid markup.
     - **Multi-line template literal** — block disable/enable around the statement.

     **A range silences everything inside it, so make it the smallest thing that works.**
     Open it immediately before the element that owns the px — not before a parent
     wrapper — and close it on the line after that element's `>`. A range that spans a
     parent plus its child, or starts before `<template>`, is silently covering markup
     nobody reviewed, and **ESLint never reports an unused template directive**, so it
     will not tell you when it stops being needed. Prefer a single-line
     `eslint-disable-next-line` whenever the px sits on a line a comment can precede;
     reach for the block form only when the syntax leaves no other option.
     | Position | Why px |
     | --- | --- |
     | Hairlines and sub-pixel geometry `≤1.5px` (borders, dividers, rings, half-hairline offsets, gradient dot radii) | A 1-device-pixel rule must not scale with text, or it anti-aliases into a smear — or drops out entirely — at non-integer zoom and DPR |
     | **Exception:** `letter-spacing` / `word-spacing` / `tracking-[…]` at ANY size | Tracking is *typographic* — it must scale with the type it tracks, so it never earns the sub-pixel exemption. `tracking-[0.5px]` is a violation; use rem (or `tracking-tight`/`-normal`/`-wide` if the value matches) |
     | Shadow offsets, ring / border / outline widths, blur radii | Optical effects, not layout. Scaling them with text makes elevation bloom |
     | Media / container query **conditions** (`@max-[900px]/topbar`) | A threshold defining *when* layout changes, not a rendered length |
     | `IntersectionObserver` `rootMargin` | The API parses **px and % only** — `rem`, `em` **and bare `0`** all throw `SyntaxError` from the constructor, silently killing the observer and whatever it gates (lazy-load, prefetch-ahead-of-fold). Like a query condition, it is a scroll threshold, not a rendered length. `"200px 0px"` — keep both units |
     | Zero **inside** `calc()` / `clamp()` — `var(--x, 0px)`, `clamp(0px, …)` | `calc()` type-checks its arithmetic: `112px + 0` is *length + number*, which voids the whole declaration. The unit is load-bearing. Outside `calc()`, plain `0` is still right — `height: 0`, not `0px` |
     | **User-facing copy** — tooltip `content`, `placeholder`, `label`, template text (`1 unit = 30px`) | Prose *describing* a size, not a size being applied. Converting it rewrites the sentence — usually into a falsehood, since what it describes is typically a fixed layout constant that does not scale with font-size. Readers also do not think in rem |
     | `calc()` mixing `vh`/`vw` with a length | `vh` tracks the window, `rem` tracks font-size — converting one term makes the result depend on two independent variables |
     | `calc(var(--x) * 1px)` | A unit-conversion *operator* attaching a unit to a unitless JS-computed number, not a chosen dimension |
     | Canvas / ECharts / email consumers | No CSS cascade exists there — a detached measurement `<canvas>` has no root to resolve `rem` against, and an email resolves against the *recipient's* mail client |
     | `<svg width>` / `<img width>` attributes | SVG's attribute length grammar doesn't reliably accept `rem`; HTML dimension attributes take a bare integer |
     | Comments (`--text-xs: 0.75rem; /* 12px */`) | The px annotation is the *point* — nobody reads `0.75rem` and pictures a size |
   - **A size that JS parses with `parseInt` must stay px.** `parseInt("18.75rem")`
     is `18`, not `300` — a silent 16× shrink with no error and no failing test. If a
     value is read back by JS arithmetic, leave it in px rather than converting it.
   - **Prove the swap emits what you think — a utility is not always the literal.**
     Compile the real entry and diff the declarations rather than reasoning about it
     (postcss + `@tailwindcss/postcss`, `@import "./tailwind.css"` + `@source` a probe
     file, then compare `getComputedStyle` old vs new). Three ways this bites, all of
     which shipped as regressions before being caught:
     - A utility may resolve **through a variable**: `z-1` emits
       `z-index: var(--z-index-1)`, which is dead if that token is unregistered.
     - Bare `border` paints Tailwind's **default border colour, not `currentColor`** —
       replacing `border: 1.5px solid` silently recolours it. Add `border-current`.
     - Two utilities setting one property fight by **stylesheet order, not class
       order**. `w-22` loses to a `w-full` already on the element — while the inline
       `width` it replaced always won. Moving `style=""` to a class can therefore lose
       a cascade fight the original never had; add `!` only once you have measured it.
   - **A token existing does not mean its utility exists.** Registration in
     `@theme inline` is what generates the class; an unregistered token compiles to
     nothing and the property silently falls back (`border` → `currentColor`).
     `--color-border-subtle`/`-strong` used to be unregistered for exactly this
     reason — they are registered now, so `border-border-subtle` and
     `bg-border-strong` work. Check before you assume either way; if a token has no
     utility, register it rather than reaching for `var()`.
   - **Tailwind only emits class strings it can literally see.** JIT scans source
     text, so a class built at runtime (`` `bg-${color}` ``) is never generated —
     that is why per-row colouring goes through an inline style with a token, not a
     computed class. It also means a spelling you never wrote does not exist: the
     source may use `border-border-strong/10` while bare `border-border-strong`
     was never emitted.
   - **Font size — never `text-[..px/rem]`; pick the type-scale utility by role.**
     Only the px spelling is caught mechanically (`local/no-hardcoded-px` fails
     `text-[13px]`); **`text-[0.8125rem]` compiles silently**, so the rem form is a
     review item, not a CI gate. Both are equally banned — an arbitrary text size
     bypasses the scale whichever unit it uses.

     | Utility | px | Use for |
     |---|---|---|
     | `text-3xs` | 10 | chart axis micro-labels, dense table sub-text (charts only) |
     | `text-2xs` | 11 | tiny labels, chips, badge text |
     | `text-xs` | 12 | captions, metadata, timestamps |
     | `text-compact` | 13 | dense body / data tables |
     | `text-sm` | 14 | **default body text** (start here) |
     | `text-base` | 16 | comfortable body, form inputs |
     | `text-lg` | 18 | card / panel titles |
     | `text-xl` | 20 | section headings |
     | `text-2xl` | 24 | page / modal titles |
     | `text-3xl` | 30 | hero numbers / large display |
     | `text-4xl` | 36 | display |

     Default to `text-sm` for body. Go smaller only for genuinely dense/secondary UI,
     larger only for titles. If a design needs a size not on the scale, snap to the
     nearest step — do **not** reintroduce an arbitrary `text-[..]`.
   - **Corner radius — exactly two tiers + circle, never an arbitrary value:**
     `rounded-default` (**4px** — controls: buttons, inputs, chips, small icon
     buttons), `rounded-surface` (**12px** — surfaces: dialogs, drawers, cards,
     panels, the app-shell content area), `rounded-full` (pills / avatars / dots).
     Per-corner variants use the same names (`rounded-t-surface`, `rounded-s-default`).
     **Banned:** bare `rounded`, arbitrary `rounded-[10px]`, and the retired
     `rounded-{sm,md,lg,xl}` / `var(--radius-{sm,md,lg,xl})` (deleted — they were
     five names for one value). Pick the tier by role, not by eye.
   - **Shadow — one scale, and colour is a SEPARATE axis.** Elevation is
     `shadow-xs / sm / md / lg`; the directional roles are `--shadow-sticky-*`,
     `--shadow-rail`, `--shadow-ring-hairline`, `--shadow-scroll-*`, `--shadow-glow-*`.
     A focus/selection ring is `ring-2 ring-<token>/40`, not a shadow. A 1px hairline
     is `border-b border-<token>`, not a shadow.
     **Banned and CI-enforced (`arbShadow`) in all three spellings:**
     `shadow-[0_4px_12px_…]`, `box-shadow: <literal>` in CSS, and
     `boxShadow: "<literal>"` in JS. Accepted forms are `var(--shadow-*)`, `none`,
     and an interpolated `${…}` that is already a token.

     In a **template**, compose the two axes: `shadow-md shadow-ai-accent/35`.
     In a **stylesheet or JS** no utility exists, so the token layer publishes a
     colourless geometry half and you append the colour at the use site:

     ```css
     box-shadow: var(--shadow-glow-md-geom) color-mix(in srgb, var(--color-ai-accent) 35%, transparent);
     ```
     ```ts
     { boxShadow: `var(--shadow-rail-geom) ${color}` }   // colour chosen at runtime
     ```

     Three rules, each learned from a shipped bug:
     1. **Never write `var(--glow-color, <fallback>)` in a `:root` token.** A custom
        property is substituted against `:root`, where the override is unset, so the
        fallback wins and inherits down — a descendant setting it can never take
        effect. This silently no-op'd 38 sites.
     2. **A bare `shadow-<colour>` applies in BOTH themes.** A dark-only tint needs
        `dark:shadow-<colour>`; `shadow-xs shadow-white/8` renders white-on-white in
        light mode.
     3. **A new elevation step needs a `-c` colour token in `dark.css` too**, or it
        is invisible there — black at 8% on a `#101215` canvas paints nothing.
4. **No `<style scoped>` and no inline `style=""`** — style with **bare** Tailwind
   utilities (no `tw:` prefix — it was removed). Form-field spacing is
   `class="flex flex-col gap-5"` on `<OForm>`;
   omit it and fields render cramped with no spacing (the #1 "dialog looks broken"
   bug).
   - **No CSS preprocessor in an SFC** — `vue/block-lang` errors on
     `<style lang="scss|sass|less">`; `lang="css"` or no `lang` only. This is not
     taste: `postcss-scss` is not installed, so stylelint silently **skips** a scss
     block entirely — the hex ban, the `--o2-*` ban and the `.body--dark` ban stop
     running on that file with no warning. Plain CSS is also all a surviving block
     needs: what a Tailwind-first template leaves behind is `:deep()`,
     pseudo-elements and `@keyframes`, none of which want nesting.
   - **Where a rule goes when it can't be a utility:** an element reset →
     `src/styles/base-elements.css`; a reusable app-level treatment (pseudo-element,
     a class a library adds at runtime, a gradient background) →
     `src/styles/utilities.css` as an `@utility`. Gradients live there, **not** in
     `@theme` — a `@theme` colour compiles to `background-color: <gradient>`, which
     is invalid and dropped; the utility sets `background-image` instead.
5. **No literal colors or sizes — reach every value through a registered token,
   via its utility class.** Colour comes from a `--color-*` token's **token-backed
   utility** (`bg-surface-base`, `text-text-secondary`, `border-border-default`) —
   **not** a raw `var(--color-*)` in a `.vue` template/`<style>` block. A raw
   `var()` in a component is a counted bypass (`rawVarInComponent`) and is allowed
   **only** in the sanctioned residue: `:deep()`, `@keyframes`, `color-mix()`,
   `calc()`, SVG `fill`/`stroke`, and `v-html`/JS-generated markup. If a token has
   no utility, register it (`@theme inline`) rather than reaching for `var()`.
   **One knob per decision:** reuse an existing token before minting one, and never
   add a second name for a value that already has one — an alias is a decision made
   twice that silently splits adoption. The legacy **`--o2-*` vocabulary is
   BANNED** — never `var(--o2-*)`, never a new `--o2-*`, never a `.body--dark`
   block; migrate any `--o2-*` you touch. Raw Tailwind palette (`bg-gray-400`,
   `text-red-500`) does not even compile (`palette-reset.css`), and British
   `grey-*`/`primary-*` primitives in feature code are a zero-tolerance bypass
   (`rawProjectRamp`) — use a semantic token (`text-text-secondary`, `bg-accent`),
   not the ramp. See [references/design-tokens.md](references/design-tokens.md).

   > **All of §3–§5 are CI-enforced and FAIL the build** — `local/no-hardcoded-px`
   > (eslint) owns **px on every file type**; `lint:design:strict` owns the rest
   > (hardcoded hex, arbitrary radius/shadow, retired aliases, raw palette/ramp,
   > raw `var()` in a template *or* a `<style>` block, un-justified `<style>`,
   > literal font stacks), plus `lint:tokens`, `lint:token-purity`, `lint:styles`
   > (stylelint) and `format:check` (prettier) on every PR.
   >
   > **Tolerance is ZERO — there is no baseline any more.** `design-debt-baseline.json`
   > was deleted; one occurrence of any category fails the build. `--strict` is
   > accepted but ignored, and `--baseline` no longer exists — do not go looking for
   > a file to regenerate. Use `--list` to enumerate violations. Fix the cause; a new
   > exemption is not the answer.
   >
   > The counters scan **raw text, comments included** — a `16px` or `#fff` in a
   > `<style>`-block comment, or a banned class quoted verbatim, counts as debt.
   > Word comments in rem and plain English. This bites inside a CSS-in-TS template
   > literal too, where a comment is CSS: writing `inset 4px 0 6px` in prose there
   > fails `local/no-hardcoded-px`.
   >
   > **What the guard cannot see** (so review still matters): it walks only `.vue`
   > and `.ts` — standalone `.css` files are never scanned; the arbitrary-property
   > form `[background:…]` has no utility prefix so it slips past; and a `var()`
   > fallback (`var(--color-x,#fff)`) hides a read from the `color-mix` rules.
6. **No hardcoded user-facing text** — every label, title, placeholder, tooltip,
   empty-state, toast, and validation message comes from `useI18nTyped()`'s `t()`,
   with keys added to `web/src/locales/languages/en-US.json` (other locales follow
   from there — never hand-edit them).

   > **Where each surface is enforced.** Lint sees only `<template>`; everything
   > else is enforced by the TYPES at `npm run type-check:app`. Both gate CI.
   >
   > | Surface | Enforced by |
   > |---|---|
   > | Text node — `<div>Save</div>` | `vue/no-bare-strings-in-template` |
   > | Mustache literal — `{{ 'Save' }}` | `local/no-bare-bound-text-props` |
   > | `v-text` / `v-html` literal | `local/no-bare-bound-text-props` |
   > | Component prop — `label="Save"` **or** `:label="'Save'"` | **`I18nText` type** |
   > | Any string in `<script>` / `.ts` | **`I18nText` type** |
   > | Native HTML/ARIA attr — `<input placeholder="Search">` | `vue/no-bare-strings-in-template` |
   > | `t('x.y')` key exists | `@intlify/vue-i18n/no-missing-keys` |
   > | A key stored as data (`titleKey`) | **`I18nKey` type** |
   >
   > Two consequences worth internalising:
   > - **Lint does NOT check component props** — that is deliberate. A text-carrying
   >   prop is caught by its `I18nText` declaration, which is strictly stronger (it
   >   also rejects a plain `string` variable, which no lint rule could see). There
   >   is no `TEXT_ATTRS` list any more; **declare the prop `I18nText` and you are
   >   done.**
   > - **Native HTML/ARIA text attributes ARE linted** — `title`, `alt`, `aria-label`
   >   (+ `aria-placeholder` / `aria-roledescription` / `aria-valuetext`) on any
   >   element, and `placeholder` on `<input>` / `<textarea>`. They get lint rather
   >   than the type because a native element has no prop to annotate. Residual gap:
   >   only the STATIC form is covered, so `:title="'Delete'"` still slips through —
   >   don't reach for it to dodge the error.
   >
   > **Which translator — `t()` first, `gt()` only when it cannot reach.**
   >
   > | Where you are | Use |
   > |---|---|
   > | `<script setup>` / inside `setup()` | **`t()`** from `useI18nTyped()` |
   > | `.ts` module called from a component | **thread `t` in** as a parameter |
   > | Module scope, nothing to thread from (route guards, registries, import-time singletons) | **`gt()`** |
   > | A key stored as DATA, resolved later (`titleKey`, `labelKey`) | neither — store `I18nKey`, resolve with `t()` at render |
   >
   > `gt()` is the escape hatch, not the default — before reaching for it, ask whether
   > the function can take `t: TranslateFn` as an argument; usually it can, and the
   > caller already has one. At module scope, put `gt()` behind a **getter** so it
   > resolves at read time, not import time:
   >
   > ```ts
   > // WRONG — frozen at whatever locale was loaded when this module was imported
   > export const destination = { name: gt("alerts.email") };
   > // RIGHT — resolves when the picker renders
   > export const destination = { get name() { return gt("alerts.email"); } };
   > ```
   >
   > **What must NEVER enter the catalogue.** A key is a promise that translating the
   > string is safe. These break that promise — `raw()` them and keep them out:
   >
   > | Kind | Examples | What broke when translated |
   > |---|---|---|
   > | Values code compares or persists | a sentinel, an enum, a generated name | logic silently stops matching, non-English users only |
   > | Product / company names | `Kafka`, `Zookeeper`, `NATS`, `Airflow` | shipped as `Zoowärter`, `HORMIGAS` (ants), `Luftstrom` (air current) |
   > | Acronyms that are names | `RUM`, `DAG`, `IAM`, `AGPL`, `P95` | shipped as `RON` (the drink), `DÍA` (day), `SOY YO` ("I am me") |
   > | Code the user copies or types | SQL snippets, regexes, model ids, field names, env vars | `gpt-4.*` → `gpt-4. *`; a pasted sample no longer runs |
   >
   > The test is **not** "is it user-visible" — all of the above are. It is **"is there
   > one correct form worldwide?"** If yes, it is not copy.
   >
   > **A name INSIDE a sentence: interpolate it out, don't `raw()` the sentence.**
   >
   > ```ts
   > // WRONG — freezes the whole sentence in English
   > raw("Route all telemetry through the OTel Collector")
   > // WRONG — the translator mangles the product name
   > t("traces.noData.otelCollectorDesc")
   > // RIGHT — catalogue holds "…through the {product}"
   > t("traces.noData.otelCollectorDesc", { product: raw("OTel Collector") })
   > ```
   >
   > Same for an example token: `"e.g. {example}"` + `{ example: raw("gpt-4.*") }` keeps
   > *"e.g."* translatable while the token becomes unreachable. Never split a sentence
   > into fragments you concatenate — word order is per-language.
   >
   > **A string that is both a label and an identifier: split it.** Give display and
   > machine value separate fields — `{ label: t("iam.roleAdmin"), value: "admin" }`.
   > Before translating any label, check for a sibling `value:`; if the label IS the
   > value, translating it breaks the comparison.
   >
   > **Non-translatable text — the ladder.** Decide in this order:
   >
   > 1. **Does code branch on it?** (`"px" | "%"`, `"sm" | "md"`) → it is not text at
   >    all. Use a **union type**. Never an i18n concern.
   > 2. **Everywhere else → `raw("…")`** from `@/types/i18n`. This is the default and
   >    covers script data, typed props, bound expressions **and** text nodes:
   >    `<code>{{ raw("time_bucket") }}</code>`. It is type-checked, survives
   >    refactors, and `grep -rn "raw(" src` enumerates every exemption in the app
   >    (~1,185 of them).
   > 3. **Only if the token is short, universal and RECURS across files** → add it to
   >    the allowlist in `eslint.config.js`, which is split into three named groups so
   >    reviewers can apply the right scrutiny:
   >    `GLYPHS_AND_UNITS` (`px`, `ms`, `×`, `→`, `●`, `…`), `SPEC_IDENTIFIERS`
   >    (`GET`, `UTC`, `SQL`, `OK`), `TEXT_NODE_LITERALS` (`1000`, `./.env`,
   >    `trace.zip`). An entry here is **global, permanent and context-free** — it
   >    silences that string in every file forever, so it must be genuinely universal.
   >
   > **Do NOT use `eslint-disable` for i18n.** There are **zero** of them left in
   > `src/` and that is deliberate — `raw()` says the same thing at the call site, is
   > type-checked, and shows up in one greppable inventory. (Disables for *other*
   > rules — hyphenation, `x-invalid-end-tag` — are fine and still present.)
   >
   > **Moving a text node into `raw()` changes its parsing context from HTML to
   > JavaScript.** Four things bite:
   > - `\` becomes an escape prefix. `raw("\w+")` silently renders `w+`. Write
   >   `raw("\\w+")` to render `\w+`.
   > - HTML entities stop decoding. `&amp;` renders literally — use the real
   >   character: `raw("a & b")`.
   > - A literal `<` **breaks Prettier**, which parses `{{ raw("<Foo>") }}` as a tag
   >   and hard-fails the file (`format:check` is a CI gate). Hoist it into
   >   `<script setup>`: `const tag = raw("<Foo>")` and interpolate `{{ tag }}`.
   > - Surrounding whitespace is dropped. `<div>\n  OO\n</div>` renders `" OO "` but
   >   `<div>\n  {{ raw("OO") }}\n</div>` renders `"OO"` — invisible in normal flow,
   >   but check it inside `<pre>` / `white-space: pre-line`.
   >
   > **Plurals use vue-i18n pipe syntax, never string concatenation.** Write the key
   > as `"{count} occurrence | {count} occurrences"` and call
   > `t("alerts.occurrence", { count: n }, n)`. Never
   > `{{ n }} {{ t('x') }}{{ n > 1 ? 's' : '' }}` — no other language pluralises that
   > way, and a translator reading en-US.json cannot see the appended `s`.

   > **Text in `<script>` — use the TYPES, not a lint rule.** The three rules above
   > only see `<template>`. A string in `<script>`/`.ts` — a table column `label`, a
   > toast `message`, an i18n key stored as data — is invisible to them, because
   > deciding "is this string user-facing?" from the string alone is guesswork. So
   > that decision lives in the **type declaration**, where the author already knows
   > the answer, and `npm run type-check:app` enforces it. Two types in
   > **`web/src/types/i18n.ts`**:
   >
   > | Type | Use for | Effect |
   > |---|---|---|
   > | **`I18nKey`** | a field holding an i18n **key** (`titleKey`, `labelKey`) | only real en-US.json paths compile; a typo gets a "Did you mean…?" |
   > | **`I18nText`** | a field holding **resolved user-facing text** (`label`, `message`, `title`) | a bare string literal is a compile error; only `t()` / `raw()` satisfy it |
   >
   > ```ts
   > import type { I18nKey, I18nText } from "@/types/i18n";
   >
   > interface Column {
   >   label: I18nText;    // user-facing  -> must be t() or raw()
   >   field: string;      // data accessor -> ordinary string
   > }
   > interface Preset { titleKey: I18nKey }   // stores a key, not the text
   > ```
   >
   > **When you declare a new interface, prop type, or `*.types.ts` that carries UI
   > text or an i18n key, type that field as `I18nText` / `I18nKey` — never bare
   > `string`.** This is the same pattern the library already uses for icons
   > (`iconLeft?: IconName`): a constrained type derived from a source of truth.
   > `I18nKey` is derived from en-US.json at compile time, so there is no list to
   > maintain — add a key and it is instantly valid.
   >
   > Careful: a `*Key` field is **not** always an i18n key. `OSelect.labelKey` and
   > `JourneySteps.actionKey` are *field accessors* ("which property of the row holds
   > the label") and stay `string`. Read the doc comment before annotating.
   >
   > The opt-out is **`raw()`**, not an eslint-disable — it is type-checked, survives
   > refactors, and `grep -rn "raw(" src` lists every exemption in the app:
   > ```ts
   > const columns = [
   >   { label: t("logs.timestamp"), field: "ts" },
   >   { label: raw("trace_id"),     field: "trace_id" },  // a field name, not prose
   > ];
   > ```
   > **Getting a `t()` that returns `I18nText`** — the whole app already does this:
   > - **In a component** → `const { t } = useI18nTyped()` (from `@/types/i18n`).
   >   Never import `useI18n` from `vue-i18n` directly; `useI18nTyped()` hands back
   >   the exact same composer, just typed, so everything else is unchanged.
   > - **Outside a setup context** (a composable reached from a plain function, a
   >   util, service-layer error handling) → `gt("some.key")` from the same module.
   >   `useI18n()` may only be called during setup; `gt` reads the shared instance.
   >
   > **Non-translatable text uses `raw()`** — a server-provided error message, an
   > identifier, a code token. It accepts nullish, so the usual fallback chain reads
   > naturally and stays type-safe:
   > ```ts
   > toast({
   >   variant: "error",
   >   message: raw(err.response?.data?.message) || t("alerts.saveFailed"),
   > });
   > ```
   > Never reach for `raw()` to silence the checker on real UI copy — that is exactly
   > the bug the brand exists to catch. `grep -rn "raw(" src` is the review surface.
   >
   > **Composed text is a type error, by design.** `"Deleted " + n + " rows"`,
   > `cond ? "Yes" : "No"` and `` `Saved ${name}` `` all widen to `string`, so they
   > cannot satisfy `I18nText`. Use vue-i18n interpolation instead —
   > `t("x.deletedRows", { count: n })` with `"Deleted {count} rows"` in en-US.json —
   > and a plural message (`"one | many"` + `t(key, params, count)`) when singular and
   > plural really differ. The same rule is enforced in `<template>` by
   > `local/no-bare-bound-text-props`.
   >
   > Toast/notification copy added by this convention lives under `toastMessages.*`,
   > grouped by module.

## Structural decisions

*What* to reach for and *where the code lives* — the recurring calls that
otherwise get answered differently on every screen. One line each; the full
reasoning, spacing patterns, the cancel/save standard, layering, and the
form-container split are in [references/conventions.md](references/conventions.md),
and each domain has its own reference below.

| Decision | The rule | Detail |
| --- | --- | --- |
| **Tabular data** | `OTable` + `OTableColumnDef[]`; client-side pagination unless the backend paginates a set too large to fetch whole | [core-controls-table](references/core-controls-table.md) |
| **Whole-page layout** | **Every routed view is a `OPageLayout`.** It's the ONE page component — it owns the full-height column, the header (from `:title`/`:icon`/`:subtitle`/`:back` props + `#actions`/`#header-tabs`), an optional `#subnav` strip, an optional `#sidebar` rail (fixed or `resizable`), and the body's inset. You plug in data; there's no place to hand-roll a padded `<div>`. Body is inset to the page-edge grid by default — pass **`bleed`** for a full-bleed body (an `OTable`, a chart, a `router-view` shell), or **`constrained`** for a centered reading column (forms). The `#header` slot is a rare escape hatch only. | [page-recipes](references/page-recipes.md) |
| **Content inset** | `OPageLayout` already insets the body. Anywhere else (a panel, a dialog section, one tab's content) wrap it in **`OContent`** (bakes the one `px-page-edge` grid line, the primitive `OPageLayout` uses internally) instead of hand-picking `px-2`/`px-4`/`p-2.5`; pass `bleed` (or `bleed-x`/`bleed-y`) for full-bleed content that owns its own edge — same escape-hatch idea as `ODrawer`/`ODialog` `bleed`. Never hand-roll a content inset. | [conventions](references/conventions.md) |
| **Tab strips** | an `OTabs` strip needs **no** horizontal wrapper padding — the first tab's label self-aligns to the `px-page-edge` grid, so it lines up with the `OContent` body below it. Put the strip's bottom divider on the strip (`border-b`) and give it no `px-*`; wrapping a tab strip in `px-page-edge` double-insets the labels. | [conventions](references/conventions.md) |
| **Listing toolbar** | every list carries three affordances — search + filters (`#toolbar`), refresh (`#toolbar-trailing`), and the auto-injected column-visibility toggle; empty state is one `OEmptyState` with `:filtered` | [page-recipes](references/page-recipes.md) |
| **Data fetching** | view → domain service (`src/services`, via the `http.ts` wrapper) → Vuex (shared/cached) or local `ref` (ephemeral); never call `http`/axios from a component | [conventions](references/conventions.md) |
| **Form container** | confirm → `ConfirmDialog`; short form → `ODialog`; tall or contextual form → `ODrawer`; primary multi-section flow → a full in-page view. Use `ODialog` / `ODrawer` for these | [conventions](references/conventions.md) |
| **Form validation** | `OForm` + a colocated Zod `<Form>.schema.ts`; fields are `OForm*` bound **only by `name=`** (no `v-model`/`ref` mirror, no `formData`); submit + loading automatic; payload built with explicit keys; field arrays use `:key="index"` | [forms-validation](references/forms-validation.md) |
| **New page in nav** | a route **+ exactly one** surface (rail item / flyout child / Settings / IAM sub-page) **+** an env/role gate — the route condition, the nav-entry gate, and the SectionRail `visible` all express the same rule | [navigation-menus](references/navigation-menus.md) |
| **Keyboard shortcuts** | registry-driven — declare in `shortcutRegistry.ts`, bind with `useShortcuts([{ id, handler }])`; never an ad-hoc `keydown` listener or a hardcoded `⌘N` in a template | [keyboard-shortcuts](references/keyboard-shortcuts.md) |
| **Cancel / Save row** | cancel = `variant="outline"`, save = `variant="primary"`, both `size="sm-action"`, spaced with `gap-2` on the parent | [conventions](references/conventions.md) |
| **Nothing fits** | build a reusable component — generic primitive → a new `O*` in `web/src/lib`; app-specific composition → a named component in `web/src/components`. Never hand-assemble `<div>` + utility classes to fake a component | [creating-components](references/creating-components.md) |

**Dark mode is automatic** — every O2 component and token resolves correctly in
both themes. Never branch on `store.state.appTheme` around an O2 component; if
something looks wrong in dark mode, the fix is a token value in `dark.css`, not a
per-component conditional.

## Colour that means something — the "Calm Signal" language

`design-tokens.md` (rule 5) is *how* to colour; this is *when* and *what*. One
rule: **colour is information, never decoration** — a calm neutral canvas, with
saturated colour spent only on the one signal each screen exists to surface.
Which signal that is changes by page type (**monitoring** = state/severity;
**catalog** = category/recency/ownership; **access** = role; **forms** =
progress/validity), and you colour it with the shared toolkit — `OStatStrip` /
`OStatCard` summary tiles (optionally filter tiles, via `OTable`'s `#subheader`
slot), `OTag` chips from `badgeGroups.ts`, a row state rail + light
exception-only highlight, recency-aware `OTimeCell`, `OUserCell` avatars. Keep
everything else quiet: highlight exceptions not the norm, muted `0`/`—`,
border-not-fill selection, one primary action, no layout shift. Full playbook +
per-archetype recipes: [references/calm-signal.md](references/calm-signal.md).
Reference implementation: the Alerts list
(`web/src/components/alerts/AlertList.vue`).

## Pick a component

The **scenario → component** index and the per-file catalog (what each `O*` is,
when to reach for it, and which reference holds its exact props / slots / emits)
are in [references/component-catalog.md](references/component-catalog.md). Open the
relevant reference before writing markup — the props are the source of truth,
don't guess a name.

---

## Pre-flight checklist

Run this in your head before writing template markup, and again before
considering the UI done:

- [ ] Page/module header is `OPageHeader` (not a hand-built header bar).
- [ ] Every interactive control is an O2 component if one exists in
      `web/src/lib` — no bare HTML controls or third-party primitives with an O2 equivalent.
- [ ] A self-contained/repeated UI element with no matching component was
      **built as a reusable component** (generic → `O*` in `web/src/lib`;
      app-specific → named component in `web/src/components`), not hand-assembled
      from `<div>` + utility classes. Classes are for layout only.
- [ ] Tabular data uses `OTable` with `OTableColumnDef[]` columns; server mode
      only for backend-paginated data.
- [ ] **Server mode was checked against the backend**: every `sortable: true`
      column has a real sort key in the handler (an unknown key falls back
      silently and orders by something else), and any page-relative device
      (`ODataBarCell` bars, a `#subheader` count strip) is on a **client**-paginated
      table only. No hand-rolled `#` index column (`show-index`), no positional
      `columns.splice`, and column `size` fits the header + sort chevron.
      See [core-controls-table](references/core-controls-table.md).
- [ ] A figure/label that already exists on another screen reuses **that screen's
      formatter and i18n key** (promote a component-local formatter into
      `utils/formatters.ts` rather than copying it).
- [ ] Listing page uses the **full-height flush skeleton** (root
      `flex flex-col h-full p-0`, header `shrink-0 border-b` — OPageHeader bakes
      in its own `px-page-edge`, never add a `px-*`, table wrapper
      `card-container flex-1 min-h-0 overflow-hidden`, `OTable :frame="false"`) —
      not a `p-6` padded container; table runs flush.
- [ ] Listing page has all three toolbar affordances: **search + filters**
      (`#toolbar`, `:show-global-filter="false"`), **refresh**
      (`#toolbar-trailing`, wired to fetch), and the **column show/hide toggle**
      (`:persist-columns` + `table-id` + a `hideable` column). Non-essential
      columns hidden by default via `:column-visibility`.
- [ ] Empty state is a single `OEmptyState` with a `preset` + **`:filtered`**
      (search/filter active) + `@action` resetting on `clear-filters`; `#error` if
      fetch can fail.
- [ ] Page is **registered in navigation** (route + one of rail item / Settings
      sub-page / flyout child) and **gated** for env/role
      (`config.isEnterprise` / `config.isCloud` / `zoConfig.*`), with the route,
      nav-entry gate, and SectionRail `visible` all in sync
      (see [navigation-menus.md](references/navigation-menus.md)).
- [ ] Data fetched through a domain service (`src/services`), not raw `http` in
      the component; shared data in Vuex, ephemeral data in local refs.
- [ ] Form container matches weight: confirm → `ConfirmDialog`, short form →
      `ODialog`, large/contextual form → `ODrawer`, primary multi-section flow →
      full page.
- [ ] Validated form uses `OForm` + a colocated Zod `<Form>.schema.ts`; every
      control inside is an `OForm*` addressed only by `name=` (no `v-model`/`ref`
      mirror, no `formData`), required via the `required` prop.
- [ ] Save is `type="submit"` (inline) or `form-id`↔`OForm id` (overlay); no
      manual `useLoading`/`:loading` and Save is not disabled on invalid.
- [ ] Payload built with explicit keys (not `{ ...value }`); numeric inputs
      coerced. Field arrays use `:key="index"` + a non-last-row delete test.
- [ ] Zero `px` values outside the sanctioned positions (§3 exemption table) —
      including inside class arbitrary values (`w-[320px]`, `text-[13px]`). Sizes
      use rem / % / vh / vw or Tailwind's rem scale.
- [ ] **Spacing copies a sibling, never invented per page** — padding/margins/
      gaps and card surface classes are taken verbatim from the sibling panel
      family the screen joins (`card-container` alone styles nothing — cards
      need explicit `bg-* border-* rounded-*` classes). A page of stacked
      panels uses the full-height split (`flex-1 min-h-0` cards + fill-height
      tables) so the page itself never scrolls — see
      [conventions § Cards & stacked-panel pages](references/conventions.md).
- [ ] Corner radius is `rounded-default` / `rounded-surface` / `rounded-full`
      only — no bare `rounded`, no `rounded-[..]`, no retired
      `rounded-{sm,md,lg,xl}`.
- [ ] No `<style scoped>` block added. No `style="…"` attribute added.
- [ ] No literal colors anywhere. Colours come from `--color-*` token **utilities**
      (`bg-surface-base`, `text-text-secondary`) — not a raw `var(--color-*)` in a
      component (that's a `rawVarInComponent` bypass, allowed only in `:deep`,
      keyframes, `color-mix`, `calc`, SVG `fill`/`stroke`, `v-html`). No raw
      Tailwind palette (`bg-gray-*`) and no raw `grey-*`/`primary-*` ramp — use a
      semantic token.
- [ ] **Calm Signal** — the screen's *primary signal* is coloured (state /
      category / role / progress) via the shared toolkit (`OStatStrip`/`OStatCard`,
      `OTag` chips, row rail + exception tint, relative `OTimeCell`), and the rest
      stays calm: exceptions highlighted not the norm, muted `0`/`—`,
      border-not-fill selection, no layout shift. See
      [references/calm-signal.md](references/calm-signal.md).
- [ ] `cd web && npm run lint:design:strict` passes (zero tolerance — no
      raw-token bypass anywhere; one occurrence fails the build).
- [ ] **No `--o2-*` anywhere** — no `var(--o2-*)`, no new `--o2-*` definition, no
      `.body--dark` block. Any `--o2-*` in code you touched was migrated to its
      `--color-*` equivalent.
- [ ] Any new color/size needed was **registered as a `--color-*` token** (light
      `:root` + `@theme inline` + dark under `.dark`) before use.
- [ ] No hardcoded user-facing text **and** no `t()` key missing from the locale
      file — every label, title, placeholder, message, and validation string (whether
      a text node, a static prop `label="…"`, a bound prop `:label="'…'"`, a
      `{{ '…' }}` mustache, or `v-text`) uses
      `t()` with the key added to `web/src/locales/languages/en-US.json` in the same
      change. Text NODES, `{{ '…' }}` mustaches, `v-text`/`v-html`, and native
      HTML/ARIA attributes (`title`, `alt`, `aria-label`, `placeholder`) are caught
      by ESLint (`no-missing-keys`, `vue/no-bare-strings-in-template`,
      `local/no-bare-bound-text-props` — all **error**); COMPONENT props (static or
      bound) are caught by declaring them `I18nText`, not by any lint rule. New
      text-carrying component prop → type it `I18nText`; there is no `TEXT_ATTRS`
      list any more.
      Non-translatable strings use `raw("…")` — **never** an `eslint-disable`.
- [ ] Any **new type / interface / `*.types.ts`** field that carries UI text or an
      i18n key is declared `I18nText` / `I18nKey` (from `@/types/i18n`), not bare
      `string` — that is what guards `<script>`, which the ESLint rules cannot see.
      Non-translatable values use `raw("…")`. Verified by `npm run type-check:app`.
- [ ] Translation is obtained via **`useI18nTyped()`** (components) or **`gt()`**
      (outside setup) — never `useI18n` imported straight from `vue-i18n`, which
      returns unbranded `string` and silently defeats the check.
- [ ] `data-test` on every interactive and key output element, pattern
      `<module>-<filename>-<descriptor>` (see the project FE rules).
- [ ] New component uses `<script setup lang="ts">`, no `// @ts-nocheck`.
- [ ] **Comments are one or two lines** — the *why* of a non-obvious choice, not
      a re-telling of the code or the history of the PR that added it (no ticket
      ids, "review finding", "as discussed"). Same in specs. See
      [conventions § Comments stay short](references/conventions.md).
- [ ] `cd web && npm run lint && npm run type-check` pass.

## When a rule can't be satisfied

Don't quietly break a rule — the fix is almost always "extend the shared thing,
not the call site":

- Missing O2 component → **build a new reusable component**, don't reconstruct it
  from divs + classes at the call site. Generic primitive → a new `O*` in
  `web/src/lib`; app-specific composition → a named component in
  `web/src/components`. When *migrating* an existing element and can't build it
  yet, keep the current element in place and flag it. Never
  substitute a bare `<div>`. See
  [references/creating-components.md](references/creating-components.md) and the
  "No component fits?" section of [references/conventions.md](references/conventions.md).
- Missing O2 variant → add the variant to the component source, then use it.
- Missing token → register it in the token CSS (rule 5), then use it.
- `OPageHeader` can't express the header → change `OPageHeader`, not the page.

If you genuinely believe a rule shouldn't apply to a specific case, say so
explicitly and explain why, rather than silently introducing a `px`, a hex, or a
scoped style.
