// Copyright 2026 OpenObserve Inc.
//
// ueba.ts — per-user behaviour against that user's own recent past.
//
// Every user is compared with themselves, not with the org: a service account
// that logs in 5,000 times a day is normal, a person who does it once is not.
// The current window is set against a baseline window just before it, and a
// user is flagged only on concrete, explainable differences, each carrying the
// numbers that triggered it. These are heuristics over the chosen windows —
// the page says so — not a trained model.
//
// Input is two GROUP BYs per stream and window — (user, hour of day) and
// (user, source IP) — folded here into profiles; totals come from the hours
// aggregate (at most 24 rows a user). When either is truncated, the signals
// that need every row are withheld rather than guessed. Pure functions only.

import type { SeverityTone } from "./severity";
import { isExternalIp, quoteIdent, type StreamPlan } from "./entities";

/** Tuning knobs. Each guard exists to stop a tiny count from reading as a spike. */
export const UEBA_THRESHOLDS = {
  /** Volume: at least this many events now… */
  volumeMinEvents: 20,
  /** …and at least this multiple of the baseline rate scaled to the window… */
  volumeRatio: 3,
  /** …and a Poisson z-score at least this high. */
  volumeZ: 3,
  /** New IP: this many events from an address the baseline never saw. */
  newIpMinEvents: 3,
  /** Failure jump: at least this many failures now… */
  failureMinCount: 5,
  /** …a failure share at least this high… */
  failureRate: 0.3,
  /** …and at least this much above the baseline share. */
  failureRateDelta: 0.2,
  /** New hours: a profile needs this many baseline events to have "usual hours"… */
  hoursMinBaseline: 20,
  /** …a history covering at least this share of the baseline window… */
  hoursMinSpanShare: 0.9,
  /** …and this many events now in hours the baseline never used. */
  hoursMinEvents: 3,
  /** First seen: a user absent from the baseline with at least this many events. */
  firstSeenMinEvents: 5,
};

/** Points each signal adds to the 0–100 risk score. */
export const UEBA_WEIGHTS = {
  volume: 30,
  new_ip: 20,
  new_ip_external: 10,
  failure_jump: 25,
  new_hours: 15,
  first_seen: 20,
};

export type UebaSignalKind = "volume" | "new_ip" | "failure_jump" | "new_hours" | "first_seen";

export interface UebaSignal {
  kind: UebaSignalKind;
  weight: number;
  /** Named values for the reason text. */
  evidence: Record<string, string | number>;
}

export interface UserProfile {
  user: string;
  events: number;
  failures: number;
  /** Events from streams that can report failure — the failure rate's denominator. */
  failureEvents: number;
  /** Per source IP: events and failures. Empty when no stream has an IP column. */
  ips: Map<string, { events: number; failures: number }>;
  /** Events per hour of day (UTC, 0–23). */
  hours: Map<number, number>;
  streams: Set<string>;
  /** Earliest event in the window, µs; how much history the baseline really has. */
  firstSeen: number;
}

export interface HourHit {
  zo_user: unknown;
  zo_hour: unknown;
  zo_n: unknown;
  zo_fail: unknown;
  zo_first?: unknown;
}

export interface IpHit {
  zo_user: unknown;
  zo_ip: unknown;
  zo_n: unknown;
  zo_fail: unknown;
}

const userPresent = (user: string) =>
  `${quoteIdent(user)} IS NOT NULL AND CAST(${quoteIdent(user)} AS VARCHAR) != ''`;
const failSum = (plan: StreamPlan) =>
  plan.failure ? `SUM(CASE WHEN ${plan.failure} THEN 1 ELSE 0 END)` : "0";

