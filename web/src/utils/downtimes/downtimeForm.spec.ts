// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import type { Downtime } from "@/services/downtimes";
import { conditionToBuilder } from "./conditionBridge";
import {
  ALL_FOLDERS,
  applyPrefill,
  buildDowntimeAutoName,
  buildDowntimeRequest,
  buildNotifications,
  notifyAfterPick,
  defaultDowntimeValues,
  downtimeToFormValues,
  exclusiveAllFolders,
  nextFullHourMs,
  scheduleForRepeat,
  unnarrowedModules,
  type DowntimeFormValues,
} from "./downtimeForm";

const NOW = Date.parse("2026-09-17T12:20:00Z");

const flow1: Downtime = {
  id: "2f9K",
  org: "default",
  folder_id: "planned-maintenance",
  name: "Payments failover · weekly",
  reason: "Planned DB failover drill, CHG-4471",
  condition: {
    type: "group",
    op: "and",
    items: [
      { type: "pair", key: "service", operator: "=", value: "payments" },
      { type: "pair", key: "env", operator: "=", value: "prod" },
    ],
  },
  targets: [
    { module: "alerts", folders: { kind: "all" } },
    { module: "synthetics", folders: { kind: "all" }, tags: ["service:payments"] },
    { module: "slos", folders: { kind: "all" }, slo_mode: "exclude" },
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
  created_by: "lin",
  created_at: 1,
  updated_by: "lin",
  updated_at: 1,
};

describe("folder select", () => {
  it("maps All folders exclusively in both directions", () => {
    expect(exclusiveAllFolders(["a", ALL_FOLDERS], ["a"])).toEqual([ALL_FOLDERS]);
    expect(exclusiveAllFolders([ALL_FOLDERS, "a"], [ALL_FOLDERS])).toEqual(["a"]);
    expect(exclusiveAllFolders(["a", "b"], ["a"])).toEqual(["a", "b"]);
  });

  it("sends All folders as kind all and chosen folders as kind some", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    expect(buildDowntimeRequest(values).targets).toEqual([
      { module: "alerts", folders: { kind: "all" } },
    ]);
    values.targets.alerts.folders = ["7Hq2staging"];
    expect(buildDowntimeRequest(values).targets[0].folders).toEqual({
      kind: "some",
      folder_ids: ["7Hq2staging"],
    });
  });
});

