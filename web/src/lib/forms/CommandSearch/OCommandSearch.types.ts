// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** One result row: a label followed by where it lives. */
export interface CommandSearchItem {
  /** Stable id, emitted on select. */
  id: string;
  label: I18nText;
  /** Location crumbs shown after the label, joined with " · ". */
  context?: I18nText[];
}

/**
 * OCommandSearch — a search field whose typed text lists matching items in a
 * popover; arrows move, Enter or click selects, Esc closes. The caller ranks
 * the items; the field only shows them in the order given.
 */
export interface CommandSearchProps {
  /** The typed text (v-model). */
  modelValue?: string;
  /** Ranked results for the current text. */
  items: CommandSearchItem[];
  /** Accessible name of the field. */
  label: I18nText;
  placeholder?: I18nText;
  /** Registry shortcut that focuses the field; its keycap shows inside the field. */
  shortcutId?: string;
  /** Heading above the results, e.g. "3 settings match". */
  countText?: I18nText;
  /** Shown when the text matches nothing. */
  emptyText?: I18nText;
  disabled?: boolean;
}

export interface CommandSearchEmits {
  (e: "update:modelValue", value: string): void;
  (e: "select", id: string): void;
}

export interface CommandSearchSlots {
  /** Hint under the results. */
  footer?: () => unknown;
}

export interface CommandSearchExpose {
  focus: () => void;
}
