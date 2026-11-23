# House rules — full treatment (what · why · how)

> Extracted from the ui-architect contract. The always-loaded summary is in ../SKILL.md § The seven house rules — read this for the full rationale and code of rules 1–6; rule 7 (responsive) lives in [responsive.md](responsive.md).

## The house rules

Each rule below states **what**, **why**, and **how**. The "why" matters: these
aren't arbitrary — each one exists because breaking it produces a specific,
recurring class of bug or drift in this codebase.

> **The v2 guidelines are binding** ([guidelines.md](guidelines.md)). Where a rule
> below and a guideline disagree, the guideline wins; each rule cites the ids it
> implements.

### 1. Every page/module header is `OPageHeader`

**What.** The top of any routed view or module screen (title + icon + actions,
optionally peer tabs and a back button) is rendered by `OPageHeader`, never a
hand-rolled `<div class="header">…<h1>…` or a bespoke `q-toolbar`.

```vue
<script setup lang="ts">
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
</script>

<template>
  <OPageHeader
    :title="t('dashboard.header')"
    icon="dashboard"
    :subtitle="t('dashboard.subtitle')"
  >
    <template #actions>
      <OButton variant="primary" @click="addDashboard">
        {{ t("dashboard.add") }}
      </OButton>
    </template>
  </OPageHeader>
</template>
```

**Why.** `OPageHeader` encodes a single header contract used app-wide: row 1 is
a fixed-height band (icon tile + `<h1>` + right-aligned actions, with the
`subtitle` tagline under the title); row 2 is the full-width peer-tab strip.
Tabs and a tagline coexist — most module index pages carry both. Every
hand-built header silently re-litigates title font size, icon tile geometry,
back-button placement, and the tab underline — and drifts. Reusing the component
keeps the title's X/Y position identical as a user navigates list → detail →
edit, which is the whole point.

**How.**
- The component is `OPageHeader`, at
  `web/src/lib/core/PageHeader/OPageHeader.vue`. Its full API — props, slots, and
  the one-row-content contract — is documented in this rule (below), so you can
  use it correctly without opening the file.
