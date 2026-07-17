// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// ── AddAlert orchestrator (OForm + Zod owner pattern) ────────────────────────
// Behaviour-first spec. The wizard OWNS the ONE <OForm>; these tests drive the
// real form (form.handleSubmit) and assert schema-gated block-on-invalid + the
// EXACT save payload (Rule ④). Heavy step children are stubbed (the form is the
// single source of truth, so the save chain doesn't depend on their markup); the
// composed schema still validates from the seeded form values + default `_meta`.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { nextTick } from "vue";
import AddAlert from "@/components/alerts/AddAlert.vue";
import alertsService from "@/services/alerts";
import { toast } from "@/lib/feedback/Toast/useToast";
import anomalyDetectionService from "@/services/anomaly_detection";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { generateWhereClause } from "@/utils/alerts/alertQueryBuilder";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "field1", type: "string" },
        { name: "field2", type: "int" },
      ],
    }),
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
  }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));

// NOTE: `cron-parser` is deliberately NOT mocked. It is a pure, fast library and
// the cron save gate below asserts real interval math. (There used to be a
// `{ default: { parseExpression: vi.fn() } }` mock here — stale: queryUtils calls
// `CronExpressionParser.parse`, so the mock made EVERY expression, valid or not,
// throw "Invalid cron expression". queryUtils.spec.ts uses the real parser too.)

vi.mock("@/utils/zincutils", async () => {
  const actual: any = await vi.importActual("@/utils/zincutils");
  return {
    ...actual,
    getUUID: vi.fn(() => "mock-uuid"),
    getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
  } as any;
});

// Toast returns a dismiss fn (loading toast). No-op in tests.
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

vi.mock("@/services/alerts", () => ({
  default: {
    create_by_alert_id: vi.fn(() =>
      Promise.resolve({ data: { code: 200, message: "Alert saved" } }),
    ),
    update_by_alert_id: vi.fn(() => Promise.resolve({ data: { success: true } })),
    generate_sql: vi.fn(() => Promise.resolve({ data: { sql: "SELECT * FROM test" } })),
  },
}));

vi.mock("@/services/anomaly_detection", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => Promise.resolve({ data: { id: "anom-1" } })),
    update: vi.fn(() => Promise.resolve({ data: { id: "anom-1" } })),
    triggerTraining: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PreviewAlert: true,
  AlertSummary: true,
  // Custom stub exposing validate() so the template ref (anomalyStep2Ref) the
  // orchestrator calls during saveAnomalyDetection resolves truthy.
  AnomalyDetectionConfig: {
    template: "<div />",
    methods: { async validate() { return true; } },
  },
  AnomalyAlerting: true,
  AnomalySummary: true,
  QueryEditor: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  AppPageHeader: true,
};

const mountAlert = (
  props: Record<string, any> = {},
  options: Record<string, any> = {},
) =>
  mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n, router], stubs },
    props,
    ...options,
  });

/** Seed a complete, valid scheduled-custom alert into the ONE form. */
const seedValidScheduled = (form: any) => {
  form.setFieldValue("name", "test_alert");
  form.setFieldValue("stream_type", "logs");
  form.setFieldValue("stream_name", "_rundata");
  form.setFieldValue("destinations", ["dest1"]);
  form.setFieldValue("query_condition.type", "custom");
  form.setFieldValue("trigger_condition", {
    period: 10,
    operator: ">=",
    frequency: 10,
    cron: "",
    threshold: 3,
    silence: 10,
    frequency_type: "minutes",
    timezone: "UTC",
  });
};

