// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

export interface ChipInputSuggestion {
  /** Stable identity; emitted by `select`. */
  key: string;
  label: I18nText;
  /** Secondary text on the end edge (a type, a count, a description). */
  detail?: I18nText;
  icon?: IconName;
  /** Draws a check mark, for multi-value pickers. */
  selected?: boolean;
}

export interface ChipInputProps {
  /** The text being typed. */
  modelValue: string;
  /** Whether the suggestion popover is shown; the parent decides. */
  open: boolean;
  suggestions: ChipInputSuggestion[];
  placeholder?: I18nText;
  /** Caption above the suggestion rows, naming what is being picked. */
  header?: I18nText;
  /** Shown instead of rows when there are no suggestions. */
  emptyText?: I18nText;
  loading?: boolean;
  /** Highlight the first row so Enter picks it; off when Enter should fall through to `enter`. */
  autoHighlight?: boolean;
  disabled?: boolean;
  /** Let the text input take the rest of the row; off while it sits between chips. */
  inputGrow?: boolean;
  size?: "sm" | "md";
  ariaLabel?: I18nText;
  /** Prefix for `data-test`; the input is `-input`, the popover `-suggest`, rows `-suggest-item-{key}`. */
  dataTest?: string;
}

export interface ChipInputEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "select", _key: string): void;
  /** Enter with no suggestion highlighted. */
  (_e: "enter"): void;
  /** Backspace while the text is empty. */
  (_e: "backspace-empty"): void;
  /** Escape while the popover is already closed. */
  (_e: "escape"): void;
  (_e: "close"): void;
  (_e: "focus"): void;
  (_e: "blur"): void;
  /** A typed character the parent may treat as a separator (`,`). */
  (_e: "separator", _char: string): void;
}

export interface ChipInputSlots {
  /** Chips drawn before the text input. */
  default?(): unknown;
  /** Chips drawn after the text input, for editing a chip in place. */
  after?(): unknown;
  /** Controls on the end edge of the field. */
  trailing?(): unknown;
  /** Custom row content. */
  suggestion?(_props: { suggestion: ChipInputSuggestion; active: boolean }): unknown;
  /** Content pinned under the rows (a hint line). */
  footer?(): unknown;
}

export interface ChipInputExpose {
  focus: () => void;
  /** Focuses the field with its text selected, so typing replaces it. */
  focusSelect: () => void;
}
