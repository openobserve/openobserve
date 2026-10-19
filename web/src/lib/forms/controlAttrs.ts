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

/** Dev-only nudge when a form control has no accessible name. */
export function warnIfUnlabelled(component: string, named: boolean) {
  if (named || !import.meta.env.DEV || import.meta.env.MODE === "test") return;
  console.warn(`[${component}] rendered without label, aria-label or aria-labelledby`);
}
