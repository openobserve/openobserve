# Headless Libraries — Confirmed Safe List

This file tracks headless libraries explicitly confirmed by the project owner for use in the O2 component library.

---

## Confirmation Requirement

**NEVER install or import a headless library without explicit user confirmation.**

Before using any headless primitive, ask:
> "I need headless behavior for [specific behavior]. I recommend using [library name] because [reason]. Can I install and use it?"

Only after the user says **yes** — proceed.

---

## Confirmed Libraries

| Library | Provides | Confirmed |
|---------|----------|-----------|
| `@tanstack/vue-form` | Headless form state management (validation, field state, submission) | ✅ |

> All other headless behavior (dropdown positioning, dialogs, virtual scroll, etc.) must be **built from scratch** unless the user confirms a new library.

---

## Build Your Own — Guidance

For common UI behaviors not covered by the confirmed list, implement directly:

| Behavior | Implementation approach |
|----------|------------------------|
| Dropdown / floating positioning | `getBoundingClientRect()` + Vue `Teleport` to body |
| Click outside | `onMounted` + `document.addEventListener('click', ...)`, cleaned up in `onUnmounted` |
| Focus trap (Modal) | Manual focus management with `querySelectorAll(focusableSelectors)` |
| Virtual scroll | `@tanstack/vue-virtual` — already in project; confirm before using in `lib/` |
| Keyboard navigation (listbox, menu) | `KeyboardEvent` handler with `ArrowUp`/`ArrowDown`/`Enter`/`Escape` |
| Controlled open/close | Internal `ref<boolean>` + `v-model` pattern |

---

## Already in Project (Still Require Confirmation for `lib/` Use)

| Package | Notes |
|---------|-------|
| `@tanstack/vue-virtual` | Already installed — confirm before adding to lib/ |
| `lucide-vue-next` | Icon library — already installed, fine to use directly |
| `date-fns` | Date utilities — already installed, fine to use directly |