/** user × hour of day, with totals. Null when the stream has no user column. */
export function hoursSql(plan: StreamPlan, limit: number): string | null {
  const user = plan.columns.user;
  if (!user) return null;
  return (
    `SELECT CAST(${quoteIdent(user)} AS VARCHAR) AS zo_user, ` +
    `date_part('hour', to_timestamp_micros(_timestamp)) AS zo_hour, COUNT(*) AS zo_n, ` +
    `${failSum(plan)} AS zo_fail, MIN(_timestamp) AS zo_first ` +
    `FROM ${quoteIdent(plan.stream)} WHERE ${userPresent(user)} ` +
    `GROUP BY zo_user, zo_hour ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

/** user × source IP. Null when the stream lacks a user or an IP column. */
export function ipsSql(plan: StreamPlan, limit: number): string | null {
  const user = plan.columns.user;
  const ip = plan.columns.ip;
  if (!user || !ip) return null;
  return (
    `SELECT CAST(${quoteIdent(user)} AS VARCHAR) AS zo_user, CAST(${quoteIdent(ip)} AS VARCHAR) AS zo_ip, ` +
    `COUNT(*) AS zo_n, ${failSum(plan)} AS zo_fail ` +
    `FROM ${quoteIdent(plan.stream)} WHERE ${userPresent(user)} AND ${quoteIdent(ip)} IS NOT NULL ` +
    `AND CAST(${quoteIdent(ip)} AS VARCHAR) != '' ` +
    `GROUP BY zo_user, zo_ip ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

function blank(user: string): UserProfile {
  return {
    user,
    events: 0,
    failures: 0,
    failureEvents: 0,
    ips: new Map(),
    hours: new Map(),
    streams: new Set(),
    firstSeen: Number.POSITIVE_INFINITY,
  };
}

/** Folds the two aggregates from any number of streams into one profile per user. */
export function buildProfiles(
  perStream: { stream: string; hours: HourHit[]; ips: IpHit[]; failureKnown?: boolean }[],
): Map<string, UserProfile> {
  const profiles = new Map<string, UserProfile>();
  const get = (user: string) => {
    const p = profiles.get(user) ?? blank(user);
    profiles.set(user, p);
    return p;
  };
  for (const { stream, hours, ips, failureKnown = true } of perStream) {
    for (const hit of hours) {
      const user = String(hit.zo_user ?? "");
      if (!user) continue;
      const n = Number(hit.zo_n ?? 0) || 0;
      const p = get(user);
      p.events += n;
      if (failureKnown) {
        p.failures += Number(hit.zo_fail ?? 0) || 0;
        p.failureEvents += n;
      }
      p.streams.add(stream);
      const hour = Number(hit.zo_hour);
      if (Number.isFinite(hour)) p.hours.set(hour, (p.hours.get(hour) ?? 0) + n);
      const first = Number(hit.zo_first);
      if (Number.isFinite(first) && first > 0) p.firstSeen = Math.min(p.firstSeen, first);
    }
    for (const hit of ips) {
      const user = String(hit.zo_user ?? "");
      const ip = String(hit.zo_ip ?? "");
      if (!user || !ip) continue;
      const p = get(user);
      const cur = p.ips.get(ip) ?? { events: 0, failures: 0 };
      p.ips.set(ip, {
        events: cur.events + (Number(hit.zo_n ?? 0) || 0),
        failures: cur.failures + (Number(hit.zo_fail ?? 0) || 0),
      });
    }
  }
  return profiles;
}

export interface UebaWindows {
  /** Current window, µs. */
  currentStart: number;
  currentEnd: number;
  /** Baseline window start, µs; it ends where the current window starts. */
  baselineStart: number;
}

// Which baseline aggregates came back whole: a truncated one lacks the rare rows
// "never seen before" depends on, so its signals are withheld, not guessed.
export interface BaselineCompleteness {
  hours: boolean;
  ips: boolean;
  /** Streams with any baseline data; without one, "first seen" means a new source. Omitted = all. */
  streamsWithHistory?: Set<string>;
}

export interface UserRisk {
  user: string;
  score: number;
  tone: SeverityTone;
  signals: UebaSignal[];
  current: UserProfile;
  baseline: UserProfile | null;
  /** Baseline events scaled to the current window's length. */
  expected: number;
  /** History the baseline actually covered, µs (≤ the baseline window). */
  baselineSpanUs: number;
  /** Whether "volume spike" could be judged (sub-day windows need a day of history). */
  volumeJudged: boolean;
  /** Whether "unusual hours" could be judged for this user at all. */
  hoursEligible: boolean;
  /** Signals not evaluated because the baseline data behind them was incomplete. */
  withheld: UebaSignalKind[];
}

export function toneOfRisk(score: number): SeverityTone {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  if (score > 0) return "low";
  return "info";
}

// The baseline a user really has: from their first event in it, not the window
// start — else a young source makes everyone look like a spike.
export function baselineSpanUs(baseline: UserProfile | null, w: UebaWindows): number {
  if (!baseline || !Number.isFinite(baseline.firstSeen)) return 0;
  return w.currentStart - Math.max(w.baselineStart, baseline.firstSeen);
}

const pct = (x: number) => Math.round(x * 100);
const DAY_US = 24 * 3_600_000_000;
const HOUR_US = 3_600_000_000;

/** How much of each UTC hour-of-day a window under a day covers (0–1). */
export function hourCoverage(startUs: number, endUs: number): Map<number, number> {
  const cover = new Map<number, number>();
  for (let t = startUs; t < endUs;) {
    const hourStart = Math.floor(t / HOUR_US) * HOUR_US;
    const next = Math.min(endUs, hourStart + HOUR_US);
    const h = new Date(t / 1000).getUTCHours();
    cover.set(h, (cover.get(h) ?? 0) + (next - t) / HOUR_US);
    t = next;
  }
  return cover;
}

// Expected events now. A day or longer scales the whole baseline; a shorter window
// uses the same hours of day (a worker's busy hour is no spike) and needs a day of history.
export function expectedVolume(
  baseline: UserProfile | null,
  w: UebaWindows,
  span: number,
): { expected: number; judged: boolean } {
  const currentLen = w.currentEnd - w.currentStart;
  if (!baseline) return { expected: 0, judged: false };
  if (currentLen >= DAY_US) {
    // Never divide by less than one window: a short baseline must not inflate this.
    return { expected: baseline.events * (currentLen / Math.max(span, currentLen)), judged: true };
  }
  if (span < UEBA_THRESHOLDS.hoursMinSpanShare * DAY_US) return { expected: 0, judged: false };
  const days = Math.max(1, span / DAY_US);
  let expected = 0;
  for (const [h, share] of hourCoverage(w.currentStart, w.currentEnd)) {
    expected += ((baseline.hours.get(h) ?? 0) / days) * share;
  }
  return { expected, judged: true };
}
const COMPLETE: BaselineCompleteness = { hours: true, ips: true };

/** Scores one user against their own baseline. */
export function scoreUser(
  current: UserProfile,
  baseline: UserProfile | null,
  w: UebaWindows,
  complete: BaselineCompleteness = COMPLETE,
): UserRisk {
  const T = UEBA_THRESHOLDS;
  const signals: UebaSignal[] = [];
  const withheld: UebaSignalKind[] = [];
  const baselineLen = w.currentStart - w.baselineStart;
  const span = baselineSpanUs(baseline, w);
  const volume = expectedVolume(baseline, w, span);
  const expected = volume.expected;
  const hoursEligible =
    complete.hours &&
    !!baseline &&
    baseline.events >= T.hoursMinBaseline &&
    span >= T.hoursMinSpanShare * baselineLen;

  // Totals and hours come from the hours aggregate; if it was cut short,
  // "absent from the baseline" and volume are not facts.
  if (!complete.hours) withheld.push("first_seen", "volume", "new_hours", "failure_jump");
  if (!complete.ips) withheld.push("new_ip");

  const hasHistory =
    !complete.streamsWithHistory ||
    [...current.streams].some((s) => complete.streamsWithHistory!.has(s));

  if (!baseline || baseline.events === 0) {
    if (complete.hours && hasHistory && current.events >= T.firstSeenMinEvents) {
      signals.push({
        kind: "first_seen",
        weight: UEBA_WEIGHTS.first_seen,
        evidence: { n: current.events },
      });
    }
  } else {
    // Volume against the user's own scaled baseline, with a Poisson z-score so a
    // jump from 1 to 4 is not treated like a jump from 100 to 400.
    const floor = Math.max(expected, 1);
    const z = (current.events - floor) / Math.sqrt(floor);
    if (
      complete.hours &&
      volume.judged &&
      current.events >= T.volumeMinEvents &&
      current.events >= T.volumeRatio * floor &&
      z >= T.volumeZ
    ) {
      signals.push({
        kind: "volume",
        weight: UEBA_WEIGHTS.volume,
        evidence: {
          n: current.events,
          expected: Math.max(1, Math.round(expected)),
          ratio: Math.round((current.events / floor) * 10) / 10,
        },
      });
    }

    if (complete.ips && baseline.ips.size) {
      const newIps = [...current.ips.entries()]
        .filter(([ip, c]) => !baseline.ips.has(ip) && c.events >= T.newIpMinEvents)
        .sort((a, b) => b[1].events - a[1].events);
      if (newIps.length) {
        const external = newIps.some(([ip]) => isExternalIp(ip));
        const [topIp, top] = newIps[0];
        signals.push({
          kind: "new_ip",
          weight: UEBA_WEIGHTS.new_ip + (external ? UEBA_WEIGHTS.new_ip_external : 0),
          evidence: { ip: topIp, n: top.events, count: newIps.length, external: external ? 1 : 0 },
        });
      }
    }

    // Both windows need failure-capable events, or "up from 0%" is invented.
    const rate = current.failureEvents ? current.failures / current.failureEvents : 0;
    const baseRate = baseline.failureEvents ? baseline.failures / baseline.failureEvents : 0;
    if (
      complete.hours &&
      current.failureEvents > 0 &&
      baseline.failureEvents > 0 &&
      current.failures >= T.failureMinCount &&
      rate >= T.failureRate &&
      rate - baseRate >= T.failureRateDelta
    ) {
      signals.push({
        kind: "failure_jump",
        weight: UEBA_WEIGHTS.failure_jump,
        evidence: { n: current.failures, rate: pct(rate), baseline: pct(baseRate) },
      });
    }

    if (hoursEligible) {
      const newHours = [...current.hours.entries()].filter(([h]) => !baseline.hours.has(h));
      const inNewHours = newHours.reduce((sum, [, n]) => sum + n, 0);
      if (inNewHours >= T.hoursMinEvents) {
        signals.push({
          kind: "new_hours",
          weight: UEBA_WEIGHTS.new_hours,
          evidence: {
            n: inNewHours,
            hours: newHours
              .map(([h]) => h)
              .sort((a, b) => a - b)
              .map((h) => `${String(h).padStart(2, "0")}:00`)
              .join(", "),
          },
        });
      }
    }
  }

  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.weight, 0),
  );
  return {
    user: current.user,
    score,
    tone: toneOfRisk(score),
    signals,
    current,
    baseline,
    expected,
    volumeJudged: volume.judged,
    baselineSpanUs: span,
    hoursEligible,
    withheld,
  };
}

/** Scores every user active in the current window, riskiest first. */
export function scoreAll(
  current: Map<string, UserProfile>,
  baseline: Map<string, UserProfile>,
  w: UebaWindows,
  complete: BaselineCompleteness = COMPLETE,
): UserRisk[] {
  return [...current.values()]
    .map((p) => scoreUser(p, baseline.get(p.user) ?? null, w, complete))
    .sort((a, b) => b.score - a.score || b.current.events - a.current.events);
}
