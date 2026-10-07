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

import { raw, type I18nText } from "@/types/i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { labelsOf } from "./kubernetesObjects";
import type { MapRow } from "./mapFill";

export interface MapObjects {
  state: "loading" | "skipped" | "failed" | "ok";
  reason?: "noStream" | "unscoped" | "anchor" | "noCluster";
}

export interface LabelKeyStats {
  key: string;
  rows: number;
  values: { value: string; count: number }[];
}

export interface LabelIndex {
  observed: number;
  total: number;
  keys: LabelKeyStats[];
}

// Controller bookkeeping: hashes change on every rollout and job names duplicate the workload.
const NOISE_LABEL_KEYS: readonly string[] = [
  "pod-template-hash",
  "controller-revision-hash",
  "pod-template-generation",
];

const NOISE_NAME_PARTS: readonly string[] = ["controller-uid", "job-name"];

// "=" never appears in a label key, so a value starting with it can never be a filter term.
export const NOT_A_TERM = "=";

export const isNoiseKey = (key: string) =>
  NOISE_LABEL_KEYS.includes(key) || NOISE_NAME_PARTS.includes(key.slice(key.lastIndexOf("/") + 1));

export const splitTerm = (term: string): [string, string] => {
  const at = term.indexOf(":");
  return [term.slice(0, at), term.slice(at + 1)];
};

export const rowLabels = (row: MapRow): Record<string, string> | null =>
  labelsOf(row.object ?? null);

export function applyFilter(rows: MapRow[], terms: readonly string[]): MapRow[] {
  if (!terms.length) return rows;
  const byKey = new Map<string, Set<string>>();
  for (const term of terms) {
    const [key, value] = splitTerm(term);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(value);
  }
  return rows.filter((row) => {
    const labels = rowLabels(row);
    if (!labels) return false;
    for (const [key, values] of byKey) if (!values.has(labels[key])) return false;
    return true;
  });
}

export function labelIndex(rows: readonly MapRow[]): LabelIndex {
  const keys = new Map<string, Map<string, number>>();
  let observed = 0;
  for (const row of rows) {
    const labels = rowLabels(row);
    if (!labels) continue;
    observed++;
    for (const key in labels) {
      const value = labels[key];
      if (typeof value !== "string" || value === "" || isNoiseKey(key)) continue;
      let counts = keys.get(key);
      if (!counts) keys.set(key, (counts = new Map()));
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const stats = [...keys].map(([key, counts]) => {
    const values = [...counts]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { key, rows: values.reduce((sum, v) => sum + v.count, 0), values };
  });
  stats.sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
  return { observed, total: rows.length, keys: stats };
}

export function filterOptions(index: LabelIndex, header: I18nText): SelectOption[] {
  const out: SelectOption[] = [{ label: header, header: true }];
  for (const { key, values } of index.keys) {
    out.push({ label: raw(key), value: `${NOT_A_TERM}${key}`, expandable: true });
    for (const { value, count } of values) {
      out.push({
        label: raw(`${key}: ${value} · ${count}`),
        value: `${key}:${value}`,
        parentValue: `${NOT_A_TERM}${key}`,
      });
    }
  }
  return out;
}

export function groupLabelOptions(index: LabelIndex): SelectOption[] {
  return index.keys.map(({ key }) => ({ label: raw(key), value: `label.${key}` }));
}
