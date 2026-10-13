// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import type { DowntimeDetail } from "@/services/downtimes";
import {
  DOWNTIME_EMAIL_TEMPLATE,
  DOWNTIME_TEMPLATE,
  downtimeVariables,
  renderDowntimeTemplate,
  templateNameFor,
  testRequestFor,
} from "./notifyTest";

const HOUR = 3_600_000_000;

const detail = {
  id: "2f9K",
  org: "acme",
  folder_id: "default",
  name: 'Nightly "deploy" <db>',
  reason: "CHG-1",
  targets: [
    { module: "alerts", folders: { kind: "all" } },
    { module: "synthetics", folders: { kind: "all" } },
  ],
  schedule: {
    repeat: "none",
    starts_at: 10 * HOUR,
    ends_at: 12 * HOUR,
    timezone: "UTC",
    duration_secs: 7200,
    weekdays: [],
  },
  show_banner: true,
  created_by: "lin",
  created_at: 1,
  updated_by: "lin",
  updated_at: 1,
  status: "scheduled",
  current_window: null,
  next_window: { start: 10 * HOUR, end: 12 * HOUR },
  matched_alerts: 2,
  matched_anomalies: 0,
  matched_synthetics: 1,
  matched_slos: 0,
  affected: { alerts: [], anomalies: [], synthetics: [], slos: [] },
} as DowntimeDetail;

const HTTP_BODY =
  '{"text": "Downtime {downtime_name}: {downtime_event}.", "downtime": {"counts": "{downtime_counts}", "targets": "{downtime_targets}", "starts_at": "{downtime_starts_at}", "url": "{downtime_url}", "org": "{org_name}", "other": "{alert_name}"}}';

describe("downtime test send", () => {
  const vars = downtimeVariables(
    detail,
    { start: 10 * HOUR, end: 12 * HOUR },
    "https://o2.example.com/web/downtimes?org_identifier=acme",
  );

  it("fills the variables the server sends for a start", () => {
    expect(vars).toMatchObject({
      downtime_name: 'Nightly "deploy" <db>',
      downtime_event: "started",
      downtime_reason: "CHG-1",
      downtime_starts_at: "1970-01-01 10:00 UTC",
      downtime_ends_at: "1970-01-01 12:00 UTC",
      downtime_targets: "alerts, synthetics checks",
      downtime_counts: "2 alerts, 1 synthetics check",
      org_name: "acme",
    });
  });

  it("renders a JSON body that still parses and leaves unknown variables alone", () => {
    const json = JSON.parse(renderDowntimeTemplate(HTTP_BODY, vars, "json"));
    expect(json.text).toBe('Downtime Nightly "deploy" <db>: started.');
    expect(json.downtime.counts).toBe("2 alerts, 1 synthetics check");
    expect(json.downtime.url).toBe("https://o2.example.com/web/downtimes?org_identifier=acme");
    expect(json.downtime.other).toBe("{alert_name}");
  });

  it("escapes HTML for an email and fills each variable once", () => {
    expect(renderDowntimeTemplate("<b>{downtime_name}</b>", vars, "html")).toBe(
      "<b>Nightly &quot;deploy&quot; &lt;db&gt;</b>",
    );
    expect(
      renderDowntimeTemplate(
        "{downtime_name}",
        { downtime_name: "{org_name}", org_name: "x" },
        "json",
      ),
    ).toBe("{org_name}");
  });

  it("uses a destination template only when it is written for downtimes", () => {
    const slack = { name: "slack", type: "http", template: "mine" };
    expect(templateNameFor(slack, "{downtime_name} {downtime_event}")).toBe("mine");
    expect(templateNameFor(slack, "[{alert_status}] {alert_name}")).toBe(DOWNTIME_TEMPLATE);
    expect(templateNameFor({ name: "mail", type: "email" })).toBe(DOWNTIME_EMAIL_TEMPLATE);
  });

  it("builds the test request per destination type", () => {
    expect(
      testRequestFor(
        { name: "hook", type: "http", url: "https://hooks.example.com", method: "post" },
        "{}",
      ),
    ).toEqual({
      type: "http",
      url: "https://hooks.example.com",
      method: "post",
      headers: undefined,
      skip_tls_verify: undefined,
      body: "{}",
    });
    expect(testRequestFor({ name: "mail", type: "email", emails: ["a@x.io"] }, "<p/>")).toEqual({
      type: "email",
      url: "",
      recipients: ["a@x.io"],
      body: "<p/>",
    });
    expect(testRequestFor({ name: "topic", type: "sns" }, "{}")).toBeNull();
  });
});
