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

import type { PackUpdateRow } from "./types";
import { contentHash } from "./useInstallRecords";

type Doc = Record<string, any>;

/** Alert fields a library update may change; the server keeps `stream_name` as created, so it is not one. */
export const ALERT_UPDATE_FIELDS = [
  "description",
  "query_condition.type",
  "query_condition.sql",
  "query_condition.promql",
  "query_condition.conditions",
  "query_condition.aggregation",
  "query_condition.promql_condition",
  "trigger_condition.threshold",
  "trigger_condition.operator",
  "trigger_condition.period",
  "trigger_condition.frequency",
  "trigger_condition.silence",
  "trigger_condition.frequency_type",
  "trigger_condition.cron",
];

/** Fields only valid together once their kind changes, so they update or stay as one. */
const LINKED: Array<{ kind: string; fields: string[] }> = [
  {
    kind: "query_condition.type",
    fields: [
      "query_condition.type",
      "query_condition.sql",
      "query_condition.promql",
      "query_condition.conditions",
      "query_condition.aggregation",
      "query_condition.promql_condition",
    ],
  },
  {
    kind: "trigger_condition.frequency_type",
    fields: [
      "trigger_condition.frequency_type",
      "trigger_condition.cron",
      "trigger_condition.frequency",
    ],
  },
];

const readPath = (doc: Doc, path: string): unknown =>
  path.split(".").reduce<any>((node, key) => node?.[key], doc) ?? null;

const writePath = (doc: Doc, path: string, value: unknown) => {
  const keys = path.split(".");
  const last = keys.pop()!;
  let node = doc;
  for (const key of keys) {
    node[key] ??= {};
    node = node[key];
  }
  if (value === null) delete node[last];
  else node[last] = JSON.parse(JSON.stringify(value));
};

const same = (left: unknown, right: unknown) => contentHash(left) === contentHash(right);

export const pickFields = (doc: Doc, fields = ALERT_UPDATE_FIELDS): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field, readPath(doc, field)]));

/** Three-way merge: a field still at the installed value takes the library's, any other stays the user's. */
export const mergeUpdate = <T extends Doc>(
  current: T,
  base: Record<string, unknown> | null,
  next: Doc,
  fields = ALERT_UPDATE_FIELDS,
): { doc: T; rows: PackUpdateRow[] } => {
  const doc = JSON.parse(JSON.stringify(current)) as T;
  const untouched = (field: string) =>
    base !== null && same(readPath(current, field), base[field] ?? null);
  const decided = new Map(fields.map((field) => [field, untouched(field)]));
  for (const { kind, fields: group } of LINKED) {
    if (same(readPath(current, kind), readPath(next, kind))) continue;
    const whole = group.every(untouched);
    for (const field of group) if (decided.has(field)) decided.set(field, whole);
  }
  const rows: PackUpdateRow[] = [];
  for (const field of fields) {
    const yours = readPath(current, field);
    const library = readPath(next, field);
    if (same(yours, library)) continue;
    const installed = base ? (base[field] ?? null) : null;
    const take = decided.get(field)!;
    if (take) writePath(doc, field, library);
    rows.push({ field, installed, yours, library, outcome: take ? "updated" : "kept" });
  }
  return { doc, rows };
};

/** Puts back the installed value of each field the update changed, unless the user edited it since. */
export const revertUpdate = <T extends Doc>(current: T, rows: PackUpdateRow[]): T => {
  const doc = JSON.parse(JSON.stringify(current)) as T;
  const reverts = (row: PackUpdateRow) =>
    row.outcome === "updated" && same(readPath(current, row.field), row.library);
  const blocked = new Set<string>();
  for (const { kind, fields } of LINKED) {
    const group = rows.filter(({ field }) => fields.includes(field));
    const kindChanged = group.some(({ field, outcome }) => field === kind && outcome === "updated");
    if (kindChanged && !group.every(reverts)) for (const { field } of group) blocked.add(field);
  }
  for (const row of rows) {
    if (reverts(row) && !blocked.has(row.field)) writePath(doc, row.field, row.installed);
  }
  return doc;
};
