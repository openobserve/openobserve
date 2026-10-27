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
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import type { FilterDialect, FilterField, FilterGroup, FilterNode } from "@/utils/query/filterBar";

export interface QueryFilterBarProps {
  modelValue: FilterGroup;
  fields: FilterField[];
  /** `sql` joins chips with AND/OR and groups; `promql` ANDs label matchers only. */
  dialect?: FilterDialect;
  /** Offer a "search all text" row for typed words that match no field. */
  freeText?: boolean;
  /** Let the user name a field that is not in `fields` (labels not loaded yet). */
  allowCustomFields?: boolean;
  /** Suggested values for a field; `search` is the typed needle, empty for the first page. */
  loadValues?: (field: string, search: string) => Promise<string[]>;
  fieldsLoading?: boolean;
  placeholder?: I18nText;
  disabled?: boolean;
  size?: "sm" | "md";
  /** `plain` blends the bar into the editor surface it replaces. */
  appearance?: "field" | "plain";
  dataTest?: string;
}

export interface QueryFilterBarEmits {
  (_e: "update:modelValue", _value: FilterGroup): void;
  /** Enter on an empty bar: run the query. */
  (_e: "submit"): void;
  /** The field list is about to be shown; lazy pages load fields here. */
  (_e: "focus"): void;
}

export interface QueryFilterBarExpose {
  focus: () => void;
}

export interface FilterBarNodesProps {
  items: FilterNode[];
  /** Draw the AND/OR connector between nodes. */
  connectors: boolean;
  editingId?: string | null;
  editPart?: FilterTokenPart | null;
  armedId?: string | null;
  openGroupId?: string | null;
  dataTest: string;
}

export interface FilterBarNodesEmits {
  (_e: "edit", _id: string, _part: FilterTokenPart, _element: HTMLElement): void;
  (_e: "remove", _id: string): void;
  (_e: "toggle-connector", _id: string): void;
}