describe("buildDowntimeRequest", () => {
  it("round-trips flow 1 through the form", () => {
    const body = buildDowntimeRequest(downtimeToFormValues(flow1));
    expect(body).toEqual({
      folder_id: "planned-maintenance",
      name: "Payments failover · weekly",
      reason: "Planned DB failover drill, CHG-4471",
      condition: flow1.condition,
      targets: flow1.targets,
      schedule: {
        ...flow1.schedule,
        starts_at: Date.parse("2026-09-13T22:00:00Z") * 1000,
      },
      show_banner: true,
    });
  });

  it("sends no SLOs target unless the SLOs module is chosen, and sends its mode", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    expect(buildDowntimeRequest(values).targets.some((t) => t.module === "slos")).toBe(false);
    values.modules = ["alerts", "slos"];
    values.targets.slos.slo_mode = "count_as_good";
    const slo = buildDowntimeRequest(values).targets.find((t) => t.module === "slos");
    expect(slo).toEqual({ module: "slos", folders: { kind: "all" }, slo_mode: "count_as_good" });
  });

  it("defaults the alerts incident mode to muted and sends it only when none", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    expect(values.targets.alerts.incident_mode).toBe("muted");
    expect(buildDowntimeRequest(values).targets[0]).toEqual({
      module: "alerts",
      folders: { kind: "all" },
    });
    values.targets.alerts.incident_mode = "none";
    expect(buildDowntimeRequest(values).targets[0]).toEqual({
      module: "alerts",
      folders: { kind: "all" },
      incident_mode: "none",
    });
    values.modules = ["anomaly_detections"];
    values.targets.anomaly_detections.incident_mode = "none";
    expect(buildDowntimeRequest(values).targets[0].incident_mode).toBeUndefined();
  });

  it("reads a saved row without the incident mode as muted and keeps none on edit", () => {
    expect(downtimeToFormValues(flow1).targets.alerts.incident_mode).toBe("muted");
    const none: Downtime = {
      ...flow1,
      targets: [{ module: "alerts", folders: { kind: "all" }, incident_mode: "none" }],
    };
    const values = downtimeToFormValues(none);
    expect(values.targets.alerts.incident_mode).toBe("none");
    expect(buildDowntimeRequest(values).targets).toEqual(none.targets);
  });

  it("keeps the condition in the form but sends none when only synthetics is chosen", () => {
    const values = downtimeToFormValues(flow1);
    values.modules = ["synthetics"];
    const body = buildDowntimeRequest(values);
    expect(body.condition).toBeUndefined();
    expect(values.condition).not.toBeNull();
  });

  it("sends a one-time window as starts_at, ends_at and its length", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    values.schedule = {
      ...values.schedule,
      start_date: "2026-09-17",
      start_time: "14:10",
      end_date: "2026-09-17",
      end_time: "16:10",
    };
    const s = buildDowntimeRequest(values).schedule;
    expect(s.starts_at).toBe(Date.parse("2026-09-17T14:10:00Z") * 1000);
    expect(s.ends_at).toBe(Date.parse("2026-09-17T16:10:00Z") * 1000);
    expect(s.duration_secs).toBe(7200);
    expect(s.repeat).toBe("none");
  });

  it("keeps a mid-day starts_at of a recurring row through a form round trip", () => {
    const midDay = Date.parse("2026-09-17T13:00:00Z") * 1000;
    const row: Downtime = {
      ...flow1,
      schedule: {
        repeat: "daily",
        starts_at: midDay,
        ends_at: null,
        timezone: "UTC",
        start_time_local: "09:00",
        duration_secs: 3600,
        weekdays: [],
      },
    };
    const values = downtimeToFormValues(row);
    expect(buildDowntimeRequest(values).schedule.starts_at).toBe(midDay);
    const moved = { ...values, schedule: { ...values.schedule, start_date: "2026-09-20" } };
    expect(buildDowntimeRequest(moved).schedule.starts_at).toBe(
      Date.parse("2026-09-20T00:00:00Z") * 1000,
    );
  });

  it("rebuilds starts_at in a new zone whether or not the zone moves the local date", () => {
    const midDay = Date.parse("2026-10-01T13:00:00Z") * 1000;
    const row: Downtime = {
      ...flow1,
      schedule: {
        repeat: "daily",
        starts_at: midDay,
        ends_at: null,
        timezone: "UTC",
        start_time_local: "09:00",
        duration_secs: 3600,
        weekdays: [],
      },
    };
    const values = downtimeToFormValues(row);
    const inZone = (timezone: string) =>
      buildDowntimeRequest({ ...values, schedule: { ...values.schedule, timezone } }).schedule
        .starts_at;
    // Kolkata keeps 2026-10-01 as the local date of the instant, Auckland moves it to 2026-10-02.
    expect(inZone("Asia/Kolkata")).toBe(Date.parse("2026-09-30T18:30:00Z") * 1000);
    expect(inZone("Pacific/Auckland")).toBe(Date.parse("2026-09-30T11:00:00Z") * 1000);
  });

  it("saves a legacy zone name back unchanged and keeps the recurring start", () => {
    const midDay = Date.parse("2026-10-01T13:00:00Z") * 1000;
    const row: Downtime = {
      ...flow1,
      schedule: {
        repeat: "daily",
        starts_at: midDay,
        ends_at: null,
        timezone: "Asia/Calcutta",
        start_time_local: "09:00",
        duration_secs: 3600,
        weekdays: [],
      },
    };
    const values = downtimeToFormValues(row);
    expect(values.schedule.timezone).toBe("Asia/Calcutta");
    const body = buildDowntimeRequest(values);
    expect(body.schedule.timezone).toBe("Asia/Calcutta");
    expect(body.schedule.starts_at).toBe(midDay);
  });

  it("drops blank names and reasons so the backend generates a name", () => {
    const body = buildDowntimeRequest(defaultDowntimeValues(NOW, "UTC"));
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("reason");
  });
});

describe("prefill and the mute-all rule", () => {
  it("pre-fills one module with all folders and the row's id", () => {
    const values = applyPrefill(defaultDowntimeValues(NOW, "UTC"), {
      module: "slos",
      ids: ["slo-1"],
    });
    expect(values.modules).toEqual(["slos"]);
    expect(values.targets.slos).toMatchObject({
      folders: [ALL_FOLDERS],
      ids_open: true,
      ids: ["slo-1"],
    });
  });

  it("flags a module that narrows nothing, so Save asks before muting it whole", () => {
    const values: DowntimeFormValues = defaultDowntimeValues(NOW, "UTC");
    expect(unnarrowedModules(values)).toEqual(["alerts"]);
    values.condition_open = true;
    values.condition = conditionToBuilder({
      type: "pair",
      key: "service",
      operator: "=",
      value: "x",
    });
    expect(unnarrowedModules(values)).toEqual([]);
  });
});

