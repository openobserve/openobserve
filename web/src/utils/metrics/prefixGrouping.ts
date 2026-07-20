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

/**
 * Prefix / Suffix Grouping Utilities
 *
 * Pure, dependency-free helpers that derive browsable facets from a flat list of
 * metric names:
 *
 *  - `computePrefixAssignment` — buckets names by their common underscore-delimited
 *                                prefix (e.g. `node_cpu_seconds_total` -> `node_cpu`),
 *                                returning the groups AND the name -> group map.
 *  - `computeSuffixGroups`     — tallies the trailing segment of each name
 *                                (e.g. `..._total`, `..._bucket`).
 *  - `matchesSearch`           — order-independent, multi-term substring matching
 *                                over a metric's name and help text.
 *
 * No imports from the app (no store, no vue) — safe to unit test and reuse anywhere.
 */

/** The id used for metrics that do not share a qualifying prefix with any other metric. */
export const MISC_GROUP_ID = "misc";

/** Human-facing label for the {@link MISC_GROUP_ID} bucket. */
export const MISC_GROUP_LABEL = "Other";

/** Default number of underscore-delimited segments considered for a prefix. */
export const DEFAULT_MAX_DEPTH = 2;

/** Default number of distinct metric names a prefix must cover to form a group. */
export const DEFAULT_MIN_GROUP_SIZE = 2;

/** A bucket of metric names sharing a common underscore-delimited prefix. */
export interface PrefixGroup {
  /** The prefix itself (e.g. `node_cpu`), or `misc` for the catch-all bucket. */
  id: string;
  /** Display label — the prefix for real groups, `Other` for the catch-all bucket. */
  label: string;
  /** Number of distinct metric names assigned to this group. */
  count: number;
  /** Segment count of the prefix (1 or 2 by default); `0` for the catch-all bucket. */
  depth: number;
}

/** A bucket of metric names sharing a common trailing underscore-delimited segment. */
export interface SuffixGroup {
  /** The suffix segment (e.g. `total`, `bucket`). */
  id: string;
  /** Display label — same as `id`. */
  label: string;
  /** Number of distinct metric names ending with this suffix. */
  count: number;
}

/** Options for {@link computePrefixAssignment}. */
export interface PrefixGroupOptions {
  /** Deepest prefix (in segments) that may be considered. Defaults to `2`. */
  maxDepth?: number;
  /** Minimum number of distinct names a prefix must cover to qualify. Defaults to `2`. */
  minGroupSize?: number;
}

/**
 * Normalizes an input list: trims, drops empties/non-strings and de-duplicates,
 * preserving first-seen order.
 */
function normalizeNames(metricNames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of metricNames ?? []) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

/**
 * Builds the candidate prefixes for a single metric name, shallowest first.
 *
 * `node_cpu_seconds_total` with `maxDepth = 2` yields `["node", "node_cpu"]`.
 * A name with no underscore yields a single depth-1 candidate: the whole name.
 */
function candidatePrefixes(name: string, maxDepth: number): string[] {
  const segments = name.split("_");
  const depth = Math.min(maxDepth, segments.length);
  const candidates: string[] = [];

  for (let i = 1; i <= depth; i++) {
    candidates.push(segments.slice(0, i).join("_"));
  }

  return candidates;
}

/**
 * Groups metric names by their common underscore-delimited prefix, and returns
 * the name -> group assignment along with the groups.
 *
 * For every name, candidate prefixes of depth `1..maxDepth` are considered. Each name is
 * assigned to the LONGEST (deepest) candidate that is shared by at least `minGroupSize`
 * distinct names in the input; if no candidate qualifies, the name lands in the `misc`
 * bucket. Every name is assigned to exactly one group, so the group counts always sum to
 * the number of distinct input names.
 *
 * Qualification is evaluated against how many names *could* use a prefix, but assignment
 * then pulls some of those names into a deeper group, which can leave a qualifying prefix
 * holding fewer than `minGroupSize` names. Given `envoy_cluster_a`, `envoy_cluster_b` and
 * `envoy_http_x`, the prefix `envoy` qualifies (3 names) but only `envoy_http_x` remains
 * once the other two claim the deeper `envoy_cluster`. A final pass folds such under-sized
 * groups into `misc`, so no rendered group is ever smaller than `minGroupSize`.
 *
 * The assignment comes OUT of the algorithm; it is never reconstructed from the
 * groups. "The deepest candidate that survived as a group" is a different
 * question from the one pass 2 answered — a name whose group was folded into
 * `misc` would be handed back to a shallower group that is still standing, and
 * the counts on the rail would stop agreeing with what the grid filters. That is
 * why there is one entry point returning both halves, rather than a groups-only
 * function that invites the caller to guess the other.
 *
 * Results are sorted by `count` descending, then `label` ascending. The `misc` group is
 * always sorted last regardless of its count.
 *
 * @param metricNames Flat list of metric names. Blanks and duplicates are ignored.
 * @param opts `maxDepth` (default 2) and `minGroupSize` (default 2).
 */
