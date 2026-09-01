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

describe("generateAnomalySummary — anomaly rate", () => {
  it("states the rate as the percentile's complement", () => {
    expect(generateAnomalySummary(config(), [], t)).toContain("3% anomaly rate");
  });

  it("reports 1% for the most conservative tier", () => {
    expect(generateAnomalySummary(config({ threshold: 99 }), [], t)).toContain("1% anomaly rate");
  });

  // The percentile input can be emptied, and the write-back passes "" through
  // unchanged. `100 - ""` is 100, which announced "flag every bucket" — the most
  // alarming value in the range — for a field the user had merely cleared.
  it.each([["", "empty string"], [null, "null"], [undefined, "undefined"], ["abc", "non-numeric"]])(
    "omits the rate entirely for %s (%s) rather than claiming 100%%",
    (threshold) => {
      const summary = generateAnomalySummary(config({ threshold }), [], t);
      expect(summary).not.toContain("anomaly rate");
      // The rest of the summary still renders.
      expect(summary).toContain("14 days");
    },
  );
});
