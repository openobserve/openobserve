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
  it.each([97, 99])(
    "states Auto over a legacy percentile of %s, never a live anomaly rate",
    (threshold) => {
      const summary = generateAnomalySummary(config({ threshold }), [], t);
      expect(summary).toContain(String(t("alerts.anomaly.sensitivityAuto")));
      expect(summary).not.toMatch(/\blevel \d/);
      expect(summary).not.toContain("anomaly rate");
      expect(summary).not.toMatch(new RegExp(`Threshold:[^<]*<[^>]*>\\s*${threshold}\\s*<`));
    },
  );

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
  ])("reads a blank band width %s (%s) as Auto", (band_width) => {
    const summary = generateAnomalySummary(config({ band_width }), [], t);
    expect(summary).toContain(String(t("alerts.anomaly.sensitivityAuto")));
    expect(summary).not.toMatch(/\d+(\.\d+)?σ/);
    // The rest of the summary still renders.
    expect(summary).toContain("14 days");
  });
});

describe("generateAnomalySummary — training line", () => {
  const grouping = (key: string) => String(t(`alerts.anomaly.${key}` as any));

  it("names the band grouping the trainer will pick, which reads at least 21 days", () => {
    for (const days of [7, 14, 21]) {
      expect(generateAnomalySummary(config({ training_window_days: days }), [], t)).toContain(
        `(${grouping("bandGroupingWeekendHourIfData")})`,
      );
    }
  });

  it("is global for a resolution coarser than 1h", () => {
    const summary = generateAnomalySummary(
      config({
        training_window_days: 30,
        histogram_interval_value: 2,
        histogram_interval_unit: "h",
      }),
      [],
      t,
    );
    expect(summary).toContain(`(${grouping("bandGroupingGlobal")})`);
  });
});

describe("generateAnomalySummary — band width and delivery", () => {
  it("states the band width when one is set, instead of the percentile", () => {
    const summary = generateAnomalySummary(config({ band_width: 3.5 }), [], t);
    expect(summary).toContain("3.5σ");
    expect(summary).not.toMatch(/\blevel \d/);
  });

  it("states Auto without a band width, never the legacy percentile", () => {
    const summary = generateAnomalySummary(config({ band_width: null }), [], t);
    expect(summary).toContain(String(t("alerts.anomaly.sensitivityAuto")));
    expect(summary).not.toMatch(/\blevel \d/);
  });

  it("names the trained k beside Auto on an edit of a trained Auto alert", () => {
    const summary = generateAnomalySummary(config({ band_width: null, band_k: 3.4567 }), [], t);
    expect(summary).toContain(String(t("alerts.anomaly.sensitivityAutoTrained", { k: 3.46 })));
  });

  it("still states direction and window share with notifications off", () => {
    const summary = generateAnomalySummary(
      config({ alert_enabled: false, alert_direction: "above", alert_window_buckets: 4 }),
      [],
      t,
    );
    expect(summary).toContain(String(t("alerts.anomaly.directionAbove" as any)));
    expect(summary).toContain(
      String(
        t("alerts.anomaly.windowShareCompact" as any, { fire: 100, buckets: 4, recover: 100 }),
      ),
    );
  });

  it("states direction and window share once alerting is on", () => {
    const summary = generateAnomalySummary(
      config({
        alert_enabled: true,
        alert_destination_ids: ["slack"],
        alert_direction: "below",
        alert_window_buckets: 5,
        alert_window_fire_pct: 80,
      }),
      [],
      t,
    );
    expect(summary).toContain(String(t("alerts.anomaly.directionBelow" as any)));
    expect(summary).toContain(
      String(t("alerts.anomaly.windowShareCompact" as any, { fire: 80, buckets: 5, recover: 80 })),
    );
  });
});
