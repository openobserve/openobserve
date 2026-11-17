import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ALERT_PREFILL_KEY,
  clearAlertPrefill,
  readAlertPrefill,
  takeAlertEditHandoff,
  writeAlertEditHandoff,
  writeAlertPrefill,
} from "./alertPrefillStorage";
import {
  ALERT_PREFILL_VERSION,
  type AlertEditHandoff,
  type AlertPrefill,
} from "@/ts/interfaces/alertPrefill";

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

const handoff: AlertEditHandoff = {
  version: ALERT_PREFILL_VERSION,
  source: "calibration",
  target: { alertId: "a1", findingId: "f1" },
  focus: "pending_period",
  patch: { pendingPeriodSecs: { from: 60, to: 120 } },
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

  describe("edit handoff", () => {
    it("a calibration handoff never seeds the create form", () => {
      writeAlertEditHandoff(handoff);
      expect(readAlertPrefill()).toBeNull();
      expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).not.toBeNull();
    });

    it("is read once for its own alert, then cleared", () => {
      writeAlertEditHandoff(handoff);
      expect(takeAlertEditHandoff("a1")).toEqual(handoff);
      expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
      expect(takeAlertEditHandoff("a1")).toBeNull();
    });

    it("clears a handoff for another alert or version without returning it", () => {
      writeAlertEditHandoff(handoff);
      expect(takeAlertEditHandoff("a2")).toBeNull();
      expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
      writeAlertEditHandoff({ ...handoff, version: 9 as never });
      expect(takeAlertEditHandoff("a1")).toBeNull();
      expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
    });

    it("leaves a create prefill for the create form", () => {
      writeAlertPrefill(prefill);
      expect(takeAlertEditHandoff("a1")).toBeNull();
      expect(readAlertPrefill()).toEqual(prefill);
    });
  });
});
