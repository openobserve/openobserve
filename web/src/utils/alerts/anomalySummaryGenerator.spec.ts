// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// The summary renders live beside the wizard, reading the same mutated config
// object the form writes back to — so it sees half-typed and cleared values.

import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";

import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";
import { generateAnomalySummary } from "./anomalySummaryGenerator";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});
const t = i18n.global.t as unknown as TranslateFn;

const config = (overrides: Record<string, unknown> = {}) => ({
  stream_name: "default",
  stream_type: "logs",
  query_mode: "filters",
  detection_function: "count",
  histogram_interval_value: 5,
  histogram_interval_unit: "m",
  schedule_interval_value: 1,
  schedule_interval_unit: "h",
  detection_window_value: 1,
  detection_window_unit: "h",
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 97,
  alert_enabled: false,
  ...overrides,
});

describe("generateAnomalySummary — sensitivity line", () => {
  it("states the stored level, never a live anomaly rate", () => {
    // The stored number indexes TRAINING scores and promises nothing about live buckets.
    const summary = generateAnomalySummary(config(), [], t);
    expect(summary).toContain("level 97");
    expect(summary).not.toContain("anomaly rate");
    // A bare "97" beside "Threshold" would read as a count or a percentage of alerts.
    expect(summary).not.toMatch(/Threshold:[^<]*<[^>]*>\s*97\s*</);
  });

  it("reports the conservative tier as its level", () => {
    expect(generateAnomalySummary(config({ threshold: 99 }), [], t)).toContain("level 99");
  });

  it("a stored budget replaces the level with the enforced cap", () => {
    const summary = generateAnomalySummary(config({ alert_budget_per_day: 2 }), [], t);
    expect(summary).toContain("at most 2 alerts/day");
    expect(summary).not.toMatch(/\blevel \d/);
  });

  it("a sub-daily budget reads as alerts per week, singular at one", () => {
    const summary = generateAnomalySummary(config({ alert_budget_per_day: 1 / 7 }), [], t);
    expect(summary).toContain("at most 1 alert/week");
  });

  it("a fractional budget keeps the plural", () => {
    const summary = generateAnomalySummary(config({ alert_budget_per_day: 0.05 }), [], t);
    expect(summary).toContain("at most 0.35 alerts/week");
  });

  // The level input can be emptied, and the write-back passes "" through
  // unchanged; a blank must not be numberified into a claim.
  it.each([
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    ["abc", "non-numeric"],
  ])("omits the sensitivity line entirely for %s (%s)", (threshold) => {
    const summary = generateAnomalySummary(config({ threshold }), [], t);
    expect(summary).not.toContain("Threshold:");
    expect(summary).not.toMatch(/\blevel \d/);
    expect(summary).not.toContain("anomaly rate");
    // The rest of the summary still renders.
    expect(summary).toContain("14 days");
  });
});
