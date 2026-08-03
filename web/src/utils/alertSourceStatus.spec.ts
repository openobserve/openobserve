import { describe, it, expect } from "vitest";
import { getAlertSourceStatus } from "./alertSourceStatus";

const MICROS_PER_MIN = 60_000_000;

describe("getAlertSourceStatus", () => {
  it("returns not_connected when lastReceivedAt is null", () => {
    expect(getAlertSourceStatus(null, 1_000_000_000)).toBe("not_connected");
  });

  it("returns not_connected when lastReceivedAt is undefined", () => {
    expect(getAlertSourceStatus(undefined, 1_000_000_000)).toBe("not_connected");
  });

  it("returns receiving when last event was under 15 minutes ago", () => {
    const now = 1_000_000_000_000;
    const lastReceivedAt = now - 5 * MICROS_PER_MIN;
    expect(getAlertSourceStatus(lastReceivedAt, now)).toBe("receiving");
  });

  it("returns receiving at exactly the boundary minus one microsecond", () => {
    const now = 1_000_000_000_000;
    const lastReceivedAt = now - (15 * MICROS_PER_MIN - 1);
    expect(getAlertSourceStatus(lastReceivedAt, now)).toBe("receiving");
  });

  it("returns stale at exactly 15 minutes", () => {
    const now = 1_000_000_000_000;
    const lastReceivedAt = now - 15 * MICROS_PER_MIN;
    expect(getAlertSourceStatus(lastReceivedAt, now)).toBe("stale");
  });

  it("returns stale when last event was over 15 minutes ago", () => {
    const now = 1_000_000_000_000;
    const lastReceivedAt = now - 60 * MICROS_PER_MIN;
    expect(getAlertSourceStatus(lastReceivedAt, now)).toBe("stale");
  });
});
