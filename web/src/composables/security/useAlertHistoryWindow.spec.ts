// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";

import type { HistoryRow } from "@/utils/security/history";
import alertsService from "@/services/alerts";
import {
  dedupeHistory,
  historyRowKey,
  isComplete,
  useAlertHistoryWindow,
} from "./useAlertHistoryWindow";

vi.mock("@/services/alerts", () => ({ default: { getHistory: vi.fn() } }));
vi.mock("@/services/stream", () => ({ default: { schema: vi.fn(async () => ({ data: {} })) } }));

const getHistory = alertsService.getHistory as unknown as ReturnType<typeof vi.fn>;

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

describe("useAlertHistoryWindow", () => {
  it("reads a 403 as a missing grant, not as the raw status text", async () => {
    getHistory.mockRejectedValue({
      response: { status: 403, data: "Unauthorized Access" },
      message: "Request failed with status code 403",
    });
    const history = useAlertHistoryWindow();
    await history.load("acme", 0, 1);
    expect(history.forbidden.value).toBe(true);
    expect(history.error.value).toBe("");
  });

  it("clears the lock once a load succeeds", async () => {
    getHistory.mockRejectedValueOnce({ response: { status: 403 } });
    getHistory.mockResolvedValueOnce({ data: { total: 0, hits: [] } });
    const history = useAlertHistoryWindow();
    await history.load("acme", 0, 1);
    await history.load("acme", 0, 1);
    expect(history.forbidden.value).toBe(false);
  });
});