describe("schedule defaults", () => {
  it("starts on the next full hour of the form's timezone, not of UTC", () => {
    const values = defaultDowntimeValues(NOW, "Asia/Kolkata");
    expect(values.schedule.start_date).toBe("2026-09-17");
    expect(values.schedule.start_time).toBe("18:00");
    expect(values.schedule.end_time).toBe("19:00");
    expect(nextFullHourMs(NOW, "UTC")).toBe(Date.parse("2026-09-17T13:00:00Z"));
    expect(nextFullHourMs(Date.parse("2026-09-17T13:00:00Z"), "UTC")).toBe(
      Date.parse("2026-09-17T13:00:00Z"),
    );
  });

  it("starts on :00 across a thirty-minute DST step", () => {
    const lordHowe = Date.parse("2026-10-03T15:15:00Z");
    const start = nextFullHourMs(lordHowe, "Australia/Lord_Howe");
    expect(start).toBe(Date.parse("2026-10-03T16:00:00Z"));
    expect(defaultDowntimeValues(lordHowe, "Australia/Lord_Howe").schedule.start_time).toBe(
      "03:00",
    );
    expect(nextFullHourMs(Date.parse("2026-09-17T12:20:00Z"), "Asia/Kathmandu")).toBe(
      Date.parse("2026-09-17T13:15:00Z"),
    );
  });

  it("picks today's weekday in the form's timezone when the repeat becomes weekly", () => {
    const late = Date.parse("2026-09-17T23:30:00Z");
    const s = { ...defaultDowntimeValues(late, "Asia/Tokyo").schedule };
    const weekly = scheduleForRepeat(s, "weekly", late);
    expect(weekly.start_date).toBe("2026-09-18");
    expect(weekly.weekdays).toEqual([5]);
    expect(scheduleForRepeat({ ...s, weekdays: [1, 3] }, "weekly", late).weekdays).toEqual([1, 3]);
  });

  it("resets the start date on a repeat change, recurring from today and once on the next hour", () => {
    const s = { ...defaultDowntimeValues(NOW, "UTC").schedule, start_date: "2026-12-01" };
    expect(scheduleForRepeat(s, "daily", NOW).start_date).toBe("2026-09-17");
    const once = scheduleForRepeat({ ...s, repeat: "daily" }, "none", NOW);
    expect(once).toMatchObject({
      repeat: "none",
      start_date: "2026-09-17",
      start_time: "13:00",
      end_date: "2026-09-17",
      end_time: "14:00",
    });
  });
});

describe("generated name", () => {
  it("names an unnarrowed module the way the server does", () => {
    expect(
      buildDowntimeAutoName(defaultDowntimeValues(NOW, "UTC"), gt, undefined, undefined, "en-US"),
    ).toBe("All alerts · once Thu 17 Sep");
  });
});

describe("notifications in the form", () => {
  it("start with no destination and send none", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    expect(values.notifications.destinations).toEqual([]);
    expect(values.notifications.lead).toBe("10m");
    expect(buildDowntimeRequest(values).notifications).toBeUndefined();
  });

  it("turn on the reminder and the end when the first destination is picked", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    const picked = notifyAfterPick(values.notifications, ["slack-oncall"]);
    expect(picked).toMatchObject({
      destinations: ["slack-oncall"],
      started: false,
      ending_soon: true,
      ended: true,
      cancelled: false,
      extended: false,
    });
    const second = notifyAfterPick({ ...picked, ending_soon: false }, ["slack-oncall", "pd"]);
    expect(second.ending_soon).toBe(false);
    const chosen = notifyAfterPick({ ...values.notifications, started: true }, ["pd"]);
    expect(chosen.ending_soon).toBe(false);
  });

  it("build the request with every event and the lead in seconds", () => {
    const values = defaultDowntimeValues(NOW, "UTC");
    values.notifications = {
      ...notifyAfterPick(values.notifications, ["slack-oncall"]),
      cancelled: true,
      lead: "15m",
    };
    expect(buildNotifications(values.notifications)).toEqual({
      destinations: ["slack-oncall"],
      events: { started: false, ending_soon: true, ended: true, cancelled: true, extended: false },
      ending_soon_lead_secs: 900,
    });
    const body = buildDowntimeRequest(values);
    expect(body.notifications?.destinations).toEqual(["slack-oncall"]);
  });

  it("round-trip through a saved row", () => {
    const saved: Downtime = {
      ...flow1,
      notifications: {
        destinations: ["pd"],
        events: {
          started: true,
          ending_soon: false,
          ended: true,
          cancelled: false,
          extended: true,
        },
        ending_soon_lead_secs: 3600,
      },
    };
    const values = downtimeToFormValues(saved);
    expect(values.notifications).toEqual({
      destinations: ["pd"],
      started: true,
      ending_soon: false,
      ended: true,
      cancelled: false,
      extended: true,
      lead: "1h",
    });
    expect(buildDowntimeRequest(values).notifications).toEqual(saved.notifications);
    expect(downtimeToFormValues(flow1).notifications.destinations).toEqual([]);
  });
});
