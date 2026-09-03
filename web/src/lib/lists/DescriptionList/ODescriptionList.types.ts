// Copyright 2026 OpenObserve Inc.
//
// Types for ODescriptionList / ODescriptionItem — the label/value detail block
// that sits beside a detail page's main content ("Acknowledged by / Team /
// Alert / Opened"). It renders a real <dl>/<dt>/<dd>, so the pairing is in the
// markup rather than implied by a two-column grid of <div>s.
//
// Distinct from OFieldList (lib/lists/FieldList), which is a stream-schema field
// BROWSER — searchable, typed, interactive. This is static metadata.

import type { I18nText } from "@/types/i18n";

export interface DescriptionListProps {
  /**
   * How many label/value pairs sit side by side on a wide viewport. Always one
   * column below `md`, where a two-column detail block is unreadable.
   */
  columns?: 1 | 2;
  /** Tighter row rhythm, for a list inside a card rather than a page column. */
  dense?: boolean;
}

export interface DescriptionItemProps {
  label: I18nText;
  /**
   * Value shown when the default slot is empty. Defaults to an em dash — an
   * absent value must read as absent, never as a blank row.
   */
  emptyLabel?: I18nText;
  /**
   * Stack the value under the label instead of beside it. For values that need
   * the full width (a long id, a chip row, a code fragment).
   */
  stacked?: boolean;
}

export interface DescriptionListSlots {
  default: () => unknown;
}

export interface DescriptionItemSlots {
  default?: () => unknown;
  /** Replaces the label, e.g. a label plus a help tooltip. */
  label?: () => unknown;
}
