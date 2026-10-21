// Copyright 2026 OpenObserve Inc.

/** True when a button has no visible text and no aria name, so assistive tech announces just "button". */
export function isUnnamedIconOnly(el: Element): boolean {
  if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) return false;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[aria-hidden='true']").forEach((n) => n.remove());
  if (clone.querySelector('img[alt]:not([alt=""]), [aria-label]')) return false;
  return !clone.textContent?.trim();
}

/** Dev-only nudge for an icon-only button that nothing names. */
export function warnIfUnnamedIconOnly(el: Element | null | undefined) {
  if (!el || !import.meta.env.DEV || import.meta.env.MODE === "test") return;
  if (isUnnamedIconOnly(el)) {
    console.warn("[OButton] icon-only button has no accessible name; pass aria-label", el);
  }
}
