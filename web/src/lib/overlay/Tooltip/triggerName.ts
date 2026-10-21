// Copyright 2026 OpenObserve Inc.

import { isUnnamedIconOnly } from "@/lib/core/Button/iconOnlyName";

const NAMEABLE_CONTROL =
  'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"]';

/** The control a child-mode tooltip should name, since the trigger is often just the icon inside it. */
export function tooltipNameTarget(trigger: Element): Element | null {
  const control = trigger.closest(NAMEABLE_CONTROL);
  return control && isUnnamedIconOnly(control) ? control : null;
}
