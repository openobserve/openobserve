// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  summarizeError,
  firingKey,
  firingStatus,
  toneOfHistoryLevel,
  valueVsThreshold,
  windowMinutes,
  type FiringRow,
} from "./firings";
import {
  TRANSITIONS,
  caseDetections,
  caseFirings,
  groupValueRows,
  toTimeline,
  toTimelineEntry,
  toneOfPriority,
} from "./cases";
import type { IncidentWithAlerts } from "@/services/incidents";

const row = (over: Partial<FiringRow> = {}): FiringRow => ({
  timestamp: 1_000,
  alert_name: "a",
  status: "firing",
  level: "critical",
  actual_value: 112,
  threshold_operator: ">=",
  start_time: 1_000_000,
  end_time: 901_000_000,
  error: null,
  is_silenced: false,
  evaluation_took_in_secs: 0.2,
  ...over,
});

describe("firings", () => {
  it("keeps notify_failed apart from a plain firing, and errors apart from both", () => {
    expect(firingStatus("firing")).toBe("firing");
    expect(firingStatus("notify_failed")).toBe("notify_failed");
    expect(firingStatus("error")).toBe("error");
    expect(firingStatus("failed")).toBe("error");
    expect(firingStatus("normal")).toBe("normal");
    expect(firingStatus("skipped")).toBe("skipped");
    expect(firingStatus("weird")).toBe("other");
  });

  it("reads an ordinary alert's matched level as its severity", () => {
    expect(toneOfHistoryLevel("critical")).toBe("critical");
    expect(toneOfHistoryLevel("warning")).toBe("medium");
    expect(toneOfHistoryLevel(undefined)).toBe("unknown");
  });

  it("states the value against the threshold that matched", () => {
    expect(valueVsThreshold(row({ threshold_value: 100 }))).toBe("112 ≥ 100");
    expect(valueVsThreshold(row({ threshold_value: null }))).toBe("112");
    expect(valueVsThreshold(row({ value_is_lower_bound: true, threshold_value: 50 }))).toBe(
      "≥ 112 ≥ 50",
    );
    expect(valueVsThreshold(row({ actual_value: null }))).toBe("");
  });

  it("measures the evaluation window in minutes", () => {
    expect(windowMinutes(row())).toBe(15);
    expect(windowMinutes(row({ end_time: 0 }))).toBeNull();
  });

  it("keys a row by timestamp and name", () => {
    expect(firingKey(row())).toBe("1000:a");
  });
});

describe("cases", () => {
  it("maps priorities onto the shared tones", () => {
    expect(toneOfPriority("P1")).toBe("critical");
    expect(toneOfPriority("p4")).toBe("low");
    expect(toneOfPriority(undefined)).toBe("unknown");
  });

  it("offers only transitions the server accepts", () => {
    expect(TRANSITIONS.resolved).toEqual(["open"]);
    expect(TRANSITIONS.open).toContain("acknowledged");
  });

  it("reads each serde-tagged event, including ones with no data", () => {
    expect(toTimelineEntry({ timestamp: 1, type: "Created" }).key).toBe("created");
    const alert = toTimelineEntry({
      timestamp: 2,
      type: "Alert",
      data: { alert_name: "Brute force", count: 3, alert_id: "x", first_at: 1, last_at: 2 },
    });
    expect(alert.params).toEqual({ name: "Brute force", n: 3 });
    const comment = toTimelineEntry({
      timestamp: 3,
      type: "Comment",
      data: { user_id: "a@b.c", comment: "looking" },
    });
    expect(comment.body).toBe("looking");
    expect(comment.actor).toBe("a@b.c");
    expect(toTimelineEntry({ timestamp: 4, type: "Resolved", data: { user_id: null } }).key).toBe(
      "autoResolved",
    );
  });

  it("keeps an event type it does not know instead of dropping it", () => {
    expect(toTimelineEntry({ timestamp: 5, type: "FutureThing" }).key).toBe("other");
  });

  it("orders the timeline newest first", () => {
    expect(
      toTimeline([
        { timestamp: 1, type: "Created" },
        { timestamp: 9, type: "Acknowledged", data: { user_id: "u" } },
      ]).map((e) => e.timestamp),
    ).toEqual([9, 1]);
  });

  it("flattens correlation dimensions, skipping empty ones", () => {
    expect(groupValueRows({ host: "db1", user: "", n: 2 })).toEqual([
      { key: "host", value: "db1" },
      { key: "n", value: "2" },
    ]);
    expect(groupValueRows(null)).toEqual([]);
    expect(groupValueRows(["x"])).toEqual([]);
  });
});

describe("summarizeError", () => {
  it("strips an embedded HTML error page and truncates", () => {
    const text =
      "sent error status: 405, err: <!doctype html><html><head><style>body{x:1}</style></head><body><h1>Example Domain</h1></body></html>";
    expect(summarizeError(text)).toBe("sent error status: 405, err: Example Domain");
    expect(summarizeError("a".repeat(400), 10)).toBe(`${"a".repeat(9)}…`);
    expect(summarizeError(null)).toBe("");
  });
});

describe("case detections from a real incident payload", () => {
  // Shape of GET /api/v2/{org}/alerts/incidents/{id}: `alerts` are alert
  // DEFINITIONS (no alert_name / alert_fired_at); firings are `triggers`.
  const payload: IncidentWithAlerts = {
    id: "inc-1",
    org_id: "default",
    status: "open",
    severity: "P2",
    first_alert_at: 1_000,
    last_alert_at: 9_000,
    alert_count: 3,
    created_at: 1_000,
    updated_at: 9_000,
    alerts: [
      { id: "a1", name: "AWS_Root_Account_Activity", stream_name: "cloudtrail", enabled: true },
      { id: "a2", name: "AWS_IAM_Access_Key_Created", stream_name: "cloudtrail", enabled: true },
    ],
    triggers: [
      {
        incident_id: "inc-1",
        alert_id: "a1",
        alert_name: "AWS_Root_Account_Activity",
        alert_fired_at: 1_000,
        correlation_reason: "primary_match",
        created_at: 1_000,
      },
      {
        incident_id: "inc-1",
        alert_id: "a2",
        alert_name: "AWS_IAM_Access_Key_Created",
        alert_fired_at: 5_000,
        correlation_reason: "primary_match",
        created_at: 5_000,
      },
      {
        incident_id: "inc-1",
        alert_id: "a1",
        alert_name: "AWS_Root_Account_Activity",
        alert_fired_at: 9_000,
        correlation_reason: "alert_id",
        created_at: 9_000,
      },
    ],
  };

  it("counts firings per detection from triggers, busiest first", () => {
    expect(caseDetections(payload.triggers)).toEqual([
      { alertName: "AWS_Root_Account_Activity", count: 2, last: 9_000 },
      { alertName: "AWS_IAM_Access_Key_Created", count: 1, last: 5_000 },
    ]);
  });

  it("never reads the definitions as firings", () => {
    // Definitions have no alert_name; they must not produce entries or throw.
    expect(caseDetections(payload.alerts as never)).toEqual([]);
    expect(caseDetections(undefined)).toEqual([]);
  });

  it("lists firings newest first", () => {
    expect(caseFirings(payload.triggers).map((f) => f.alert_fired_at)).toEqual([
      9_000, 5_000, 1_000,
    ]);
  });
});
