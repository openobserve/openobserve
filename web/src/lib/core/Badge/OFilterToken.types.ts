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

export type FilterTokenPart = "field" | "operator" | "value";

export interface FilterTokenProps {
  field: I18nText;
  /** Omitted while the condition is still being picked. */
  operator?: I18nText;
  /** Omitted while the value is still being picked, or for operators that take none. */
  value?: I18nText;
  /** The segment whose picker is open. */
  activePart?: FilterTokenPart | null;
  /** Marks the whole token, for a pending keyboard delete. */
  armed?: boolean;
  /** Draws the token as needing attention (an unfinished or rejected condition). */
  invalid?: boolean;
  /** Read to assistive tech while `invalid`; defaults to a generic "Error". */
  invalidMessage?: I18nText;
  /** A soft warning on the value, e.g. a value not seen in recent data; shown as a tooltip. */
  valueHint?: I18nText;
  /** Segments emit `select`; off for a token that only displays. */
  editable?: boolean;
  removable?: boolean;
  removeLabel?: I18nText;
  /** Prefix for `data-test`; segments are `-field`, `-operator`, `-value`, the dismiss `-remove`. */
  dataTest?: string;
}

export interface FilterTokenEmits {
  /** A segment was clicked; `element` is where its picker should open. */
  (_e: "select", _part: FilterTokenPart, _element: HTMLElement): void;
  (_e: "remove"): void;
}
