// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { ref } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { useAlertFormSections, checkEveryLabel, type FieldMetaMap } from "./useAlertFormSections";
import { AGGREGATION_ENABLED_FIELD, sectionOfField } from "@/components/alerts/alertFormSections";
import config from "@/aws-exports";

const t = i18n.global.t as unknown as TranslateFn;

const scheduled = (over: Record<string, unknown> = {}) => ({
  name: "",
  stream_name: "",
  is_real_time: "false",
  destinations: [],
  workflows: [],
  query_condition: { type: "custom", aggregation: null },
  trigger_condition: { operator: ">=", threshold: 3, frequency: 10, frequency_type: "minutes" },
  ...over,
});

const setup = (formData: Record<string, unknown>, meta: FieldMetaMap = {}, editing = false) =>
  useAlertFormSections({
    fieldMeta: ref(meta),
    formData: ref(formData),
    anomalyConfig: ref({}),
    isAnomalyMode: ref(formData.is_real_time === "anomaly"),
    isAggregationEnabled: ref(false),
    isEditing: ref(editing),
    t,
  });

const byId = (items: { id: string }[], id: string) => items.find((i) => i.id === id)!;

describe("useAlertFormSections", () => {
  it("lists the five sections with their questions in order", () => {
    const { items } = setup(scheduled());
    expect(items.value.map((i) => i.id)).toEqual([
      "watch",
      "condition",
      "notify",
      "schedule",
      "details",
    ]);
    expect(items.value[0].title).toBe("What should we watch?");
  });

  it("asks for a stream and a name until they are set", () => {
    const { items } = setup(scheduled());
    expect(byId(items.value, "watch")).toMatchObject({
      state: "attention",
      stateLabel: "Needs a value",
      summary: "Pick a stream",
    });
    expect(byId(items.value, "details").state).toBe("attention");
  });

  it("ticks set sections and phrases them from the form", () => {
    const { items } = setup(
      scheduled({ stream_name: "k8s_logs", name: "errors", destinations: ["slack"] }),
    );
    expect(byId(items.value, "watch")).toMatchObject({ state: "done", summary: "k8s_logs" });
    expect(byId(items.value, "condition").summary).toBe("Count >= 3");
    expect(byId(items.value, "notify")).toMatchObject({ state: "done", summary: "1 destination" });
    expect(byId(items.value, "schedule").summary).toBe("Every 10 min");
  });

  it("says nobody is notified without marking the optional section as missing", () => {
    const { items } = setup(scheduled({ stream_name: "k8s_logs" }));
    expect(byId(items.value, "notify")).toMatchObject({ state: "none", summary: "Nobody yet" });
  });

  describe("on-call delivery", () => {
    const { isEnterprise, isCloud } = config;
    afterEach(() => {
      config.isEnterprise = isEnterprise;
      config.isCloud = isCloud;
    });

    it("counts an on-call team as someone notified where on-call exists", () => {
      config.isEnterprise = "true";
      const { items } = setup(scheduled({ stream_name: "cpu", oncall_team: "team-1" }));
      expect(byId(items.value, "notify")).toMatchObject({
        state: "done",
        summary: "1 destination",
      });
    });

    it("ignores an on-call team where on-call does not exist", () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const { items } = setup(scheduled({ stream_name: "cpu", oncall_team: "team-1" }));
      expect(byId(items.value, "notify").summary).toBe("Nobody yet");
    });
  });

  it("counts invalid fields per section from the form's field meta", () => {
    const { items, errorCounts } = setup(scheduled({ stream_name: "k8s_logs", name: "x" }), {
      "trigger_condition.period": { errors: ["Required"] },
      "trigger_condition.silence": { errors: ["Required"] },
      "trigger_condition.threshold": { errors: [] },
    });
    expect(errorCounts.value.schedule).toBe(2);
    expect(byId(items.value, "schedule")).toMatchObject({
      state: "error",
      stateLabel: "Needs a fix · 2",
    });
    expect(byId(items.value, "condition").state).toBe("done");
  });

  it("shows a muted tick while editing a saved alert", () => {
    const { items } = setup(scheduled({ stream_name: "k8s_logs", name: "x" }), {}, true);
    expect(byId(items.value, "watch").state).toBe("saved");
  });
});

describe("checkEveryLabel", () => {
  it("names the schedule in minutes, whole hours or cron", () => {
    expect(checkEveryLabel(scheduled(), t)).toBe("Every 10 min");
    expect(checkEveryLabel(scheduled({ trigger_condition: { frequency: 120 } }), t)).toBe(
      "Every 2 h",
    );
    expect(checkEveryLabel(scheduled({ trigger_condition: { frequency_type: "cron" } }), t)).toBe(
      "On a cron schedule",
    );
  });
});

describe("sectionOfField", () => {
  it("maps form paths to the section that shows them", () => {
    expect(sectionOfField("stream_name")).toBe("watch");
    expect(sectionOfField("query_condition.conditions.conditions[0].value")).toBe("watch");
    expect(sectionOfField("query_condition.aggregation.having.value")).toBe("condition");
    expect(sectionOfField("query_condition.promql_warning_value")).toBe("condition");
    expect(sectionOfField("trigger_condition.warning_threshold")).toBe("condition");
    expect(sectionOfField("pending_period_sec")).toBe("condition");
    expect(sectionOfField("destinations")).toBe("notify");
    expect(sectionOfField(AGGREGATION_ENABLED_FIELD)).toBe("condition");
    expect(sectionOfField("trigger_condition.frequency")).toBe("schedule");
    expect(sectionOfField("row_template_type")).toBe("details");
  });
  it("in edit mode mutes saved sections and words the changed ones", () => {
    const { items } = useAlertFormSections({
      fieldMeta: ref({}),
      formData: ref(scheduled({ name: "errors", stream_name: "default", destinations: ["d"] })),
      anomalyConfig: ref({}),
      isAnomalyMode: ref(false),
      isAggregationEnabled: ref(false),
      isEditing: ref(true),
      changedSections: ref(new Set(["condition" as const])),
      t,
    });
    expect(byId(items.value, "watch").state).toBe("saved");
    expect(byId(items.value, "condition")).toMatchObject({
      state: "changed",
      stateLabel: "Changed",
    });
  });
});
