import { describe, expect, it, vi, beforeEach } from "vitest";

const watchMock = vi.fn();

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return { ...actual, watch: (...args: any[]) => watchMock(...args) };
});

import { useVariablesWatcher, variableLog } from "./useVariableDebugger";

describe("useVariableDebugger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a deep watcher on variablesData.values", () => {
    const variablesData = {
      values: [{ name: "region", value: "us-east" }],
    };

    useVariablesWatcher(variablesData);

    expect(watchMock).toHaveBeenCalledTimes(1);
    const [getter, callback, options] = watchMock.mock.calls[0];

    expect(getter()).toBe(variablesData.values);
    expect(options).toEqual({ deep: true });

    // callback currently has an early return and should be a no-op
    expect(callback([{ name: "region", value: "eu-west" }])).toBeUndefined();
  });

  it("keeps variableLog as a no-op", () => {
    expect(() => variableLog("service", "changed")).not.toThrow();
  });
});
