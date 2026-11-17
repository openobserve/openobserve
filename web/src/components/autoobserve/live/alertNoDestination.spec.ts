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
    expect(row.kindVariant).toBe("amber-soft");
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

  it("is amber, says how often it fired and what the button opens, on the card itself (T1-N5)", () => {
    const [request] = toRequests(gt, ZONE, [noDestination()], NOW_MS);
    expect(request.insight.chip).toMatchObject({ variant: "amber-soft", tone: "gap" });
    expect(request.insight.why).toBe(
      "It fired 4 times in the last calibration window, and no one was notified.",
    );
    expect(request.insight.note).toBe(
      "Opens the alert editor at who gets notified. Nothing is saved until you save.",
    );
  });
});

describe("alert_no_destination on Home: Review change and Where (T3-17, C12)", () => {
  const withChange = () =>
    finding(
      "alert_no_destination",
      { rule_id: "no_destination", severity: "high", firings: 4, folder: "ops" },
      {
        actions: [
          {
            type: "apply_suggestion",
            alert_id: "alert-1",
            patch: [{ field: "destinations", from: [], to: ["pay-webhook"] }],
          },
          { type: "review_alert", alert_id: "alert-1", focus: "settings" },
        ] as never,
      },
    );

  it("offers Review change on the card and the row when the server sends the change", () => {
    const [request] = toRequests(gt, ZONE, [withChange()], NOW_MS);
    expect(request.insight.cta?.label).toBe("Review change");
    expect(request.insight.cta?.target).toMatchObject({ type: "review_change" });
    expect(request.insight.secondary.map((c) => c.label)).toContain("Review alert");
    const [row] = toSuggestionRows(gt, ZONE, [withChange()], NOW_MS);
    expect(row.insight.cta?.label).toBe("Review change");
  });

  it("puts the alert's folder in Where, and a dash only when the server doesn't know it", () => {
    expect(toSuggestionRows(gt, ZONE, [withChange()], NOW_MS)[0].where).toBe("Folder ops");
    expect(toSuggestionRows(gt, ZONE, [noDestination()], NOW_MS)[0].where).toBe("—");
    const [notWorking] = toSuggestionRows(
      gt,
      ZONE,
      [finding("alert_not_working", { rule_id: "failure", pattern: "syntax", folder: "pay" })],
      NOW_MS,
    );
    expect(notWorking.where).toBe("Folder pay");
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

describe("calibration tiers say what they mean (T1-15)", () => {
  it.each([
    [
      "A",
      "Confirmed condition",
      "The evidence confirms this condition, and any change offered is a concrete setting.",
    ],
    ["B", "Investigate", "The evidence shows where, when and how widely it fails, but not why."],
    [
      "C",
      "Owner decision",
      "The numbers are real, but whether to change the alert is the owner's call.",
    ],
  ] as const)("tier %s carries its one-line meaning", (tier, label, hint) => {
    const [row] = toSuggestionRows(
      gt,
      ZONE,
      [finding("alert_not_working", { rule_id: "failure", pattern: "syntax" }, { tier })],
      NOW_MS,
    );
    expect(row.insight.facts).toEqual([{ label, variant: "default-soft", hint }]);
  });
});
