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

import { describe, expect, it } from "vitest";
import {
  LIMIT_APPROACHING_PERCENT,
  LIMIT_OVER_PERCENT,
  SIGNAL_VARIANT,
  checkState,
  elapsedParts,
  firingTotal,
  hasKnownSince,
  levelCount,
  limitBarVariant,
  limitStatus,
  mergeTopStreams,
  oldestKnownFiring,
  isUnderOnePercent,
  overviewChecks,
  overviewStatus,
  percentOf,
  percentToFraction,
  sectionView,
  signalSplit,
  signalTotalMb,
  topStreamShares,
} from "./overviewFormat";
import { buildHealthyOverview, buildOverview } from "./overviewFixtures";
import type { OverviewStreamTypeSummary } from "@/ts/interfaces/overview";
import type { AttentionCheck } from "./overviewFormat";

const summary = (stream_type: string, top: Array<[string, number]>): OverviewStreamTypeSummary => ({
  stream_type,
  count: top.length,
  doc_num: 0,
  storage_size_mb: 0,
  compressed_size_mb: 0,
  top: top.map(([name, storage_size_mb]) => ({ name, doc_num: 1, storage_size_mb })),
});

describe("sectionView", () => {
  const idle = { pending: false, failed: false };

  it("maps each status to its own view", () => {
    expect(sectionView({ status: "ok", data: {} }, idle)).toBe("ok");
    expect(sectionView({ status: "error", error: "boom" }, idle)).toBe("error");
    expect(sectionView({ status: "forbidden" }, idle)).toBe("forbidden");
    expect(sectionView({ status: "locked", reason: "x" }, idle)).toBe("locked");
  });

  it("loading wins while the first load is in flight", () => {
    expect(sectionView(undefined, { pending: true, failed: false })).toBe("loading");
  });

  it("treats a failed request or a missing section as an error", () => {
    expect(sectionView({ status: "ok", data: {} }, { pending: false, failed: true })).toBe("error");
    expect(sectionView(undefined, idle)).toBe("error");
    expect(sectionView({ status: "ok" }, idle)).toBe("error");
  });
});

describe("limit helpers", () => {
  it("calls usage out from 75 percent and over the limit from 100", () => {
    expect(LIMIT_APPROACHING_PERCENT).toBe(75);
    expect(LIMIT_OVER_PERCENT).toBe(100);
    expect(limitStatus(74.9)).toBe("ok");
    expect(limitStatus(75)).toBe("approaching");
    expect(limitStatus(99.9)).toBe("approaching");
    expect(limitStatus(100)).toBe("over");
    expect(limitStatus(250)).toBe("over");
  });

  it("picks the bar colour from the same thresholds", () => {
    expect(limitBarVariant(10)).toBe("default");
    expect(limitBarVariant(75)).toBe("warning");
    expect(limitBarVariant(100)).toBe("danger");
  });

  it("clamps the bar fraction", () => {
    expect(percentToFraction(45)).toBe(0.45);
    expect(percentToFraction(250)).toBe(1);
    expect(percentToFraction(-3)).toBe(0);
  });
});

describe("top streams", () => {
  const byType = [
    summary("logs", [
      ["app", 500],
      ["web", 100],
    ]),
    summary("metrics", [["cpu", 900]]),
    summary("traces", [
      ["t1", 50],
      ["t2", 40],
      ["t3", 30],
    ]),
  ];

  it("merges every type, largest first, capped", () => {
    const rows = mergeTopStreams(byType, 4);
    expect(rows.map((r) => `${r.stream_type}/${r.name}`)).toEqual([
      "metrics/cpu",
      "logs/app",
      "logs/web",
      "traces/t1",
    ]);
  });
});

