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
  /** The text typed into the popover's search box. */
  modelValue: string;
  /** Whether the suggestion popover is shown; the parent decides. */
  open: boolean;
  suggestions: ChipInputSuggestion[];
  /** Text on the add target while the field holds no chips. */
  placeholder?: I18nText;
  /** Placeholder of the popover's search box, naming what is being picked. */
  searchPlaceholder?: I18nText;
  /** Element the popover opens under; the add target at the end of the chips when unset. */
  anchor?: HTMLElement | null;
  /** Shown instead of rows when there are no suggestions. */
  emptyText?: I18nText;
  loading?: boolean;
  /** Highlight the first row so Enter picks it; off when Enter should fall through to `enter`. */
  autoHighlight?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  ariaLabel?: I18nText;
  /** Prefix for `data-test`: `-add` target, `-input` search box, `-suggest` popover, `-suggest-item-{key}` rows. */
  dataTest?: string;
}

export interface ChipInputEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "select", _key: string): void;
  /** Enter with no suggestion highlighted. */
  (_e: "enter"): void;
  /** Backspace while the text is empty. */
  (_e: "backspace-empty"): void;
  /** Escape in the search box. */
  (_e: "escape"): void;
  /** A pointer or focus move outside the field and its popover. */
  (_e: "close"): void;
  /** The add target was clicked, focused or typed into; `text` is a first typed character. */
  (_e: "activate", _text: string): void;
  /** A typed character the parent may treat as a separator (`,`). */
  (_e: "separator", _char: string): void;
}

export interface ChipInputSlots {
  /** Chips drawn before the add target. */
  default?(): unknown;
  /** Controls on the end edge of the field. */
  trailing?(): unknown;
  /** Custom row content. */
  suggestion?(_props: { suggestion: ChipInputSuggestion; active: boolean }): unknown;
  /** Content pinned under the rows (a hint line). */
  footer?(): unknown;
}

export interface ChipInputExpose {
  /** Moves focus to the add target. */
  focus: () => void;
}
