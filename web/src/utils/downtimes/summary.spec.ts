// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import type { DowntimeRequest } from "@/services/downtimes";
import { summarySentence } from "./summary";

const flow1: DowntimeRequest = {
  folder_id: "planned-maintenance",
  condition: {
    type: "group",
    op: "and",
    items: [
      { type: "pair", key: "service", operator: "=", value: "payments" },
      { type: "pair", key: "env", operator: "=", value: "prod" },
    ],
  },
  targets: [
    { module: "slos", folders: { kind: "all" }, slo_mode: "exclude" },
    { module: "alerts", folders: { kind: "all" } },
    { module: "synthetics", folders: { kind: "all" }, tags: ["service:payments"] },
  ],
  schedule: {
    repeat: "weekly",
    starts_at: Date.parse("2026-09-13T22:00:00Z") * 1000,
    ends_at: null,
    timezone: "Europe/Berlin",
    start_time_local: "02:00",
    duration_secs: 5400,
    weekdays: [7],
  },
  show_banner: true,
};

describe("summarySentence", () => {
  it("describes flow 1 in the strip's module order", () => {
    expect(summarySentence(flow1, gt, undefined, "en-US")).toBe(
      "Every Sunday at 02:00 Europe/Berlin, for 1 h 30 min: " +
        "alerts with service=payments · env=prod, synthetics checks tagged service:payments " +
        "stop notifying. SLOs with service=payments · env=prod exclude the window from their score.",
    );
  });

  it("names folders and items, and leaves SLO scores alone without an SLOs target", () => {
    const request: DowntimeRequest = {
      ...flow1,
      condition: undefined,
      targets: [
        { module: "alerts", folders: { kind: "some", folder_ids: ["f1", "f2"] } },
        { module: "synthetics", folders: { kind: "all" }, ids: ["c1"] },
      ],
      schedule: {
        repeat: "none",
        starts_at: Date.parse("2026-09-17T14:10:00Z") * 1000,
        ends_at: Date.parse("2026-09-17T16:10:00Z") * 1000,
        timezone: "UTC",
        duration_secs: 7200,
        weekdays: [],
      },
    };
    const names: Record<string, string> = { f1: "Staging", f2: "Load test" };
    expect(summarySentence(request, gt, (_m, id) => names[id], "en-US")).toBe(
      "Once, from Thu 17 Sep, 14:10 to Thu 17 Sep, 16:10 UTC: " +
        "alerts in the folders Staging, Load test, synthetics checks limited to 1 named item " +
        "stop notifying. SLO scores are not changed.",
    );
  });

  it("says the window as good when the SLOs target counts it so", () => {
    const request: DowntimeRequest = {
      ...flow1,
      condition: undefined,
      targets: [{ module: "slos", folders: { kind: "all" }, slo_mode: "count_as_good" }],
    };
    expect(summarySentence(request, gt, undefined, "en-US")).toMatch(
      /no alert or check is muted\. SLOs count the window as good time\.$/,
    );
  });
});
