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
 * Deadlock grouping — the decision that makes this tab a diagnosis rather than
 * a log.
 *
 * The lab produced 43 deadlocks from 2 query pairs. An event list is 43
 * near-identical rows and leaves the reader to notice the repetition; grouping
 * by pair puts the bug on row 1 with its frequency attached. So ROWS are pairs
 * and the TAB BADGE is events — "how much is happening" and "what is wrong" are
 * different questions and each gets the number that answers it.
 */

import type { DeadlockEvent, DeadlockParticipant } from "@/services/db_monitoring";

import { oneLine } from "./format";

/**
 * Accept one wire event.
 *
 * The server sends the assembled DTO — `participants` is already an array, the
 * victim verdict is already applied per side, and MySQL's per-transaction
 * entries are already stitched into whole deadlocks. So this is a GUARD, not a
 * decoder: it rejects an event with no sides, because a deadlock with no
 * participants is not something the UI can say anything true about.
 *
 * The decoding this function used to do (parsing the JSON-string participants
 * column, re-deriving `objects` with a regex, merging MySQL sides by timestamp)
 * moved into `api.rs`. Client-side stitching could only ever see the rows that
 * fitted in the response limit, so it split deadlocks at the page boundary; the
 * server sees the whole window.
 */
export const parseDeadlockEvent = (hit: DeadlockEvent): DeadlockEvent | null => {
  if (!Array.isArray(hit.participants) || hit.participants.length === 0) return null;
  return hit;
};

export const parseDeadlockEvents = (hits: DeadlockEvent[]): DeadlockEvent[] =>
  hits
    .map(parseDeadlockEvent)
    .filter((e): e is DeadlockEvent => e !== null)
    // Newest first. The server already sorts this way; re-sorting keeps the
    // table's contract local rather than depending on response order.
    .sort((a, b) => b.timestamp - a.timestamp);

/** One query pair, with every event it produced. */
export interface DeadlockPair {
  /** Order-independent key — A⇄B and B⇄A are the same bug. */
  pairKey: string;
  /** Events in this pair, newest first. */
  events: DeadlockEvent[];
  /** How many times this pair deadlocked. */
  count: number;
  /** Share of all deadlocks in the window, 0–1. */
  share: number;
  firstSeen: number;
  lastSeen: number;
  db_system: string;
  db_instance?: string | null;
  /** The tables both sides fought over. */
  objects: string[];
  /** The two statements, in the order they are displayed. */
  queries: [string, string];
  /** The applications on each side, deduped and display-ordered. */
  applications: string[];
  /**
   * Neither side is consistently the victim. That alternation is the signature
   * of a symmetric lock-ordering bug and is invisible in any single event.
   */
  victimAlternates: boolean;
  /** How many times each participant pid was the cancelled side. */
  victimCounts: Record<string, number>;
}

/**
 * Normalize a statement enough that two runs of the same query collapse, while
 * the row VALUES stay — `id = 2` vs `id = 1` IS the finding here, so the usual
 * parameter-stripping normalization would erase exactly what the reader needs.
 * Only whitespace, trailing punctuation and comments go.
 */
export const normalizeDeadlockQuery = (query: string | null | undefined): string =>
  oneLine(query ?? "")
    .replace(/\/\*.*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[;\s]+$/, "")
    .trim();

/**
 * The pair key. Sorted so the two orderings of the same collision land in one
 * group, and scoped by engine+instance so an identical statement on two
 * databases stays two findings.
 */
export const deadlockPairKey = (event: DeadlockEvent): string => {
  const queries = event.participants
    .map((p) => normalizeDeadlockQuery(p.query))
    .filter(Boolean)
    .sort();
  const scope = `${event.db_system} ${event.db_instance ?? ""}`;
  // With no statements captured the log only proved a deadlock happened, so
  // every such event on one database is one "queries not captured" group
  // rather than N singleton rows that all say nothing.
  if (!queries.length) return `${scope} <no-queries>`;
  return `${scope} ${queries.join(" ")}`;
};

const participantLabel = (p: DeadlockParticipant): string =>
  p.application?.trim() || (p.pid != null ? String(p.pid) : "");

/**
 * Group events into pairs, ranked by how often each pair fired. `share` is over
 * the events GROUPED HERE, not over `response.total` — when the server capped
 * the row list, a share against an uncapped total would not add to 100%.
 */
