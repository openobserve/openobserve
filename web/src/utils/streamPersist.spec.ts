// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  pickDashboardPanelStream,
  restoreDashboardPanelStreamType,
  saveDashboardPanelStream,
  saveLogsStream,
  saveMetricsStream,
  saveTracesStream,
} from "./streamPersist";

describe("dashboard panel stream memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remembers the saved stream per org and stream type", () => {
    saveDashboardPanelStream("org1", "traces", "spans");
    saveDashboardPanelStream("org1", "logs", "nginx");
    saveDashboardPanelStream("org2", "metrics", "cpu");

    expect(restoreDashboardPanelStreamType("org1")).toBe("logs");
    expect(restoreDashboardPanelStreamType("org2")).toBe("metrics");
    expect(pickDashboardPanelStream("org1", "traces", ["default", "spans"])).toBe("spans");
    expect(pickDashboardPanelStream("org1", "logs", ["default", "nginx"])).toBe("nginx");
  });

  it("falls back to the last explored stream of that type, then the first stream", () => {
    saveLogsStream("org1", ["missing", "app"]);
    saveTracesStream("org1", "otel");
    saveMetricsStream("org1", "mem");

    expect(pickDashboardPanelStream("org1", "logs", ["default", "app"])).toBe("app");
    expect(pickDashboardPanelStream("org1", "traces", ["default", "otel"])).toBe("otel");
    expect(pickDashboardPanelStream("org1", "metrics", ["cpu", "mem"])).toBe("mem");
    expect(pickDashboardPanelStream("org1", "metrics", ["cpu", "disk"])).toBe("cpu");
  });

  it("falls back to the freshest stream with data, skipping internal streams", () => {
    const streams = [
      { name: "_agent_signals", stats: { doc_num: 900, doc_time_max: 300 } },
      { name: "empty", stats: { doc_num: 0, doc_time_max: 0 } },
      { name: "older", stats: { doc_num: 10, doc_time_max: 100 } },
      { name: "newer", stats: { doc_num: 5, doc_time_max: 200 } },
    ];
    expect(pickDashboardPanelStream("org1", "logs", streams)).toBe("newer");
    expect(
      pickDashboardPanelStream("org1", "logs", [{ name: "_internal" }, { name: "plain" }]),
    ).toBe("plain");
    expect(pickDashboardPanelStream("org1", "logs", [{ name: "_internal" }])).toBe("_internal");
  });

  it("skips a remembered stream that no longer exists", () => {
    saveDashboardPanelStream("org1", "logs", "deleted");
    expect(pickDashboardPanelStream("org1", "logs", ["default"])).toBe("default");
  });

  it("ignores unknown stream types and empty values", () => {
    saveDashboardPanelStream("org1", "enrichment_tables", "geo");
    saveDashboardPanelStream("org1", "logs", "");
    expect(restoreDashboardPanelStreamType("org1")).toBe("");
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(() => saveDashboardPanelStream("org1", "logs", "app")).not.toThrow();
    expect(restoreDashboardPanelStreamType("org1")).toBe("");
    expect(pickDashboardPanelStream("org1", "logs", ["default"])).toBe("default");
  });
});
