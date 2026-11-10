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
import { say } from "../v2/fixtures";
import { insightOf, toRequests } from "../live/liveAdapter";

const ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW_MS = Date.UTC(2026, 10, 6, 12, 0);
const us = (ms: number) => ms * 1000;
const zone = { locale: "en-US", timeZone: "UTC" };
const at = (ms: number) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(ms);

const notWorking = (
  evidence: Record<string, unknown> = {},
  over: Partial<AutoObserveSuggestion> = {},
): AutoObserveSuggestion => ({
  id: ID,
  org: "demo-org",
  analyzer: "alert_calibration",
  kind: "alert_not_working",
  subject: { kind: "alert", key_dims: { entity_id: "a2" } },
  evidence: {
    alert_name: "payments-latency",
    pattern: "field_missing",
    rule_id: "failure",
    finding_id: ID,
    field: "duration_ms",
    evaluation_errors: 4,
    evaluations: 9,
    severity: "high",
    run_window_start: us(NOW_MS - 30 * DAY),
    run_window_end: us(NOW_MS - HOUR),
    ...evidence,
  },
  score: null,
  confidence: "suggestive",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  last_seen_at: us(NOW_MS - HOUR),
  tier: "A",
  advice: "check_missing_field",
  limitations: [],
  actions: [{ type: "review_alert", alert_id: "a2", focus: "query" }],
  ...over,
});

