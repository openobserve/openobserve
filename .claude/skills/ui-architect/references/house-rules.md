# House rules — full treatment (what · why · how)

> Extracted from the ui-architect contract. The always-loaded summary is in ../SKILL.md § The six house rules — read this for the full rationale and code.

## The house rules

Each rule below states **what**, **why**, and **how**. The "why" matters: these
aren't arbitrary — each one exists because breaking it produces a specific,
recurring class of bug or drift in this codebase.

### 1. Every page/module header is `AppPageHeader`

**What.** The top of any routed view or module screen (title + icon + actions,
optionally tabs/breadcrumb/back) is rendered by `AppPageHeader`, never a
hand-rolled `<div class="header">…<h1>…` or a bespoke `q-toolbar`.

```vue
<script setup lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
</script>

<template>
  <AppPageHeader
    :title="t('dashboard.header')"
    icon="dashboard"
    :subtitle="t('dashboard.subtitle')"
  >
    <template #actions>
      <OButton variant="primary" size="sm" icon-left="add" @click="addDashboard">
        {{ t("dashboard.add") }}
      </OButton>
    </template>
  </AppPageHeader>
</template>
```

**Why.** `AppPageHeader` encodes a single header contract used app-wide: row 1 is
a fixed-height band (icon tile + `<h1>` + right-aligned actions); row 2 shows
**exactly one** of peer tabs, an ancestor breadcrumb, or a plain tagline. Every
hand-built header silently re-litigates title font size, icon tile geometry,
back-button placement, and the tab underline — and drifts. Reusing the component
keeps the title's X/Y position identical as a user navigates list → detail →
edit, which is the whole point.

**How.**
- The component is `AppPageHeader`, at
  `web/src/components/common/AppPageHeader.vue`. Its full API — props, slots, and
  the one-row-content contract — is documented in this rule (below), so you can
  use it correctly without opening the file.
- Props: `title`, `subtitle`, `icon` (an `IconName` from
  `@/lib/core/Icon/OIcon.icons`), `breadcrumb` (`BreadcrumbItem[]`),
  `breadcrumbMaxInline`, `back` (`{ label, to | onClick, dataTest }`),
  `tabsBelow`.
- Slots: `title-prefix`, `title`, `subtitle`, `title-trail`, `actions`, `tabs`,
  `back`.
- Put page actions in `#actions` using O2 components. Do not add your own
  `border-b`, height, or padding around it — the header owns its own chrome.
- **Do not** style `AppPageHeader` from the outside with utility classes or a
  wrapper trying to change its internals. If it can't express what a page needs,
  that's a change to `AppPageHeader` itself, not a per-page override.

### 2. Build from O2 components in `web/src/lib`

**What.** Compose UI out of the O2 library (`O*` components in
`web/src/lib/**`). Do not reach for a Quasar primitive (`q-btn`, `q-input`,
`q-select`, `q-dialog`, `q-table`, `q-tabs`, …) or a bare HTML control
(`<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` used as a button) when an
O2 equivalent exists.

**Why.** O2 components have design decisions baked in — radius, color, focus
ring, dark-mode tokens, spacing, disabled/loading states. A raw `q-btn` or
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
  migrating, keep the existing Quasar component (or native element) in place and
  flag that a new O2 component is needed. When building **new** UI, create a
  reusable component instead — see
  [§ No component fits? Build a reusable one](conventions.md).
  An unstyled `div` is worse than an honest `q-btn`.

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
- **The only accepted `px` is a `1px` hairline border/divider.** Every other `px`
  — inline, in a `<style>` block, or in a class arbitrary value — is a smell.

### 4. No scoped CSS — style with bare Tailwind utilities

**What.** Do not add `<style scoped>` blocks. Style layout/spacing with **bare
Tailwind utility classes** (`flex flex-col gap-4 p-6`). **Two things are banned:**
- ❌ the **`tw:` prefix** — it was removed from this project; `tw:flex` no longer
  resolves. Write `flex`, not `tw:flex`.
- ❌ **Quasar utilities** — `q-pa-md`, `q-gutter-lg`, `q-mb-sm`, `row`, `col`,
  `text-weight-bold`, `items-center` as a Quasar class, etc. are NOT available.

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
  `text-text-secondary`, `border-border-default`) or, when a raw value is
  unavoidable, the CSS custom property `var(--color-*)`. Never a hex/rgb literal.
- **Form field spacing**: put `class="flex flex-col gap-5"` (or `gap-6`) on the
  `<OForm>` — `class`/`style` fall through to its root `<form>`, so its direct
  children (the `OFormInput`/`OFormSelect` fields) get even vertical spacing.
  **Without a gap class on OForm, fields render flush with no spacing** — this is
  the #1 cause of "the dialog/drawer has no spacing".
- **Never use**:
  - ❌ `tw:flex`, `tw:gap-2`, `tw:p-4` — the `tw:` prefix is dead; drop it → `flex gap-2 p-4`
  - ❌ `q-pa-md`, `q-gutter-lg`, `row`, `col`, `text-weight-bold` (Quasar — not available)
  - ❌ `#fff`, `rgb(...)` literals (use token utilities or `var(--color-*)`)
  - ❌ `px` for sizing except `1px` borders (use the rem-based scale)
- **For O2 components**: pass only `variant` / `size` props — never patch
  appearance with inline styles or ad-hoc classes.

### 5. No hardcoded colors or sizes — use registered tokens

**What.** Never write a literal color (`#2b2d30`, `rgb(...)`, `rgba(...)`,
`hsl(...)`, named colors) or a magic dimension inline. Use the project's design
tokens. If the token you need doesn't exist, **register it** in the token CSS
first, then use it.

**Why.** Tokens are what make the app theme-aware. A literal `#fff` is invisible
in dark mode and can't be retuned globally; a token (`text-text-primary`,
`bg-surface-base`, `var(--color-*)`) resolves to the right value in both themes
and changes everywhere at once when design updates it. Hardcoding a color is
opting a single element out of theming permanently.

**How — using tokens.**
- Prefer **token-backed Tailwind utilities**: `text-text-primary`,
  `bg-surface-base`, `bg-surface-subtle`, `border-border-default`,
  `text-text-secondary`, `text-text-muted` — theme-aware by construction.
- **Don't write the arbitrary-value form when a utility exists** —
  `bg-surface-base`, not `bg-[var(--color-surface-base)]` (they compile to
  identical CSS; the utility name is the token minus `--color-`). Arbitrary
  `[var(--color-x)]` / `(--color-x)` is only for a token with **no** utility
  (a var-only domain token not in `@theme inline`, e.g.
  `bg-[var(--color-card-glass-bg)]`) or a **load-bearing fallback**. Details +
  the two exceptions in [references/design-tokens.md](design-tokens.md).
- When a raw variable is unavoidable, use the modern CSS custom property
  `var(--color-*)` (e.g. in a bound `:style` for a computed value).
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