export function computePrefixAssignment(
  metricNames: string[],
  opts: PrefixGroupOptions = {},
): { groups: PrefixGroup[]; groupOf: Map<string, string> } {
  const maxDepth = Math.max(1, Math.floor(opts.maxDepth ?? DEFAULT_MAX_DEPTH));
  const minGroupSize = Math.max(
    1,
    Math.floor(opts.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE),
  );

  const names = normalizeNames(metricNames);
  if (names.length === 0) return { groups: [], groupOf: new Map() };

  // Pass 1: how many distinct names could use each candidate prefix?
  const candidatesByName = new Map<string, string[]>();
  const candidateCoverage = new Map<string, number>();

  for (const name of names) {
    const candidates = candidatePrefixes(name, maxDepth);
    candidatesByName.set(name, candidates);

    for (const candidate of candidates) {
      candidateCoverage.set(
        candidate,
        (candidateCoverage.get(candidate) ?? 0) + 1,
      );
    }
  }

  // Pass 2: assign each name to the deepest qualifying candidate, else `misc`.
  const groupOf = new Map<string, string>();
  const namesByGroup = new Map<string, string[]>();
  const depths = new Map<string, number>();

  for (const name of names) {
    const candidates = candidatesByName.get(name) ?? [];
    let groupId = MISC_GROUP_ID;
    let groupDepth = 0;

    // Candidates are shallowest-first; walk backwards to prefer the deepest match.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i];
      if ((candidateCoverage.get(candidate) ?? 0) >= minGroupSize) {
        groupId = candidate;
        groupDepth = i + 1;
        break;
      }
    }

    groupOf.set(name, groupId);
    const members = namesByGroup.get(groupId);
    if (members) members.push(name);
    else namesByGroup.set(groupId, [name]);
    depths.set(groupId, groupDepth);
  }

  // Pass 3: a prefix can qualify on coverage yet keep fewer than `minGroupSize`
  // names once deeper groups have taken their share. Fold those into `misc` so
  // the option actually holds for every group the user sees — and move their
  // members with them, which is what keeps the counts and the assignment the
  // same statement about the same names.
  for (const [id, members] of [...namesByGroup]) {
    if (id === MISC_GROUP_ID || members.length >= minGroupSize) continue;

    namesByGroup.delete(id);
    depths.delete(id);

    const misc = namesByGroup.get(MISC_GROUP_ID) ?? [];
    for (const name of members) {
      groupOf.set(name, MISC_GROUP_ID);
      misc.push(name);
    }
    namesByGroup.set(MISC_GROUP_ID, misc);
    depths.set(MISC_GROUP_ID, 0);
  }

  const groups: PrefixGroup[] = [];
  for (const [id, members] of namesByGroup) {
    groups.push({
      id,
      label: id === MISC_GROUP_ID ? MISC_GROUP_LABEL : id,
      count: members.length,
      depth: depths.get(id) ?? 0,
    });
  }

  return { groups: groups.sort(comparePrefixGroups), groupOf };
}

/** Sorts by count desc, then label asc, with the `misc` bucket pinned last. */
function comparePrefixGroups(a: PrefixGroup, b: PrefixGroup): number {
  const aMisc = a.id === MISC_GROUP_ID;
  const bMisc = b.id === MISC_GROUP_ID;
  if (aMisc !== bMisc) return aMisc ? 1 : -1;

  if (a.count !== b.count) return b.count - a.count;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * Tallies the trailing underscore-delimited segment of each metric name.
 *
 * Names without an underscore have no suffix and are skipped entirely; so are names whose
 * trailing segment is empty (e.g. `foo_`). Duplicates and blanks in the input are ignored.
 *
 * Results are sorted by `count` descending, then `label` ascending.
 *
 * @param metricNames Flat list of metric names.
 * @returns Sorted list of {@link SuffixGroup}.
 */
export function computeSuffixGroups(metricNames: string[]): SuffixGroup[] {
  const counts = new Map<string, number>();

  for (const name of normalizeNames(metricNames)) {
    const segments = name.split("_");
    if (segments.length < 2) continue; // no underscore -> no suffix

    const suffix = segments[segments.length - 1];
    if (!suffix) continue;

    counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
  }

  const groups: SuffixGroup[] = [];
  for (const [id, count] of counts) {
    groups.push({ id, label: id, count });
  }

  return groups.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/**
 * Order-independent, multi-term substring search over a metric's name and help text.
 *
 * The raw query is split on any run of characters outside `[a-z0-9_:]` (case-insensitive),
 * empty terms are dropped, and EVERY remaining term must appear (case-insensitively) as a
 * substring of `name + " " + help`. An empty or punctuation-only query matches everything.
 *
 * @param haystackName Metric name.
 * @param haystackHelp Metric help/description text, if any.
 * @param rawQuery Free-text query as typed by the user.
 * @returns `true` when every term matches.
 */
export function matchesSearch(
  haystackName: string,
  haystackHelp: string | undefined,
  rawQuery: string,
): boolean {
  const terms = (rawQuery ?? "")
    .split(/[^a-z0-9_:]+/i)
    .filter((term) => term.length > 0)
    .map((term) => term.toLowerCase());

  if (terms.length === 0) return true;

  const haystack = `${haystackName ?? ""} ${haystackHelp ?? ""}`.toLowerCase();

  return terms.every((term) => haystack.includes(term));
}


