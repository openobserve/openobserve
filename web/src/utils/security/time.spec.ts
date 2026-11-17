// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { securityTime } from "./time";

describe("securityTime", () => {
  it("prints month, day, hour and minute, never seconds", () => {
    const ms = Date.UTC(2026, 10, 9, 3, 59, 12);
    const text = securityTime(ms);
    expect(text).toBe(
      new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(text).not.toContain(":12");
  });

  it("prints a dash for a missing time", () => {
    expect(securityTime(0)).toBe("—");
    expect(securityTime(Number.NaN)).toBe("—");
  });
});
