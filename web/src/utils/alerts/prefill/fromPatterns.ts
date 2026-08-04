// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Pattern selection → AlertPrefill.
 *
 * The headline case: "alert on my current search, but ignore these two noisy
 * patterns". Include/exclude semantics live in buildPatternSetSqlQuery; this
 * adapter decides what is safe to build and what the user needs told.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { periodMinutesFromRange, sanitizeAlertNamePart, warn, type PrefillTimeRange } from "../alertPrefill";
import {
  MAX_PATTERNS_PER_ALERT,
  buildPatternSetSqlQuery,
  extractConstantsFromPattern,
} from "@/plugins/logs/patterns/patternUtils";

export interface PatternsPrefillInput {
  streamName: string;
  streamType?: string;
  /** Pattern templates the alert should match. */
  includes?: string[];
  /** Pattern templates the alert should ignore. */
  excludes?: string[];
  /**
   * The current search's WHERE fragment. Only meaningful in filter mode — in
   * SQL mode the editor holds a whole statement, which cannot be spliced in, so
   * the caller passes nothing and sets `baseFilterDropped`.
   */
  baseFilter?: string;
  baseFilterDropped?: boolean;
  datetime?: PrefillTimeRange | null;
  timezone?: string;
  /** "count" (the registry default for this source) alerts on how many, not which. */
  select?: "rows" | "count";
}

const usable = (templates: string[]) =>
  templates.filter((t) => extractConstantsFromPattern(t).length > 0);

export const buildPrefillFromPatterns = (input: PatternsPrefillInput): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];

  const streamName = input.streamName?.trim() ?? "";
  if (!streamName) warnings.push(warn("noStream", "blocking"));

  const requestedIncludes = input.includes ?? [];
  const requestedExcludes = input.excludes ?? [];

  // A pattern with no invariant constants has nothing that identifies it — its
  // wildcards are per-log samples, not something to match on. Such patterns are
  // unselectable in the UI; this is the belt-and-braces half.
  const includes = usable(requestedIncludes);
  const excludes = usable(requestedExcludes);
  const droppedCount =
    requestedIncludes.length - includes.length + (requestedExcludes.length - excludes.length);
  if (droppedCount > 0) warnings.push(warn("noConstants", "warning"));

  const total = includes.length + excludes.length;
  if (total === 0) {
    warnings.push(warn("noConstants", "blocking"));
  }

  // Cap the set so the generated SQL stays something a human can read back in
  // the confirm dialog — and say what was left out rather than truncating
  // silently.
  let cappedIncludes = includes;
  let cappedExcludes = excludes;
  if (total > MAX_PATTERNS_PER_ALERT) {
    cappedIncludes = includes.slice(0, MAX_PATTERNS_PER_ALERT);
    cappedExcludes = excludes.slice(0, Math.max(0, MAX_PATTERNS_PER_ALERT - cappedIncludes.length));
    warnings.push(warn("patternLimit", "warning", { max: MAX_PATTERNS_PER_ALERT }));
  }

  const baseFilter = input.baseFilter?.trim();
  if (input.baseFilterDropped) {
    warnings.push(warn("sqlModeFilterDropped", "warning"));
  }

  // Excluding without including anything, over no base filter, means "everything
  // except these" — legitimate, but it matches nearly the whole stream.
  if (!cappedIncludes.length && cappedExcludes.length && !baseFilter) {
    warnings.push(warn("broadMatch", "warning"));
  }

  const select = input.select ?? "count";

  const sql = buildPatternSetSqlQuery({
    streamName,
    includes: cappedIncludes,
    excludes: cappedExcludes,
    baseFilter,
    select,
  });

  const { minutes, warnings: rangeWarnings } = periodMinutesFromRange(input.datetime);
  warnings.push(...rangeWarnings);

  const label =
    cappedExcludes.length && !cappedIncludes.length
      ? `${streamName} (${cappedExcludes.length} ignored)`
      : `${streamName} (${cappedIncludes.length} pattern${cappedIncludes.length === 1 ? "" : "s"})`;

  return {
    version: ALERT_PREFILL_VERSION,
    source: "patterns",
    sourceLabel: label,
    name: `Alert_from_${sanitizeAlertNamePart(streamName, "patterns")}_patterns`,
    streamType: input.streamType || "logs",
    streamName,
    queryType: "sql",
    sql,
    thresholdShape: select === "count" ? "count" : "matching-rows",
    aggregation:
      select === "count"
        ? {
            group_by: [],
            function: "count",
            having: { column: "cnt", operator: ">=", value: 1 },
          }
        : null,
    periodMinutes: minutes,
    timezone: input.timezone,
    warnings,
    meta: {
      includedPatterns: cappedIncludes,
      excludedPatterns: cappedExcludes,
    },
  };
};
