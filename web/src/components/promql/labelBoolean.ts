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

export type LabelMatchOp = "=" | "!=" | "=~" | "!~";

export interface LabelMatch {
  label: string;
  op: LabelMatchOp;
  value: string;
}

export interface BooleanLabelMatch extends LabelMatch {
  /** The OR group; absent or 0 is the base list. */
  group?: number;
  /** Set on every matcher of a negated group. */
  negate?: boolean;
}

export type CompiledLabelFilters =
  { ok: true; branches: LabelMatch[][] } | { ok: false; branchCount: number };

export const MAX_FILTER_BRANCHES = 16;

/** Grouped matchers compiled at all; merging can fold many into few, but every card pays for the work. */
export const MAX_GROUPED_MATCHERS = MAX_FILTER_BRANCHES * 16;

export const INVERSE: Record<LabelMatchOp, LabelMatchOp> = {
  "=": "!=",
  "!=": "=",
  "=~": "!~",
  "!~": "=~",
};

const matchKey = (m: LabelMatch) => `${m.label}\u0000${m.op}\u0000${m.value}`;

const branchKey = (branch: LabelMatch[]) => branch.map(matchKey).sort().join("\u0001");

const plain = (m: LabelMatch): LabelMatch => ({ label: m.label, op: m.op, value: m.value });

/** True when any matcher sits in an OR group, i.e. the list is more than a plain AND. */
export const hasFilterGroups = (matchers: ReadonlyArray<{ group?: number }>): boolean =>
  matchers.some((m) => (m.group ?? 0) > 0);

/** Escapes a literal so it matches only itself inside an RE2 pattern. */
export const escapeRegexLiteral = (value: string): string =>
  value.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");

/** The groups in ascending order, each with its matchers and negation. */
export function filterGroupsOf<T extends { group?: number; negate?: boolean }>(
  matchers: T[],
): { group: number; negate: boolean; members: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const m of matchers) {
    const group = m.group ?? 0;
    if (group <= 0) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(m);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([group, members]) => ({ group, negate: members.some((m) => !!m.negate), members }));
}

const dedupeWithin = (branch: LabelMatch[]): LabelMatch[] => {
  const seen = new Set<string>();
  return branch.filter((m) => {
    const key = matchKey(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const dedupeBranches = (branches: LabelMatch[][]): LabelMatch[][] => {
  const seen = new Set<string>();
  return branches.filter((branch) => {
    const key = branchKey(branch);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** `$` may be a dashboard variable, which regex escaping would break. */
const mergeable = (m: LabelMatch | undefined): m is LabelMatch =>
  !!m && m.op === "=" && !m.value.includes("$");

/** Folds branches that differ only in one label's `=` value into one `=~` alternation. */
const mergeOnLabel = (branches: LabelMatch[][], label: string): LabelMatch[][] => {
  const buckets = new Map<string, { branch: LabelMatch[]; values: Set<string> }>();
  const out: Array<LabelMatch[] | { branch: LabelMatch[]; values: Set<string> }> = [];
  for (const branch of branches) {
    const on = branch.filter((m) => m.label === label);
    if (on.length !== 1 || !mergeable(on[0])) {
      out.push(branch);
      continue;
    }
    const sig = branchKey(branch.filter((m) => m !== on[0]));
    const bucket = buckets.get(sig);
    if (bucket) {
      bucket.values.add(on[0].value);
      continue;
    }
    const created = { branch, values: new Set([on[0].value]) };
    buckets.set(sig, created);
    out.push(created);
  }
  return out.map((entry) => {
    if (Array.isArray(entry)) return entry;
    if (entry.values.size === 1) return entry.branch;
    const alternation = `(?:${[...entry.values].map(escapeRegexLiteral).join("|")})`;
    return entry.branch.map((m) =>
      m.label === label ? { label, op: "=~" as const, value: alternation } : m,
    );
  });
};

/** Merges branches label by label, in label order so the result is deterministic. */
export function mergeBranches(branches: LabelMatch[][]): LabelMatch[][] {
  const labels = [...new Set(branches.flat().map((m) => m.label))].sort();
  return labels.reduce(mergeOnLabel, dedupeBranches(branches));
}

/** Base AND (group1 OR group2 ...) as OR-of-AND branches, NOT pushed down by De Morgan; the engine rejects or-matchers, so callers union branches with `or`. */
export function compileLabelFilters(matchers: BooleanLabelMatch[]): CompiledLabelFilters {
  const base = matchers.filter((m) => (m.group ?? 0) <= 0).map(plain);
  if (!hasFilterGroups(matchers)) return { ok: true, branches: [base] };

  const groups = filterGroupsOf(matchers);
  const grouped = groups.reduce((n, { members }) => n + members.length, 0);
  if (grouped > MAX_GROUPED_MATCHERS) {
    const expanded = groups.reduce((n, g) => n + (g.negate ? g.members.length : 1), 0);
    return { ok: false, branchCount: expanded };
  }

  const disjuncts: LabelMatch[][] = [];
  for (const { negate, members } of groups) {
    if (negate) {
      members.forEach((m) => disjuncts.push([{ ...plain(m), op: INVERSE[m.op] }]));
    } else {
      disjuncts.push(members.map(plain));
    }
  }
  const branches = mergeBranches(disjuncts.map((d) => dedupeWithin([...base, ...d])));
  if (branches.length > MAX_FILTER_BRANCHES) return { ok: false, branchCount: branches.length };
  return { ok: true, branches };
}
