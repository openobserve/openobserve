// Copyright 2026 OpenObserve Inc.
//
// OListboxOption — one row of a listbox whose focus stays in a combobox field.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";

export interface ListboxOptionProps {
  /** Renders the row as a link, so middle-click and "open in new tab" work. */
  href?: string;
  /** The row the arrow keys or the pointer are on; the owning field announces it. */
  highlighted?: boolean;
  /** Shown but not selectable: no link, no select event. */
  disabled?: boolean;
  /** Leading glyph. */
  icon?: IconName;
}

export interface ListboxOptionEmits {
  /** A primary click on an enabled row. Modified clicks on a link keep the browser's own action. */
  (_e: "select", _event: MouseEvent): void;
}

export interface ListboxOptionSlots {
  /** The row label. */
  default?: () => unknown;
  /** Secondary text at the end of the row (folder, ID). */
  meta?: () => unknown;
  /** Trailing glyphs, e.g. a lock. */
  trailing?: () => unknown;
}
