// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { acceptOutcome, planStream } from "./entities";
import {
  UEBA_THRESHOLDS,
  UEBA_WEIGHTS,
  buildProfiles,
  hoursSql,
  ipsSql,
  scoreAll,
  scoreUser,
  toneOfRisk,
  type HourHit,
  type IpHit,
} from "./ueba";

const H = 3_600_000_000;
// Last 24h against the 7 days before.
const W = { currentStart: 7 * 24 * H, currentEnd: 8 * 24 * H, baselineStart: 0 };
// Last 1h against the 24h before.
const W1 = { currentStart: 24 * H, currentEnd: 25 * H, baselineStart: 0 };

const hour = (user: string, h: number, n: number, fail = 0, first = 1): HourHit => ({
  zo_user: user,
  zo_hour: h,
  zo_n: n,
  zo_fail: fail,
  zo_first: first,
});
const ip = (user: string, addr: string, n: number, fail = 0): IpHit => ({
  zo_user: user,
  zo_ip: addr,
  zo_n: n,
  zo_fail: fail,
});
const profile = (hours: HourHit[], ips: IpHit[] = []) =>
  buildProfiles([{ stream: "auth", hours, ips }]);

describe("UEBA SQL", () => {
  const plan = acceptOutcome(
    planStream("auth", ["_timestamp", "user", "src_ip", "outcome"], null),
    [{ value: "success", n: 1 }],
  );

  it("aggregates hours and IPs separately so the cap is spent where it matters", () => {
    expect(hoursSql(plan, 50000)).toContain(
      "date_part('hour', to_timestamp_micros(_timestamp)) AS zo_hour",
    );
    expect(hoursSql(plan, 50000)).toMatch(/GROUP BY zo_user, zo_hour/);
    expect(ipsSql(plan, 20000)).toMatch(/GROUP BY zo_user, zo_ip ORDER BY zo_n DESC LIMIT 20000$/);
  });

  it("has no IP aggregate for a stream without an IP column", () => {
    expect(ipsSql(planStream("x", ["_timestamp", "user"], null), 10)).toBeNull();
  });
});

