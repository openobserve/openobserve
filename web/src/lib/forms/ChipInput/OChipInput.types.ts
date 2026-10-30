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

import type { Component } from "vue";
import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

export interface ChipInputSuggestion {
  /** Stable identity; emitted by `select`. */
  key: string;
  label: I18nText;
  /** Secondary text on the end edge (a type, a count, a description). */
  detail?: I18nText;
  icon?: IconName;
  /** Marks the current choice, or a checked row when `multiple`. */
  selected?: boolean;
}

export interface ChipInputProps {
  /** The text typed at the caret after the chips, or into the popover search while `searchInList`. */
  modelValue: string;
  /** Whether the suggestion popover is shown; the parent decides. */
  open: boolean;
  suggestions: ChipInputSuggestion[];
  /** Shown at the caret while the field is closed and empty. */
  placeholder?: I18nText;
  /** Names what is being picked; shown at the caret while the popover is open. */
  searchPlaceholder?: I18nText;
  /** Moves typing into a search box inside the popover, for a picker opened away from the caret. */
  searchInList?: boolean;
  /** Element the popover opens under; the caret after the chips when unset. */
  anchor?: HTMLElement | null;
  /** Shown instead of rows when there are no suggestions. */
  emptyText?: I18nText;
  loading?: boolean;
  /** Highlight the first row so Enter picks it; off when Enter should fall through to `enter`. */
  autoHighlight?: boolean;
  /** Rows toggle a checkbox and the popover stays open, for picking several values. */
  multiple?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  /** `plain` drops the input frame, for a field that sits inside an editor surface. */
  appearance?: "field" | "plain";
  ariaLabel?: I18nText;
  /** The default slot places the caret itself, by rendering its `caret` slot prop where typing should land. */
  inlineCaret?: boolean;
  /** Lines of chips shown before the field scrolls inside itself; it grows freely when unset. */
  maxRows?: number;
  /** Prefix for `data-test`: `-input` caret input, `-search` popover search box, `-suggest` popover, `-suggest-item-{key}` rows. */
  dataTest?: string;
}

export interface ChipInputEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "select", _key: string): void;
  /** Enter with no suggestion highlighted. */
  (_e: "enter"): void;
  /** Backspace while the text is empty. */
  (_e: "backspace-empty"): void;
  /** Escape while the popover is open. */
  (_e: "escape"): void;
  /** A pointer or focus move outside the field and its popover. */
  (_e: "close"): void;
  /** The caret was clicked or typed into while the popover was shut. */
  (_e: "activate"): void;
  /** A typed character the parent may treat as a separator (`,`). */
  (_e: "separator", _char: string): void;
  /** Left or Right on an empty caret: move it one place among the chips. */
  (_e: "caret-move", _step: -1 | 1): void;
  /** Delete on an empty caret. */
  (_e: "delete-empty"): void;
  /** Ctrl or Cmd + Enter: confirm what is picked, e.g. a multi-select. */
  (_e: "apply"): void;
  /** A press on the field's own surface, before the caret is focused; the parent may move the caret there. */
  (_e: "press", _event: PointerEvent): void;
  /** Focus moved from the caret to another control inside the field while its list was open. */
  (_e: "dismiss"): void;
  /** Focus left the field and its popover. */
  (_e: "leave"): void;
}

export interface ChipInputSlots {
  /** Chips drawn before the caret; with `inlineCaret`, render `caret` where typing should land. */
  default?(_props: { caret: Component }): unknown;
  /** Controls on the end edge of the field. */
  trailing?(): unknown;
  /** Custom row content. */
  suggestion?(_props: { suggestion: ChipInputSuggestion; active: boolean }): unknown;
  /** Content pinned under the rows (a hint line). */
  footer?(): unknown;
}

export interface ChipInputExpose {
  /** Moves focus to the caret after the chips. */
  focus: () => void;
}
