// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { conditionToBuilder } from "@/utils/downtimes/conditionBridge";
import { defaultDowntimeValues, type DowntimeFormValues } from "@/utils/downtimes/downtimeForm";
import { makeAddDowntimeSchema, tabForPath } from "./AddDowntime.schema";

const NOW = Date.parse("2026-09-17T12:20:00Z");

const valid = (): DowntimeFormValues => ({
  ...defaultDowntimeValues(NOW, "UTC"),
  condition_open: true,
  condition: conditionToBuilder({
    type: "group",
    op: "and",
    items: [{ type: "pair", key: "service", operator: "=", value: "payments" }],
  }),
});

const errorsOf = (values: DowntimeFormValues, ctx = {}) => {
  const result = makeAddDowntimeSchema(gt, ctx).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("AddDowntime schema", () => {
  it("accepts a narrowed one-time downtime", () => {
    expect(errorsOf(valid())).toEqual({});
  });

  it("needs at least one module", () => {
    expect(errorsOf({ ...valid(), modules: [] }).modules).toBe("Choose at least one module.");
  });

  it("needs folders on every chosen target", () => {
    const v = valid();
    v.targets.alerts.folders = [];
    expect(errorsOf(v)["targets.alerts.folders"]).toBe(
      "Choose All folders or at least one folder.",
    );
  });

  it("rejects a condition made only of != rows", () => {
    const v = valid();
    v.condition = conditionToBuilder({
      type: "group",
      op: "and",
      items: [{ type: "pair", key: "env", operator: "!=", value: "staging" }],
    });
    expect(errorsOf(v).condition).toMatch(/^Add at least one = condition/);
  });

  it("ignores the hidden condition block when only synthetics is chosen", () => {
    const v = valid();
    v.modules = ["synthetics"];
    v.targets.synthetics.tags_open = true;
    v.targets.synthetics.tags = ["team:checkout"];
    v.condition = conditionToBuilder({
      type: "group",
      op: "and",
      items: [{ type: "pair", key: "env", operator: "!=", value: "staging" }],
    });
    expect(errorsOf(v)).toEqual({});
  });

  it("accepts a module with All folders and nothing else; Save asks for it in a dialog", () => {
    expect(errorsOf({ ...valid(), condition_open: false })).toEqual({});
  });

  it("refuses an id outside the chosen folders", () => {
    const v = valid();
    v.targets.alerts.folders = ["payments"];
    v.targets.alerts.ids_open = true;
    v.targets.alerts.ids = ["a1"];
    const itemFolder = () => "ops";
    expect(errorsOf(v, { itemFolder })["targets.alerts.ids"]).toBe(
      "Some chosen items are not in the chosen folders.",
    );
  });

  it("checks a one-time window's order and length", () => {
    const v = valid();
    v.schedule = { ...v.schedule, end_date: v.schedule.start_date, end_time: "00:00" };
    v.schedule.start_time = "10:00";
    expect(errorsOf(v)["schedule.end_date"]).toBe("The end must be after the start.");
    v.schedule = {
      ...v.schedule,
      start_date: "2026-09-01",
      end_date: "2026-09-10",
      end_time: "10:00",
    };
    expect(errorsOf(v)["schedule.end_date"]).toBe("A window can last at most 7 days.");
  });

  it("checks a weekly rule's days and duration", () => {
    const v = valid();
    v.schedule = { ...v.schedule, repeat: "weekly", start_time: "02:00", duration: "soon" };
    const errors = errorsOf(v);
    expect(errors["schedule.weekdays"]).toBe("Choose at least one day.");
    expect(errors["schedule.duration"]).toBe("Enter a duration such as 90m or 1h 30m.");
  });

  it("maps an error path to the tab that shows it", () => {
    expect(tabForPath(["schedule", "duration"])).toBe("schedule");
    expect(tabForPath(["reason"])).toBe("advanced");
    expect(tabForPath(["targets", "alerts", "folders"])).toBe("targets");
    expect(tabForPath(["modules"])).toBe("targets");
  });

  it("needs the first day of a recurring schedule", () => {
    const v = valid();
    v.schedule = { ...v.schedule, repeat: "daily", start_date: "" };
    expect(errorsOf(v)["schedule.start_date"]).toBe("Choose the first day.");
    v.schedule.start_date = "2026-09-17";
    expect(errorsOf(v)).toEqual({});
  });
});

describe("AddDowntime schema, notifications", () => {
  const notifying = (patch: Partial<DowntimeFormValues["notifications"]>) => {
    const v = valid();
    v.notifications = {
      ...v.notifications,
      destinations: ["slack-oncall"],
      ending_soon: true,
      ended: true,
      ...patch,
    };
    return v;
  };

  it("accepts a destination with events and a lead inside the window", () => {
    expect(errorsOf(notifying({}))).toEqual({});
  });

  it("checks nothing while no destination is picked", () => {
    const v = valid();
    v.notifications.lead = "nonsense";
    v.notifications.ending_soon = true;
    expect(errorsOf(v)).toEqual({});
  });

  it("needs an event once a destination is picked", () => {
    expect(errorsOf(notifying({ ending_soon: false, ended: false }))["notifications.started"]).toBe(
      "Choose at least one event, or remove the destinations.",
    );
  });

  it("refuses a lead shorter than a minute or longer than the window", () => {
    const message = "The reminder must come between 1 minute and the window length before the end.";
    expect(errorsOf(notifying({ lead: "0m" }))["notifications.lead"]).toBe(message);
    expect(errorsOf(notifying({ lead: "2h" }))["notifications.lead"]).toBe(message);
    expect(errorsOf(notifying({ lead: "2h", ending_soon: false }))).toEqual({});
  });

  it("refuses more than ten destinations", () => {
    const destinations = Array.from({ length: 11 }, (_, i) => `d${i}`);
    expect(errorsOf(notifying({ destinations }))["notifications.destinations"]).toBe(
      "At most 10 destinations can be notified.",
    );
  });

  it("opens the schedule tab for a notification error", () => {
    expect(tabForPath(["notifications", "lead"])).toBe("schedule");
  });
});
