// Copyright 2026 OpenObserve Inc.

import { isUnnamedIconOnly } from "@/lib/core/Button/iconOnlyName";

const NAMEABLE_CONTROL =
  'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"]';

// getComputedStyle forces a style recalc on every mount, so only ask when a class or inline style can set display:contents.
function mayBeDisplayContents(el: Element): boolean {
  if ((el as HTMLElement).style?.display === "contents") return true;
  return [...el.classList].some((c) => c === "contents" || c.endsWith(":contents"));
}

/** True when the element has no layout box of its own because it is display:contents. */
export function isDisplayContents(el: Element): boolean {
  return mayBeDisplayContents(el) && window.getComputedStyle(el).display === "contents";
}

/** The control a child-mode tooltip should name, since the trigger is often just the icon inside it. */
export function tooltipNameTarget(trigger: Element): Element | null {
  const control = trigger.closest(NAMEABLE_CONTROL);
  return control && isUnnamedIconOnly(control) ? control : null;
}

/** The element a child-mode tooltip hovers on: the enclosing control when the trigger is only one of its slots. */
export function tooltipHoverTarget(trigger: Element): Element {
  const control = trigger.closest(NAMEABLE_CONTROL);
  if (!control || control === trigger) return trigger;
  // Only boxless wrappers may sit in between, so a tooltip on an inner layout block of a clickable card keeps its own target.
  for (let el = trigger.parentElement; el && el !== control; el = el.parentElement) {
    if (!isDisplayContents(el)) return trigger;
  }
  return control;
}
