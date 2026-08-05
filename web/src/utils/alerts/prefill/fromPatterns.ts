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
  type AlertPatternMode,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import {
  periodMinutesFromRange,
  sanitizeAlertNamePart,
  warn,
  type PrefillTimeRange,
} from "../alertPrefill";
import {
  buildPatternSetSqlQuery,
  extractConstantsFromPattern,
} from "@/plugins/logs/patterns/patternUtils";

export interface PatternsPrefillInput {
  streamName: string;
  streamType?: string;
  /**
   * The patterns the user can currently see. The severity chips narrow this,
   * which the dialog states explicitly rather than leaving implicit.
   */
  templates?: string[];
  /** Every extracted pattern, for the "N of M" line. */
  totalCount?: number;
  /** True when the severity chips are narrowing the list. */
  filtered?: boolean;
  /** Whether the visible patterns are matched, ignored, or left out. */
  mode?: AlertPatternMode;
  /**
   * Block when no usable pattern is available, instead of quietly falling back
   * to an alert on the bare search. Set by the single-pattern entry point, where
   * the user explicitly named the pattern they meant.
   */
  requirePatterns?: boolean;
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

  const mode: AlertPatternMode = input.mode ?? "exclude";
  const requested = input.templates ?? [];

  // A pattern with no invariant constants has nothing that identifies it — its
  // wildcards are per-log samples, not something to match on.
  const templates = usable(requested);
  if (requested.length && templates.length < requested.length) {
    warnings.push(warn("noConstants", "warning"));
  }

  // With no usable patterns there is nothing to include or exclude, so the alert
  // is simply the user's current search. Degrade to "none" rather than blocking:
  // blocking would stop the user at a dialog to tell them about a choice that
  // does not exist. The single-pattern path opts out via `requirePatterns` —
  // there the user named one pattern, and quietly alerting on the whole stream
  // instead would be wrong rather than merely unhelpful.
  let effectiveMode = mode;
  if (mode !== "none" && !templates.length) {
    if (input.requirePatterns) {
      warnings.push(warn("noConstants", "blocking"));
    } else {
      effectiveMode = "none";
      // Only worth saying when patterns existed but none could be used; a page
      // with no patterns at all needs no explanation.
      if (requested.length) warnings.push(warn("patternsUnusable", "info"));
    }
  }

  const applied = effectiveMode === "none" ? [] : templates;

  // No cap: "exclude all patterns" is only correct if it really is all of them,
  // and silently dropping the tail would produce an alert that still fires on
  // the noise the user asked to ignore.

  const baseFilter = input.baseFilter?.trim();
  if (input.baseFilterDropped) {
    warnings.push(warn("sqlModeFilterDropped", "warning"));
  }

  // Excluding without a base filter means "everything except these" — legitimate
  // but close to the whole stream.
  if (effectiveMode === "exclude" && applied.length && !baseFilter) {
    warnings.push(warn("broadMatch", "warning"));
  }

  const select = input.select ?? "count";

  const sql = buildPatternSetSqlQuery({
    streamName,
    includes: effectiveMode === "include" ? applied : [],
    excludes: effectiveMode === "exclude" ? applied : [],
    baseFilter,
    select,
  });

  const { minutes, warnings: rangeWarnings } = periodMinutesFromRange(input.datetime);
  warnings.push(...rangeWarnings);

  const totalCount = input.totalCount ?? requested.length;
  const modeLabel =
    effectiveMode === "exclude" ? "ignored" : effectiveMode === "include" ? "matched" : "patterns";

  return {
    version: ALERT_PREFILL_VERSION,
    source: "patterns",
    sourceLabel: `${streamName} (${applied.length} ${modeLabel})`,
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
    patternFilter: {
      mode: effectiveMode,
      visibleCount: templates.length,
      totalCount,
      filtered: !!input.filtered,
    },
    warnings,
    meta: {
      appliedPatterns: applied,
    },
  };
};
