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

/**
 * The health scalar — "which instance needs attention first", as opposed to
 * "which instance is busiest", which the `load` column already answers.
 *
 * `load` sorts `total_time_ns`: cumulative client-observed wait. That is
 * VOLUME. An instance serving ten times the traffic outranks a saturated one
 * that is melting, so a fleet ranked by it answers the wrong question on
 * arrival. This module ranks by how close an instance is to a CEILING.
 *
 * Three rules, and each one is a thing the obvious version gets wrong:
 *
 *  • It is a MAX over saturation ratios, not a weighted composite. A weighted
 *    score needs coefficients nobody can defend, and a user who cannot explain
 *    why a row is at the top will not act on it. A max is explainable in one
 *    sentence — "this is the ratio that is worst" — which is why the scalar
 *    also names which ratio won.
 *
 *  • It is only ever a ratio of a measurement to a PUBLISHED limit. Today that
 *    is exactly one input: connection saturation. Cache hit is a quality
 *    fraction, not a distance to a ceiling — a 60% hit rate is not "60% full".
 *    Replication lag has no denominator in either of the two units the engines
 *    report it in. Deadlocks is a count. Dividing any of them by something to
 *    make a percentage would be an invented ceiling, so none of them are here.
 *    The shape is a list so a genuine second ratio can join without a rewrite.
 *
 *  • Unknown health sorts to the TOP, never the bottom. Every MySQL instance
 *    is permanently unknown — mysqlreceiver publishes no `max_connections`, so
 *    `connectionSaturation` can only ever return `no-limit` — and so is every
 *    instance behind a pooler, every unreadable stream and every row on an
 *    install with the join off. A descending sort that buries all of those
 *    below the healthy instances answers "which needs attention first" with a
 *    row we can see, while the ones we cannot see are the actual risk.
 *
 * The scalar deliberately does NOT fall back to the raw connection count when
 * there is no limit. Ranking a 400-connection MySQL host against a Postgres
 * host at 99% of its limit compares a count with a share; they are not the
 * same kind of number and one column cannot hold both.
 */

import type { DbmRowMetrics } from "./instanceMetrics";

/** Which ratio produced the figure, so the cell can say it beside the number. */
export type DbmHealthDriver = "connections";

export interface DbmHealthScalar {
  /**
   * `measured` — a ratio against a published limit.
   * `no-limit`  — a reading arrived but the engine publishes no ceiling.
   * `absent`    — no reading at all: unmatched, unread, or never asked for.
   */
  state: "measured" | "no-limit" | "absent";
  /** Uncapped: over the limit is exactly the thing worth ranking first. */
  ratio: number | null;
  driver: DbmHealthDriver | null;
}

/**
 * The two sort tiers: unknown health ranks ABOVE every measured ratio.
 *
 * A saturation ratio is uncapped, so no "big enough" constant could sit above
 * the measured tier — an instance at 400% of its limit is a real reading.
 * Instead `healthSortValue` squashes every measured ratio into [0, 1) via
 * r/(1+r), which preserves the ratios' own order, and the unknown tier sits at
 * exactly 1 — above the whole measured range by construction, with every
 * return finite.
 */
const UNKNOWN_RANK = 1;
const MEASURED_RANK = 0;

/**
 * The candidate ratios. One entry today; the list is the extension point, and
 * a `null` ratio means "this input could not be measured", never "zero".
 */
const saturationRatios = (
  metrics: DbmRowMetrics,
): { driver: DbmHealthDriver; ratio: number | null; hasReading: boolean }[] => [
  {
    driver: "connections",
    ratio: metrics.saturation.state === "measured" ? metrics.saturation.ratio : null,
    // A count with no published ceiling IS a reading — it just cannot be
    // expressed as a share — and that is a different state from silence.
    hasReading: metrics.saturation.state !== "absent",
  },
];

/**
 * The worst saturation ratio on this instance, and which one it was.
 *
 * A row with no metrics at all — the read has not landed, or this is one of
 * the breakdown's child rows — is `absent`, not healthy.
 */
export const healthScalar = (metrics?: DbmRowMetrics): DbmHealthScalar => {
  if (!metrics) return { state: "absent", ratio: null, driver: null };

  const candidates = saturationRatios(metrics);
  let worst: { driver: DbmHealthDriver; ratio: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.ratio === null || !Number.isFinite(candidate.ratio)) continue;
    // `>` keeps the earlier candidate on ties; unobservable until a second
    // ratio joins `saturationRatios`.
    if (worst === null || candidate.ratio > worst.ratio) {
      worst = { driver: candidate.driver, ratio: candidate.ratio };
    }
  }
  if (worst) return { state: "measured", ratio: worst.ratio, driver: worst.driver };

  // No ratio. Whether that is "we read a number we cannot divide" or "we read
  // nothing" is the distinction the cell renders differently, so it survives.
  const anyReading = candidates.some((candidate) => candidate.hasReading);
  return { state: anyReading ? "no-limit" : "absent", ratio: null, driver: null };
};

/**
 * The comparable number the table sorts on. Descending is "needs attention
 * first".
 *
 * Two tiers, so an unknown can never be undercut by a measured ratio however
 * large: the tier dominates, and the ratio only breaks ties within the
 * measured tier. Every return is finite, because a NaN or an Infinity in a
 * comparator produces an order that depends on the input's original position.
 */
export const healthSortValue = (metrics?: DbmRowMetrics): number => {
  const scalar = healthScalar(metrics);
  if (scalar.state !== "measured" || scalar.ratio === null) return UNKNOWN_RANK;
  // Squashed into [0, 1) so the whole measured tier sits strictly below the
  // unknown tier no matter how far past its limit an instance has gone, while
  // preserving the order of the ratios themselves.
  return MEASURED_RANK + scalar.ratio / (1 + scalar.ratio);
};
