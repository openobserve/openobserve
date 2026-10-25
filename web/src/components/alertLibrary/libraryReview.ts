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

import type { AlertLibraryFile } from "@/types/alertLibrary";

import { readTunables } from "./libraryTunables";

/** How many library files a pack review fetches at once. */
export const REVIEW_CONCURRENCY = 4;

const SELECTOR =
  /([A-Za-z_:][A-Za-z0-9_:]*)?\s*\{((?:[^{}"'`]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)*)\}/g;
const MATCHER =
  /([A-Za-z_][A-Za-z0-9_]*)\s*(=~|!~|!=|=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;
const NAME_LABEL = "__name__";

/** One `label="value"` a rule's selector requires on a metric. */
export interface LabelMatcher {
  metric: string;
  label: string;
  value: string;
}

/** Where a pack review sends what it enables. */
export interface ReviewRoutes {
  /** The org default destination, or "" when none is set or it no longer exists. */
  orgDefault: string;
  /** The user's own email destination, or "" when there is none. */
  email: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const unquote = (literal: string): string => {
  const body = literal.slice(1, -1);
  return literal.startsWith("`") ? body : body.replace(/\\(.)/g, "$1");
};

/** The equality matchers with a value in each selector; only these can match nothing on a missing label. */
export const labelMatchers = (expression: string): LabelMatcher[] => {
  if (typeof expression !== "string") return [];
  const found: LabelMatcher[] = [];
  const seen = new Set<string>();
  for (const selector of expression.matchAll(SELECTOR)) {
    const pairs = [...selector[2].matchAll(MATCHER)].map((match) => ({
      label: match[1],
      operator: match[2],
      value: unquote(match[3]),
    }));
    const named = pairs.find((pair) => pair.label === NAME_LABEL && pair.operator === "=");
    const metric = selector[1] ?? named?.value ?? "";
    if (!metric) continue;
    for (const pair of pairs) {
      if (pair.operator !== "=" || pair.label === NAME_LABEL || pair.value === "") continue;
      const key = `${metric}\u0000${pair.label}\u0000${pair.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ metric, label: pair.label, value: pair.value });
    }
  }
  return found;
};

/** Maps every item with at most `limit` calls in flight; a failed item answers undefined. */
export const mapBounded = async <T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> => {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await run(items[index], index);
      } catch {
        results[index] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
};

/** "job hadoop-namenode, env prod": the label and value each missing matcher asks for. */
export const needsDataText = (missing: readonly LabelMatcher[]): string =>
  missing.map((matcher) => `${matcher.label} ${matcher.value}`).join(", ");

/** "up · job=\"hadoop-namenode\"": the streams a rule reads, then the label values it selects. */
export const reviewRequires = (
  streams: readonly string[],
  matchers: readonly LabelMatcher[],
): string =>
  [
    ...streams,
    ...matchers.map((matcher) => `${matcher.label}=${JSON.stringify(matcher.value)}`),
  ].join(" · ");

/** Criticals page the org default; everything else goes only to the user's own email. */
export const reviewDestination = (severity: string, routes: ReviewRoutes): string =>
  severity === "critical" ? routes.orgDefault : routes.email;

/** The email destination that sends to the user alone, by the lowercased address it is stored under. */
export const userEmailDestination = (destinations: readonly unknown[], address: string): string => {
  const wanted = address.trim().toLowerCase();
  if (!wanted) return "";
  for (const item of destinations) {
    const destination = asRecord(item);
    const emails = Array.isArray(destination.emails) ? destination.emails : [];
    if (
      destination.type === "email" &&
      typeof destination.name === "string" &&
      emails.length === 1 &&
      String(emails[0]).trim().toLowerCase() === wanted
    ) {
      return destination.name;
    }
  }
  return "";
};

/** The rule's firing condition in the form the library drawer prints it. */
export const reviewThreshold = (file: AlertLibraryFile): string => {
  const tunables = readTunables(file);
  if (tunables.promqlOperator !== null) {
    return `${tunables.promqlOperator} ${tunables.promqlValue ?? 0}`;
  }
  const operator = asRecord(file?.trigger_condition).operator;
  return `${typeof operator === "string" ? operator : ">="} ${tunables.threshold}`;
};