describe("scoring", () => {
  const baseline = profile(
    [hour("alice", 9, 70, 2), hour("alice", 10, 70, 1)],
    [ip("alice", "10.0.1.5", 140, 3)],
  ).get("alice")!;

  it("totals come from the hours aggregate", () => {
    expect(baseline.events).toBe(140);
    expect(baseline.ips.get("10.0.1.5")!.events).toBe(140);
  });

  it("stays quiet for a user behaving as usual", () => {
    const current = profile([hour("alice", 9, 20, 1)], [ip("alice", "10.0.1.5", 20, 1)]).get(
      "alice",
    )!;
    const risk = scoreUser(current, baseline, W);
    expect(risk.signals).toEqual([]);
    expect(risk.score).toBe(0);
    expect(risk.tone).toBe("info");
  });

  it("explains a spike from a new public IP with failures at an unusual hour", () => {
    const current = profile(
      [hour("alice", 3, 90, 55)],
      [ip("alice", "91.240.118.172", 90, 55)],
    ).get("alice")!;
    const risk = scoreUser(current, baseline, W);
    expect(risk.signals.map((s) => s.kind).sort()).toEqual([
      "failure_jump",
      "new_hours",
      "new_ip",
      "volume",
    ]);
    expect(risk.signals.find((s) => s.kind === "new_ip")!.evidence).toMatchObject({
      ip: "91.240.118.172",
      n: 90,
      external: 1,
    });
    expect(risk.score).toBe(
      Math.min(
        100,
        UEBA_WEIGHTS.volume +
          UEBA_WEIGHTS.new_ip +
          UEBA_WEIGHTS.new_ip_external +
          UEBA_WEIGHTS.failure_jump +
          UEBA_WEIGHTS.new_hours,
      ),
    );
    expect(risk.tone).toBe("critical");
  });

  it("does not call a small count a spike", () => {
    const tiny = profile([hour("bob", 9, 1)]).get("bob")!;
    const now = profile([hour("bob", 9, UEBA_THRESHOLDS.volumeMinEvents - 1)]).get("bob")!;
    expect(scoreUser(now, tiny, W).signals.map((s) => s.kind)).not.toContain("volume");
  });

  it("marks a user absent from the baseline as first seen", () => {
    const [risk] = scoreAll(profile([hour("eve", 12, 9)]), new Map(), W);
    expect(risk.signals.map((s) => s.kind)).toEqual(["first_seen"]);
  });

  it("measures a young history against the span it actually has", () => {
    const young = profile([hour("bob", 9, 20, 0, W.currentStart - 2 * H)]).get("bob")!;
    const now = profile([hour("bob", 3, 25)]).get("bob")!;
    const risk = scoreUser(now, young, W);
    expect(risk.baselineSpanUs).toBe(2 * H);
    expect(risk.signals.map((s) => s.kind)).not.toContain("volume");
    expect(risk.hoursEligible).toBe(false);
    expect(risk.signals.map((s) => s.kind)).not.toContain("new_hours");
  });

  it("can judge unusual hours in the 1h window when the 24h baseline is full", () => {
    const full = profile([hour("dan", 9, 30, 0, 1), hour("dan", 10, 30, 0, 1)]).get("dan")!;
    const now = profile([hour("dan", 3, 5)]).get("dan")!;
    const risk = scoreUser(now, full, W1);
    expect(risk.hoursEligible).toBe(true);
    expect(risk.signals.map((s) => s.kind)).toContain("new_hours");
  });

  it("withholds 'never seen' signals when the baseline aggregate was truncated", () => {
    const current = profile(
      [hour("alice", 3, 90, 55)],
      [ip("alice", "91.240.118.172", 90, 55)],
    ).get("alice")!;
    const ipsCut = scoreUser(current, baseline, W, { hours: true, ips: false });
    expect(ipsCut.signals.map((s) => s.kind)).not.toContain("new_ip");
    expect(ipsCut.withheld).toEqual(["new_ip"]);
    const hoursCut = scoreUser(current, baseline, W, { hours: false, ips: true });
    const kinds = hoursCut.signals.map((s) => s.kind);
    expect(kinds).not.toContain("new_hours");
    expect(kinds).not.toContain("volume");
    expect(hoursCut.hoursEligible).toBe(false);
    const [first] = scoreAll(profile([hour("eve", 12, 9)]), new Map(), W, {
      hours: false,
      ips: true,
    });
    expect(first.signals).toEqual([]);
    expect(first.withheld).toContain("first_seen");
  });

  it("does not call anyone first seen when their source has no baseline at all", () => {
    const current = profile([hour("eve", 12, 9)]);
    const [noHistory] = scoreAll(current, new Map(), W, {
      hours: true,
      ips: true,
      streamsWithHistory: new Set(),
    });
    expect(noHistory.signals).toEqual([]);
    const [withHistory] = scoreAll(current, new Map(), W, {
      hours: true,
      ips: true,
      streamsWithHistory: new Set(["auth"]),
    });
    expect(withHistory.signals.map((s) => s.kind)).toEqual(["first_seen"]);
  });

  it("does not flag an 8-hour worker's normal busy hour in the 1h window", () => {
    // 30 events an hour, 09:00–16:59 UTC, every day: 240 a day.
    const worker = profile(Array.from({ length: 8 }, (_, i) => hour("wendy", 9 + i, 30, 0, 1))).get(
      "wendy",
    )!;
    // Current window: 10:00–11:00 UTC on the day after the 24h baseline.
    const w = { currentStart: 34 * H, currentEnd: 35 * H, baselineStart: 10 * H };
    const now = profile([hour("wendy", 10, 30)]).get("wendy")!;
    const risk = scoreUser(now, worker, w);
    expect(risk.expected).toBeCloseTo(30);
    expect(risk.signals.map((s) => s.kind)).not.toContain("volume");
    // The same 30 events at 03:00, an hour she never works, is a spike.
    const night = { currentStart: 27 * H, currentEnd: 28 * H, baselineStart: 3 * H };
    const at3 = scoreUser(profile([hour("wendy", 3, 30)]).get("wendy")!, worker, night);
    expect(at3.signals.map((s) => s.kind)).toContain("volume");
  });

  it("does not judge sub-day volume without a day of history", () => {
    const young = profile([hour("bob", 9, 20, 0, W1.currentStart - 2 * H)]).get("bob")!;
    const risk = scoreUser(profile([hour("bob", 9, 90)]).get("bob")!, young, W1);
    expect(risk.volumeJudged).toBe(false);
    expect(risk.signals.map((s) => s.kind)).not.toContain("volume");
  });

  it("never compares failure rates against a stream that cannot report failure", () => {
    const base = buildProfiles([
      { stream: "a", hours: [hour("ann", 9, 100, 0)], ips: [], failureKnown: false },
    ]).get("ann")!;
    const now = profile([hour("ann", 9, 20, 15)]).get("ann")!;
    expect(base.failureEvents).toBe(0);
    expect(scoreUser(now, base, W).signals.map((s) => s.kind)).not.toContain("failure_jump");
    // Withheld too when the hours aggregate (which carries the totals) was cut.
    const known = profile([hour("ann", 9, 100, 1)]).get("ann")!;
    const cut = scoreUser(now, known, W, { hours: false, ips: true });
    expect(cut.signals.map((s) => s.kind)).not.toContain("failure_jump");
    expect(cut.withheld).toContain("failure_jump");
  });

  it("maps scores to tones", () => {
    expect([0, 10, 25, 45, 80].map(toneOfRisk)).toEqual([
      "info",
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });
});
