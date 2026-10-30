// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import type { DowntimeListItem } from "@/services/downtimes";
import { isEditable, isFinished, sortDowntimeRows } from "./listOrder";

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
