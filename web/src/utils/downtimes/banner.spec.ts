// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { countChipLabel, countdownText, msUntilCountdownChanges } from "./banner";

describe("downtime banner", () => {
  it("counts down in hours and minutes at 90 minutes", () => {
    expect(countdownText(90 * 60, gt)).toBe("ends in 1 h 30 min");
  });

  it("says less than a minute at 59 seconds", () => {
    expect(countdownText(59, gt)).toBe("ends in less than a minute");
  });

  it("counts whole minutes under an hour, singular and plural", () => {
    expect(countdownText(60, gt)).toBe("ends in 1 minute");
    expect(countdownText(119, gt)).toBe("ends in 1 minute");
    expect(countdownText(5 * 60 + 40, gt)).toBe("ends in 5 minutes");
    expect(countdownText(59 * 60 + 59, gt)).toBe("ends in 59 minutes");
  });

  it("switches to hours and minutes from an hour on", () => {
    expect(countdownText(3600, gt)).toBe("ends in 1 h");
    expect(countdownText(2 * 3600 + 15 * 60 + 30, gt)).toBe("ends in 2 h 15 min");
  });

  it("wakes at the next minute boundary, and at the end in the last minute", () => {
    expect(msUntilCountdownChanges(5 * 60_000 + 1_500)).toBe(1_500);
    expect(msUntilCountdownChanges(5 * 60_000)).toBe(60_000);
    expect(msUntilCountdownChanges(42_000)).toBe(42_000);
    expect(msUntilCountdownChanges(0)).toBeNull();
    expect(msUntilCountdownChanges(-5)).toBeNull();
  });

  it("says ended past the end", () => {
    expect(countdownText(0, gt)).toBe("ended");
    expect(countdownText(-30, gt)).toBe("ended");
  });

  it("labels the count chips by module", () => {
    expect(countChipLabel({ module: "alerts", count: 7 }, gt)).toBe("Alerts 7");
    expect(countChipLabel({ module: "slos", count: 3 }, gt)).toBe("SLOs 3");
    expect(countChipLabel({ module: "mystery", count: 1 }, gt)).toBe("mystery 1");
  });
});
