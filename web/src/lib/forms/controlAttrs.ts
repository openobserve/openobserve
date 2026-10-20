// Copyright 2026 OpenObserve Inc.

const ARIA_ATTR = /^aria[-A-Z]/;

/** Splits fallthrough attrs so `aria-*` reach the focusable control while the rest stay on the wrapper. */
export function splitControlAttrs(attrs: Record<string, unknown>) {
  const controlAttrs: Record<string, unknown> = {};
  const wrapperAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "tabindex") continue;
    (ARIA_ATTR.test(key) ? controlAttrs : wrapperAttrs)[key] = value;
  }
  return { controlAttrs, wrapperAttrs };
}

/** Joins the control's own description id with one the caller passed, so neither replaces the other. */
export function mergeDescribedBy(own: string | undefined, controlAttrs: Record<string, unknown>) {
  const joined = [own, controlAttrs["aria-describedby"]].filter(Boolean).join(" ");
  return joined || undefined;
}

/** Dev-only nudge when a form control has no accessible name. */
export function warnIfUnlabelled(component: string, named: boolean, id?: string) {
  if (named || !import.meta.env.DEV || import.meta.env.MODE === "test") return;
  if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return;
  console.warn(`[${component}] rendered without label, aria-label or aria-labelledby`);
}
