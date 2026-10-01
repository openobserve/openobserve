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

  it("asks for the confirmation tick when a module has All folders and nothing else", () => {
    const v = { ...valid(), condition_open: false };
    expect(errorsOf(v).confirm_all).toMatch(/^Tick the box/);
    expect(errorsOf({ ...v, confirm_all: true })).toEqual({});
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
    expect(tabForPath(["confirm_all"])).toBe("targets");
  });
});
