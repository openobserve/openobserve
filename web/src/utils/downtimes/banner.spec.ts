// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { countChipLabel, countdownText } from "./banner";

describe("downtime banner", () => {
  it("counts down in hours and minutes at 90 minutes", () => {
    expect(countdownText(90 * 60, gt)).toBe("ends in 1 h 30 min");
  });

  it("says under a minute at 59 seconds", () => {
    expect(countdownText(59, gt)).toBe("ends in under a minute");
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
