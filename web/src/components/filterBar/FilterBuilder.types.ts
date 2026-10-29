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
import type { FilterField } from "@/utils/query/filterBar";
import type { FilterIssue, FilterLayout, FilterProfileName } from "./filterProfiles";

export interface FilterBuilderProps {
  /** Which page's rules apply: operators, layout, depth, connectors, limits and the saved format. */
  profile: FilterProfileName;
  /** The filter in the profile's own saved format; written back unchanged until the user edits it. */
  modelValue: unknown;
  fields: FilterField[];
  /** Suggested values for a field; `search` is the typed needle, empty for the first page. */
  loadValues?: (field: string, search: string) => Promise<string[]>;
  /** Values listed first for every field, e.g. dashboard `$variables`. */
  extraValueSuggestions?: (field: string) => string[];
  /** A soft warning for a chip's value, e.g. one not seen in recent data. */
  valueHint?: (field: string, values: string[]) => I18nText | undefined;
  /** Overrides the profile's layout. */
  layout?: FilterLayout;
  fieldsLoading?: boolean;
  placeholder?: I18nText;
  disabled?: boolean;
  size?: "sm" | "md";
  /** `plain` blends the bar into the editor surface it sits in. */
  appearance?: "field" | "plain";
  /** Prefix for every test id: `-row-<path>`, `-chip-<field>`, `-connector-<path>`, `-add-condition`, `-add-group`, `-ungroup-<path>`, `-issues`. */
  dataTest?: string;
}

export interface FilterBuilderEmits {
  (_e: "update:modelValue", _value: unknown): void;
  /** Whether the filter passes the profile's validation; emitted on mount and on every change. */
  (_e: "update:valid", _valid: boolean): void;
  /** Enter on an empty search box. */
  (_e: "submit"): void;
  /** The field list is about to be shown; lazy pages load fields here. */
  (_e: "focus"): void;
}

export interface FilterBuilderExpose {
  focus: () => void;
  /** Runs the profile's validation, marks the offending chips and returns the problems. */
  validate: () => FilterIssue[];
}
