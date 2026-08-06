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

import { formatDistanceToNowStrict } from "date-fns";

/** Escape a value for embedding inside single-quoted SQL string literals. */
export const escapeSqlString = (value: string): string => value.replaceAll("'", "''");

export interface IssueSignature {
  error_type?: string | null;
  error_message?: string | null;
  error_handling?: string | null;
}

/**
 * Stable identity for an error issue. Issues are grouped by signature
 * (type + message + handling); the NUL separator cannot appear in the fields, so the
 * joined key is collision-free.
 */
export const issueKey = (row: IssueSignature): string =>
  `${row.error_type ?? ""}\u0000${row.error_message ?? ""}\u0000${row.error_handling ?? ""}`;

export interface TopFrame {
  file: string;
  line: number | null;
}

// Matches "path:line" or "path:line:col" at the end of a stack frame line,
// tolerating Chrome ("at fn (url:1:2)"), Firefox ("fn@url:1:2"), and bare
// "at url:1:2" formats.
const FRAME_TAIL = /([^\s()@]+?):(\d+)(?::\d+)?\)?$/;

/**
 * Extract the top (first) stack frame as {file, line} for the issue chip,
 * e.g. "checkout.js:214". Lines without a dot-extension file segment
 * (like "<anonymous>") are skipped. Returns null when nothing parses.
 */
export const parseTopFrame = (stack?: string | null): TopFrame | null => {
  if (!stack) return null;
  for (const rawLine of stack.split("\n")) {
    const match = rawLine.trim().match(FRAME_TAIL);
    if (!match) continue;
    const path = match[1].split("?")[0];
    const file = path.split("/").pop() ?? path;
    // Require a file-looking segment; skips "<anonymous>" and message lines.
    if (!file.includes(".") || file.startsWith("<")) continue;
    return { file, line: Number(match[2]) };
  }
  return null;
};

/** Pathname of the page URL for the route chip, e.g. "/checkout". */
export const routeFromUrl = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).pathname || "/";
  } catch {
    // Not an absolute URL — accept already-relative paths as-is.
    return url.startsWith("/") ? url.split("?")[0] : null;
  }
};

export type IssueStatus = "new" | "ongoing";

/**
 * Derive the issue status. "New" means first seen after the latest deploy;
 * without a detected deploy, an issue counts as new when its first
 * occurrence is clearly inside the window (past the leading 10%), i.e. not
 * an artifact of window truncation.
 *
 * Caveat: firstSeen is MIN(_timestamp) within the query window, so a
 * long-lived issue whose only in-window occurrences are post-deploy will
 * read as "new".
 */
export const computeIssueStatus = (
  firstSeen: number,
  deployTs: number | null,
  windowStart: number,
  windowEnd: number,
): IssueStatus => {
  if (!firstSeen) return "ongoing";
  if (deployTs !== null) return firstSeen >= deployTs ? "new" : "ongoing";
  const span = windowEnd - windowStart;
  if (span <= 0) return "ongoing";
  return firstSeen >= windowStart + span * 0.1 ? "new" : "ongoing";
};

export interface TrendAnnotation {
  kind: "new" | "spike" | "drop" | "flat";
  /** Spike/drop ratio of recent activity vs baseline; null for new/flat. */
  factor: number | null;
}

const SPIKE_FACTOR = 2;
const DROP_FACTOR = 0.5;
/** Buckets treated as "recent" when comparing against the baseline. */
const RECENT_BUCKETS = 4;

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * Classify an issue's trend from its histogram buckets:
 * recent = avg(last 4 buckets), baseline = avg(all earlier buckets),
 * factor = recent / max(baseline, 0.01). "new" status always wins;
 * factor >= 2 → spike, <= 0.5 → drop, otherwise flat.
 */
export const computeTrendAnnotation = (
  buckets: number[] | null,
  status: IssueStatus,
): TrendAnnotation => {
  if (status === "new") return { kind: "new", factor: null };
  if (!buckets || buckets.length <= RECENT_BUCKETS) {
    return { kind: "flat", factor: null };
  }
  const recent = average(buckets.slice(-RECENT_BUCKETS));
  const baseline = average(buckets.slice(0, -RECENT_BUCKETS));
  const factor = recent / Math.max(baseline, 0.01);
  if (factor >= SPIKE_FACTOR) return { kind: "spike", factor };
  if (factor <= DROP_FACTOR) return { kind: "drop", factor };
  return { kind: "flat", factor: null };
};

