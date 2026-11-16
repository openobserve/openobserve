// Copyright 2026 OpenObserve Inc.

import { TOOLTIP_TRIGGER_ATTR, TOOLTIP_TRIGGER_OVERFLOW } from "./OTooltip.types";
import { isElementTruncated } from "./useIsTruncated";

/** True when a hovered tooltip trigger inside `own` will open its own bubble, so `own`'s must yield. */
export function hoversNestedTrigger(own: Element | null | undefined): boolean {
  if (!own) return false;
  const hovered = own.querySelectorAll(`[${TOOLTIP_TRIGGER_ATTR}]:hover`);
  return Array.from(hovered).some(
    (el) =>
      el !== own &&
      // An overflow-only trigger opens nothing while its text fits, so it must not mute the outer one.
      (el.getAttribute(TOOLTIP_TRIGGER_ATTR) !== TOOLTIP_TRIGGER_OVERFLOW ||
        isElementTruncated(el)),
  );
}
