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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { gt, raw } from "@/types/i18n";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import { say } from "../v2/fixtures";
import LiveSuggestions from "./LiveSuggestions.vue";
import { toRequests, toSuggestionRows } from "./liveAdapter";
import type { RailSource } from "./liveModel";
import { alertFindingBody, alertFindingHeadline, analysedText } from "./alertFindingCopy";

const NOW_MS = 1_800_000_000_000;
const HOUR_US = 3_600_000_000;
const ZONE = { locale: "en-US", timeZone: "UTC" };

const finding = (
  id: string,
  evidence: Record<string, unknown>,
  over: Partial<AutoObserveSuggestion> = {},
): AutoObserveSuggestion => ({
  id,
  org: "demo-org",
  analyzer: "alert_calibration",
  kind: "alert_not_working",
  subject: { kind: "alert", key_dims: { entity_id: `alert-${id}` } },
  evidence: {
    alert_name: "checkout-errors",
    severity: "high",
    rule_id: "failure",
    finding_id: id,
    evaluation_errors: 0,
    evaluations: 0,
    ...evidence,
  },
  score: null,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  last_seen_at: NOW_MS * 1000 - 2 * HOUR_US,
  tier: "A",
  advice: "check_missing_stream",
  limitations: [],
  ...over,
});

const ITEMS = [
  finding("f1", { pattern: "stream_missing", stream: "logs/checkout" }),
  finding("f2", { pattern: "stream_missing" }),
  finding(
    "f3",
    { pattern: "source_inactive", stream: "logs/payments", severity: "medium" },
    { tier: "B", advice: "confirm_quiet_source", limitations: ["quiet_source"] },
  ),
  finding("f4", { pattern: "syntax" }),
  finding("f5", { pattern: "future_class" }, { advice: "future_advice", limitations: ["x"] }),
  finding("f6", {}, { advice: null, tier: null }),
];

const rail = (items: AutoObserveSuggestion[]): RailSource => ({
  status: "ready",
  retry: () => undefined,
  busy: false,
  failure: null,
  detail: raw(""),
  stale: null,
  requests: toRequests(gt, ZONE, items, NOW_MS),
  total: items.length,
});

describe("alert_not_working cards (P5b test 27)", () => {
  it("say each pattern and class with the shared sentences, and anything else generically", () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { pattern: "stream_missing", stream: "logs/checkout" },
        "checkout-errors reads logs/checkout, which doesn't exist",
      ],
      [
        { pattern: "stream_missing" },
        "checkout-errors keeps failing because its stream doesn't exist",
      ],
      [
        { pattern: "field_missing", field: "duration_ms" },
        "checkout-errors filters on duration_ms, a field its stream doesn't have",
      ],
      [
        { pattern: "field_missing" },
        "checkout-errors keeps failing because a field it uses doesn't exist",
      ],
      [
        { pattern: "ignored_matcher", field: "pod" },
        "checkout-errors matches on pod, a label no series has, so it watches every series",
      ],
      [{ pattern: "ignored_matcher" }, "checkout-errors is not working"],
      [{ pattern: "empty_scope" }, "checkout-errors filters to rows that never arrive"],
      [
        { pattern: "source_inactive", stream: "logs/payments" },
        "checkout-errors reads logs/payments, which has no recent data",
      ],
      [{ pattern: "source_inactive" }, "checkout-errors is not working"],
      [{ pattern: "syntax" }, "checkout-errors has a query that does not parse"],
      [{ pattern: "resource_timeout" }, "checkout-errors keeps timing out before it finishes"],
      [{ pattern: "resource_memory" }, "checkout-errors keeps running out of memory"],
      [{ pattern: "other" }, "checkout-errors keeps failing with an error"],
      [{ pattern: "future_class" }, "checkout-errors is not working"],
      [{ pattern: "constructor" }, "checkout-errors is not working"],
      [{}, "checkout-errors is not working"],
    ];
    for (const [evidence, expected] of cases) {
      expect(String(alertFindingHeadline(gt, "en-US", finding("f", evidence)))).toBe(expected);
    }
  });

  it("dates the card by its calibration run", () => {
    expect(String(analysedText(gt, "en-US", 120))).toBe("From the calibration run 2 hours ago");
    expect(String(analysedText(gt, "en-US", 0))).toBe("From the calibration run just now");
  });

  it("explains with calibration's advice and limits, and never an unknown code", () => {
    const text = (s: AutoObserveSuggestion) => {
      const body = alertFindingBody(s);
      return body ? String(say(gt, body)) : null;
    };
    expect(text(ITEMS[2])).toBe(
      "Confirm whether this source is expected to be quiet before changing the alert. " +
        "A quiet source can be a batch or cron job that is idle by design.",
    );
    expect(text(ITEMS[0])).toBe("Check the source the query reads: it does not exist.");
    expect(text(ITEMS[4])).toBeNull();
    expect(text(ITEMS[5])).toBeNull();
  });

  it("renders the tier neutral, the run time in Details, and no raw pattern, code or id", async () => {
    const wrapper = mount(LiveSuggestions, {
      props: { rail: rail(ITEMS), skeleton: false },
      global: { plugins: [i18n, store, router] },
    });
    const first = rail(ITEMS).requests[0].copy;
    expect(String(first?.label)).toBe("Not working");
    expect(String(first?.why)).toBe("From the calibration run 2 hours ago");
    expect(first?.tags.map((tag) => [String(tag.label), tag.variant])).toEqual([
      ["Confirmed condition", "default-soft"],
    ]);
    const medium = rail(ITEMS).requests[2].copy;
    expect(medium?.tags.map((tag) => [String(tag.label), tag.variant])).toEqual([
      ["Investigate", "default-soft"],
    ]);
    for (const toggle of wrapper.findAll('[data-test$="-details-toggle"]')) {
      await toggle.trigger("click");
    }
    const text = wrapper.text();
    expect(text).toContain("checkout-errors reads logs/checkout, which doesn't exist");
    expect(text).toContain("From the calibration run 2 hours ago");
    for (const raw of [
      "stream_missing",
      "source_inactive",
      "future_class",
      "check_missing_stream",
      "alert-f1",
      "f1",
    ]) {
      expect(text).not.toContain(raw);
    }
    expect(text).not.toContain("future_advice");
  });

  it("gives the drawer row the same headline and the red Not working chip, with no High tag", () => {
    const [row] = toSuggestionRows(gt, ZONE, [ITEMS[0]]);
    expect(String(row.headline)).toBe("checkout-errors reads logs/checkout, which doesn't exist");
    expect(String(row.kind)).toBe("Not working");
    expect(row.kindVariant).toBe("error-soft");
    expect(row.severity).toBeNull();
  });
});
