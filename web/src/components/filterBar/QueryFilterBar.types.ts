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

import type { InjectionKey } from "vue";
import type { I18nText } from "@/types/i18n";
import type { FilterTokenPart } from "@/lib/core/Badge/OFilterToken.types";
import type {
  FilterConnector,
  FilterDialect,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterOperatorId,
} from "@/utils/query/filterBar";
import type {
  FilterConnectorMode,
  FilterIssue,
  FilterLayout,
  FilterProfileName,
} from "./filterProfiles";

export interface QueryFilterBarProps {
  modelValue: FilterGroup;
  fields: FilterField[];
  /** `sql` joins chips with AND/OR and groups; `promql` ANDs label matchers only. */
  dialect?: FilterDialect;
  /** Offer a "search all text" row for typed words that match no field. */
  freeText?: boolean;
  /** Let the user name a field that is not in `fields` (labels not loaded yet). */
  allowCustomFields?: boolean;
  /** Edit by a named profile's rules; `dialect`, `freeText` and `allowCustomFields` are then ignored. */
  profile?: FilterProfileName;
  /** Overrides the profile's layout. */
  layout?: FilterLayout;
  /** Suggested values for a field; `search` is the typed needle, empty for the first page. */
  loadValues?: (field: string, search: string) => Promise<string[]>;
  /** Values listed first for every field, e.g. dashboard `$variables`. */
  extraValueSuggestions?: (field: string) => string[];
  /** Problems to mark on their chips, from FilterBuilder's validation. */
  issues?: FilterIssue[];
  /** A soft warning for a chip's value, e.g. one not seen in recent data. */
  valueHint?: (field: string, values: string[]) => I18nText | undefined;
  fieldsLoading?: boolean;
  placeholder?: I18nText;
  disabled?: boolean;
  size?: "sm" | "md";
  /** `plain` blends the bar into the editor surface it replaces. */
  appearance?: "field" | "plain";
  /** Lines of chips shown before the bar scrolls inside itself; it grows freely when unset. */
  maxRows?: number;
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
  /** The group these items belong to; the tail slot renders inside the matching group. */
  groupId: string;
  /** Index path of the group, `-` joined, empty for the root; test ids carry it. */
  path?: string;
  /** `and-only` draws no AND/OR between nodes. */
  connectorMode: FilterConnectorMode;
  editingId?: string | null;
  editPart?: FilterTokenPart | null;
  armedId?: string | null;
  /** The group the caret is in, and where among its items; the `caret` slot renders there. */
  caretGroupId?: string | null;
  /** Null keeps the caret out of these nodes. */
  caretIndex?: number | null;
  /** Ids of chips that have a validation problem. */
  invalidIds?: Set<string>;
  /** Picks PromQL's own spelling of the regex operators. */
  dialect?: FilterDialect;
  disabled?: boolean;
  /** Whether group `id` can be ungrouped without changing what the filter matches. */
  canUngroup?: (_id: string) => boolean;
  dataTest: string;
}

export interface FilterBarNodesEmits {
  (_e: "edit", _id: string, _part: FilterTokenPart, _element: HTMLElement): void;
  (_e: "remove", _id: string): void;
  (_e: "toggle-connector", _id: string): void;
  /** Lift a group's items into its parent. */
  (_e: "ungroup", _id: string): void;
}

export interface FilterBarRowsProps extends FilterBarNodesProps {
  /** Group level of these items, the root being 1. */
  level?: number;
  /** Whether a group may be added inside the group `id`. */
  canGroupIn: (_id: string) => boolean;
  /** Why no more conditions can be added; adding is disabled while set. */
  limitReason?: I18nText;
  /** Connector a new line in this group takes, shown on the half-built line. */
  nextConnector?: FilterConnector;
  /** Groups drawn as one summary line instead of their lines. */
  foldedIds?: Set<string>;
}

export interface FilterBarRowsEmits extends FilterBarNodesEmits {
  (_e: "add-condition", _groupId: string): void;
  (_e: "add-group", _groupId: string): void;
  /** Start a new condition on the line after node `id`. */
  (_e: "add-after", _id: string): void;
  /** Fold or unfold group `id`. */
  (_e: "toggle-fold", _groupId: string): void;
}

export interface FilterBarCaretSlotProps {
  groupId: string;
  /** The caret's place among the group's items. */
  index: number;
}

/** What a chip reads from the bar it sits in, without threading props through every nested group. */
export interface FilterBarChipContext {
  fieldLabel: (field: string) => string | undefined;
  valueHint: (field: string, values: string[]) => I18nText | undefined;
  issueMessage: (nodeId: string) => I18nText | undefined;
  operatorName: (id: FilterOperatorId) => I18nText;
}

export const FILTER_BAR_CHIP_CONTEXT: InjectionKey<FilterBarChipContext> =
  Symbol("filterBarChipContext");