const gap = (kind: string, evidence: Record<string, unknown> = {}): AutoObserveSuggestion => ({
  id: `${kind}-1`,
  org: "demo-org",
  analyzer: "coverage",
  kind,
  subject: { kind: "service", key_dims: { service_name: "checkout" } },
  evidence: { service_name: "checkout", severity: "high", cells: {}, ...evidence },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const parts = (s: AutoObserveSuggestion) => insightOf(gt, zone, s, NOW_MS);

let enterprise: string;

beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("insightCopy: why a Not working alert can't fire (tests 1-4)", () => {
  const first = NOW_MS - 2 * HOUR;
  const lastGood = NOW_MS - 2 * HOUR - 2 * MIN;

  it("names the count, the time it started, the error and the last good run", () => {
    const why = parts(
      notWorking({
        evaluation_errors: 438,
        evaluations: 2104,
        error_class: "field_missing",
        first_failure_at: us(first),
        last_success_at: us(lastGood),
      }),
    ).why;
    expect(why).toBe(
      `438 of 2,104 runs failed since ${at(first)} with field-not-found errors; the last good run was ${at(lastGood)}.`,
    );
  });

  it("says it cannot fire when no run succeeded, never 'since undefined' (M-N)", () => {
    const why = parts(
      notWorking({
        evaluation_errors: 73,
        evaluations: 73,
        error_class: "syntax",
        first_failure_at: us(first),
      }),
    ).why;
    expect(why).toBe(`73 of 73 runs failed since ${at(first)}, so it cannot fire.`);
    expect(why).not.toMatch(/undefined|NaN|null/);
  });

  it("falls back to the counts alone, in the singular for one run", () => {
    expect(parts(notWorking()).why).toBe("4 of 9 runs failed in the last calibration window.");
    expect(parts(notWorking({ evaluation_errors: 1, evaluations: 1 })).why).toBe(
      "1 of 1 run failed in the last calibration window.",
    );
    expect(
      parts(notWorking({ first_failure_at: us(first), last_success_at: us(lastGood) })).why,
    ).toBe("4 of 9 runs failed in the last calibration window.");
  });

  it("hides the sentence when nothing failed, never saying 0", () => {
    expect(parts(notWorking({ evaluation_errors: 0, evaluations: 0 })).why).toBeNull();
    expect(parts(notWorking({ evaluation_errors: 0, evaluations: 12 })).why).toBeNull();
  });

  it("says an empty scope matched nothing in the searched window, and hides it without one", () => {
    const withWindow = parts(notWorking({ pattern: "empty_scope", searched_secs: 86_400 }));
    expect(withWindow.why).toBe(
      "No rows matched its filters in the last 1 day, so it cannot fire.",
    );
    const without = parts(notWorking({ pattern: "empty_scope" }));
    expect(without.why).toBeNull();
    expect(without.cta?.label).toBe("Review alert");
  });
});

describe("insightCopy: Not working next step and actions (test 5)", () => {
  it("takes Next from the record's advice in calibration's words", () => {
    expect(parts(notWorking()).next).toBe(
      "Check the field the query filters on: none of its streams has it.",
    );
    expect(parts(notWorking({}, { advice: "not_a_code" })).next).toBeNull();
  });

  it("labels the CTA by the typed action's focus and opens the editor", () => {
    const query = parts(notWorking());
    expect(query.cta?.label).toBe("Review alert");
    expect(query.cta?.target).toEqual({
      type: "review_alert",
      action: { type: "review_alert", alert_id: "a2", focus: "query" },
      alertName: "payments-latency",
      findingId: ID,
    });
    expect(query.note).toBe(
      "Opens the alert editor at the query. Nothing is saved until you save.",
    );
    const threshold = parts(
      notWorking({}, { actions: [{ type: "review_alert", alert_id: "a2", focus: "threshold" }] }),
    );
    expect(threshold.cta?.label).toBe("Review alert");
    expect(threshold.note).toBe(
      "Opens the alert editor at the threshold. Nothing is saved until you save.",
    );
  });

  it("opens Logs on a quiet logs stream from an hour before its last data", () => {
    const lastData = NOW_MS - 8 * DAY;
    const quiet = parts(
      notWorking(
        { pattern: "source_inactive", stream: "logs/batch_logs", last_data_at: us(lastData) },
        { actions: [{ type: "review_source", stream_type: "logs", stream_name: "batch_logs" }] },
      ),
    );
    expect(quiet.cta?.label).toBe("Open in Logs");
    expect(quiet.cta?.target).toMatchObject({
      type: "route",
      to: {
        path: "/logs",
        query: {
          stream: "batch_logs",
          stream_type: "logs",
          from: String(us(lastData - HOUR)),
          to: String(us(NOW_MS)),
          org_identifier: "demo-org",
        },
      },
    });
    expect(quiet.note).toBe("Opens Logs on batch_logs, from an hour before its last data.");
    expect(quiet.secondary.map((c) => c.label)).toEqual(["Open in Alert calibration"]);
  });

  it("drops an action it cannot label instead of showing it raw (M-U)", () => {
    const unknown = parts(
      notWorking(
        {},
        {
          actions: [
            { type: "future_action" },
            { type: "review_alert", alert_id: "a2", focus: "nowhere" },
            { type: "review_source", stream_type: "metrics", stream_name: "cpu" },
          ] as never,
        },
      ),
    );
    expect(unknown.cta).toBeNull();
    expect(unknown.note).toBeNull();
    expect(parts(notWorking({}, { actions: [] })).cta).toBeNull();
  });

  it("adds Open in Logs on the alert's logs stream, but not on a stream that is gone", () => {
    const withStream = parts(notWorking({ pattern: "field_missing", stream: "logs/app_logs" }));
    expect(withStream.secondary.map((c) => c.label)).toEqual([
      "Open in Logs",
      "Open in Alert calibration",
    ]);
    const gone = parts(notWorking({ pattern: "stream_missing", stream: "logs/orders_v1" }));
    expect(gone.secondary.map((c) => c.label)).toEqual(["Open in Alert calibration"]);
    const metrics = parts(notWorking({ pattern: "source_inactive", stream: "metrics/cpu" }));
    expect(metrics.secondary.map((c) => c.label)).toEqual(["Open in Alert calibration"]);
  });

  it("links the run's detail page with its window and rule", () => {
    const calibration = parts(notWorking()).secondary.at(-1);
    expect(calibration?.target).toEqual({
      type: "route",
      to: {
        name: "alertCalibrationDigest",
        params: {
          windowStart: String(us(NOW_MS - 30 * DAY)),
          windowEnd: String(us(NOW_MS - HOUR)),
        },
        query: { org_identifier: "demo-org", rule: "failure" },
      },
    });
  });

  it("offers Dismiss… for a calibration finding of the alert's own id", () => {
    expect(parts(notWorking()).dismissable).toMatchObject({ finding_id: ID, scope_key: "a2" });
  });
});

describe("insightCopy: chip colour and words (test 6)", () => {
  it("is a red Not working for a failing alert, with its tier in Details, not a High tag", () => {
    const p = parts(notWorking());
    expect(p.chip).toEqual({ label: "Not working", variant: "error-soft", tone: "failure" });
    expect(p.facts.map((f) => f.variant)).toEqual(["default-soft"]);
    expect(p.meta).toBe("From the calibration run 1 hour ago");
  });

  it("is amber for a gap and neutral for information", () => {
    expect(parts(gap("coverage_gap")).chip.variant).toBe("amber-soft");
    expect(parts(gap("no_absence_check")).chip.variant).toBe("amber-soft");
    expect(parts(gap("discovery_unusable", { good: 1, active: 4 })).chip.variant).toBe(
      "default-soft",
    );
    expect(parts(gap("some_new_kind")).chip).toMatchObject({
      label: "Other",
      variant: "default-soft",
    });
  });

  it("never shows a raw code as a chip", () => {
    for (const kind of ["alert_not_working", "coverage_gap", "silent_coverage", "some_new_kind"])
      expect(parts(kind === "alert_not_working" ? notWorking() : gap(kind)).chip.label).not.toMatch(
        /_/,
      );
  });
});

describe("insightCopy: coverage kinds read the same on the rail and the card (test 7)", () => {
  it("shares the headline and why with the rail, words each check plainly, and offers no Dismiss…", () => {
    const s = gap("coverage_gap", { traffic_per_hour: 31_000 });
    const [request] = toRequests(gt, zone, [s], NOW_MS);
    const p = parts(s);
    expect(p.headline).toBe(request.copy?.headline);
    expect(p.why).toBe(request.copy?.why);
    expect(p.whyDetail).toBe("Errors: no alert. Latency: no alert. Stops sending: no alert.");
    expect(say(gt, request.body)).toContain("Errors");
    expect(p.cta?.label).toBe("Open service");
    expect(p.dismissable).toBeNull();
  });

  it("gives a fallback alert row the CTA of its typed action and no Dismiss… (test 14)", () => {
    const blind: AutoObserveSuggestion = {
      ...gap("blind_guardrail", {
        monitor_name: "checkout-errors",
        reason: { stream_missing: null },
        detail: "logs/checkout",
      }),
      subject: { kind: "alert", key_dims: { entity_id: "a7" } },
      actions: [{ type: "review_alert", alert_id: "a7", focus: "query" }],
    };
    const p = parts(blind);
    expect(p.chip.variant).toBe("error-soft");
    expect(p.cta?.label).toBe("Review alert");
    expect(p.cta?.target).toMatchObject({ alertName: "checkout-errors", findingId: "" });
    expect(p.dismissable).toBeNull();
  });
});

describe("insightCopy: the open-source build", () => {
  it("offers nothing that writes or navigates", () => {
    config.isEnterprise = "false";
    const p = parts(notWorking({ stream: "logs/app_logs" }));
    expect(p.cta).toBeNull();
    expect(p.secondary).toEqual([]);
    expect(p.note).toBeNull();
    expect(p.dismissable).toBeNull();
    expect(p.why).toBe("4 of 9 runs failed in the last calibration window.");
  });
});

describe("Review change on the card (W5)", () => {
  const apply = {
    type: "apply_suggestion",
    alert_id: "a2",
    patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
  };

  it("a finding that stores a change leads with Review change and keeps Review alert", () => {
    const p = parts(
      notWorking(
        { alert_id: "a2" },
        { actions: [{ type: "review_alert", alert_id: "a2", focus: "query" }, apply] as never },
      ),
    );
    expect(p.cta?.label).toBe("Review change");
    expect(p.cta?.action).toBe("reviewChange");
    expect(p.note).toBe("Shows what changes before anything is saved.");
    const target = p.cta?.target;
    if (target?.type !== "review_change") throw new Error("expected review_change");
    expect(target.change).toEqual({
      findingId: ID,
      alertId: "a2",
      alertName: "payments-latency",
      action: {
        type: "apply_suggestion",
        alert_id: "a2",
        patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
      },
    });
    expect(p.secondary.map((c) => c.action)).toContain("reviewAlert");
  });

  it("the alert id can come from the review action when evidence has none", () => {
    const p = parts(
      notWorking({}, { actions: [{ type: "review_alert", alert_id: "a2" }, apply] as never }),
    );
    expect(p.cta?.action).toBe("reviewChange");
  });

  it("a change for another alert, or a malformed one, is dropped and the card is as today", () => {
    const other = { ...apply, alert_id: "zz" };
    expect(
      parts(notWorking({ alert_id: "a2" }, { actions: [other] as never })).cta?.action,
    ).not.toBe("reviewChange");
    const bad = { ...apply, patch: [{ field: "query", from: 1, to: 2 }] };
    expect(parts(notWorking({ alert_id: "a2" }, { actions: [bad] as never })).cta?.action).not.toBe(
      "reviewChange",
    );
    expect(parts(notWorking()).cta?.action).toBe("reviewAlert");
  });
});
