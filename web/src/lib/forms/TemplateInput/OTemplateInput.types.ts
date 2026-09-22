// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { ComputedRef, Ref } from "vue";

import type { InputProps, InputSlots } from "../Input/OInput.types";

/** One row offered when the user types `{{`; callers may add their own fields. */
export interface TemplateSuggestion {
  name: string;
}

/** The `{{` list props both wrappers share, on top of the wrapped field's own props. */
export interface TemplateSuggestProps<T extends TemplateSuggestion> {
  /** Bound value */
  modelValue?: string;
  /** Names offered on `{{`, in display order; absent or empty means a plain field. */
  suggestions?: T[];
  /** Values for the peek shown over the token under the caret; absent means no peek. */
  values?: Record<string, string>;
}

/** Keys the list cannot support: each one makes the caret and the emitted text disagree. */
export type TemplateInputUnsupportedKeys =
  "modelValue" | "type" | "debounce" | "mask" | "modelModifiers" | "revealable";

export interface TemplateInputProps<T extends TemplateSuggestion>
  extends Omit<InputProps, TemplateInputUnsupportedKeys>, TemplateSuggestProps<T> {
  /** `selectionStart` is `null` on every other input type. */
  type?: "text" | "url";
}

export interface TemplateSuggestEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "select", _name: string): void;
  (_e: "focus", _event: FocusEvent): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "keydown", _event: KeyboardEvent): void;
}

export type TemplateInputEmits = TemplateSuggestEmits;

export interface TemplateSuggestionSlotProps<T extends TemplateSuggestion> {
  suggestion: T;
  active: boolean;
}

export interface TemplateSuggestSlots<T extends TemplateSuggestion> {
  /** One row of the list; the default renders `{{name}}` in mono. */
  suggestion?: (_props: TemplateSuggestionSlotProps<T>) => unknown;
}

export interface TemplateInputSlots<T extends TemplateSuggestion>
  extends InputSlots, TemplateSuggestSlots<T> {}

export type TemplateSuggestEmit = {
  (_e: "update:modelValue", _value: string): void;
  (_e: "select", _name: string): void;
};

export interface UseTemplateSuggestOptions<T extends TemplateSuggestion> {
  suggestions: () => T[] | undefined;
  values: () => Record<string, string> | undefined;
  emit: TemplateSuggestEmit;
}

export interface OpenToken {
  query: string;
  start: number;
}

export interface UseTemplateSuggestReturn<T extends TemplateSuggestion> {
  /** The native element, handed over by the field's first `focus`. */
  element: Ref<HTMLInputElement | HTMLTextAreaElement | null>;
  open: Ref<OpenToken | null>;
  highlightedIndex: Ref<number>;
  matches: ComputedRef<T[]>;
  /** `open` with at least one match: the only state in which the list renders and keys are intercepted. */
  listOpen: ComputedRef<boolean>;
  peekName: Ref<string | null>;
  /** `null` while no known token is under the caret; `—` for a known name with an empty value. */
  peekValue: ComputedRef<string | null>;
  onFocus: (_event: FocusEvent) => void;
  onInput: (_text: string) => void;
  onCaretMove: () => void;
  onKeydown: (_event: KeyboardEvent) => void;
  onBlur: () => void;
  accept: (_name: string) => void;
  close: () => void;
}

export type {
  TemplateTextareaEmits,
  TemplateTextareaProps,
  TemplateTextareaSlots,
} from "./OTemplateTextarea.types";
export type {
  TemplateSuggestListEmits,
  TemplateSuggestListProps,
  TemplateSuggestListSlots,
} from "./OTemplateSuggestList.types";