describe("topStreamShares", () => {
  it("takes the six largest streams of every type, with their share of the total", () => {
    const byType = [
      summary("logs", [
        ["a", 400],
        ["b", 300],
        ["c", 5],
      ]),
      summary("metrics", [
        ["d", 200],
        ["e", 100],
      ]),
      summary("index", [
        ["f", 50],
        ["g", 1],
      ]),
    ];
    const rows = topStreamShares(byType, 1000);
    expect(rows.map((r) => r.name)).toEqual(["a", "b", "d", "e", "f", "c"]);
    expect(rows.map((r) => r.percent)).toEqual([40, 30, 20, 10, 5, 1]);
    expect(rows[5].underOne).toBe(true);
    expect(rows[0].underOne).toBe(false);
  });

  it("scales each bar to the largest row and is zero, not NaN, for empty data", () => {
    const rows = topStreamShares(
      [
        summary("logs", [
          ["a", 400],
          ["b", 100],
        ]),
      ],
      2000,
    );
    expect(rows.map((r) => r.barPct)).toEqual([100, 25]);
    const empty = topStreamShares([summary("logs", [["a", 0]])], 0);
    expect(empty[0].barPct).toBe(0);
    expect(empty[0].percent).toBe(0);
  });

  it("totals only the three signals for the data size", () => {
    const typed = (stream_type: string, storage_size_mb: number) => ({
      ...summary(stream_type, []),
      storage_size_mb,
    });
    expect(signalTotalMb([typed("logs", 10), typed("index", 90)])).toBe(10);
  });
});

