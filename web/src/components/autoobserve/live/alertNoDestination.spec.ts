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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/locales";
import config from "@/aws-exports";
import { gt } from "@/types/i18n";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import { suggestionKindLabel, toRequests, toSuggestionRows } from "./liveAdapter";

const NOW_MS = 1_800_000_000_000;
const HOUR_US = 3_600_000_000;
const ZONE = { locale: "en-US", timeZone: "UTC" };
const FINDING_ID = "a".repeat(64);

const finding = (
  kind: string,
  evidence: Record<string, unknown>,
  over: Partial<AutoObserveSuggestion> = {},
): AutoObserveSuggestion => ({
  id: FINDING_ID,
  org: "demo-org",
  analyzer: "alert_calibration",
  kind: kind as AutoObserveSuggestion["kind"],
  subject: { kind: "alert", key_dims: { entity_id: "alert-1" } },
  evidence: {
    alert_name: "checkout-errors",
    finding_id: FINDING_ID,
    run_window_start: NOW_MS * 1000 - 24 * HOUR_US,
    run_window_end: NOW_MS * 1000,
    ...evidence,
  },
  score: null,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  last_seen_at: NOW_MS * 1000 - 2 * HOUR_US,
  tier: null,
  advice: null,
  limitations: [],
  actions: [{ type: "review_alert", alert_id: "alert-1", focus: "settings" }],
  ...over,
});

const noDestination = () =>
  finding("alert_no_destination", {
    rule_id: "no_destination",
    severity: "high",
    firings: 4,
    creates_incident: false,
  });

let enterprise: string;

// The OSS build drops every CTA and Dismiss, so the cards are read as the enterprise build shows them.
beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("alert_no_destination suggestions (C7)", () => {
  it("names the kind Notifies no one, as Slack and silent coverage do", () => {
    expect(suggestionKindLabel(gt, "alert_no_destination")).toBe("Notifies no one");
  });

  it("words the All suggestions row with its own headline, next step and CTA, not Other", () => {
    const [row] = toSuggestionRows(gt, ZONE, [noDestination()], NOW_MS);
    expect(row.kind).toBe("Notifies no one");
    expect(row.kindVariant).toBe("error-soft");
    expect(row.headline).toBe("checkout-errors fired and notifies no one");
    expect(String(row.note)).toContain("Choose who gets notified.");
    expect(row.insight.cta?.label).toBe("Review alert");
    expect(row.insight.cta?.target).toMatchObject({ type: "review_alert", findingId: FINDING_ID });
    expect(row.insight.dismissable).toMatchObject({
      finding_id: FINDING_ID,
      rule_id: "no_destination",
      scope_key: "alert-1",
    });
    expect(row.insight.ai?.request).toContain("notifies no one");
  });

  it("puts the same words on the Home rail card", () => {
    const [request] = toRequests(gt, ZONE, [noDestination()], NOW_MS);
    expect(request.copy.label).toBe("Notifies no one");
    expect(request.insight.chip.label).toBe("Notifies no one");
    expect(request.insight.headline).toBe("checkout-errors fired and notifies no one");
    expect(request.insight.next).toBe("Choose who gets notified.");
  });
});

describe("one label for a kind (filter chip and row)", () => {
  it("alert_not_working's filter chip says what its rows say", () => {
    const [row] = toSuggestionRows(
      gt,
      ZONE,
      [finding("alert_not_working", { rule_id: "failure", pattern: "syntax" })],
      NOW_MS,
    );
    expect(suggestionKindLabel(gt, "alert_not_working")).toBe(row.kind);
  });
});
