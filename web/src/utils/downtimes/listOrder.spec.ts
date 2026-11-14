// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import type { DowntimeListItem } from "@/services/downtimes";
import { isDeletable, isEditable, isFinished, sortDowntimeRows } from "./listOrder";

const row = (
  id: string,
  status: DowntimeListItem["status"],
  start: number,
  window: "current" | "next" | null = null,
) =>
  ({
    id,
    status,
    schedule: { starts_at: start },
    current_window: window === "current" ? { start, end: start + 10 } : null,
    next_window: window === "next" ? { start, end: start + 10 } : null,
  }) as unknown as DowntimeListItem;

describe("isDeletable", () => {
  const HOUR = 3_600_000_000;
  const once = {
    repeat: "none",
    starts_at: 10 * HOUR,
    ends_at: 12 * HOUR,
    timezone: "UTC",
    duration_secs: 7200,
    weekdays: [],
  };
  const finished = (modules: string[], cancelled_at?: number) =>
    ({
      status: cancelled_at === undefined ? "ended" : "ended_early",
      targets: modules.map((module) => ({ module, folders: { kind: "all" } })),
      schedule: once,
      cancelled_at,
    }) as unknown as DowntimeListItem;

  it("offers Delete on a finished row without an SLO target", () => {
    expect(isDeletable(finished(["alerts"]))).toBe(true);
  });

  it("hides Delete on a finished SLO row whose window started", () => {
    expect(isDeletable(finished(["alerts", "slos"]))).toBe(false);
    expect(isDeletable(finished(["slos"], 11 * HOUR))).toBe(false);
  });

  it("offers Delete on an SLO row cancelled before its first window", () => {
    const cancelled = { ...finished(["slos"], 9 * HOUR), status: "cancelled" } as DowntimeListItem;
    expect(isDeletable(cancelled)).toBe(true);
  });

  it("offers no Delete on an active or scheduled row", () => {
    expect(isDeletable({ ...finished(["alerts"]), status: "active" } as DowntimeListItem)).toBe(
      false,
    );
  });
});

describe("downtime list order", () => {
  it("sorts by status, then start, then id, whatever the input order", () => {
    const rows = [
      row("c", "cancelled", 1),
      row("e2", "ended", 5),
      row("x", "ended_early", 2),
      row("b", "active", 30, "current"),
      row("a", "active", 30, "current"),
      row("s", "scheduled", 50, "next"),
      row("e1", "ended", 5),
      row("z", "active", 10, "current"),
    ];
    const ids = (list: DowntimeListItem[]) => sortDowntimeRows(list).map((r) => r.id);
    expect(ids(rows)).toEqual(["z", "a", "b", "s", "e1", "e2", "x", "c"]);
    expect(ids([...rows].reverse())).toEqual(ids(rows));
  });

  it("offers Edit only on live rows and Delete only on finished ones", () => {
    for (const status of ["active", "scheduled"] as const) {
      expect(isEditable(row("a", status, 0))).toBe(true);
      expect(isFinished(row("a", status, 0))).toBe(false);
    }
    for (const status of ["ended", "ended_early", "cancelled"] as const) {
      expect(isEditable(row("a", status, 0))).toBe(false);
      expect(isFinished(row("a", status, 0))).toBe(true);
    }
  });
});
