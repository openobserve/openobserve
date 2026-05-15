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

/**
 * Field categorisation for the field sidebar.
 *
 * Priority order:
 *   1. Org semantic group  (FieldAlias exact match)
 *   2. Dot-namespace prefix  ("aws.region" → "aws")
 *   3. Underscore-namespace prefix — dynamically discovered from the field set
 *      (any prefix shared by ≥ MIN_PREFIX_FIELDS fields qualifies)
 *   4. Data-type bucket  (string / number / boolean)
 */

import type { FieldAlias } from "@/services/service_streams";
import type { FieldGroupingConfig } from "@/composables/useServiceCorrelation";

export type StreamType = "logs" | "traces" | "metrics" | string;

// ---------------------------------------------------------------------------
// Fallback group keys
// ---------------------------------------------------------------------------

export const CATEGORY = {
  PINNED: "pinned",
  TYPE_STRING: "type_string",
  TYPE_NUMBER: "type_number",
  TYPE_BOOLEAN: "type_boolean",
  OTHER: "other",
} as const;

export type Category = (typeof CATEGORY)[keyof typeof CATEGORY];

// Labels for the fixed bucket keys — these never come from the remote config.
const CATEGORY_LABELS: Record<string, string> = {
  [CATEGORY.PINNED]: "Key Fields",
  [CATEGORY.TYPE_STRING]: "String",
  [CATEGORY.TYPE_NUMBER]: "Number",
  [CATEGORY.TYPE_BOOLEAN]: "Boolean",
  [CATEGORY.OTHER]: "Other",
};

// Normalise a raw prefix to its canonical group key via the fetched grouping config.
function canonicalise(prefix: string, grouping?: FieldGroupingConfig | null): string {
  return grouping?.prefix_aliases?.[prefix] ?? prefix;
}

// ---------------------------------------------------------------------------
// SemanticIndex
// ---------------------------------------------------------------------------

export interface SemanticIndex {
  /** field name (lowercase) → group key */
  fieldToGroup: Map<string, string>;
  /** group key → display label */
  groupLabels: Map<string, string>;
  /** ordered list of group keys (API order) */
  groupOrder: string[];
  /** fetched grouping config (prefix aliases + group labels); null = use hardcoded fallbacks */
  grouping: FieldGroupingConfig | null;
}

/**
 * Build a SemanticIndex from the org's FieldAlias list.
 * All aliases sharing the same `alias.group` parent collapse into one group key.
 * Pass `grouping` from the fetched field_grouping settings key to replace the
 * hardcoded PREFIX_CANONICAL and GROUP_LABELS maps.
 */
