# Fix: Font Appearing Bold After Quasar Removal

**Branch:** `fix/ux-revamp-font`  
**Date:** 2026-05-20

---

## Symptom

After removing the `quasar` npm dependency and its CSS classes, all text across the app appeared visually bolder/heavier than expected.

---

## Root Cause Analysis

### 1. Missing font-smoothing (primary cause)

Quasar's `quasar.css` was applying antialiased font rendering globally:

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Without this, macOS reverts to **subpixel antialiasing**, which renders all text visually heavier. This is a rendering pipeline change — not an actual `font-weight` change — which is why the effect looks like "everything is bold".

**Key facts:**

- Tailwind v4 Preflight does **not** include font-smoothing (it was removed vs v3)
- `src/styles/app.scss` `body {}` block was missing these properties
- `src/assets/base.css` had them, but that file is **never imported** in production — it was dead code from the Vue CLI scaffold (`assets/main.css` imports it, but `main.ts` does not import `main.css`)

### 2. Nunito Sans web font no longer loaded (secondary cause)

`@quasar/extras` was previously loading the Nunito Sans web font. With Quasar removed:

- The token `--font-sans: 'Nunito Sans', ...` silently falls back to system fonts
- System fonts (San Francisco on macOS, Segoe UI on Windows) have different visual weight metrics
- No `@font-face` declaration exists anywhere in the codebase
- No `@fontsource/nunito-sans` package installed

---

## Files Changed

| File                          | Change                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/styles/tailwind.css` | Added `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale` + `text-rendering: optimizeLegibility` on `html` in `@layer base` — loaded immediately via `main.ts` |
| `web/src/styles/app.scss`     | Added the same font-smoothing properties to the `body {}` block as a belt-and-suspenders fallback                                                                                       |
| `web/index.html`              | Added Google Fonts `<link>` for Nunito Sans (weights 300–700, optical size 6–12, including italic 400) to restore the web font that `@quasar/extras` previously provided                |

---

## Why Two Places for Font-Smoothing?

`app.scss` is imported inside `MainLayout.vue` and `Login.vue` component `<style>` blocks. Even though these are non-scoped and inject globally, the CSS is bundled with the component chunk — meaning it is only injected into the DOM when the component JavaScript is first evaluated.

`tailwind.css` is imported directly in `main.ts` and is part of the initial CSS bundle, so it applies immediately on page load before any component mounts.

Both locations are needed to cover the full lifecycle.

---

## Verification

After applying these fixes:

1. Text should render with the same antialiased, lighter appearance as before Quasar was removed
2. Nunito Sans should load as the primary font (check DevTools → Network → Fonts)
3. Fallback chain if Google Fonts is unavailable: `-apple-system` → `BlinkMacSystemFont` → `Segoe UI` → `Roboto` → `sans-serif`

---

## Future Recommendation

Consider replacing the Google Fonts CDN dependency with a self-hosted approach:

```bash
npm install @fontsource-variable/nunito-sans
```

```ts
// main.ts
import "@fontsource-variable/nunito-sans";
```

This eliminates the external CDN dependency, works offline, and avoids potential CSP issues.