describe("AddAlert (OForm owner)", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
  });

  describe("owner pattern wiring", () => {
    it("owns the ONE form and exposes formData as a read-view + _meta seeded", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.vm.form).toBeTruthy();
      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData._meta).toBeTruthy();
      expect(wrapper.vm.formData.is_real_time).toBe("false");
    });
  });

  describe("schema-gated save (block-on-invalid)", () => {
    it("blocks save when required fields are empty and does NOT call the create service", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("blocks save when only the name is missing", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("name", ""); // clear name

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("blocks save when the name contains unsupported characters (§4 restore)", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("name", "bad name"); // space is unsupported

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("blocks save when there are no destinations", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("destinations", []);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });
  });

  // The pre-save gates that are NOT schema rules — re-homed from the old
  // QueryConfig.validate() into useAlertForm.runImperativeQueryChecks (run at
  // the top of onSubmit, i.e. only after the composed schema passes). Same
  // toast messages as pre-migration.
  describe("imperative query-text gates (runImperativeQueryChecks)", () => {
    it("blocks a SQL save when the SQL query is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", "");

      await form.handleSubmit();
      await flushPromises();

      // The schema passes (query text is not a schema rule) …
      expect(form.state.isValid).toBe(true);
      // … but the imperative gate blocks the save with the same toast.
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "SQL query cannot be empty." }),
      );
    });

    it("blocks a SQL save while a SQL validation error is present", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", "SELECT * FROM logs");
      wrapper.vm.sqlQueryErrorMsg = "Invalid syntax";

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Please fix the SQL error before saving.",
        }),
      );
    });

    it("blocks a PromQL save when the PromQL query is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "promql");
      form.setFieldValue("query_condition.promql", "");

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "PromQL query cannot be empty." }),
      );
    });

    // The measure-column rule is SCHEMA-owned (QueryConfig.schema.ts), not an
    // imperative toast — that is what lets the name-bound <OFormSelect> paint
    // itself red (it derives `:error` from the field's own errors). So these
    // assert the FIELD ERROR, not a toast, and must seed `_meta` (QueryConfig is
    // stubbed here, so nothing bridges the discriminators in).
    const seedMeasureAggregation = (form: any, column: string) => {
      form.setFieldValue("query_condition.type", "custom");
      form.setFieldValue("query_condition.aggregation", {
        function: "avg",
        group_by: [],
        having: { column, operator: ">=", value: 10 },
      });
      form.setFieldValue("_meta.selectedFunction", "avg");
      form.setFieldValue("_meta.aggregationEnabled", true);
    };

    it("blocks a custom measure save when the aggregation column is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      seedMeasureAggregation(form, "");
      wrapper.vm.isAggregationEnabled = true;

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(form.state.isValid).toBe(false);
      // The error lands on the exact path both the logs and the metrics
      // <OFormSelect> bind, so the field renders it (red border + message).
      const errors =
        form.getFieldMeta("query_condition.aggregation.having.column")?.errors ??
        [];
      expect(errors.map((e: any) => e?.message ?? e)).toContain(
        "Column is required when using an aggregate function.",
      );
    });

    it("blocks a custom measure save when the aggregation column is only whitespace", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      seedMeasureAggregation(form, "   ");
      wrapper.vm.isAggregationEnabled = true;

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(form.state.isValid).toBe(false);
    });

    it("does NOT block a custom measure save when the aggregation column is set", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      seedMeasureAggregation(form, "field2");
      wrapper.vm.isAggregationEnabled = true;

      await form.handleSubmit();
      await flushPromises();

      const errors =
        form.getFieldMeta("query_condition.aggregation.having.column")?.errors ??
        [];
      expect(errors).toHaveLength(0);
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cron save gates (R4 RESTORE) ──────────────────────────────────────────
  // Pre-migration AlertSettings.validate() ran validateFrequency() first and
  // returned {valid:false, message:cronJobError}; the orchestrator blocked the
  // save, toasted `if (message)`, and switched to the condition tab. After the
  // migration QueryConfig still RENDERED cronError but nothing gated save — a
  // 1-second cron saved happily. Re-homed into runImperativeQueryChecks.
  describe("cron save gates (runImperativeQueryChecks)", () => {
    const seedCron = (form: any, cron: string, timezone = "UTC") => {
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "custom");
      form.setFieldValue("trigger_condition", {
        period: 10,
        operator: ">=",
        frequency: 10,
        cron,
        threshold: 3,
        silence: 10,
        frequency_type: "cron",
        timezone,
      });
    };

    /** Set the org floor (SECONDS) on the shared test store, restoring after. */
    const withMinInterval = (secs: number | undefined) => {
      const prev = store.state.zoConfig;
      store.state.zoConfig = { ...prev, min_auto_refresh_interval: secs };
      return () => {
        store.state.zoConfig = prev;
      };
    };

    it("blocks a cron save when the interval is below the org minimum", async () => {
      const restore = withMinInterval(300); // 5 minutes
      try {
        wrapper = mountAlert();
        await flushPromises();
        const form = wrapper.vm.form;
        // Every minute = 60s < 300s.
        seedCron(form, "0 * * * * *");

        await form.handleSubmit();
        await flushPromises();

        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
        // Verbatim pre-migration message (minInterval - 1).
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Frequency should be greater than 299 seconds.",
          }),
        );
        expect(wrapper.vm.activeTab).toBe("condition");
      } finally {
        restore();
      }
    });

    it("blocks a cron save when the expression is invalid", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedCron(form, "not-a-cron");

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Invalid cron expression" }),
      );
      expect(wrapper.vm.activeTab).toBe("condition");
    });

    it("blocks a cron save when the timezone is missing (inline-only, NO toast)", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedCron(form, "0 */10 * * * *", "");

      await form.handleSubmit();
      await flushPromises();

      // Pre-migration returned {valid:false, message:null} here and the
      // orchestrator only toasted `if (message)` — so this case blocks + moves
      // to the condition tab WITHOUT a toast (QueryConfig renders the inline
      // "Cron expression and timezone are required").
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(wrapper.vm.activeTab).toBe("condition");
    });

    it("blocks a cron save when the expression is missing", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedCron(form, "");

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("ALLOWS a cron save when the interval clears the org minimum", async () => {
      const restore = withMinInterval(300);
      try {
        wrapper = mountAlert();
        await flushPromises();
        const form = wrapper.vm.form;
        // Every 10 minutes = 600s > 300s.
        seedCron(form, "0 */10 * * * *");

        await form.handleSubmit();
        await flushPromises();

        expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });

    it("does NOT run the cron gate in minutes mode", async () => {
      const restore = withMinInterval(300);
      try {
        wrapper = mountAlert();
        await flushPromises();
        const form = wrapper.vm.form;
        seedValidScheduled(form);
        // A garbage cron is irrelevant while frequency_type is 'minutes'.
        form.setFieldValue("trigger_condition.cron", "not-a-cron");
        // 10 min clears the 5-min floor, so the schema rule passes too.
        form.setFieldValue("_ui.checkEvery", 10);

        await form.handleSubmit();
        await flushPromises();

        expect(toast).not.toHaveBeenCalledWith(
          expect.objectContaining({ message: "Invalid cron expression" }),
        );
        expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });
  });

  describe("create save path (payload parity — Rule ④)", () => {
    it("creates an alert with the EXACT payload (keys + types + conditions {version:2})", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);

      const [orgId, payload, folderId] =
        (alertsService.create_by_alert_id as any).mock.calls[0];

      expect(orgId).toBe("default");
      expect(folderId).toBeDefined();

      // ── EXACT top-level key set (Rule ④ payload parity) ──────────────────
      // Asserted as a SET, not key-by-key: a subset check cannot catch a NEW
      // form-only key leaking to the backend. The form value set is cloneDeep'd
      // wholesale into the payload, so every key seeded into the form ships
      // unless getAlertPayload drops it (it strips uuid/_ui/_meta/logGroupBy —
      // alertPayload.ts:70-84). This list = defaultAlertValue()'s 20 keys
      // (useAlertForm.ts:107-161); prepareAndSaveAlert only re-stamps keys that
      // already exist (folder_id/createdAt/owner/lastTriggeredAt/lastEditedBy).
      // If this fails, do NOT just add the key — check whether it BELONGS on the
      // wire or needs stripping in getAlertPayload.
      expect(Object.keys(payload).sort()).toEqual(
        [
          "context_attributes",
          "createdAt",
          "creates_incident",
          "description",
          "destinations",
          "enabled",
          "folder_id",
          "is_real_time",
          "lastEditedBy",
          "lastTriggeredAt",
          "name",
          "owner",
          "query_condition",
          "row_template",
          "row_template_type",
          "stream_name",
          "stream_type",
          "template",
          "trigger_condition",
          "updatedAt",
        ].sort(),
      );

      // is_real_time coerced string → boolean
      expect(payload.is_real_time).toBe(false);
      // numeric trigger fields parseInt'd to numbers
      expect(payload.trigger_condition.threshold).toBe(3);
      expect(typeof payload.trigger_condition.threshold).toBe("number");
      expect(payload.trigger_condition.period).toBe(10);
      expect(payload.trigger_condition.frequency).toBe(10);
      expect(payload.trigger_condition.silence).toBe(10);
      // context_attributes array → object (empty here)
      expect(payload.context_attributes).toEqual({});
      // custom + aggregation disabled → aggregation null
      expect(payload.query_condition.aggregation).toBeNull();
      // sql/custom → promql_condition null
      expect(payload.query_condition.promql_condition).toBeNull();
      // conditions wrapped { version: 2, conditions }
      expect(payload.query_condition.conditions).toHaveProperty("version", 2);
      expect(payload.query_condition.conditions).toHaveProperty("conditions");
      expect(payload.query_condition.conditions.conditions.filterType).toBe("group");
      // owner / lastEditedBy from store.state.userInfo.email (create path)
      expect(payload.owner).toBe(store.state.userInfo.email);
      expect(payload.lastEditedBy).toBe(store.state.userInfo.email);
      expect(payload.createdAt).toBeDefined();
      // uuid stripped
      expect(payload.uuid).toBeUndefined();

      expect(alertsService.update_by_alert_id).not.toHaveBeenCalled();
    });
  });

  describe("update save path", () => {
    it("updates an existing alert via update_by_alert_id (beingUpdated)", async () => {
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: {
          name: "existing_alert",
          stream_type: "logs",
          stream_name: "_rundata",
          is_real_time: "false",
          query_condition: {
            type: "custom",
            conditions: {
              filterType: "group",
              logicalOperator: "AND",
              groupId: "g1",
              conditions: [],
            },
            sql: "",
            promql: "",
            aggregation: null,
            promql_condition: null,
            vrl_function: null,
            multi_time_range: [],
          },
          trigger_condition: {
            period: 10,
            operator: ">=",
            frequency: 10,
            cron: "",
            threshold: 5,
            silence: 10,
            frequency_type: "minutes",
            timezone: "UTC",
          },
          destinations: ["email"],
          context_attributes: {},
          enabled: true,
          description: "",
          row_template: "",
          row_template_type: "String",
        },
        destinations: [{ name: "email" }],
      });
      await flushPromises();
      const form = wrapper.vm.form;

      expect(wrapper.vm.beingUpdated).toBe(true);
      // edit-prefill seeded the form via form.reset
      expect(form.state.values.name).toBe("existing_alert");
      expect(form.state.values.destinations).toEqual(["email"]);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();

      const payload = (alertsService.update_by_alert_id as any).mock.calls[0][1];
      expect(payload.is_real_time).toBe(false);
      expect(payload.trigger_condition.threshold).toBe(5);
      expect(payload.query_condition.conditions).toHaveProperty("version", 2);
      // update path stamps lastEditedBy + updatedAt
      expect(payload.lastEditedBy).toBe(store.state.userInfo.email);
      expect(payload.updatedAt).toBeDefined();
    });
  });

  describe("anomaly save path", () => {
    it("saves via anomalyDetectionService.create with the anomaly_config payload", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      // Switch to anomaly mode first; the is_real_time watcher re-seeds
      // anomalyConfig from formData, so set the anomaly fields AFTER it settles.
      form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      // name/stream_type/stream_name are FORM fields in anomaly mode too (the
      // topbar binds all three), and useAlertForm's watcher copies them into
      // anomalyConfig for the payload. Drive them through the form like the real
      // UI does — writing anomalyConfig directly is the pre-migration dual-source
      // path, and that watcher fires on any of the three and rewrites all three,
      // so a direct write gets clobbered by the next form edit anyway.
      form.setFieldValue("name", "anom_alert");
      form.setFieldValue("stream_type", "logs");
      form.setFieldValue("stream_name", "_rundata");
      await flushPromises();
      wrapper.vm.anomalyConfig.alert_enabled = false; // no destination requirement
      wrapper.vm.anomalyConfig.query_mode = "filters";

      await wrapper.vm.handleSave();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(anomalyDetectionService.create).toHaveBeenCalledTimes(1);

      const [orgId, payload] = (anomalyDetectionService.create as any).mock.calls[0];
      expect(orgId).toBe("default");
      expect(payload.alert_type).toBe("anomaly_detection");
      expect(payload.name).toBe("anom_alert");
      expect(payload.stream_name).toBe("_rundata");
      expect(payload.anomaly_config).toBeTruthy();
      expect(payload.anomaly_config.query_mode).toBe("filters");
    });

    it("blocks anomaly save when the anomaly name is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      form.setFieldValue("is_real_time", "anomaly");
      form.setFieldValue("name", "");
      await flushPromises();

      await wrapper.vm.handleSave();
      await flushPromises();

      expect(anomalyDetectionService.create).not.toHaveBeenCalled();
    });

    // The blank name used to be an imperative toast inside saveAnomalyDetection,
    // which cannot paint a field — so the topbar stayed unhighlighted while the
    // toast said to fix the highlighted fields. The rule now lives in the schema
    // and routes to the topbar `name` field.
    it("surfaces the empty anomaly name on the name FIELD, not just a toast", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      form.setFieldValue("is_real_time", "anomaly");
      form.setFieldValue("name", "");
      await flushPromises();

      await wrapper.vm.handleSave();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(
        form.state.fieldMeta.name.errors.map((e: any) =>
          typeof e === "string" ? e : e?.message,
        ),
      ).toContain("Anomaly name is required.");
      expect(anomalyDetectionService.create).not.toHaveBeenCalled();
    });
  });

  // ── Cross-tab error focus ──────────────────────────────────────────────────
  // Regression: leave a required field blank on the Alert Rules tab, switch to
  // Advanced, hit Save → "Please fix the highlighted fields" fired while the
  // highlighted field sat on a v-show'd-off tab the user could not see, and
  // nothing steered them back. focusOnFirstError skips messages with a null
  // offsetParent (correct on its own — focusing a display:none control no-ops),
  // so every message on the inactive pane was filtered out and it focused
  // nothing. It must bring the tab OWNING the error forward first.
  describe("focusOnFirstError (cross-tab)", () => {
    let offsetParent: any;

    beforeEach(() => {
      // jsdom has no layout, so offsetParent is null for EVERYTHING — which would
      // make an already-visible message look hidden and mask which branch runs.
      // Model just the rule this code leans on: display:none has no offsetParent.
      offsetParent = vi
        .spyOn(HTMLElement.prototype, "offsetParent", "get")
        .mockImplementation(function (this: HTMLElement) {
          let node: HTMLElement | null = this;
          while (node) {
            if (node.style?.display === "none") return null;
            node = node.parentElement;
          }
          return document.body;
        });
      // Not implemented in jsdom.
      (Element.prototype as any).scrollIntoView = vi.fn();
    });

    afterEach(() => offsetParent?.mockRestore());

    /** Stand in for the error an OForm* field renders once the schema fails —
     *  the step children are stubbed here, so inject the same shape they emit
     *  (a [role="alert"] message beside its control) into the real pane. */
    const seedFieldError = (tab: string): HTMLInputElement => {
      const pane = wrapper.find(`[data-tab-pane="${tab}"]`).element;
      const field = document.createElement("div");
      field.innerHTML =
        '<span role="alert">At least one destination is required.</span><input />';
      pane.appendChild(field);
      return field.querySelector("input") as HTMLInputElement;
    };

    it("brings the tab owning the error forward and focuses the field", async () => {
      // Attached: focusOnFirstError reaches for the live document (the real
      // <form> + focus()), which a detached wrapper has no place in.
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      const input = seedFieldError("condition");
      wrapper.vm.activeTab = "advanced";
      await nextTick();

      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("condition");
      expect(document.activeElement).toBe(input);
    });

    it("stays put when the error is already on the visible tab", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      const input = seedFieldError("condition");
      wrapper.vm.activeTab = "condition";
      await nextTick();

      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("condition");
      expect(document.activeElement).toBe(input);
    });

    // Anomaly mode swaps the tab headers wholesale, but every pane stays in the
    // DOM (v-show). Hopping onto a pane with no header would strand the user on
    // a tab the toggle group cannot show or leave.
    it("never hops to a tab that has no header in the current mode", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      wrapper.vm.form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      expect(wrapper.vm.activeTab).toBe("anomaly-config");

      seedFieldError("condition"); // stale message on the now-headerless pane
      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("anomaly-config");
    });
  });

  // ── Pure util regression (independent of the form) ─────────────────────────
  describe("generateWhereClause (V2 conditions)", () => {
    const streamFieldsMap = {
      age: { label: "age", value: "age", type: "Int64" },
      city: { label: "city", value: "city", type: "String" },
    };

    it("builds a simple numeric where clause without quotes", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          { filterType: "condition", column: "age", operator: ">", value: 30, logicalOperator: "AND" },
        ],
      };
      expect(generateWhereClause(group, streamFieldsMap)).toBe("WHERE age > 30");
    });

    it("quotes string values", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          { filterType: "condition", column: "city", operator: "=", value: "delhi", logicalOperator: "AND" },
        ],
      };
      expect(generateWhereClause(group, streamFieldsMap)).toBe("WHERE city = 'delhi'");
    });

    it("returns empty string for an invalid group", () => {
      expect(generateWhereClause(null as any, streamFieldsMap)).toBe("");
    });
  });
});
