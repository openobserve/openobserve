import { describe, expect, it } from "vitest";
import {
  buildCompletionConfigPayloads,
  completionWindowConfigFromJob,
  completionWindowDefaultsForScope,
  durationPartsFromSecs,
  SESSION_COMPLETION_WINDOW_DEFAULTS,
  TRACE_COMPLETION_WINDOW_DEFAULTS,
} from "./completionWindow";
import type { EvalJob } from "@/services/online-evals.service";

const endSignal = {
  version: 2,
  conditions: {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      {
        filterType: "condition",
        column: "status",
        operator: "=",
        value: "complete",
        values: [],
        logicalOperator: "AND",
      },
    ],
  },
};

describe("completionWindowDefaultsForScope", () => {
  it("uses the documented 2-minute / 30-minute trace window", () => {
    expect(completionWindowDefaultsForScope("trace")).toEqual({
      idleWindowSecs: 120,
      maxAgeSecs: 1800,
    });
    expect(TRACE_COMPLETION_WINDOW_DEFAULTS).toEqual({
      idleWindowSecs: 120,
      maxAgeSecs: 1800,
    });
  });

  it("uses the documented 2-minute / 4-hour session window", () => {
    expect(completionWindowDefaultsForScope("session")).toEqual({
      idleWindowSecs: 120,
      maxAgeSecs: 14400,
    });
    expect(SESSION_COMPLETION_WINDOW_DEFAULTS).toEqual({
      idleWindowSecs: 120,
      maxAgeSecs: 14400,
    });
  });

  it("does not define a completion window for span scope", () => {
    expect(completionWindowDefaultsForScope("span")).toBeNull();
  });
});

describe("completionWindowConfigFromJob", () => {
  it("reads a camelCase trace config and preserves its End Signal", () => {
    const row = {
      traceConfig: {
        idleWindowSecs: 45,
        maxAgeSecs: 900,
        endSignal,
      },
    } as EvalJob;

    expect(completionWindowConfigFromJob(row, "trace")).toEqual({
      idleWindowSecs: 45,
      maxAgeSecs: 900,
      endSignal,
    });
  });

  it("reads snake_case session configs and falls back to scope defaults", () => {
    const row = {
      session_config: {
        idle_window_secs: 600,
        end_signal: endSignal,
      },
    } as unknown as EvalJob;

    expect(completionWindowConfigFromJob(row, "session")).toEqual({
      idleWindowSecs: 600,
      maxAgeSecs: 14400,
      endSignal,
    });
  });

  it("does not expose stale completion config for span scope", () => {
    const row = { traceConfig: { endSignal } } as EvalJob;
    expect(completionWindowConfigFromJob(row, "span")).toBeNull();
  });
});

describe("buildCompletionConfigPayloads", () => {
  const window = { idleWindowSecs: 120, maxAgeSecs: 1800 };

  it("emits only traceConfig for trace scope, including the End Signal", () => {
    expect(buildCompletionConfigPayloads("trace", window, endSignal)).toEqual({
      traceConfig: { ...window, endSignal },
      sessionConfig: null,
    });
  });

  it("emits only sessionConfig for session scope", () => {
    expect(buildCompletionConfigPayloads("session", window, null)).toEqual({
      traceConfig: null,
      sessionConfig: { ...window, endSignal: null },
    });
  });

  it("emits neither completion config for span scope", () => {
    expect(buildCompletionConfigPayloads("span", window, endSignal)).toEqual({
      traceConfig: null,
      sessionConfig: null,
    });
  });
});

describe("durationPartsFromSecs", () => {
  it("splits a seconds field into display units", () => {
    expect(durationPartsFromSecs(120)).toEqual({
      hours: 0,
      minutes: 2,
      seconds: 0,
    });
    expect(durationPartsFromSecs(1800)).toEqual({
      hours: 0,
      minutes: 30,
      seconds: 0,
    });
    // Session max age defaults to 4h — where raw seconds stop being readable.
    expect(durationPartsFromSecs(14400)).toEqual({
      hours: 4,
      minutes: 0,
      seconds: 0,
    });
    expect(durationPartsFromSecs("45")).toEqual({
      hours: 0,
      minutes: 0,
      seconds: 45,
    });
  });

  it("splits values that span several units", () => {
    expect(durationPartsFromSecs(90)).toEqual({
      hours: 0,
      minutes: 1,
      seconds: 30,
    });
    expect(durationPartsFromSecs(5430)).toEqual({
      hours: 1,
      minutes: 30,
      seconds: 30,
    });
  });

  // Unit words are the component's job (i18n), so this returns numbers only.
  it("returns no formatted text of its own", () => {
    const parts = durationPartsFromSecs(1800);
    expect(Object.values(parts!).every((v) => typeof v === "number")).toBe(true);
  });

  it.each(["", "   ", "0", "-60", "abc"])("has no duration to show for %s", (value) => {
    expect(durationPartsFromSecs(value)).toBeNull();
  });
});
