# Design Token Architecture — O2 Component Library

The O2 library uses a **3-layer design token system** identical to Adobe Spectrum, Material Design 3, and other enterprise systems.

---

## Layer Overview

| Layer         | Location                           | Purpose                                              | Used in Components?                  |
| ------------- | ---------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| **Base**      | `:root` in `base.css`              | Raw palette, spacing, radius, shadows                | **Never**                            |
| **Semantic**  | `@theme inline` in `semantic.css`  | Maps base to meaning (primary, error, text, surface) | **Yes** — shared across components   |
| **Component** | `@theme inline` in `component.css` | Component-specific decisions                         | **Yes** — only within that component |

---

## File Structure

```
web/src/lib/styles/
  tailwind.css          ← Entry: @import "tailwindcss" prefix(tw)
  tokens/
    base.css            ← :root — raw palette
    semantic.css        ← @theme inline — shared semantic tokens
    component.css       ← @theme inline — per-component tokens
    dark.css            ← @custom-variant dark (.dark) overrides
```

> **Note**: Tailwind v4 is configured with `prefix(tw)`. Every utility class must use the `tw:` prefix: `tw:flex`, `tw:text-sm`, `tw:bg-primary-500`.
> **No SCSS.** All token and style files are plain `.css`. Never create `.scss` files inside `lib/`.

---

## Token Usage Rules

| Scenario                               | Use                     | Example                                       |
| -------------------------------------- | ----------------------- | --------------------------------------------- |
| Color unique to this component's state | Component token utility | `tw:bg-button-primary-hover`                  |
| Color shared across many components    | Semantic token utility  | `tw:text-text-primary`, `tw:bg-surface-panel` |
| Spacing, padding, margin               | Tailwind spacing scale  | `tw:px-4`, `tw:gap-2`                         |
| Border radius, shadows, fonts          | Semantic utility        | `tw:rounded-md`, `tw:shadow-md`               |

---

## Adding a New Component's Tokens

1. Open `web/src/lib/styles/tokens/component.css`
2. Add inside `@theme inline { }`:

```css
/* Button */
--color-button-primary: var(--color-primary-600);
--color-button-primary-hover: var(--color-primary-700);
--color-button-primary-foreground: var(--color-white);
--color-button-primary-focus-ring: var(--color-primary-400);
--radius-button: var(--radius-md);

/* Input */
--color-input-border: var(--color-border-default);
--color-input-border-focus: var(--color-primary-500);
--color-input-border-error: var(--color-error-500);
--color-input-bg: var(--color-surface-base);
--color-input-text: var(--color-text-primary);
```

3. Reference base/semantic tokens via `var()` — **never hardcode values**

---

## Token Naming Conventions

```
Component tokens:
--color-{component}-{element}           → --color-button-primary
--color-{component}-{element}-{state}   → --color-button-primary-hover
--color-{component}-{property}          → --color-input-border
--color-{component}-{property}-{state}  → --color-input-border-focus
--radius-{component}                    → --radius-button
--shadow-{component}                    → --shadow-card

Semantic tokens:
--color-text-primary, --color-text-secondary, --color-text-disabled
--color-surface-base, --color-surface-panel, --color-surface-overlay
--color-border-default, --color-border-strong
--color-primary-{50..900}
--color-error-{50..900}
--color-success-{50..900}
--radius-sm, --radius-md, --radius-lg, --radius-full
--shadow-sm, --shadow-md, --shadow-lg

Base spacing primitives (reference via var() in component.css — never write raw px):
--spacing-px   → 1px
--spacing-8    → 2rem  (32px)
--spacing-10   → 2.5rem (40px)
Add more to base.css as needed — never hardcode px in component.css directly
```

---

## Forbidden Patterns

```vue
<!-- ❌ Hardcoded color -->
<div class="tw:bg-[#6950ff]">

<!-- ❌ CSS variable in template -->
<div class="tw:bg-[var(--color-primary)]">

<!-- ❌ Base token in component -->
<div class="tw:bg-violet-500">

<!-- ❌ Another component's token -->
<!-- Inside an Alert: -->
<div class="tw:bg-button-primary">

<!-- ❌ Missing tw: prefix -->
<div class="flex items-center">
```

```css
/* ❌ Hardcoded px value in component.css token definition */
--spacing-tabs-height: 40px;
--spacing-separator: 1px;

/* ✅ Reference a base spacing primitive via var() */
--spacing-tabs-height: var(--spacing-10);
--spacing-separator: var(--spacing-px);
```

```vue
<!-- ✅ Semantic token -->
<div class="tw:bg-surface-panel tw:text-text-primary">

<!-- ✅ Component token -->
<button class="tw:bg-button-primary tw:hover:bg-button-primary-hover">

<!-- ✅ Tailwind spacing (no token needed) -->
<div class="tw:px-4 tw:gap-2">
```

---

## Dark Mode — App Theme System

### How the OpenObserve theme system works

The app manages themes via **Vuex store** (`store.state.theme`). The value is `"dark"` or `"light"`. In `App.vue`, this drives a root CSS class on the router-view:

```vue
<!-- App.vue -->
<router-view
  :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
/>
```

Theme can also be customized via:

- **`store.state.tempThemeColors`** — live preview from General Settings color picker
- **`localStorage` (`customLightColor`, `customDarkColor`)** — saved user preference
- **`store.state.organizationData.organizationSettings`** — org-level default from backend
- Applied by `applyThemeColors()` in `web/src/utils/theme.ts`

### Dark token selector

`web/src/lib/styles/tokens/dark.css` uses this selector to activate dark overrides:

```css
:root.dark,
.dark :root,
.dark,
.dark-theme {
  --color-surface-base: var(--color-grey-950);
  --color-text-primary: var(--color-grey-50);
  /* ... */
}
```