export function buildSemanticIndex(
  aliases: FieldAlias[],
  grouping?: FieldGroupingConfig | null,
): SemanticIndex {
  const g = grouping ?? null;
  const fieldToGroup = new Map<string, string>();
  const groupLabels = new Map<string, string>();
  const groupOrder: string[] = [];

  for (const alias of aliases) {
    const rawKey = (alias.group || alias.id).toLowerCase();
    const groupKey = canonicalise(rawKey, g);

    if (!groupLabels.has(groupKey)) {
      const label =
        g?.group_labels?.[groupKey] ??
        (alias.group
          ? alias.group.charAt(0).toUpperCase() + alias.group.slice(1)
          : groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
      groupLabels.set(groupKey, label);
      groupOrder.push(groupKey);
    }

    for (const field of alias.fields) {
      fieldToGroup.set(field.toLowerCase(), groupKey);
    }
  }

  return { fieldToGroup, groupLabels, groupOrder, grouping: g };
}

// ---------------------------------------------------------------------------
// Dynamic prefix discovery
//
// Given the actual field names in the stream, find underscore-prefixes that
// appear on at least MIN_PREFIX_FIELDS fields.  This catches prefixes like
// "body_" that aren't in any static list but are clearly a namespace.
// ---------------------------------------------------------------------------

const MIN_PREFIX_FIELDS = 2;

/**
 * Scan fieldNames and return the set of underscore-prefixes that qualify as
 * a dynamic group (appear on ≥ MIN_PREFIX_FIELDS distinct fields).
 * Already-dot-namespaced fields are excluded (handled in tier 2a).
 */
export function discoverPrefixes(
  fieldNames: string[],
  grouping?: FieldGroupingConfig | null,
): Set<string> {
  const counts = new Map<string, number>();

  for (const name of fieldNames) {
    const lower = name.toLowerCase();
    if (lower.includes(".")) continue; // dot-namespaced — handled elsewhere
    const us = lower.indexOf("_");
    if (us <= 0) continue;
    const prefix = canonicalise(lower.slice(0, us), grouping);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  const result = new Set<string>();
  Array.from(counts.entries()).forEach(([prefix, count]) => {
    if (count >= MIN_PREFIX_FIELDS) result.add(prefix);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Data-type bucket (tier 4)
// ---------------------------------------------------------------------------

function dataTypeBucket(dataType: string): string {
  const t = (dataType || "").toLowerCase();
  if (
    t === "int64" || t === "float64" || t === "int32" || t === "float32" ||
    t === "double" || t === "long" || t === "integer"
  ) return CATEGORY.TYPE_NUMBER;
  if (t === "bool" || t === "boolean") return CATEGORY.TYPE_BOOLEAN;
  return CATEGORY.TYPE_STRING;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the group key for a field.
 *
 * @param fieldName       - raw field name
 * @param dataType        - schema type string (e.g. "Utf8", "Int64")
 * @param index           - pre-built SemanticIndex, or null
 * @param dynamicPrefixes - set returned by discoverPrefixes(), or null
 */
export function resolveFieldGroup(
  fieldName: string,
  dataType: string,
  index: SemanticIndex | null,
  dynamicPrefixes: Set<string> | null = null,
): string {
  const lower = fieldName.toLowerCase();

  // 1. Org semantic group
  if (index) {
    const group = index.fieldToGroup.get(lower);
    if (group) return group;
  }

  // 2a. Dot-namespace prefix  ("aws.region" → "aws", "kubernetes.pod" → "k8s")
  const dot = lower.indexOf(".");
  if (dot > 0) return canonicalise(lower.slice(0, dot), index?.grouping);

  // 2b. Underscore-namespace prefix — canonical + dynamic discovery
  const us = lower.indexOf("_");
  if (us > 0) {
    const canonical = canonicalise(lower.slice(0, us), index?.grouping);
    if (dynamicPrefixes?.has(canonical)) return canonical;
  }

  // 2c. Field name is itself a known group key (e.g. "body" matching the "body" prefix group)
  if (dynamicPrefixes?.has(canonicalise(lower, index?.grouping))) return canonicalise(lower, index?.grouping);

  // 3. Data-type bucket
  return dataTypeBucket(dataType);
}

/**
 * Display label for a group key.
 * Checks semantic index first, then fetched group_labels, then CATEGORY_LABELS, then capitalises key.
 */
export function getGroupLabel(groupKey: string, index: SemanticIndex | null): string {
  if (index) {
    const label = index.groupLabels.get(groupKey);
    if (label) return label;
    const fetched = index.grouping?.group_labels?.[groupKey];
    if (fetched) return fetched;
  }
  if (groupKey in CATEGORY_LABELS) return CATEGORY_LABELS[groupKey];
  return groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
}

/**
 * Sort order for a group key.
 * Semantic index groups come first (API order), dynamic groups in the middle,
 * data-type buckets trail at the end.
 */
export function groupSortOrder(groupKey: string, index: SemanticIndex | null): number {
  if (groupKey === CATEGORY.PINNED) return -1;

  const TAIL: Record<string, number> = {
    [CATEGORY.TYPE_STRING]: 990,
    [CATEGORY.TYPE_NUMBER]: 991,
    [CATEGORY.TYPE_BOOLEAN]: 992,
    [CATEGORY.OTHER]: 999,
  };
  if (groupKey in TAIL) return TAIL[groupKey];

  if (index) {
    const pos = index.groupOrder.indexOf(groupKey);
    if (pos !== -1) return pos;
  }

  // Dynamic prefix groups — alphabetical, after semantic groups
  return 500;
}

// ---------------------------------------------------------------------------
// Shared grouping pipeline — call from logs and traces extractFields
// ---------------------------------------------------------------------------

export interface FieldObj {
  name: string;
  dataType: string;
  ftsKey: boolean;
  isSchemaField: boolean;
  showValues: boolean;
  isInterestingField: boolean;
  group: string;
  streams: string[];
  label?: boolean;
  [key: string]: unknown;
}

/**
 * Bucket `fields` by semantic group, sort groups, and inject label header rows.
 *
 * Returns a new ordered array: [labelRow, ...fieldsInGroup, labelRow, ...].
 * Already-label rows in the input are skipped (idempotent).
 *
 * When `index` is null, returns the input array unchanged (flat fallback).
 */
export function applyFieldGrouping(
  fields: FieldObj[],
  index: SemanticIndex | null,
  keyFieldSet: Set<string>,
  keyGroupSet: Set<string>,
): FieldObj[] {
  if (!index || !fields.length) return fields;

  const allNames = fields.filter((f) => !f.label).map((f) => f.name);
  const dynamicPrefixes = discoverPrefixes(allNames, index.grouping);

  const groupBuckets = new Map<string, FieldObj[]>();

  for (const f of fields) {
    if (f.label) continue; // skip existing label rows

    const resolvedGroup = resolveFieldGroup(f.name, f.dataType || "", index, dynamicPrefixes);
    const lower = f.name.toLowerCase();
    const semanticGroup = index.fieldToGroup.get(lower) ?? null;
    const us = lower.indexOf("_");
    const rawPrefix = us > 0 ? lower.slice(0, us) : "";
    const isKeyField =
      keyFieldSet.has(lower) ||
      keyGroupSet.has(resolvedGroup) ||
      (rawPrefix !== "" && keyGroupSet.has(rawPrefix)) ||
      (semanticGroup !== null && keyGroupSet.has(semanticGroup));

    const g = isKeyField ? CATEGORY.PINNED : resolvedGroup;
    const updated = { ...f, group: g };

    if (!groupBuckets.has(g)) groupBuckets.set(g, []);
    groupBuckets.get(g)!.push(updated);
  }

  const sortedGroups = Array.from(groupBuckets.keys()).sort(
    (a, b) => groupSortOrder(a, index) - groupSortOrder(b, index),
  );

  const result: FieldObj[] = [];
  for (const groupKey of sortedGroups) {
    const groupFields = groupBuckets.get(groupKey)!;
    if (!groupFields.length) continue;
    result.push(
      {
        name: getGroupLabel(groupKey, index),
        label: true,
        ftsKey: false,
        isSchemaField: false,
        showValues: false,
        group: groupKey,
        isExpanded: false,
        streams: [],
        isInterestingField: false,
        dataType: "",
      } as FieldObj,
      ...groupFields,
    );
  }
  return result;
}

/**
 * Decide whether semantic field grouping should be applied.
 *
 * Grouping is suppressed when multiple streams are selected because the
 * multi-stream layout uses per-stream label rows (group: streamName) and
 * semantic re-grouping would discard those headers.
 */
export function shouldApplyFieldGrouping(opts: {
  semanticIndex: SemanticIndex | null;
  streamCount: number;
  udsActive: boolean;
  udsFieldLimit: number;
  totalSchemaFieldCount: number;
}): boolean {
  if (!opts.semanticIndex) return false;
  if (opts.streamCount !== 1) return false;
  if (opts.udsActive) return true;
  return true;
}

/**
 * Filter `fields` according to group-collapse state.
 *
 * Rules:
 * - Label (header) rows are always kept.
 * - When `filterTerm` is non-empty, bypass collapse entirely so the q-table
 *   filter-method can match fields inside collapsed groups.
 * - When a field's group is not tracked in `expandGroupRows`, it is visible
 *   (flat / ungrouped list behaviour).
 * - Otherwise the field is visible only when its group is expanded.
 */
export function applyCollapseFilter(
  fields: FieldObj[],
  expandGroupRows: Record<string, boolean>,
  filterTerm: string,
): FieldObj[] {
  if (filterTerm) return fields;
  return fields.filter((row) => {
    if (row.label === true) return true;
    const group = row.group;
    if (group === undefined || !(group in expandGroupRows)) return true;
    return expandGroupRows[group] !== false;
  });
}
