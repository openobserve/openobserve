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

import { LIVE_CHECKS, type CoverageRow, type LiveCheck } from "./aoTypes";

export type ServiceState = "watched" | "partial" | "learning" | "gap";
export type CoverageGroupBy = "none" | "service" | "place";
export type CoverageSortKey =
  "traffic" | "service" | "where" | `check-${LiveCheck}` | "state" | "lastScanned";

/** Rows that share a service name or a place, folded under one header row. */
export interface CoverageGroup {
  kind: "group";
  // The table and the map key every row by `service`; the prefix keeps a group apart from a service.
  service: string;
  // What the rows share, which the group keeps as its row key changes with the rows shown.
  id: string;
  title: string;
  children: CoverageRow[];
  counts: Record<ServiceState, number>;
  traffic: number | null;
}

export type CoverageTableRow = CoverageRow | CoverageGroup;

/** How rows fold: the key they share, or null to stay a plain row, and the title a group reads. */
export interface CoverageGrouper {
  keyOf: (row: CoverageRow) => string | null;
  titleOf: (row: CoverageRow) => string;
}

// Up to this many rows read fine flat; past it names that repeat fold into one line each.
const FLAT_MAX = 30;
// Past this many name lines, places take over when they cut the lines to this share or fewer.
const NAME_LINES_MAX = 50;
const PLACE_SHARE = 2 / 3;

export const SORT_KEYS: CoverageSortKey[] = [
  "traffic",
  "service",
  "where",
  ...LIVE_CHECKS.map((c) => `check-${c}` as const),
  "state",
  "lastScanned",
];

export const SERVICE_RANK: Record<ServiceState, number> = {
  gap: 0,
  partial: 1,
  learning: 2,
  watched: 3,
};

// Sorting a check column puts the worst first: no monitor, then the ways one falls short, then covered.
export const CHECK_RANK: Record<string, number> = {
  none: 0,
  blind: 1,
  unmapped: 2,
  silent: 3,
  weak: 4,
  covered: 5,
};

export const isGroup = (row: CoverageTableRow): row is CoverageGroup =>
  (row as CoverageGroup).kind === "group";

/** A service is one name in many places. */
export const coverageName = (row: CoverageRow): string => row.identity?.serviceName ?? row.service;

/** The place is the Where the adapter wrote; its dash means it knows none, and such rows share nothing. */
export const coveragePlace = (row: CoverageRow): string | null => {
  const where = String(row.where ?? "");
  return where && where !== "—" ? where : null;
};

// The adapter states every live row; a row without one has no covered check.
export const serviceState = (row: CoverageRow): ServiceState => row.status?.state ?? "gap";

const checkRank = (row: CoverageRow, check: LiveCheck) =>
  CHECK_RANK[row.checks?.[check].engine?.stateKey ?? "none"];

const rowValue = (row: CoverageRow, key: CoverageSortKey): number | string => {
  if (key === "service") return row.service;
  if (key === "where") return String(row.where ?? "");
  if (key === "state") return SERVICE_RANK[serviceState(row)];
  if (key === "lastScanned") return row.scannedMinutes ?? Number.MAX_SAFE_INTEGER;
  if (key === "traffic") return row.traffic ?? -1;
  return checkRank(row, key.slice("check-".length) as LiveCheck);
};

/** What a column sorts a row or a group by. */
export const sortValue = (row: CoverageTableRow, key: CoverageSortKey): number | string => {
  if (!isGroup(row)) return rowValue(row, key);
  if (key === "service" || key === "where") return row.title;
  if (key === "traffic") return row.traffic ?? -1;
  return row.children.reduce((min, c) => Math.min(min, rowValue(c, key) as number), Infinity);
};

const rankOf = (row: CoverageTableRow) =>
  isGroup(row)
    ? row.children.reduce((min, c) => Math.min(min, SERVICE_RANK[serviceState(c)]), Infinity)
    : SERVICE_RANK[serviceState(row)];

const compare = (a: number | string, b: number | string) =>
  typeof a === "string" || typeof b === "string" ? String(a).localeCompare(String(b)) : a - b;

/** Traffic ranks within a state, so a busy watched service never sorts above a gap; unknown traffic stays last. */
export const coverageOrder =
  (key: CoverageSortKey, order: "asc" | "desc") =>
  (a: CoverageTableRow, b: CoverageTableRow): number => {
    const dir = order === "asc" ? 1 : -1;
    const traffic = () => {
      const x = sortValue(a, "traffic") as number;
      const y = sortValue(b, "traffic") as number;
      if (x < 0 || y < 0) return (y < 0 ? 0 : 1) - (x < 0 ? 0 : 1);
      return (x - y) * dir;
    };
    const tie = () => (sortValue(b, "traffic") as number) - (sortValue(a, "traffic") as number);
    const name = () => a.service.localeCompare(b.service);
    if (key === "traffic") return rankOf(a) - rankOf(b) || traffic() || name();
    return compare(sortValue(a, key), sortValue(b, key)) * dir || tie() || name();
  };

