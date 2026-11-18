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
import {
  AGGREGATION_ENABLED_FIELD,
  conditionPresetFor,
  sectionOfField,
} from "@/components/alerts/alertFormSections";
import config from "@/aws-exports";

const t = i18n.global.t as unknown as TranslateFn;
const SQL = "SELECT count(*) FROM default";
const FIX_QUERY = "alerts.sections.condition.fixQuery";

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
  queryFailed = false,
  extra: { anomaly?: Record<string, unknown>; aggregation?: boolean } = {},
) =>
  useAlertFormSections({
    fieldMeta: ref(meta),
    formData: ref(formData),
    anomalyConfig: ref(extra.anomaly ?? {}),
    isAnomalyMode: ref(formData.is_real_time === "anomaly"),
    isAggregationEnabled: ref(extra.aggregation ?? false),
    isEditing: ref(editing),
    incidentsEnabled: ref(incidentsEnabled),
    queryFailed: ref(queryFailed),
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

  it.each([
    ["false", ["watch", "condition", "notify", "schedule", "details"]],
    ["anomaly", ["watch", "condition", "notify", "schedule", "details"]],
    ["true", ["watch", "condition", "notify", "details"]],
    ["composite", ["watch", "condition", "notify", "details"]],
  ])("lists the sections a %s alert has, in order", (type, ids) => {
    const { items, sections } = setup(scheduled({ is_real_time: type }));
    expect(items.value.map((i) => i.id)).toEqual(ids);
    expect(sections.value.map((s) => s.id)).toEqual(ids);
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
    expect(summary("<=")).toBe("at most 3 events");
    expect(summary("<")).toBe("less than 3 events");
    expect(summary("=")).toBe("exactly 3 events");
    expect(summary("!=")).toBe("not exactly 3 events");
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
    ["SQL", { type: "sql", sql: SQL }, ">=", "3+ rows"],
    ["SQL with a strict limit", { type: "sql", sql: SQL }, ">", "> 3 rows"],
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
        "Fires when 1 or more events match in the last 5 minutes.",
        "Tells ops-slack, notifying at most every 10 minutes.",
        "Checks every 5 minutes, looking at the last 5 minutes.",
      ],
    ],
    [
      "a SQL alert on cron that opens an incident",
      {
        query_condition: { type: "sql", sql: SQL },
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
        "Fires when the query returns 1 or more rows in the last 5 minutes.",
        "Opens an incident, notifying at most every 2 hours.",
        "Checks on the cron schedule 0 9 * * *, looking at the last 5 minutes.",
      ],
    ],
    [
      "a real-time alert telling nobody",
      { is_real_time: "true", destinations: [], trigger_condition: { silence: 0 } },
      ["Watches Logs in default.", "Fires on each matching event.", "Tells no one yet."],
    ],
    [
      "a traces alert checking every minute",
      {
        stream_type: "traces",
        trigger_condition: { ...base.trigger_condition, frequency: 1, silence: 1 },
      },
      [
        "Watches Traces in default, on a schedule.",
        "Fires when 1 or more spans match in the last 5 minutes.",
        "Tells ops-slack, notifying at most every minute.",
        "Checks every minute, looking at the last 5 minutes.",
      ],
    ],
    [
      "a combined alert with no alerts yet",
      { is_real_time: "composite", children: [], composite_condition: null },
      [
        "No alerts picked yet.",
        "Fires once you choose how its alerts combine.",
        "Tells ops-slack, notifying at most every 10 minutes.",
        "Checks whenever one of its alerts changes state.",
      ],
    ],
  ])("reads back %s in sentences", (_, over, sentences) => {
    const { review } = setup({ ...base, ...over });
    expect(review.value.map((line) => reviewLineText(line, t))).toEqual(sentences);
  });

  const metrics = { ...base, stream_type: "metrics" };
  it.each([
    [
      "a measure",
      {
        query_condition: {
          type: "custom",
          aggregation: { function: "avg", having: { column: "value", operator: ">=", value: 1 } },
        },
      },
      "avg of value ≥ 1",
      "Fires when avg of value is at least 1 in the last 5 minutes.",
    ],
    [
      "PromQL with one alert",
      { query_condition: { type: "promql", promql_condition: { operator: ">=", value: 1 } } },
      "1+ series ≥ 1",
      "Fires when 1 or more series are at least 1 at any point in the last 5 minutes.",
    ],
    [
      "PromQL with one alert per series",
      {
        query_condition: {
          type: "promql",
          promql_multi_alert: true,
          promql_condition: { operator: "<", value: 0.5 },
        },
      },
      "< 0.5",
      "Fires for each series whose latest value is less than 0.5.",
    ],
    [
      "a forecast",
      {
        query_condition: {
          type: "promql",
          promql_multi_alert: true,
          promql_condition: { operator: "<=", value: 7 },
        },
        _ui: { forecast: { T: 90, W: "2d", direction: "rises" } },
      },
      "Reaches 90 within 7 days",
      "Fires when a series is forecast to rise to 90 within 7 days, based on the last 2 days.",
    ],
    [
      "a forecast with no threshold yet",
      {
        query_condition: { type: "promql", promql_condition: { operator: "<=", value: 7 } },
        _ui: { forecast: { T: "", W: "2d", direction: "rises" } },
      },
      "Forecast needs a threshold",
      "Forecast needs a threshold",
    ],
  ])("reads %s on metrics in symbols in the list and words in the review", (_, over, nav, line) => {
    const { items, review } = setup({ ...metrics, ...over }, {}, false, true, false, {
      aggregation: true,
    });
    expect(byId(items.value, "condition").summary).toBe(nav);
    expect(reviewLineText(byId(review.value, "condition") as never, t)).toBe(line);
  });

  it("reads a forecast's schedule as a trend fit, and an anomaly's measure and window", () => {
    const forecast = setup({
      ...metrics,
      query_condition: { type: "promql", promql_condition: { operator: "<=", value: 7 } },
      _ui: { forecast: { T: 90, W: "2d" } },
      trigger_condition: { ...base.trigger_condition, frequency: 30 },
    });
    expect(reviewLineText(byId(forecast.review.value, "schedule") as never, t)).toBe(
      "Checks every 30 minutes, fitting the trend over the last 2 days.",
    );
    const anomaly = setup({ ...base, is_real_time: "anomaly" }, {}, false, true, false, {
      anomaly: {
        detection_function: "count",
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
        schedule_interval_value: 1,
        schedule_interval_unit: "h",
        detection_window_value: 3,
        detection_window_unit: "h",
        alert_direction: "both",
      },
    });
    expect(anomaly.review.value.map((l) => reviewLineText(l, t))).toEqual([
      "Watches Logs in default for unusual values.",
      "Fires when count per 5 minutes is unusual (spikes or drops).",
      "Tells no one yet.",
      "Checks every hour, looking at the last 3 hours.",
    ]);
  });

  it.each([
    ["a SQL alert with no query", { type: "sql", sql: "" }, 3, "alerts.saveModeDialog.noQuery"],
    ["a negative limit", { type: "custom" }, -5, "alerts.sections.condition.fixLimit"],
    ["a fractional limit", { type: "custom" }, 2.5, "alerts.sections.condition.fixLimit"],
    ["an emptied limit", { type: "sql", sql: SQL }, "", "alerts.sections.condition.fixLimit"],
    ["a SQL query that fails", { type: "sql", sql: SQL }, 3, FIX_QUERY, true],
    ["a PromQL query that fails", { type: "promql", promql: "up" }, 3, FIX_QUERY, true],
    ["a builder query whose SQL fails", { type: "custom" }, 3, FIX_QUERY, true],
  ] as const)(
    "flags %s in the list and the read-back",
    (_, query_condition, threshold, key, failed = false) => {
      const fd = {
        ...base,
        query_condition,
        trigger_condition: { ...base.trigger_condition, threshold },
      };
      const { items, review } = setup(fd, {}, false, true, failed);
      expect(byId(items.value, "condition")).toMatchObject({
        state: "attention",
        stateLabel: t(key),
        summary: t(key),
      });
      expect(reviewLineText(byId(review.value, "condition") as never, t)).toBe(t(key));
    },
  );

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
    expect(checkEveryLabel(scheduled({ trigger_condition: { frequency: 1 } }), t)).toBe(
      "Every minute",
    );
    expect(checkEveryLabel(scheduled(), t)).toBe("Every 10 min");
    expect(checkEveryLabel(scheduled({ trigger_condition: { frequency: 120 } }), t)).toBe(
      "Every 2 h",
    );
    expect(checkEveryLabel(scheduled({ trigger_condition: { frequency_type: "cron" } }), t)).toBe(
      "On a cron schedule",
    );
  });
});

describe("conditionPresetFor", () => {
  it.each([
    [">=", 5, "few"],
    [">=", 7, "custom"],
    [">=", -5, undefined],
    [">=", 2.5, undefined],
    [">=", "", undefined],
    [">", 5, undefined],
  ])("picks the card for %s %s", (operator, threshold, card) => {
    expect(conditionPresetFor({ operator, threshold })).toBe(card);
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
