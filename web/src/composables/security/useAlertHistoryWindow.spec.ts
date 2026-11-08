// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import type { HistoryRow } from "@/utils/security/history";
import { dedupeHistory, historyRowKey, isComplete } from "./useAlertHistoryWindow";

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  timestamp: 1,
  alert_name: "a",
  status: "normal",
  level: "ok",
  actual_value: 0,
  threshold_operator: null,
  start_time: 0,
  end_time: 1,
  error: null,
  is_silenced: false,
  evaluation_took_in_secs: null,
  ...over,
});

describe("dedupeHistory", () => {
  it("drops a row that two pages both returned, keeping distinct rows on one timestamp", () => {
    const a = row({ alert_name: "a" });
    const b = row({ alert_name: "b" });
    expect(dedupeHistory([a, b, { ...a }])).toEqual([a, b]);
    expect(historyRowKey(a)).not.toBe(historyRowKey(b));
  });
});

describe("isComplete", () => {
  it("judges completeness by pages fetched, not by the rows that survived", () => {
    // 1000 counted, 998 returned after server drops and dedupe: still complete.
    expect(isComplete(1000, 1)).toBe(true);
    expect(isComplete(1001, 1)).toBe(false);
    expect(isComplete(4800, 5)).toBe(true);
    expect(isComplete(5001, 5)).toBe(false);
  });
});
