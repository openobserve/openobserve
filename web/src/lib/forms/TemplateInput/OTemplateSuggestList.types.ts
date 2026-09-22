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

import type { TemplateSuggestSlots, TemplateSuggestion } from "./OTemplateInput.types";

export interface TemplateSuggestListProps<T extends TemplateSuggestion> {
  /** Whether the popover renders; the wrapper passes `listOpen`. */
  open: boolean;
  /** The native field the popover docks under. */
  reference: HTMLElement | null;
  /** The wrapper root; a pointerdown inside it (a caret click) must not dismiss the list. */
  boundary: HTMLElement | null;
  matches: T[];
  highlightedIndex: number;
  /** The consumer's `data-test`; the list appends `-suggest` and `-suggest-item-{name}`. */
  dataTest?: string;
}

export interface TemplateSuggestListEmits {
  (_e: "select", _name: string): void;
  (_e: "highlight", _index: number): void;
  /** reka dismissed the popover (outside click, focus leaving): the wrapper must close. */
  (_e: "close"): void;
}

export type TemplateSuggestListSlots<T extends TemplateSuggestion> = TemplateSuggestSlots<T>;
