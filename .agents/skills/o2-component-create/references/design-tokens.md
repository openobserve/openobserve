# Design Token Architecture — O2 Component Library

The O2 library uses a **3-layer design token system** identical to Adobe Spectrum, Material Design 3, and other enterprise systems.

---

## Layer Overview

| Layer | Location | Purpose | Used in Components? |
|-------|----------|---------|-------------------|
| **Base** | `:root` in `base.css` | Raw palette, spacing, radius, shadows | **Never** |
| **Semantic** | `@theme inline` in `semantic.css` | Maps base to meaning (primary, error, text, surface) | **Yes** — shared across components |
| **Component** | `@theme inline` in `component.css` | Component-specific decisions | **Yes** — only within that component |

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

| Scenario | Use | Example |
|----------|-----|---------|
| Color unique to this component's state | Component token utility | `tw:bg-button-primary-hover` |
| Color shared across many components | Semantic token utility | `tw:text-text-primary`, `tw:bg-surface-panel` |
| Spacing, padding, margin | Tailwind spacing scale | `tw:px-4`, `tw:gap-2` |
| Border radius, shadows, fonts | Semantic utility | `tw:rounded-md`, `tw:shadow-md` |

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

```vue
<!-- ✅ Semantic token -->
<div class="tw:bg-surface-panel tw:text-text-primary">

<!-- ✅ Component token -->
<button class="tw:bg-button-primary tw:hover:bg-button-primary-hover">

<!-- ✅ Tailwind spacing (no token needed) -->
<div class="tw:px-4 tw:gap-2">
```

---

## Dark Mode

Dark mode overrides live in `web/src/styles/tokens/dark.css`:

```css
@custom-variant dark (.dark) {
  :root {
    --color-surface-base: var(--grey-950);
    --color-text-primary: var(--grey-50);
    /* ... */
  }
}
```

Components automatically support dark mode through semantic tokens — **no per-component dark mode conditionals needed**.

---

## RTL (Right-to-Left) Support

Always use logical properties:

| ❌ Avoid | ✅ Use | Purpose |
|---------|--------|---------|
| `tw:pl-*`, `tw:pr-*` | `tw:ps-*`, `tw:pe-*` | Padding |
| `tw:ml-*`, `tw:mr-*` | `tw:ms-*`, `tw:me-*` | Margin |
| `tw:left-*`, `tw:right-*` | `tw:start-*`, `tw:end-*` | Positioning |
| `tw:text-left`, `tw:text-right` | `tw:text-start`, `tw:text-end` | Text align |
| `tw:border-l-*`, `tw:border-r-*` | `tw:border-s-*`, `tw:border-e-*` | Borders |