describe("percentOf", () => {
  it("rounds to a whole percent", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(512, 2048)).toBe(25);
  });

  it("is zero, not NaN or Infinity, for a zero total", () => {
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("isUnderOnePercent", () => {
  it("is true only for a non-empty share below one percent", () => {
    expect(isUnderOnePercent(1, 1000)).toBe(true);
    expect(isUnderOnePercent(10, 1000)).toBe(false);
    expect(isUnderOnePercent(0, 1000)).toBe(false);
    expect(isUnderOnePercent(5, 0)).toBe(false);
  });
});

describe("signalSplit", () => {
  const typed = (stream_type: string, storage_size_mb: number): OverviewStreamTypeSummary => ({
    ...summary(stream_type, []),
    storage_size_mb,
  });

  it("splits logs, metrics and traces by stored size and ignores other types", () => {
    const rows = signalSplit([
      typed("logs", 710),
      typed("metrics", 190),
      typed("traces", 100),
      typed("enrichment_tables", 99999),
    ]);
    expect(rows.map((r) => [r.signal, r.percent])).toEqual([
      ["logs", 71],
      ["metrics", 19],
      ["traces", 10],
    ]);
    expect(rows.map((r) => r.segment.pct)).toEqual([71, 19, 10]);
  });

  it("returns zero shares for a zero total and for missing signals", () => {
    const rows = signalSplit([typed("logs", 0)]);
    expect(rows.map((r) => r.percent)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.segment.pct)).toEqual([0, 0, 0]);
    expect(signalSplit([]).map((r) => r.sizeMb)).toEqual([0, 0, 0]);
  });

  it("paints each signal with its own signal token", () => {
    expect(SIGNAL_VARIANT).toEqual({ logs: "logs", metrics: "metrics", traces: "traces" });
  });
});

describe("elapsedParts", () => {
  it("splits milliseconds into days, hours and minutes", () => {
    expect(elapsedParts((26 * 60 + 5) * 60_000)).toEqual({ days: 1, hours: 2, minutes: 5 });
    expect(elapsedParts(59_999)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(elapsedParts(9 * 3_600_000 + 40 * 60_000)).toEqual({ days: 0, hours: 9, minutes: 40 });
  });

  it("never goes negative", () => {
    expect(elapsedParts(-120_000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("firing totals", () => {
  const alerts = buildOverview().alerts.data!;

  it("reads the per-level counts", () => {
    expect(levelCount(alerts, "critical")).toBe(2);
    expect(levelCount(undefined, "critical")).toBe(0);
  });

  it("totals every firing level, or falls back to the state counts without levels", () => {
    expect(firingTotal(alerts)).toBe(3);
    const noLevels = { ...alerts, firing_by_level: undefined } as never;
    expect(firingTotal(noLevels)).toBe(3);
  });

  it("treats a zero or negative since as unknown", () => {
    expect(hasKnownSince(0)).toBe(false);
    expect(hasKnownSince(-5)).toBe(false);
    expect(hasKnownSince(1_699_996_400_000_000)).toBe(true);
  });

  it("takes the oldest age from the first firing row with a known since", () => {
    const [first, second] = alerts.firing;
    const rows = [{ ...first, since: 0 }, second];
    expect(oldestKnownFiring({ ...alerts, firing: rows })?.name).toBe(second.name);
    expect(oldestKnownFiring({ ...alerts, firing: [{ ...first, since: 0 }] })).toBeUndefined();
    expect(oldestKnownFiring(undefined)).toBeUndefined();
  });
});

describe("overviewStatus", () => {
  const idle = { pending: false, failed: false };
  const clearOverview = () => {
    const base = buildHealthyOverview();
    return buildOverview({
      ...base,
      streams: { status: "ok", data: { ...base.streams.data!, quiet_count: 0 } },
    });
  };
  const healthy = () => overviewChecks({ overview: clearOverview(), ...idle });
  const check = (over: Partial<AttentionCheck>): AttentionCheck => ({
    key: "quiet",
    state: "ok",
    count: 0,
    monitors: true,
    ...over,
  });

  it("lists the non-zero problems in the strip's order with the danger look", () => {
    const status = overviewStatus(
      overviewChecks({ overview: buildOverview(), ...idle, incidents: { state: "ok", count: 2 } }),
    );
    expect(status.kind).toBe("danger");
    expect(status.items).toEqual([
      { key: "firing", count: 3 },
      { key: "failing", count: 4 },
      { key: "incidents", count: 2 },
      { key: "pipelines", count: 2 },
      { key: "quiet", count: 3 },
    ]);
    expect(status).not.toHaveProperty("total");
  });

  it.each(["firing", "failing", "incidents", "pipelines"] as const)(
    "uses the danger look when only %s is above zero",
    (key) => {
      expect(overviewStatus([check({ key, count: 1 })]).kind).toBe("danger");
    },
  );

  it("uses the warning look, not danger, when only quiet streams are above zero", () => {
    const status = overviewStatus([
      check({ key: "quiet", count: 82 }),
      check({ key: "firing", count: 0 }),
    ]);
    expect(status).toEqual({ kind: "warning", items: [{ key: "quiet", count: 82 }] });
  });

  it("reports a known problem even while other checks load or failed", () => {
    const status = overviewStatus([
      check({ key: "firing", count: 1 }),
      check({ key: "incidents", state: "loading" }),
      check({ key: "pipelines", state: "unavailable" }),
    ]);
    expect(status.kind).toBe("danger");
  });

  it("says checking while a source is still loading and none has a problem", () => {
    expect(overviewStatus([...healthy(), check({ key: "incidents", state: "loading" })]).kind).toBe(
      "checking",
    );
    expect(
      overviewStatus(overviewChecks({ overview: null, pending: true, failed: false })).kind,
    ).toBe("checking");
  });

  it("never says all clear when a source could not load", () => {
    expect(
      overviewStatus(overviewChecks({ overview: null, pending: false, failed: true })).kind,
    ).toBe("partial");
    expect(
      overviewStatus(
        overviewChecks({ overview: null, pending: false, failed: false, forbidden: true }),
      ).kind,
    ).toBe("partial");
    const locked = buildOverview({ ...clearOverview(), pipelines: { status: "locked" } });
    expect(overviewStatus(overviewChecks({ overview: locked, ...idle })).kind).toBe("partial");
    expect(
      overviewStatus([...healthy(), check({ key: "incidents", state: "unavailable" })]).kind,
    ).toBe("partial");
  });

  it("calls a loaded page that monitors something and has no problem clear", () => {
    expect(overviewStatus(healthy())).toEqual({ kind: "clear", items: [] });
  });

  it("says nothing is monitored, not clear, when every source is ok but nothing is set up", () => {
    const base = clearOverview();
    const overview = buildOverview({
      ...base,
      alerts: {
        status: "ok",
        data: { ...base.alerts.data!, total: 0, enabled: 0, disabled: 0, by_state: {} },
      },
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
      streams: {
        status: "ok",
        data: { ...base.streams.data!, total_streams: 0, quiet_count: 0, by_type: [] },
      },
    });
    const checks = overviewChecks({ overview, ...idle });
    expect(checks.every((c) => !c.monitors)).toBe(true);
    expect(overviewStatus(checks)).toEqual({ kind: "unmonitored", items: [] });
    const withIncidents = overviewChecks({
      overview,
      ...idle,
      incidents: { state: "ok", count: 0 },
    });
    expect(withIncidents.find((c) => c.key === "incidents")?.monitors).toBe(false);
    expect(overviewStatus(withIncidents).kind).toBe("unmonitored");
  });

  it("calls incidents with enabled rules clear", () => {
    const base = clearOverview();
    const overview = buildOverview({
      ...base,
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
      streams: {
        status: "ok",
        data: { ...base.streams.data!, total_streams: 0, quiet_count: 0, by_type: [] },
      },
    });
    const checks = overviewChecks({ overview, ...idle, incidents: { state: "ok", count: 0 } });
    expect(checks.find((c) => c.key === "incidents")?.monitors).toBe(true);
    expect(overviewStatus(checks).kind).toBe("clear");
  });

  it("counts any one configured source as monitoring, and disabled rules as none", () => {
    const base = clearOverview();
    const noRules = buildOverview({
      ...base,
      alerts: {
        status: "ok",
        data: { ...base.alerts.data!, total: 0, enabled: 0, disabled: 0, by_state: {} },
      },
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
    });
    expect(overviewStatus(overviewChecks({ overview: noRules, ...idle })).kind).toBe("clear");
    const disabledRules = buildOverview({
      ...noRules,
      alerts: { status: "ok", data: { ...base.alerts.data!, total: 2, enabled: 0, disabled: 2 } },
    });
    const checks = overviewChecks({ overview: disabledRules, ...idle });
    expect(checks.find((c) => c.key === "firing")?.monitors).toBe(false);
    expect(checks.find((c) => c.key === "failing")?.monitors).toBe(false);
  });

  it("says nothing is monitored when every rule is disabled and nothing else is set up", () => {
    const base = clearOverview();
    const overview = buildOverview({
      ...base,
      alerts: {
        status: "ok",
        data: { ...base.alerts.data!, total: 3, enabled: 0, disabled: 3, by_state: {} },
      },
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
      streams: {
        status: "ok",
        data: { ...base.streams.data!, total_streams: 0, quiet_count: 0, by_type: [] },
      },
    });
    expect(overviewStatus(overviewChecks({ overview, ...idle }))).toEqual({
      kind: "unmonitored",
      items: [],
    });
  });

  it("counts a notify-failed rule as firing", () => {
    const base = clearOverview();
    const overview = buildOverview({
      ...base,
      alerts: { status: "ok", data: { ...base.alerts.data!, by_state: { notify_failed: 2 } } },
    });
    expect(overviewStatus(overviewChecks({ overview, ...idle })).items).toEqual([
      { key: "firing", count: 2 },
    ]);
  });

  it("leaves out incidents the deployment does not have, and never reads anomalies", () => {
    const keys = healthy().map((c) => c.key);
    expect(keys).toEqual(["firing", "failing", "pipelines", "quiet"]);
  });

  it("maps each section view to a check state", () => {
    expect(checkState("ok")).toBe("ok");
    expect(checkState("empty")).toBe("ok");
    expect(checkState("loading")).toBe("loading");
    for (const view of ["error", "forbidden", "locked"] as const) {
      expect(checkState(view)).toBe("unavailable");
    }
  });
});