export interface DeployInfo {
  version: string;
  /** First occurrence of this version within the window (µs). */
  firstSeen: number;
}

/**
 * Pick the deploy to mark on the chart: the newest version whose
 * window-bounded first appearance falls strictly inside the window AND past
 * the first histogram bucket — a version already present at the window edge
 * almost certainly predates the window and would produce a false marker.
 */
export const pickLatestDeploy = (
  deploys: DeployInfo[],
  windowStart: number,
  windowEnd: number,
  bucketMicros: number,
): DeployInfo | null => {
  const threshold = windowStart + bucketMicros;
  const candidates = deploys.filter(
    (deploy) => deploy.firstSeen > threshold && deploy.firstSeen < windowEnd,
  );
  if (!candidates.length) return null;
  return candidates.reduce((latest, deploy) =>
    deploy.firstSeen > latest.firstSeen ? deploy : latest,
  );
};

/** Minimum post/pre ratio for the chart's "spike after deploy" caption. */
const DEPLOY_SPIKE_MIN_FACTOR = 1.5;
/** Caption needs a real baseline: at least this many pre-deploy buckets… */
const DEPLOY_SPIKE_MIN_PRE_BUCKETS = 3;
/** …averaging at least this many errors per bucket. A near-zero baseline
 * turns any post-deploy activity into an absurd ratio ("23× spike" when
 * there simply was no traffic before), so the caption is suppressed. */
const DEPLOY_SPIKE_MIN_BASELINE = 1;

/**
 * Ratio of average total errors after vs before the deploy bucket.
 * Returns null when below the caption threshold, when the pre-deploy
 * baseline is too thin to be meaningful, or when not computable.
 */
export const computeDeploySpikeFactor = (totals: number[], deployIndex: number): number | null => {
  if (deployIndex < DEPLOY_SPIKE_MIN_PRE_BUCKETS || deployIndex >= totals.length) {
    return null;
  }
  const pre = average(totals.slice(0, deployIndex));
  if (pre < DEPLOY_SPIKE_MIN_BASELINE) return null;
  const factor = average(totals.slice(deployIndex)) / pre;
  return factor >= DEPLOY_SPIKE_MIN_FACTOR ? factor : null;
};

/** SQL interval strings produced by getTimeInterval(), e.g. "30 minute". */
const INTERVAL_UNIT_MICROS: Record<string, number> = {
  second: 1_000_000,
  minute: 60 * 1_000_000,
  hour: 3600 * 1_000_000,
  day: 86400 * 1_000_000,
};

/** Convert "5 minute" / "1 hour" style interval strings to microseconds. */
export const intervalToMicros = (interval: string): number => {
  const [count, unit] = interval.trim().split(/\s+/);
  const unitMicros = INTERVAL_UNIT_MICROS[unit?.replace(/s$/, "")] ?? 0;
  const parsed = Number(count) * unitMicros;
  // Fall back to 1 minute rather than dividing by zero downstream.
  return parsed > 0 ? parsed : INTERVAL_UNIT_MICROS.minute;
};

/**
 * Parse a histogram() bucket key into microseconds. OpenObserve returns
 * UTC ISO strings without a timezone suffix ("2026-01-01T10:00:00").
 */
export const histogramKeyToMicros = (key: string | number): number => {
  if (typeof key === "number") return key;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(key);
  const ms = Date.parse(hasZone ? key : `${key}Z`);
  return Number.isNaN(ms) ? 0 : ms * 1000;
};

/** "2 minutes ago" style relative time from a microsecond timestamp. */
export const formatRelativeTime = (timestampMicros: number): string => {
  if (!timestampMicros) return "";
  return formatDistanceToNowStrict(new Date(timestampMicros / 1000), {
    addSuffix: true,
  });
};
