import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ALERT_PREFILL_KEY,
  clearAlertPrefill,
  readAlertPrefill,
  writeAlertPrefill,
} from "./alertPrefillStorage";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const prefill: AlertPrefill = {
  version: ALERT_PREFILL_VERSION,
  source: "logs",
  sourceLabel: "k8s_logs",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: 'SELECT * FROM "k8s_logs"',
  warnings: [],
};

describe("alertPrefillStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a prefill", () => {
    writeAlertPrefill(prefill);
    expect(readAlertPrefill()).toEqual(prefill);
  });

  it("returns null when nothing is stored", () => {
    expect(readAlertPrefill()).toBeNull();
  });

  it("ignores a prefill written by a different contract version", () => {
    sessionStorage.setItem(ALERT_PREFILL_KEY, JSON.stringify({ ...prefill, version: 99 }));
    expect(readAlertPrefill()).toBeNull();
  });

  it("ignores unparseable content instead of throwing", () => {
    sessionStorage.setItem(ALERT_PREFILL_KEY, "{not json");
    expect(readAlertPrefill()).toBeNull();
  });

  it("survives a write failure without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => writeAlertPrefill(prefill)).not.toThrow();
  });

  it("survives a read failure without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readAlertPrefill()).toBeNull();
  });

  it("clears the stored prefill", () => {
    writeAlertPrefill(prefill);
    clearAlertPrefill();
    expect(readAlertPrefill()).toBeNull();
  });

  it("survives being cleared twice", () => {
    expect(() => {
      clearAlertPrefill();
      clearAlertPrefill();
    }).not.toThrow();
  });
});
