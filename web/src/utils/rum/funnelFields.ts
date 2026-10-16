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

import { isFilterColumn } from "@/utils/rum/productAnalyticsModel";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

/** A field seen on the funnel's step events in the per-step sample. */
export interface SeenField {
  field: string;
  /** 1-based steps whose sampled rows carry the field, in order. */
  steps: number[];
  /** Most frequent values at the first step that carries it. */
  top: string[];
  /** Distinct values at that step beyond `top`. */
  more: number;
  /** More distinct values in the sample than a breakdown can show. */
  many: boolean;
}

export interface FieldSample {
  fields: SeenField[];
}

export const FIELD_SAMPLE_ROWS = 200;
export const MANY_VALUES = 50;
const TOP_VALUES = 3;
// The RUM SDK writes these on every row of a kind, so they never say what a step's events carry.
const SDK_PREFIXES = [
  "o2",
  "action_",
  "view_",
  "session_",
  "resource_",
  "long_task_",
  "error_",
  "telemetry_",
  "display_",
  "connectivity_",
  "user_agent_",
  "device_",
  "geo_info_",
  "privacy_",
  "usr_",
];
const SDK_FIELDS = [
  "date",
  "type",
  "source",
  "service",
  "sdk_version",
  "tab_id",
  "ip",
  "batch_time",
  "application_id",
  "anonymous_id",
];

/** A column the per-step sample reads: one the app sets itself, which a breakdown or step condition can use. */
export function isSampledField(name: string): boolean {
  return (
    isFilterColumn(name) &&
    !SDK_FIELDS.includes(name) &&
    !SDK_PREFIXES.some((p) => name.startsWith(p))
  );
}

const text = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

// Steps with the same event share one sample, since the query tags a row with the first step it matches.
const sampleStep = (steps: StepRef[], i: number): number =>
  steps.findIndex((s) => s.kind === steps[i].kind && s.key === steps[i].key) + 1;

const valueCounts = (rows: Record<string, unknown>[], field: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = text(r[field]);
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
};

/** Folds the sample's rows into the fields each step's events carry, ordered by the first step that sets them. */
export function foldFieldSample(
  rows: Record<string, unknown>[],
  steps: StepRef[],
  fields: readonly string[],
): FieldSample {
  const byStep = new Map<number, Record<string, unknown>[]>();
  for (const r of rows) {
    const st = Number(r.st);
    byStep.set(st, [...(byStep.get(st) ?? []), r]);
  }
  const rowsOf = (i: number) => byStep.get(sampleStep(steps, i)) ?? [];
  const seen: SeenField[] = [];
  for (const field of fields) {
    const per = steps.map((_, i) => valueCounts(rowsOf(i), field));
    const at = per.map((c, i) => (c.size ? i + 1 : 0)).filter((s) => s > 0);
    if (!at.length) continue;
    const first = per[at[0] - 1];
    const ranked = [...first.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const all = new Set(per.flatMap((c) => [...c.keys()]));
    seen.push({
      field,
      steps: at,
      top: ranked.slice(0, TOP_VALUES).map(([v]) => v),
      more: Math.max(0, ranked.length - TOP_VALUES),
      many: all.size > MANY_VALUES,
    });
  }
  seen.sort((a, b) => a.steps[0] - b.steps[0] || (a.field < b.field ? -1 : 1));
  return { fields: seen };
}

export function fieldsOnStep(sample: FieldSample | null, step: number): SeenField[] {
  return sample?.fields.filter((f) => f.steps.includes(step)) ?? [];
}