- Props: `title`, `subtitle`, `icon` (an `IconName` from
  `@/lib/core/Icon/OIcon.icons`), `back` (`{ label, to | onClick, dataTest }`),
  `tabsBelow`, `titleDataTest` (a `data-test` on the `<h1>`, so a page needn't
  take over the `#title` slot just to attach a test hook), and `titleOverflow`
  (`"truncate"` default | `"visible"` — pass `"visible"` when `#title` hosts an
  interactive control, or the `<h1>`'s `overflow:hidden` swallows its focus ring).
  `overflowFirst` renders `#actions-overflow` before `#actions` on desktop, so a
  trailing primary CTA stays last; `titleMinWidth` keeps the title at least 10rem
  wide for a `#title-trail` that competes for the row.
  There is **no breadcrumb prop** — `OPageHeader` has no breadcrumb affordance
  and no `BreadcrumbItem` type exists; a sub-page uses `back` instead.
- Slots: `title-prefix`, `title`, `subtitle`, `title-trail`, `actions`,
  `actions-overflow` (secondaries: inline on desktop, behind one "More" button
  below md), `tabs`, `back`.
- **Peer tabs need `tabs-below` — the slot alone is not enough.** `#tabs`
  (`#header-tabs` on `OPageLayout`) defaults to rendering the strip *inline
  beside the title*, which is the wrong place for Level-2 section nav: the title
  block is `shrink-0`, so the strip's x-position moves with the title's width
  and shifts under the cursor as you navigate between siblings. Pass
  `tabs-below` to get the full-width row-2 strip every module uses. The four
  alerting pages shipped inline for exactly this reason — nothing failed, they
  just didn't look like the rest of the app.
- **The header `icon` must be the SAME `IconName` the page's nav entry
  declares** — see [navigation-menus](navigation-menus.md#icon-parity).
- Put page actions in `#actions` using O2 components. Do not add your own
  `border-b`, height, or padding around it — the header owns its own chrome.
- **The header's create CTA is label-only — no `+` icon.** Write
  `<OButton variant="primary">New alert</OButton>`, never `icon="add"`. This
  applies to every New/Add/Create button in `#actions`, on list and detail pages
  alike. See *No `+` on a text button* below.
- **Do not** style `OPageHeader` from the outside with utility classes or a
  wrapper trying to change its internals. If it can't express what a page needs,
  that's a change to `OPageHeader` itself, not a per-page override.

#### No `+` on a text button (B4)

An icon goes on a text button only when it adds meaning the word lacks: menu
chevron ▾, external link ↗, download, upload, copy, run (B4). So:

```vue
<!-- ✅ -->
<template #actions>
  <OButton variant="primary" data-test="alert-list-add-btn" @click="create">
    {{ t("alerts.add") }}
  </OButton>
</template>

<!-- ❌ never: a "+" says nothing the label does not -->
<OButton variant="primary" icon="add">{{ t("alerts.add") }}</OButton>
```

This covers every text button, not only the header CTA: an in-section adder is
"Add condition" with no `+` (W2), and Edit or Delete as text buttons carry no
glyph either. Icon-only buttons are a separate case: only universal actions
(refresh, close, more, copy, expand, settings, columns, and edit or delete in a
row), each with a tooltip and an aria-label (B5).

**Auditing this.** Grep `<OButton` with `icon="add"`, then keep the ones that also
render a label.

### 2. Build from O2 components in `web/src/lib`

**What.** Compose UI out of the O2 library (`O*` components in
`web/src/lib/**`). Do not reach for a bare HTML control
(`<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` used as a button) or an
unstyled third-party primitive when an O2 equivalent exists.

**Why.** O2 components have design decisions baked in — radius, color, focus
ring, dark-mode tokens, spacing, disabled/loading states. A raw native
`<button>` re-introduces all of those as per-call-site choices, which is exactly
how a UI ends up with nine slightly different buttons. Baked-in design is the
feature, not a limitation.

**How.**
- Pick the right component from the [§ Component catalog](component-catalog.md) —
  it maps scenarios to components and links the reference file with each one's
  props, slots, and a usage example.
- The `web/src/lib` folder is the ultimate source of truth. To confirm a
  component exists or read its exact props, check its `.types.ts`:
  ```bash
  find web/src/lib -name 'OButton.vue'     # locate a component
  # then read the sibling OButton.types.ts for its real prop/variant/size list
  ```
- Import by full path — there is no barrel:
  `import OButton from "@/lib/core/Button/OButton.vue";`
- Pass only documented props (check `O{Name}.types.ts`) — typically `size`,
  `variant`, and state props (`disabled`, `loading`). Do **not** hunt for a
  `rounded`/`color`/`flat` prop to reshape it; those overrides don't exist by
  design (see [§ Working with O2 components](conventions.md)).
- **If no O2 equivalent exists:** do NOT drop to a bare `<div>`/`<button>` to
  fake it, and do NOT hand-assemble the element from utility classes. When
  migrating, keep the existing element in place and
  flag that a new O2 component is needed. When building **new** UI, create a
  reusable component instead — see
  [§ No component fits? Build a reusable one](conventions.md).
  An unstyled `div` is worse than an honest native `<button>`.

### 3. No hardcoded `px`

**What.** Never size anything in `px`. Use `rem` for type/spacing/dimensions,
`%` for parent-relative sizing, `vh`/`vw` for viewport-relative sizing — or,
preferably, Tailwind's spacing/size utilities (which are already rem-based).

```vue
<!-- avoid --> <div style="width: 320px; margin-top: 12px">
<!-- prefer --> <div class="w-80 mt-3">        <!-- 20rem / 0.75rem -->
<!-- or   -->  <div class="w-[20rem] mt-[0.75rem]">
```

**Why.** `px` ignores the user's root font size and breaks the app's ability to
scale type and density consistently. The whole spacing system is rem-based; a
stray `px` value is a value that won't move when everything else does. Tailwind's
numeric scale (`p-3`, `w-80`, `gap-2`) already maps to rem, so preferring
utilities usually removes the temptation entirely.

**How.**
- Reach for a Tailwind utility first — **bare, no `tw:` prefix** (`p-3`, `w-80`,
  `gap-2`). The numeric scale is `0.25rem`-based: `2 → 0.5rem`, `4 → 1rem`, etc.
- Need an exact value not on the scale? Use a **rem** arbitrary value:
  `h-[1.375rem]`, never `h-[22px]`. This applies **inside class strings**
  too — a `px` unit in a Tailwind arbitrary value (`w-[320px]`, `text-[13px]`,
  `gap-[6px]`) is just as banned as a `px` in a `style=""`. Convert to rem
  (divide by 16: `320px → 20rem`, `22px → 1.375rem`, `6px → 0.375rem`).
- **`px` is banned outside a sanctioned position** — hairlines, shadow/ring/border
  widths, query conditions, canvas/email consumers and a handful more. The list is
  the table in `SKILL.md` §3, enforced by `local/no-hardcoded-px`. If your px is one
  of them, annotate the site — `// eslint-disable-next-line local/no-hardcoded-px --
  <why px is correct here>` — so the reason travels with the code. Any other `px`
  — inline, in a style block, or in a class arbitrary value — is a smell.
  In a `<style>` block the directive goes **inside the block** as a CSS comment
  (`/* eslint-disable-next-line local/no-hardcoded-px -- … */`); the rule parses style
  blocks itself and reports the directive once it stops suppressing anything. Never a
  blanket `eslint-disable` above the block, and never a side-file exemption list —
  there is no allowlist, by design, so that every px keeps a stated reason.
- **Prefer `eslint-disable-next-line`; use a `disable`/`enable` range only when the
  syntax forces it** (px inside a multi-line opening tag or template literal, where a
  comment cannot be placed). A range silences *everything* between its markers, so open
  it directly before the element that owns the px — never before a parent wrapper or
  `<template>` — and close it right after that element's `>`. ESLint does not report an
  unused template directive, so an over-wide range will keep silencing new px forever
  without ever telling you.
- **Corner radius is a token, not a guess — four tiers by role + circle:**
  `rounded-chip` (**4** — chips, badges, kbd, checkbox), `rounded-default` (**6** —
  buttons, inputs, selects, segmented, every control), `rounded-menu` (**8** —
  menus, popovers, tooltips), `rounded-surface` (**10** — dialogs, drawers, cards,
  panels, the content frame), and `rounded-full` (pills / avatars / status dots).
  Per-corner variants use the same names (`rounded-t-surface`, `rounded-s-default`).
  **Banned:** bare `rounded`, arbitrary `rounded-[10px]`, and the retired
  `rounded-{sm,md,lg,xl}` / `var(--radius-{sm,md,lg,xl})`. Pick the tier by the
  element's role, never by eye. See [design-tokens § Corner radius](design-tokens.md).
- **Control heights are tokens too, and the component owns them** (S1, S2):
  `h-control-xs` / `-sm` / `-md` / `-lg` = 24 / 28 / 32 / 36, chosen through the
  O* component's `size` prop (`md` is the default). Never size a control with a
  class (`h-8`, `!h-9`, `size-7`, `[&_input]:h-8`); `local/o2-control-height`
  flags it. A bespoke element that must line up with controls uses the same
  `h-control-*` utility, never a raw step like `h-8`.

### 4. No scoped CSS — style with bare Tailwind utilities

**What.** Do not add `<style scoped>` blocks. Style layout/spacing with **bare
Tailwind utility classes** (`flex flex-col gap-4 p-6`). **One thing is banned:**
- ❌ the **`tw:` prefix** — it was removed from this project; `tw:flex` no longer
  resolves. Write `flex`, not `tw:flex`.

The **important modifier is a trailing `!`** in Tailwind v4 — `size-5!`,
`bg-surface-base!` — reserved for the rare case of overriding an O2 component's own
utility (a row-exception wash, an icon glyph size). The leading form `!size-5`
lint-warns (`suggestCanonicalClasses`); always put the `!` at the end.

In the rare case a `<style>` block genuinely cannot be Tailwind, it must **justify
itself** or CI counts it as debt (`styleKeepComment` — zero tolerance, so any
unjustified block fails the build). It must also be plain CSS: `vue/block-lang`
errors on `lang="scss"`, because stylelint silently skips a scss block and the hex
/ `--o2-*` / `.body--dark` bans stop running on that file. The block must open with
a keep-comment:

```css
/* keep(lib-override:echarts): tooltip DOM is generated by the lib, no class hook */
```

Sanctioned tags: `lib-override:<lib>`, `generated-content`, `keyframes`, `print`,
`scrollbar`, `complex-state`, `brand`, `third-party` — one line stating *why this
cannot be utilities*. (`keep: <tag>` punctuation also accepted.)

**Comments count as debt too.** The design-consistency counters scan raw file
text — comments included. A `16px`, a `#fff`, or a `var(--color-*)` written in a
`<style>`-block comment counts against `stylePxUnit` / `styleBlockHex` /
`rawVarInComponent` exactly like real CSS, and the whole-file categories
(`rawPalette`, `tw:`, arbitrary `[..px]` values, retired aliases) match verbatim
mentions in template/JS comments as well. Write comment prose in `rem` or plain
words ("a 1rem gap", "the drawer's 0.75rem inset") — never quote a banned pattern
verbatim in a comment.

Prefer utility classes over inline `style=""`. Reserve inline `style` for the
rare dynamic value that must be computed in JS (and even then, prefer a bound
class or CSS custom property).

**Why.** Scoped CSS is a per-file invisible override that forks the design system
one component at a time. Utility classes keep spacing on one rem-based scale and
read the same across every screen. Inline `style` blocks carry no token and beat
everything — they're the last resort, not the default.

**How.**
- **Layout & spacing**: bare Tailwind utilities on the element:
  ```vue
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-2">Content</div>
  </div>
  ```
  This is the exact pattern real components use (e.g. `ModelPricingEditor.vue`,
  `AddRegexPattern.vue`): `class="flex flex-col gap-4"`, `class="flex items-center gap-2"`.
- **Colors**: use token-backed utilities (`bg-surface-subtle`,
  `text-text-secondary`, `border-border-default`). A raw `var(--color-*)` inside a
  `.vue` component is a **CI-counted bypass** (`rawVarInComponent`) — allowed only
  in the sanctioned residue (`:deep`, `@keyframes`, `color-mix`, `calc`, SVG
  `fill`/`stroke`, `v-html`). Never a hex/rgb literal.
- **Form field spacing**: put `class="flex flex-col gap-4"` on the `<OForm>`
  (16 between fields; `gap-6` between form sections — L4, V1) — `class`/`style` fall through to its root `<form>`, so its direct
  children (the `OFormInput`/`OFormSelect` fields) get even vertical spacing.
  **Without a gap class on OForm, fields render flush with no spacing** — this is
  the #1 cause of "the dialog/drawer has no spacing".
- **Never use**:
  - ❌ `tw:flex`, `tw:gap-2`, `tw:p-4` — the `tw:` prefix is dead; drop it → `flex gap-2 p-4`
  - ❌ `#fff`, `rgb(...)` literals (use token utilities or `var(--color-*)`)
  - ❌ `px` for sizing except `1px` borders (use the rem-based scale)
  - ❌ literal font stacks — `font-family` (CSS or `[font-family:…]`/`font-[…]`
    arbitrary values) must be `var(--font-sans)` or `var(--font-mono)`; anything
    else is CI-banned (`literalFontFamily` + stylelint at error)
- **For O2 components**: pass only `variant` / `size` props — never patch
  appearance with inline styles or ad-hoc classes.

### 5. No hardcoded colors or sizes — use registered tokens

**What.** Never write a literal color (`#2b2d30`, `rgb(...)`, `rgba(...)`,
`hsl(...)`, named colors) or a magic dimension inline. Use the project's design
tokens. If the token you need doesn't exist, **register it** in the token CSS
first, then use it.

**Why.** Tokens are what make the app theme-aware. A literal `#fff` is invisible
in dark mode and can't be retuned globally; a token (`text-text-heading`,
`bg-surface-base`) resolves to the right value in both themes and changes
everywhere at once when design updates it. Hardcoding a color is opting a single
element out of theming permanently. **One knob per decision:** reuse an existing
token before minting one, and never add a second name for a value that already
has one — an alias is a decision made twice that silently splits adoption.

**How — using tokens.**
- Prefer **token-backed Tailwind utilities**: `text-text-heading` (titles),
  `text-text-body`, `text-text-secondary`, `text-text-label`, `text-text-muted`,
  `bg-surface-base`, `bg-surface-subtle`, `border-border-default` — theme-aware by
  construction. (The old `text-text-primary` / `text-text-caption` are **retired
  and CI-banned** — use `-heading` / `-secondary`.)
- **Don't write the arbitrary-value form when a utility exists** —
  `bg-surface-base`, not `bg-[var(--color-surface-base)]` (they compile to
  identical CSS; the utility name is the token minus `--color-`). Arbitrary
  `[var(--color-x)]` / `(--color-x)` is only for a token with **no** utility
  (a var-only domain token not in `@theme inline`, e.g.
  `bg-[var(--color-card-glass-bg)]`) or a **load-bearing fallback**. Details +
  the two exceptions in [references/design-tokens.md](design-tokens.md).
- When a raw variable is genuinely unavoidable (a `:deep()`/keyframe rule, a
  `color-mix()`/`calc()`, an SVG `fill`/`stroke`, or `v-html`/JS-generated markup),
  use the modern custom property `var(--color-*)` — but know that anywhere OUTSIDE
  that residue it is a zero-tolerance bypass (`rawVarInComponent` in a `<style>`
  block, `rawVarInTemplate` in a class attribute). If it's just a colour you could
  name, register the token and use its utility instead.
- **Only `--color-*` tokens** — see the `--o2-*` ban below.

**How — registering a NEW token / the `--o2-*` ban.** Full details, the token-file
layout, the 3-step registration, and the `--o2-*` → `--color-*` migration map are
in [references/design-tokens.md](design-tokens.md). The rules that must
stay top-of-mind:

- New tokens are **`--color-*` only** — light value in `:root`, registered in the
  same file's `@theme inline` block, dark override in `dark.css` under `.dark`
  (never `.body--dark`). Token files live in `web/src/lib/styles/tokens/`.
- **The `--o2-*` vocabulary is banned — never use it, never add to it.** No
  `var(--o2-*)` (not in a `<style>` block, not in a Tailwind arbitrary value like
  `bg-[var(--o2-card-bg)]`, not in `:style`); no new `--o2-*` definition; no
  `.body--dark` block. It is a legacy set being deleted, with lint/CI that fails
  the build on any `--o2-*`.
- **If you touch code that references an `--o2-*` token, migrate it** to its
  `--color-*` equivalent (the map is in the reference — e.g. `--o2-text-primary` →
  `--color-text-primary`, `--o2-border` → `--color-border-default`,
  `--o2-primary-background` → `--color-surface-base`). If a mapping is unclear,
  flag it rather than leaving the `--o2-*`.

### 6. No hardcoded user-facing text — use i18n

**What.** Every string a user can read — page titles, field labels, button text,
placeholders, tooltips, empty-state copy, toast/notification messages, and
validation messages — comes from the i18n layer via `useI18n()`'s `t()`, keyed
into `web/src/locales/languages/en-US.json`. Never write a display string literally
in a template or script.

**Why.** The app ships in many languages; a hardcoded string is invisible to
translation and silently serves English to every locale. Centralizing copy in
`en-US.json` also keeps wording consistent and reviewable. It's the same principle as
tokens and variants — a user-facing value lives in one shared place, never
scattered as a literal at the call site.

**How.**
- `const { t } = useI18n()` in setup; `{{ t('module.key') }}` in templates,
  `t('module.key')` in script. Group keys under a sensible namespace
  (e.g. `notificationChannels.title`).
- Add new keys **only** to `web/src/locales/languages/en-US.json` — the other
  language files follow from there; never hand-edit them.
- **Validation messages** get localized too: pass `t` into the Zod schema factory
  (`make…Schema(t)`) so rule messages come from `en-US.json` — see
  [references/forms-validation.md](forms-validation.md).
- **Shortcut descriptions** are i18n keys (`shortcuts.actions.*`) — see
  [references/keyboard-shortcuts.md](keyboard-shortcuts.md).
- Not user-facing text, so these stay literal: `data-test` values, `name=` field
  keys, icon names, CSS/utility classes, and developer-only console logs.

---

