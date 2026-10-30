// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { raw, type TranslateFn } from "@/types/i18n";
import {
  changeLabel,
  changeValueText,
  changedSections,
  diffAlertValues,
  sameValue,
} from "./alertFormDiff";

const t = ((key: string) => raw(key)) as unknown as TranslateFn;

const loaded = () => ({
  name: "errors",
  stream_name: "default",
  trigger_condition: {
    threshold: 3,
    operator: ">=",
    period: 10,
    frequency: 10,
    frequency_type: "minutes",
    cron: "",
    timezone: "UTC",
    silence: 10,
  },
  query_condition: {
    conditions: { or: [{ column: "level", operator: "=", value: "error" }] },
    aggregation: null,
  },
  destinations: ["slack"],
  _ui: { checkEvery: 10 },
  _meta: { tab: "custom" },
});

describe("diffAlertValues", () => {
  it("is empty for the loaded alert itself", () => {
    expect(diffAlertValues(loaded(), loaded())).toEqual([]);
  });

  it("counts one entry per changed field, not per keystroke", () => {
    const after = loaded();
    after.trigger_condition.threshold = 7;
    after.trigger_condition.period = 15;
    const changes = diffAlertValues(loaded(), after);
    expect(changes.map((c) => c.path)).toEqual([
      "trigger_condition.threshold",
      "trigger_condition.period",
    ]);
    expect(changes[0]).toMatchObject({ before: 3, after: 7 });
  });

  it("reads a number typed as text, and blank against absent, as unchanged", () => {
    const after = loaded() as any;
    after.trigger_condition.threshold = "3";
    after.description = "";
    after.tags = [];
    expect(diffAlertValues(loaded(), after)).toEqual([]);
  });

  it("counts a whole filter tree as one change", () => {
    const after = loaded();
    after.query_condition.conditions = {
      or: [
        { column: "level", operator: "=", value: "warn" },
        { column: "code", operator: ">", value: "500" },
      ],
    };
    expect(diffAlertValues(loaded(), after).map((c) => c.path)).toEqual([
      "query_condition.conditions",
    ]);
  });

  it("ignores display-only form state", () => {
    const after = loaded();
    after._ui.checkEvery = 60;
    after._meta.tab = "sql";
    expect(diffAlertValues(loaded(), after)).toEqual([]);
  });

  it("ignores the cron fields of an alert that runs every N minutes", () => {
    const after = loaded();
    after.trigger_condition.cron = "0 */15 * * * *";
    expect(diffAlertValues(loaded(), after)).toEqual([]);
  });

  it("ignores the minute frequency of an alert that runs on a cron", () => {
    const before = loaded();
    before.trigger_condition.frequency_type = "cron";
    before.trigger_condition.cron = "0 0 * * * *";
    const after = loaded();
    after.trigger_condition.frequency_type = "cron";
    after.trigger_condition.cron = "0 30 * * * *";
    after.trigger_condition.frequency = 30;
    expect(diffAlertValues(before, after).map((c) => c.path)).toEqual(["trigger_condition.cron"]);
  });

  it("reports a destination list change once", () => {
    const after = loaded();
    after.destinations = ["slack", "pagerduty"];
    expect(diffAlertValues(loaded(), after).map((c) => c.path)).toEqual(["destinations"]);
  });
});

describe("diff helpers", () => {
  it("compares objects by content, not key order", () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("names known fields and falls back to the path", () => {
    expect(changeLabel("trigger_condition.period", t)).toBe(
      "alerts.editMode.unsaved.fields.lookBack",
    );
    expect(changeLabel("some.new_field", t)).toBe("some.new_field");
  });

  it("prints values plainly, a tree as edited and blank as none", () => {
    expect(changeValueText(5, t)).toBe("5");
    expect(changeValueText(["a", "b"], t)).toBe("a, b");
    expect(changeValueText(null, t)).toBe("alerts.editMode.unsaved.empty");
    expect(changeValueText({ or: [] }, t, "query_condition.conditions")).toBe(
      "alerts.editMode.unsaved.edited",
    );
    expect(String(changeValueText("x".repeat(80), t)).length).toBe(40);
  });

  it("maps each change to the section that holds it", () => {
    const sections = changedSections([
      { path: "trigger_condition.threshold", before: 1, after: 2 },
      { path: "trigger_condition.period", before: 1, after: 2 },
      { path: "destinations", before: [], after: ["x"] },
    ]);
    expect([...sections].sort()).toEqual(["condition", "notify", "schedule"]);
  });
});