/** The prefix every group key takes: the first of group:, group1:, group2:… that no service key starts with. */
export const groupPrefix = (rows: CoverageRow[]): string => {
  const taken = new Set<string>();
  for (const row of rows) {
    const digits = /^group(\d*):/.exec(row.service)?.[1];
    if (digits !== undefined) taken.add(digits);
  }
  let n = 0;
  while (taken.has(n ? String(n) : "")) n += 1;
  return `group${n || ""}:`;
};

/** Folds rows sharing a key under one group row titled by `titleOf`; a key held once, or none, stays a plain row.
 * A group's row key is `prefix` plus its key: pass the prefix of every row so keys hold as rows narrow. */
export const groupCoverage = (
  rows: CoverageRow[],
  keyOf: (row: CoverageRow) => string | null,
  titleOf: (row: CoverageRow) => string = (row) => keyOf(row) ?? row.service,
  prefix: string = groupPrefix(rows),
): CoverageTableRow[] => {
  const groups = new Map<string, CoverageRow[]>();
  const lines: (string | CoverageRow)[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) {
      lines.push(row);
      continue;
    }
    const members = groups.get(key);
    if (members) members.push(row);
    else {
      groups.set(key, [row]);
      lines.push(key);
    }
  }
  return lines.map((id): CoverageTableRow => {
    if (typeof id !== "string") return id;
    const children = groups.get(id) ?? [];
    if (children.length === 1) return children[0];
    const title = titleOf(children[0]);
    const counts: Record<ServiceState, number> = { gap: 0, partial: 0, learning: 0, watched: 0 };
    children.forEach((c) => (counts[serviceState(c)] += 1));
    const known = children.filter((c) => c.traffic != null);
    return {
      kind: "group",
      service: `${prefix}${id}`,
      id,
      title,
      children,
      counts,
      traffic: known.length ? known.reduce((sum, c) => sum + (c.traffic ?? 0), 0) : null,
    };
  });
};

/** A group's worst state, from its counts, so no sort order can hide a gap inside it. */
export const groupWorst = (group: CoverageGroup): ServiceState =>
  (["gap", "partial", "learning", "watched"] as const).find((state) => group.counts[state]) ??
  "watched";

// A row with no key stays a line of its own.
const linesOf = (rows: CoverageRow[], keyOf: (row: CoverageRow) => string | null) => {
  const keys = rows.map(keyOf);
  return new Set(keys.filter((k) => k !== null)).size + keys.filter((k) => k === null).length;
};

/** The grouping the coverage table shows for these rows; the reader never has to pick one. */
export const chooseCoverageGrouping = (
  rows: CoverageRow[],
  nameOf: (row: CoverageRow) => string,
  placeOf: (row: CoverageRow) => string | null,
): CoverageGroupBy => {
  if (rows.length <= FLAT_MAX) return "none";
  const names = linesOf(rows, nameOf);
  if (names > NAME_LINES_MAX && linesOf(rows, placeOf) <= names * PLACE_SHARE) return "place";
  return names < rows.length ? "service" : "none";
};

/** Sorts rows, grouped or not; a group's children keep the same order inside it. */
export const sortCoverage = (
  rows: CoverageTableRow[],
  key: CoverageSortKey,
  order: "asc" | "desc",
): CoverageTableRow[] => {
  const by = coverageOrder(key, order);
  return rows
    .map((row) => (isGroup(row) ? { ...row, children: [...row.children].sort(by) } : row))
    .sort(by);
};

/** The map's grouping: the reader's pick as is, else its own choice, which past `cap` services folds what it can. */
export const chooseMapGrouping = (
  rows: CoverageRow[],
  cap: number,
  picked: CoverageGroupBy | null,
  nameOf: (row: CoverageRow) => string,
  placeOf: (row: CoverageRow) => string | null,
): CoverageGroupBy => {
  if (picked) return picked;
  const by = chooseCoverageGrouping(rows, nameOf, placeOf);
  if (by !== "none" || rows.length <= cap) return by;
  if (linesOf(rows, placeOf) < rows.length) return "place";
  return linesOf(rows, nameOf) < rows.length ? "service" : "none";
};

/** One hex per group, or per service when `groupOf` is null; past `cap` hexes, the first `cap` and a count. */
export const mapCoverage = (
  rows: CoverageRow[],
  cap: number,
  groupOf: CoverageGrouper | null,
  rank: ((hex: CoverageTableRow) => number) | null = null,
): { items: CoverageTableRow[]; more: number } => {
  const all = groupOf
    ? sortCoverage(groupCoverage(rows, groupOf.keyOf, groupOf.titleOf), "state", "asc")
    : rows;
  // Past the cap lower ranks go first, in their own order, so no active target is left out.
  const hexes =
    rank && all.length > cap
      ? all
          .map((hex) => ({ hex, at: rank(hex) }))
          .sort((a, b) => a.at - b.at)
          .map(({ hex }) => hex)
      : all;
  return { items: hexes.slice(0, cap), more: Math.max(0, hexes.length - cap) };
};
