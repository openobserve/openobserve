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
import { isAlertFindingKind } from "@/components/alert_calibration/dismissals";
import { suggestionKindLabel, toRequests, toSuggestionRows } from "./liveAdapter";

const NOW_MS = 1_800_000_000_000;
const HOUR_US = 3_600_000_000;
const ZONE = { locale: "en-US", timeZone: "UTC" };
const FINDING_ID = "b".repeat(64);

const notifyFailed = (evidence: Record<string, unknown> = {}): AutoObserveSuggestion => ({
  id: FINDING_ID,
  org: "demo-org",
  analyzer: "alert_calibration",
  kind: "alert_notify_failed",
  subject: { kind: "alert", key_dims: { entity_id: "alert-1" } },
  evidence: {
    alert_name: "checkout-errors",
    finding_id: FINDING_ID,
    rule_id: "notify_failed",
    severity: "high",
    delivery_failures: 3,
    delivery_attempts: 5,
    folder: "ops",
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

describe("alert_notify_failed suggestions (C15)", () => {
  it("is an alert finding, so Dismiss goes through the finding family", () => {
    expect(isAlertFindingKind("alert_notify_failed")).toBe(true);
  });

  it("names the kind Notification failed, as the calibration page and Slack do", () => {
    expect(suggestionKindLabel(gt, "alert_notify_failed")).toBe("Notification failed");
  });

  it("words the All suggestions row as a red failure with its counts, next step, CTA and Dismiss", () => {
    const [row] = toSuggestionRows(gt, ZONE, [notifyFailed()], NOW_MS);
    expect(row.kind).toBe("Notification failed");
    expect(row.kindVariant).toBe("error-soft");
    expect(row.headline).toBe("checkout-errors fired, and 3 of 5 notifications failed.");
    expect(String(row.note)).toContain("Check its destination.");
    expect(row.where).toBe("Folder ops");
    expect(row.insight.cta?.label).toBe("Review alert");
    expect(row.insight.cta?.target).toMatchObject({ type: "review_alert", findingId: FINDING_ID });
    expect(row.insight.dismissable).toMatchObject({
      finding_id: FINDING_ID,
      rule_id: "notify_failed",
      scope_key: "alert-1",
    });
  });

  it("says one notification in the singular, and drops the counts when the server has none", () => {
    const one = notifyFailed({ delivery_failures: 1, delivery_attempts: 1 });
    expect(toSuggestionRows(gt, ZONE, [one], NOW_MS)[0].headline).toBe(
      "checkout-errors fired, and 1 of 1 notification failed.",
    );
    const none = notifyFailed({ delivery_failures: undefined, delivery_attempts: undefined });
    expect(toSuggestionRows(gt, ZONE, [none], NOW_MS)[0].headline).toBe(
      "checkout-errors fired, and its notifications failed.",
    );
  });

  it("puts the same words on the Home rail card", () => {
    const [request] = toRequests(gt, ZONE, [notifyFailed()], NOW_MS);
    expect(request.copy.label).toBe("Notification failed");
    expect(request.insight.chip).toMatchObject({
      label: "Notification failed",
      variant: "error-soft",
      tone: "failure",
    });
    expect(request.insight.headline).toBe(
      "checkout-errors fired, and 3 of 5 notifications failed.",
    );
    expect(request.insight.next).toBe("Check its destination.");
    expect(request.insight.dismissable).not.toBeNull();
  });
});