export const groupDeadlocks = (events: DeadlockEvent[]): DeadlockPair[] => {
  const byKey = new Map<string, DeadlockEvent[]>();
  for (const event of events) {
    const key = deadlockPairKey(event);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(event);
    else byKey.set(key, [event]);
  }

  const total = events.length;

  const pairs: DeadlockPair[] = [];
  for (const [pairKey, bucket] of byKey) {
    const sorted = [...bucket].sort((a, b) => b.timestamp - a.timestamp);
    const newest = sorted[0];

    const victimCounts: Record<string, number> = {};
    for (const event of sorted) {
      for (const p of event.participants) {
        if (!p.victim || p.pid == null) continue;
        const id = String(p.pid);
        victimCounts[id] = (victimCounts[id] ?? 0) + 1;
      }
    }
    const losses = Object.values(victimCounts);
    // Both sides lost at least once: no single application is "the problem",
    // the ordering is.
    const victimAlternates = losses.length > 1;

    const objects = [...new Set(sorted.flatMap((e) => e.objects ?? []))];
    const applications = [...new Set(newest.participants.map(participantLabel).filter(Boolean))];
    const queries = newest.participants.map((p) => normalizeDeadlockQuery(p.query));

    pairs.push({
      pairKey,
      events: sorted,
      count: sorted.length,
      share: total > 0 ? sorted.length / total : 0,
      firstSeen: sorted[sorted.length - 1].timestamp,
      lastSeen: newest.timestamp,
      db_system: newest.db_system,
      db_instance: newest.db_instance,
      objects,
      queries: [queries[0] ?? "", queries[1] ?? ""],
      applications,
      victimAlternates,
      victimCounts,
    });
  }

  // Frequency first; a tie breaks on recency, so of two equally common bugs the
  // one still happening sorts above the one that stopped.
  return pairs.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
};

/** The cancelled side of an event, if the log said which. */
export const victimOf = (event: DeadlockEvent): DeadlockParticipant | null =>
  event.participants.find((p) => p.victim) ?? null;

/** The side allowed to finish. */
export const survivorOf = (event: DeadlockEvent): DeadlockParticipant | null =>
  event.participants.find((p) => !p.victim) ?? null;

/**
 * Two statements touch the same object with their row predicates transposed —
 * the classic lock-ordering bug, and the one finding that tells the reader the
 * fix is in their code rather than in the database.
 */
export const hasOppositeRowOrder = (pair: DeadlockPair): boolean => {
  const [a, b] = pair.queries;
  if (!a || !b || a === b) return false;

  // Only WHERE predicates identify the ROW; a `SET balance = balance - 1`
  // assignment is the same on both sides and would otherwise be read as a key.
  const predicatesOf = (q: string) => {
    const where = q.split(/\bwhere\b/i)[1];
    if (!where) return null;
    return (where.match(/=\s*'?([\w.-]+)'?/g) ?? []).map((m) => m.replace(/^=\s*/, "").trim());
  };

  const pa = predicatesOf(a);
  const pb = predicatesOf(b);
  if (!pa?.length || !pb?.length || pa.length !== pb.length) return false;

  // The two sides must be the SAME statement apart from the row they name —
  // otherwise two unrelated queries that happen to filter on one column each
  // would read as a lock-ordering bug.
  const shapeOf = (q: string) => q.replace(/=\s*'?[\w.-]+'?/g, "= ?").toLowerCase();
  if (shapeOf(a) !== shapeOf(b)) return false;

  // Same statement, different rows: each side reaches for what the other holds.
  return pa.join("|") !== pb.join("|");
};

/**
 * The interval between events, seconds, when the pair fires on a steady cadence.
 * `null` for a burst or a single event — "every 20s" is only worth saying when
 * it is actually periodic, and a mean over a bursty series would be a lie.
 */
export const deadlockCadenceSeconds = (pair: DeadlockPair): number | null => {
  if (pair.count < 3) return null;
  const stamps = pair.events.map((e) => e.timestamp).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) gaps.push((stamps[i] - stamps[i - 1]) / 1_000_000);
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (mean <= 0) return null;
  const spread = Math.sqrt(gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length);
  // Coefficient of variation under 0.5 reads as a cadence rather than a burst.
  return spread / mean < 0.5 ? Math.round(mean) : null;
};

/** Deadlocks per minute across the window — the storm-vs-trickle number. */
export const deadlockRatePerMinute = (eventCount: number, rangeMinutes: number): number | null =>
  rangeMinutes > 0 ? eventCount / rangeMinutes : null;

/**
 * A storm is a rate high enough that VOLUME is the story rather than the pair.
 * At 0.5/min a responder is reading rows; at 40/hour the banner has to say
 * "this is not normal" before they start.
 */
export const STORM_PER_MINUTE = 0.5;

/**
 * Floor on absolute count, so a short window cannot reach the storm rate on a
 * handful of events — two deadlocks in a three-minute range is a rate of 0.66,
 * and calling that a storm would cry wolf.
 */
export const STORM_MIN_EVENTS = 10;

/**
 * `truncated` is what keeps this honest at the cap. A capped read hands over a
 * count the CAP chose, not one the databases produced, so the rate computed
 * from it is a floor — and on a wide window that floor lands under the bar
 * during exactly the storm this exists to catch. A capped read that still
 * clears the volume floor is therefore a storm regardless of its apparent rate.
 */
export const isDeadlockStorm = (
  eventCount: number,
  rangeMinutes: number,
  truncated?: boolean,
): boolean => {
  if (eventCount < STORM_MIN_EVENTS) return false;
  if (truncated) return true;
  const rate = deadlockRatePerMinute(eventCount, rangeMinutes);
  return rate != null && rate >= STORM_PER_MINUTE;
};

/**
 * Share of the window's deadlocks a single pair must own to earn the red rail.
 * Above half, the pair IS the problem; below it, highlighting one row would
 * misdirect a responder away from the spread.
 */
export const DEADLOCK_DOMINANT_SHARE = 0.5;