The `.dark-theme` entry is the critical one — it matches what `App.vue` applies. O2 components pick up dark overrides automatically because CSS custom properties cascade to all children of `.dark-theme`.

### What "automatic dark mode" means for O2 components

```vue
<!-- No class toggling needed in O2 components -->
<div class="tw:bg-surface-panel tw:text-text-primary">
  <!-- surface-panel = grey-900 in dark, white in light       -->
  <!-- text-primary  = grey-50  in dark, grey-900 in light    -->
</div>
```

Components use semantic tokens → semantic tokens are overridden by `dark.css` when `.dark-theme` is present on an ancestor → **zero conditional dark mode code in components**.

### Adding dark overrides for a new component token

1. Add light value in `component.css`:

```css
@theme inline {
  --color-tab-bg: var(--color-surface-panel);
  --color-tab-indicator: var(--color-primary-600);
}
```

2. Add dark override in `dark.css` (only values that differ from light — tokens that already reference semantic tokens don't need a dark entry):

```css
:root.dark,
.dark :root,
.dark,
.dark-theme {
  /* Tab — indicator is lighter in dark for contrast */
  --color-tab-indicator: var(--color-primary-400);
}
```

> **Tip**: If your component token only references semantic tokens (e.g. `var(--color-surface-panel)`), it inherits dark mode automatically and needs no entry in `dark.css`.

## RTL (Right-to-Left) Support

Always use logical properties:

| ❌ Avoid                         | ✅ Use                           | Purpose     |
| -------------------------------- | -------------------------------- | ----------- |
| `tw:pl-*`, `tw:pr-*`             | `tw:ps-*`, `tw:pe-*`             | Padding     |
| `tw:ml-*`, `tw:mr-*`             | `tw:ms-*`, `tw:me-*`             | Margin      |
| `tw:left-*`, `tw:right-*`        | `tw:start-*`, `tw:end-*`         | Positioning |
| `tw:text-left`, `tw:text-right`  | `tw:text-start`, `tw:text-end`   | Text align  |
| `tw:border-l-*`, `tw:border-r-*` | `tw:border-s-*`, `tw:border-e-*` | Borders     |

---

## Dark Mode — Token Pairing Rules

Every component token **must** have a paired dark mode override. No component is done until dark mode is verified.

### How it works

1. Light tokens live in `semantic.css` and `component.css` under `@theme inline { }`.
2. Dark overrides live in `dark.css` — selector is `:root.dark, .dark :root, .dark, .dark-theme`.
3. `.dark-theme` is added on the app root by `App.vue` when `store.state.theme === 'dark'` — components never check the theme themselves.

### Required token pairs per component

For each new component, add entries in **both** `component.css` (light) and `dark.css` (dark):

```css
/* component.css — light values */
@theme inline {
  /* Tab example */
  --color-tab-bg: var(--color-surface-panel);
  --color-tab-text: var(--color-text-secondary);
  --color-tab-text-active: var(--color-text-primary);
  --color-tab-indicator: var(--color-primary-600);
  --color-tab-hover-bg: var(--color-surface-overlay);
}
```

```css
/* dark.css — dark overrides (only values that differ from light)
   Use the full selector to match the app's .dark-theme class */
:root.dark,
.dark :root,
.dark,
.dark-theme {
  --color-tab-bg: var(--color-grey-900);
  --color-tab-text: var(--color-grey-400);
  --color-tab-text-active: var(--color-grey-50);
  --color-tab-indicator: var(--color-primary-400);
  --color-tab-hover-bg: var(--color-grey-800);
}
```

> **Shortcut**: If a token only references semantic tokens (e.g. `var(--color-surface-panel)`), it auto-inherits dark mode and needs no dark.css entry.

### Minimum token pairs required for common states

| State              | Token suffix                  | Light example                 | Dark example               |
| ------------------ | ----------------------------- | ----------------------------- | -------------------------- |
| Default background | `-bg`                         | `var(--color-surface-panel)`  | `var(--color-grey-900)`    |
| Default text       | `-text`                       | `var(--color-text-primary)`   | `var(--color-grey-50)`     |
| Hover              | `-hover-bg`, `-hover-text`    | lighter surface               | `var(--color-grey-800)`    |
| Active / selected  | `-active-bg`, `-text-active`  | primary-600                   | primary-400                |
| Disabled           | `-disabled`, `-text-disabled` | opacity or muted              | consistent muted           |
| Border             | `-border`                     | `var(--color-border-default)` | `var(--color-grey-700)`    |
| Focus ring         | `-focus-ring`                 | `var(--color-primary-400)`    | `var(--color-primary-300)` |

### Dark mode checklist (per component)

- [ ] Every `--color-{component}-*` token that uses base palette values has a pairing in `dark.css`
- [ ] Tested visually with `store.state.theme = 'dark'` (applies `.dark-theme` on app root)
- [ ] No hardcoded light-only values in `component.css` that would look wrong in dark
- [ ] Active/hover states use **lighter** base values in dark (not darker — contrast is reversed)
- [ ] Focus rings remain visible in dark mode (use `primary-300` or `primary-400` in dark)

### Semantic token dark overrides (already handled)

The semantic tokens in `semantic.css` / `dark.css` are pre-paired for dark mode:

- `--color-surface-base`, `--color-surface-panel`, `--color-surface-overlay`
- `--color-text-primary`, `--color-text-secondary`, `--color-text-disabled`
- `--color-border-default`, `--color-border-strong`

Component tokens that reference only these semantic tokens **automatically** support dark mode. Add explicit dark overrides only for component tokens that use base palette values directly.
