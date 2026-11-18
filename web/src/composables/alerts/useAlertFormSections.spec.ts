// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { computed, ref } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  useAlertFormSections,
  checkEveryLabel,
  reviewLineText,
  type FieldMetaMap,
} from "./useAlertFormSections";
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

const base = scheduled({
  stream_name: "default",
  stream_type: "logs",
  destinations: ["ops-slack"],
  trigger_condition: {
    operator: ">=",
    threshold: 1,
    period: 5,
    frequency: 5,
    frequency_type: "minutes",
    silence: 10,
  },
});

const setup = (
  formData: Record<string, unknown>,
  meta: FieldMetaMap = {},
  editing = false,
  incidentsEnabled = true,
) =>
  useAlertFormSections({
    fieldMeta: ref(meta),
    formData: ref(formData),
    anomalyConfig: ref({}),
    isAnomalyMode: ref(formData.is_real_time === "anomaly"),
    isAggregationEnabled: ref(false),
    isEditing: ref(editing),
    incidentsEnabled: ref(incidentsEnabled),
    t,
  });

const byId = (items: { id: string }[], id: string) => items.find((i) => i.id === id)!;

describe("useAlertFormSections", () => {
  it("names a composite's child alerts by letter, not by id", () => {
    const { items } = setup({
      ...scheduled(),
      is_real_time: "composite",
      composite_condition: { expression: "({id-b} && {id-a}) || !{id-b}" },
      children: [{ alert_id: "id-a" }, { alert_id: "id-b" }],
    });
    expect(byId(items.value, "condition").summary).toBe("(B AND A) OR NOT B");
  });

  it("counts a problem the save found outside the form against its section", () => {
    const { items, errorCounts } = useAlertFormSections({
      fieldMeta: ref({}),
      formData: ref(scheduled()),
      anomalyConfig: ref({}),
      isAnomalyMode: ref(false),
      isAggregationEnabled: ref(false),
      isEditing: ref(false),
      extraErrors: ref({ schedule: 1 }),
      t,
    });
    expect(errorCounts.value.schedule).toBe(1);
    expect(byId(items.value, "schedule").state).toBe("error");
  });

  it("lists the five sections with their questions in order", () => {
    const { items } = setup(scheduled());
    expect(items.value.map((i) => i.id)).toEqual([
      "watch",
      "condition",
      "notify",
      "schedule",
      "details",
    ]);
    expect(items.value[0].title).toBe("Alert type and data");
  });

  it("tags no step in the section list", () => {
    const { items } = setup(scheduled());
    expect(items.value.filter((i) => i.tag)).toEqual([]);
  });

  it("asks for a stream and a name until they are set", () => {
    const { items } = setup(scheduled());
    expect(byId(items.value, "watch")).toMatchObject({
      state: "attention",
      stateLabel: "Pick a stream",
      summary: "Pick a stream",
    });
    expect(byId(items.value, "details").state).toBe("attention");
  });

  it("ticks set sections and phrases them from the form", () => {
    const { items } = setup(
      scheduled({ stream_name: "k8s_logs", name: "errors", destinations: ["slack"] }),
    );
    expect(byId(items.value, "watch")).toMatchObject({ state: "done", summary: "k8s_logs" });
    expect(byId(items.value, "condition").summary).toBe("3+ events");
    expect(byId(items.value, "notify")).toMatchObject({ state: "done", summary: "slack" });
    expect(byId(items.value, "schedule").summary).toBe("Every 10 min");
  });

  it("says nobody is notified without marking the optional section as missing", () => {
    const { items } = setup(scheduled({ stream_name: "k8s_logs" }));
    expect(byId(items.value, "notify")).toMatchObject({ state: "none", summary: "No one yet" });
  });

  it("does not tick the condition before a stream is picked", () => {
    const { items } = setup(scheduled());
    expect(byId(items.value, "condition").state).toBe("none");
  });

  it("mentions the incident when it is the only one told", () => {
    const { items } = setup(scheduled({ stream_name: "k8s_logs", creates_incident: true }));
    expect(byId(items.value, "notify")).toMatchObject({
      state: "done",
      summary: "Opens an incident",
    });
  });

  it("ignores a stored incident flag where incidents are off", () => {
    const { items } = setup(
      scheduled({ stream_name: "k8s_logs", creates_incident: true }),
      {},
      false,
      false,
    );
    expect(byId(items.value, "notify")).toMatchObject({ state: "none", summary: "No one yet" });
  });

  it("adds the incident to the destinations it also notifies", () => {
    const { items } = setup(
      scheduled({ stream_name: "k8s_logs", creates_incident: true, destinations: ["slack"] }),
    );
    expect(byId(items.value, "notify").summary).toBe("slack and an incident");
  });

  it("keeps the last step's name while editing", () => {
    const { items } = setup(scheduled({ stream_name: "k8s_logs", name: "errors" }), {}, true);
    expect(byId(items.value, "details").title).toBe("Name it");
  });

  describe("anomaly condition", () => {
    const anomalySetup = (anomaly: Record<string, unknown>) =>
      useAlertFormSections({
        fieldMeta: ref({}),
        formData: ref(scheduled({ stream_name: "k8s_logs", is_real_time: "anomaly" })),
        anomalyConfig: ref(anomaly),
        isAnomalyMode: ref(true),
        isAggregationEnabled: ref(false),
        isEditing: ref(false),
        t,
      });

    it("waits for the measured field before ticking the step", () => {
      const { items } = anomalySetup({ query_mode: "filters", detection_function: "avg" });
      expect(byId(items.value, "condition").state).toBe("none");
    });

    it("waits for the SQL in SQL mode", () => {
      const { items } = anomalySetup({ query_mode: "custom_sql", custom_sql: " " });
      expect(byId(items.value, "condition").state).toBe("none");
    });

    it("ticks a complete detection", () => {
      const { items } = anomalySetup({ query_mode: "filters", detection_function: "count" });
      expect(byId(items.value, "condition").state).toBe("done");
    });
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

    it("names the on-call team an incident is opened for", () => {
      config.isEnterprise = "true";
      const { items } = setup(
        scheduled({ stream_name: "cpu", oncall_team: "team-1", creates_incident: true }),
      );
      expect(byId(items.value, "notify").summary).toBe("Opens an incident for team-1");
    });

    it("ignores an on-call team where on-call does not exist", () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const { items } = setup(scheduled({ stream_name: "cpu", oncall_team: "team-1" }));
      expect(byId(items.value, "notify").summary).toBe("No one yet");
    });
  });

  it("stays quiet about a section the user has not moved past", () => {
    const { items } = useAlertFormSections({
      fieldMeta: ref({}),
      formData: ref(scheduled()),
      anomalyConfig: ref({}),
      isAnomalyMode: ref(false),
      isAggregationEnabled: ref(false),
      isEditing: ref(false),
      visited: ref(new Set()),
      t,
    });
    expect(byId(items.value, "watch")).toMatchObject({ state: "none", summary: "Pick a stream" });
    expect(byId(items.value, "watch")).not.toHaveProperty("stateLabel", expect.anything());
    expect(byId(items.value, "condition").state).toBe("none");
  });

  it("phrases each event-count operator in words", () => {
    const summary = (operator: string) =>
      byId(
        setup(scheduled({ trigger_condition: { operator, threshold: 3 } })).items.value,
        "condition",
      ).summary;
    expect(summary(">")).toBe("more than 3 events");
    expect(summary("<=")).toBe("3 or fewer events");
    expect(summary("<")).toBe("fewer than 3 events");
    expect(summary("=")).toBe("exactly 3 events");
    expect(summary("!=")).toBe("not 3 events");
  });

  it("counts invalid fields per section from the form's field meta; a silence error counts against Who to tell", () => {
    const { items, errorCounts } = setup(scheduled({ stream_name: "k8s_logs", name: "x" }), {
      "trigger_condition.period": { errors: ["Required"] },
      "trigger_condition.silence": { errors: ["Required"] },
      "trigger_condition.threshold": { errors: [] },
    });
    expect(errorCounts.value.schedule).toBe(1);
    expect(errorCounts.value.notify).toBe(1);
    expect(byId(items.value, "schedule")).toMatchObject({
      state: "error",
      stateLabel: t("alerts.sections.needsFix", { count: 1 }, 1),
    });
    expect(byId(items.value, "condition").state).toBe("done");
  });

  it.each([
    { when: "a query that cannot save, before Save", invalid: true, extra: 0, state: "none" },
    { when: "a query that cannot save, after Save", invalid: true, extra: 1, state: "error" },
    { when: "a query that can save", invalid: false, extra: 0, state: "done" },
  ])("never ticks $when", ({ invalid, extra, state }) => {
    const { items } = useAlertFormSections({
      fieldMeta: ref({}),
      formData: ref(scheduled({ stream_name: "k8s_logs", name: "x" })),
      anomalyConfig: ref({}),
      isAnomalyMode: ref(false),
      isAggregationEnabled: ref(false),
      isEditing: ref(false),
      extraErrors: ref({ condition: extra }),
      invalid: computed(() => ({ condition: invalid })),
      t,
    });
    expect(byId(items.value, "condition").state).toBe(state);
    if (extra)
      expect(byId(items.value, "condition").stateLabel).toBe(
        t("alerts.sections.needsFix", { count: 1 }, 1),
      );
  });

  it.each([
    ["SQL", { type: "sql" }, ">=", "3+ rows"],
    ["SQL with a strict limit", { type: "sql" }, ">", "> 3 rows"],
    [
      "PromQL",
      { type: "promql", promql_condition: { operator: ">=", value: 80 } },
      ">=",
      "3+ series ≥ 80",
    ],
    ["PromQL with no value yet", { type: "promql", promql_condition: null }, ">=", "3+ series"],
  ])("counts %s results by their own noun", (_, query_condition, operator, summary) => {
    const fd = scheduled({ query_condition, trigger_condition: { operator, threshold: 3 } });
    expect(byId(setup(fd).items.value, "condition").summary).toBe(summary);
  });

  it.each([
    [
      "a scheduled alert",
      {},
      [
        "Watches Logs in default, on a schedule.",
        "Fires when 1+ events turn up in the last 5 min.",
        "Tells ops-slack, reminding at most every 10 min.",
        "Checks every 5 min, looking at the last 5 min.",
      ],
    ],
    [
      "a SQL alert on cron that opens an incident",
      {
        query_condition: { type: "sql" },
        destinations: [],
        creates_incident: true,
        trigger_condition: {
          ...base.trigger_condition,
          frequency_type: "cron",
          cron: "0 9 * * *",
          silence: 120,
        },
      },
      [
        "Watches Logs in default, on a schedule.",
        "Fires when the query returns 1+ rows in the last 5 min.",
        "Opens an incident, reminding at most every 2 h.",
        "Checks on the cron schedule 0 9 * * *, looking at the last 5 min.",
      ],
    ],
    [
      "a real-time alert telling nobody",
      { is_real_time: "true", destinations: [], trigger_condition: { silence: 0 } },
      [
        "Watches Logs in default, as events arrive.",
        "Fires on each matching event.",
        "Tells no one yet.",
        "Checks as events arrive.",
      ],
    ],
  ])("reads back %s in sentences", (_, over, sentences) => {
    const { review } = setup({ ...base, ...over });
    expect(review.value.map((line) => reviewLineText(line, t))).toEqual(sentences);
  });

  it("names the stream and its type in the watch summary", () => {
    const { items } = setup(scheduled({ stream_name: "default", stream_type: "logs" }));
    expect(byId(items.value, "watch").summary).toBe("default · Logs");
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
    expect(sectionOfField("query_condition.conditions.conditions[0].value")).toBe("condition");
    expect(sectionOfField("is_real_time")).toBe("watch");
    expect(sectionOfField("children")).toBe("condition");
    expect(sectionOfField("query_condition.aggregation.having.value")).toBe("condition");
    expect(sectionOfField("query_condition.promql_warning_value")).toBe("condition");
    expect(sectionOfField("trigger_condition.warning_threshold")).toBe("condition");
    expect(sectionOfField("pending_period_sec")).toBe("condition");
    expect(sectionOfField("destinations")).toBe("notify");
    expect(sectionOfField(AGGREGATION_ENABLED_FIELD)).toBe("condition");
    expect(sectionOfField("trigger_condition.frequency")).toBe("schedule");
    expect(sectionOfField("row_template_type")).toBe("notify");
    expect(sectionOfField("trigger_condition.silence")).toBe("notify");
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
