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

// Shared so the SQL → stream-name sync tests can parse a FROM clause and fail a
// stream lookup; the defaults match the old per-call mocks.
const { getStreamMock, sqlParseMock } = vi.hoisted(() => ({
  getStreamMock: vi.fn(),
  sqlParseMock: vi.fn(),
}));
const STREAM_SCHEMA = {
  schema: [
    { name: "field1", type: "string" },
    { name: "field2", type: "int" },
  ],
};
getStreamMock.mockResolvedValue(STREAM_SCHEMA);

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: getStreamMock,
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
  }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: sqlParseMock,
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

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create_by_alert_id: vi.fn(() =>
        Promise.resolve({ data: { code: 200, message: "Alert saved" } }),
      ),
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { success: true } })),
      generate_sql: vi.fn(() => Promise.resolve({ data: { sql: "SELECT * FROM test" } })),
      validateComposite: vi.fn(() =>
        Promise.resolve({
          data: {
            valid: true,
            canonical_expression: "({id-a} && {id-b})",
            children: [],
            warnings: [],
            errors: [],
            result: true,
            result_level: "critical",
          },
        }),
      ),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});

vi.mock("@/services/anomaly_detection", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: vi.fn(),
      create: vi.fn(() => Promise.resolve({ data: { id: "anom-1" } })),
      update: vi.fn(() => Promise.resolve({ data: { id: "anom-1" } })),
      triggerTraining: vi.fn(() => Promise.resolve({})),
    },
  });
});

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
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
    name: "AnomalyDetectionConfigStub",
    props: ["previewSql"],
    template: "<div />",
    methods: {
      async validate() {
        return true;
      },
    },
  },
  AnomalyAlerting: true,
  AnomalySummary: true,
  AnomalyDataPreview: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

const mountAlert = (props: Record<string, any> = {}, options: Record<string, any> = {}) =>
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

    it("blocks save when the name is missing and there is nothing to auto-name it after", async () => {
      // With no stream chosen the generator has nothing to say, so the name
      // stays genuinely empty and the schema rule is what stops the save.
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("stream_name", "");
      form.setFieldValue("name", "");

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("auto-names a cleared alert rather than blocking, once a stream is chosen", async () => {
      // A create-mode alert can no longer reach save nameless: clearing the
      // field re-arms the generator, which fills it from the stream. The schema
      // rule above is the backstop for the case where it has nothing to offer.
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("name", "");
      await flushPromises();

      expect(form.state.values.name).toBe("_rundata_alert");
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
      const errors = form.getFieldMeta("query_condition.aggregation.having.column")?.errors ?? [];
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

      const errors = form.getFieldMeta("query_condition.aggregation.having.column")?.errors ?? [];
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

  // ── Workflows link (enterprise/cloud) ──────────────────────────────────────
  // REGRESSION GUARD. The zod migration made `formData` a READ-ONLY view of the
  // form (form.useStore), so the pre-migration `formData.value.workflows = x`
  // became a silent no-op — the write vanished and the link never reached the
  // payload. Every other setter goes through setF(); updateWorkflows must too.
  // This merged CLEANLY (the two sides never touched the same lines), so nothing
  // but a test can catch it.
  describe("workflows link survives to the payload (read-view write guard)", () => {
    it("updateWorkflows WRITES THROUGH to the form (not to the read-view)", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      wrapper.vm.updateWorkflows(["wf-1", "wf-2"]);
      await flushPromises();

      // Read back off the FORM, which is the single source of truth. A write to
      // the read-view would leave this at [].
      expect(form.state.values.workflows).toEqual(["wf-1", "wf-2"]);
    });

    it("ships the linked workflows in the create payload", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);

      wrapper.vm.updateWorkflows(["wf-1"]);
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      const [, payload] = (alertsService.create_by_alert_id as any).mock.calls[0];
      expect(payload.workflows).toEqual(["wf-1"]);
    });

    it("defaults to [] so OSS alerts ship the field empty, never undefined", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);

      await form.handleSubmit();
      await flushPromises();

      const [, payload] = (alertsService.create_by_alert_id as any).mock.calls[0];
      expect(payload.workflows).toEqual([]);
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

      const [orgId, payload, folderId] = (alertsService.create_by_alert_id as any).mock.calls[0];

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
      //
      // `workflows` was checked against that rule and BELONGS: the alerts table
      // has a `workflows` column (infra/src/table/entity/alerts.rs:52), it is
      // written on save and read back on load (table/alerts/mod.rs:678/732), so
      // it is a real backend field, not a form-only leak. Enterprise/cloud link
      // alerts to workflows through it; in OSS it ships as [].
      //
      // `notify_on_recovery` / `keep_firing_for` / `recovery_destinations` were
      // checked against the same rule and BELONG: all three are columns on the
      // alerts table (entity/alerts.rs `notify_on_recovery` /
      // `keep_firing_for_seconds` / `recovery_destinations`), all three are on
      // the HTTP model, and all three round-trip — save then GET returns them.
      // They are not form-only state.
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
          "workflows",
          "pending_period_sec",
          "notify_on_recovery",
          "recovery_destinations",
          "keep_firing_for",
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

  // The right rail's Preview card holds the DATA preview for every non-composite
  // alert type; anomaly used to put its generated SQL there instead.
  describe("right-rail Preview card", () => {
    it("renders the anomaly data preview for an anomaly alert", async () => {
      wrapper = mountAlert();
      await flushPromises();

      wrapper.vm.form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();

      expect(wrapper.findComponent({ name: "AnomalyDataPreview" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "PreviewAlert" }).exists()).toBe(false);
    });

    it("hands the generated SQL to the detection-config step, not the rail", async () => {
      wrapper = mountAlert();
      await flushPromises();

      wrapper.vm.form.setFieldValue("is_real_time", "anomaly");
      wrapper.vm.form.setFieldValue("stream_name", "_rundata");
      await flushPromises();

      const step = wrapper.findComponent({ name: "AnomalyDetectionConfigStub" });
      expect(step.props("previewSql")).toContain("time_bucket");
    });

    it("renders the scheduled data preview for a scheduled alert", async () => {
      wrapper = mountAlert();
      await flushPromises();

      wrapper.vm.form.setFieldValue("is_real_time", "false");
      wrapper.vm.form.setFieldValue("stream_name", "_rundata");
      await flushPromises();

      expect(wrapper.findComponent({ name: "PreviewAlert" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "AnomalyDataPreview" }).exists()).toBe(false);
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
      // Percentile mode: threshold on the wire, and never the budget key.
      expect(payload.anomaly_config.threshold).toBe(97);
      expect(payload.anomaly_config).not.toHaveProperty("alert_budget_per_day");
    });

    it("budget mode sends alert_budget_per_day and omits threshold — the API rejects both", async () => {
      // While a budget is set, `threshold` is controller-derived state; a
      // payload carrying both is rejected server-side.
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;

      form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      form.setFieldValue("name", "anom_alert");
      form.setFieldValue("stream_type", "logs");
      form.setFieldValue("stream_name", "_rundata");
      await flushPromises();
      wrapper.vm.anomalyConfig.alert_enabled = false;
      wrapper.vm.anomalyConfig.query_mode = "filters";
      wrapper.vm.anomalyConfig.alert_budget_per_day = 2;

      await wrapper.vm.handleSave();
      await flushPromises();

      const [, payload] = (anomalyDetectionService.create as any).mock.calls[0];
      expect(payload.anomaly_config.alert_budget_per_day).toBe(2);
      expect(payload.anomaly_config).not.toHaveProperty("threshold");
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
        form.state.fieldMeta.name.errors.map((e: any) => (typeof e === "string" ? e : e?.message)),
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
      field.innerHTML = '<span role="alert">At least one destination is required.</span><input />';
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
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 30,
            logicalOperator: "AND",
          },
        ],
      };
      expect(generateWhereClause(group, streamFieldsMap)).toBe("WHERE age > 30");
    });

    it("quotes string values", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "city",
            operator: "=",
            value: "delhi",
            logicalOperator: "AND",
          },
        ],
      };
      expect(generateWhereClause(group, streamFieldsMap)).toBe("WHERE city = 'delhi'");
    });

    it("returns empty string for an invalid group", () => {
      expect(generateWhereClause(null as any, streamFieldsMap)).toBe("");
    });
  });

  describe("composite alert integration", () => {
    const compositeCondition = {
      expression: "{id-a} && {id-b}",
      warning_counts_as_firing: true,
      stale_child_policy: "use_last_state",
    };

    it("offers Composite and replaces query controls when the capability is available", async () => {
      const previous = store.state.zoConfig.composite_alerts_available;
      try {
        store.state.zoConfig.composite_alerts_available = true;
        wrapper = mountAlert();
        await flushPromises();

        expect(wrapper.vm.alertTypeOptions).toEqual(
          expect.arrayContaining([expect.objectContaining({ value: "composite" })]),
        );
        wrapper.vm.form.setFieldValue("is_real_time", "composite");
        await flushPromises();

        expect(wrapper.findComponent({ name: "CompositeAlertForm" }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: "QueryConfig" }).exists()).toBe(false);
      } finally {
        store.state.zoConfig.composite_alerts_available = previous;
      }
    });

    it("saves an ID-only composite payload without stream, query, threshold, or cadence fields", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      form.setFieldValue("is_real_time", "composite");
      form.setFieldValue("name", "checkout_degraded");
      form.setFieldValue("stream_type", "");
      form.setFieldValue("stream_name", "");
      form.setFieldValue("destinations", ["pager"]);
      form.setFieldValue("trigger_condition", { silence: 15 });
      form.setFieldValue("composite_condition", compositeCondition);
      form.setFieldValue("children", [
        { alert_id: "id-a", name: "Renamed error alert", accessible: true },
        { alert_id: "id-b", name: "Moved latency alert", accessible: true },
      ]);

      await form.handleSubmit();
      await flushPromises();

      const payload = vi.mocked(alertsService.create_by_alert_id).mock.calls.at(-1)?.[1];
      expect(payload).toEqual(
        expect.objectContaining({
          alert_type: "composite",
          name: "checkout_degraded",
          trigger_condition: { silence: 15 },
          composite_condition: compositeCondition,
        }),
      );
      expect(payload).not.toHaveProperty("stream_name");
      expect(payload).not.toHaveProperty("query_condition");
      expect(payload).not.toHaveProperty("period");
      expect(JSON.stringify(payload)).not.toContain("Renamed error alert");
      expect(JSON.stringify(payload)).not.toContain("Moved latency alert");
    });

    it("edit round-trip keeps expression IDs when child names and folders have changed", async () => {
      const modelValue = {
        id: "composite-1",
        alert_type: "composite",
        is_real_time: "composite",
        name: "checkout_degraded",
        enabled: true,
        destinations: ["pager"],
        trigger_condition: { silence: 15 },
        composite_condition: compositeCondition,
        children: [
          {
            alert_id: "id-a",
            name: "New child name",
            folder_id: "moved-folder",
            accessible: true,
          },
          { alert_id: "id-b", name: "High latency", folder_id: "default", accessible: true },
        ],
      };
      wrapper = mountAlert({ modelValue, isUpdated: true });
      await flushPromises();

      expect(wrapper.vm.form.state.values.composite_condition.expression).toBe("{id-a} && {id-b}");
      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(alertsService.update_by_alert_id).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: "composite-1",
          composite_condition: compositeCondition,
        }),
        expect.anything(),
      );
    });
  });

  // ── Query mode at Save ─────────────────────────────────────────────────────
  // Only the selected mode runs. A Builder alert with no conditions matches
  // every row, so SQL kept in the other tab must not save silently as Builder.
  // These drive the real footer Save button and the real Alert Type toggle.
  describe("query mode at Save", () => {
    const SQL = `SELECT level FROM "default" WHERE level='CRITICAL'`;
    const emptyTree = { filterType: "group", logicalOperator: "AND", groupId: "", conditions: [] };

    const seedEmptyBuilder = (form: any, sql: string) => {
      seedValidScheduled(form);
      form.setFieldValue("query_condition.conditions", emptyTree);
      form.setFieldValue("query_condition.sql", sql);
    };

    // Await the handler the footer Save button runs, so each save settles inside
    // its own test. `form.state` read here does not follow the submit (its
    // submissionAttempts stays 0 while the save runs), so polling isSubmitting
    // passed at once and let a slow save leak into the next test.
    const clickSave = async () => {
      expect(wrapper.find('[data-test="add-alert-submit-btn"]').exists()).toBe(true);
      await wrapper.vm.handleSave();
      await flushPromises();
    };

    // Control for the next test: the same form saves once the SQL is gone, so
    // the dialog is the only thing that can hold the save back.
    it("saves an empty Builder alert when no other mode has content", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, "");

      await clickSave();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });

    it("asks which mode to use instead of saving an empty Builder over stored SQL", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, SQL);

      // The real footer button. The dialog opens once the schema passes.
      await wrapper.find('[data-test="add-alert-submit-btn"]').trigger("click");
      await vi.waitFor(() => expect(wrapper.vm.saveModeDialogOpen).toBe(true), { timeout: 4000 });
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      // ODialog teleports to document.body, outside the wrapper.
      expect(document.querySelector('[data-test="alert-save-mode-dialog"]')).not.toBeNull();
    });

    // Enter in the alert name field calls form.requestSubmit() (OInlineEdit),
    // which goes straight to the form's submit and never through handleSave.
    it("asks which mode to use when the form is submitted with Enter", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, SQL);

      await wrapper.find("form").trigger("submit");
      await vi.waitFor(() => expect(wrapper.vm.saveModeDialogOpen).toBe(true), { timeout: 4000 });
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(document.querySelector('[data-test="alert-save-mode-dialog"]')).not.toBeNull();
    });

    it("falls back to Builder and keeps the SQL when Alert Type switches to Realtime", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      await flushPromises();

      await wrapper.find('[data-test="add-alert-type-tab-true"]').trigger("click");
      await flushPromises();

      expect(form.state.values.is_real_time).toBe("true");
      expect(form.state.values.query_condition.type).toBe("custom");
      expect(form.state.values.query_condition.sql).toBe(SQL);
    });

    it("stays on Builder with the SQL kept when Alert Type switches back to Scheduled", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      await flushPromises();

      await wrapper.find('[data-test="add-alert-type-tab-true"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="add-alert-type-tab-false"]').trigger("click");
      await flushPromises();

      expect(form.state.values.is_real_time).toBe("false");
      expect(form.state.values.query_condition.type).toBe("custom");
      expect(form.state.values.query_condition.sql).toBe(SQL);
    });

    it("keeps the Compare-with-Past windows through a Realtime round trip", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.multi_time_range", [{ offSet: "1h" }]);
      await flushPromises();

      await wrapper.find('[data-test="add-alert-type-tab-true"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="add-alert-type-tab-false"]').trigger("click");
      await flushPromises();

      expect(form.state.values.query_condition.multi_time_range).toEqual([{ offSet: "1h" }]);
    });

    // The windows stay in the form; the payload is what keeps them off a Realtime alert.
    it("sends no Compare-with-Past windows when a SQL alert is saved as Realtime", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);
      form.setFieldValue("query_condition.multi_time_range", [{ offSet: "1h" }]);
      await flushPromises();

      await wrapper.find('[data-test="add-alert-type-tab-true"]').trigger("click");
      await flushPromises();
      await clickSave();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(savedPayload().is_real_time).toBe(true);
      expect(savedPayload().query_condition.type).toBe("custom");
      expect(savedPayload().query_condition.multi_time_range).toEqual([]);
    });

    const builderTree = {
      ...emptyTree,
      conditions: [
        {
          filterType: "condition",
          column: "field1",
          operator: "=",
          value: "x",
          logicalOperator: "AND",
        },
      ],
    };

    const dialogEl = (name: string) =>
      document.querySelector<HTMLElement>(`[data-test="alert-save-mode-${name}"]`);

    const dialogButton = (which: "primary" | "secondary") =>
      document.querySelector<HTMLElement>(
        `[data-test="alert-save-mode-dialog"] [data-test="o-dialog-${which}-btn"]`,
      );

    // Primary awaits the handler the dialog's Save runs (see clickSave); Cancel
    // only closes the dialog.
    const clickDialog = async (which: "primary" | "secondary") => {
      expect(dialogButton(which)).not.toBeNull();
      if (which === "primary") await wrapper.vm.saveWithPickedMode();
      else dialogButton(which)!.click();
      await flushPromises();
    };

    const savedPayload = () => (alertsService.create_by_alert_id as any).mock.calls[0][1];

    const noteText = () =>
      dialogEl("dialog")?.querySelector('[data-test="alert-save-mode-note"]')?.textContent?.trim();

    it("saves with SQL mode from the dialog when Builder is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      let tabAtSave: unknown;
      (alertsService.create_by_alert_id as any).mockImplementationOnce(() => {
        tabAtSave = form.state.values._meta.tab;
        return Promise.resolve({ data: { code: 200, message: "Alert saved" } });
      });

      await clickSave();
      expect(dialogEl("dialog")?.textContent).toContain("Choose Query Mode");
      expect(dialogEl("lead")?.textContent?.trim()).toBe(
        "Builder is selected but empty. SQL is set up.",
      );
      expect(dialogEl("dialog")?.textContent).not.toContain("-line query");
      // The dialog opens on the mode selected in the form; only a click changes it.
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
      expect(dialogButton("primary")?.textContent).toContain("Save with Builder Mode");
      expect(dialogEl("warning")?.textContent).toContain("No filters, so every row in");
      expect(noteText()).toBe("Only Builder mode runs. SQL mode is not used.");

      dialogEl("option-sql")!.click();
      await flushPromises();
      expect(dialogButton("primary")?.textContent).toContain("Save with SQL Mode");
      // SQL holds a query, so the picked mode needs no warning.
      expect(dialogEl("warning")).toBeNull();
      expect(noteText()).toBe("Only SQL mode runs.");

      // The real dialog button, waiting for the save it starts.
      dialogButton("primary")!.click();
      await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalled(), {
        timeout: 4000,
      });
      await flushPromises();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(savedPayload().query_condition.type).toBe("sql");
      expect(tabAtSave).toBe("sql");
      expect(dialogEl("dialog")).toBeNull();
    });

    it("saves as Builder when the dialog is saved without changing the pick", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, SQL);

      await clickSave();
      await clickDialog("primary");

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(savedPayload().query_condition.type).toBe("custom");
    });

    it("opens with SQL picked when SQL is selected and Builder also has a condition", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);

      await clickSave();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(dialogEl("dialog")?.textContent).toContain("Builder and SQL are both set up.");
      expect(dialogEl("option-sql")?.getAttribute("data-state")).toBe("on");
    });

    it("saves as Builder when Builder is picked in the dialog", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);

      await clickSave();
      expect(noteText()).toBe("Only SQL mode runs. Builder mode is not used.");
      dialogEl("option-custom")!.click();
      await flushPromises();
      expect(noteText()).toBe("Only Builder mode runs. SQL mode is not used.");
      expect(dialogEl("dialog")?.textContent).not.toContain("filter condition");
      expect(dialogButton("primary")?.textContent).toContain("Save with Builder Mode");

      await clickDialog("primary");

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(savedPayload().query_condition.type).toBe("custom");
    });

    // SQL selected with a query, plus a Builder condition: the dialog asks.
    const seedSqlAndBuilder = (form: any) => {
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);
    };

    it("does not ask again after the user retries a save that failed with their pick", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedSqlAndBuilder(wrapper.vm.form);
      (alertsService.create_by_alert_id as any).mockRejectedValueOnce(new Error("save failed"));

      await clickSave();
      dialogEl("option-custom")!.click();
      await flushPromises();
      await clickDialog("primary");
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(2);
      expect((alertsService.create_by_alert_id as any).mock.calls[1][1].query_condition.type).toBe(
        "custom",
      );
    });

    // The schema runs first: a form with field errors shows them, not the dialog.
    it("shows the invalid-form toast and no dialog when the form has field errors", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("destinations", []);

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: i18n.global.t("alerts.messages.fixHighlightedFields"),
        }),
      );
    });

    // "avg of took >= 500" over every row is a working Builder alert.
    it("counts a Builder aggregation with no filters as content", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("query_condition.aggregation", {
        function: "avg",
        group_by: [],
        having: { column: "took", operator: ">=", value: 500 },
      });
      wrapper.vm.isAggregationEnabled = true;

      await clickSave();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(dialogEl("dialog")?.textContent).toContain("Builder and SQL are both set up.");
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
    });

    // The Compare-with-Past windows are SQL-only; the backend still runs them
    // for a Builder alert, and the UI cannot show them off the SQL tab.
    it("sends no Compare-with-Past windows when Builder is picked in the dialog", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);
      form.setFieldValue("query_condition.multi_time_range", [{ offSet: "1h" }]);

      await clickSave();
      dialogEl("option-custom")!.click();
      await flushPromises();
      await clickDialog("primary");

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(savedPayload().query_condition.type).toBe("custom");
      expect(savedPayload().query_condition.multi_time_range).toEqual([]);
    });

    it("keeps the Compare-with-Past windows in the form when a Builder save fails", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedSqlAndBuilder(form);
      form.setFieldValue("query_condition.multi_time_range", [{ offSet: "1h" }]);
      (alertsService.create_by_alert_id as any).mockRejectedValueOnce(new Error("save failed"));

      await clickSave();
      dialogEl("option-custom")!.click();
      await flushPromises();
      await clickDialog("primary");

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(form.state.values.query_condition.multi_time_range).toEqual([{ offSet: "1h" }]);
    });

    it("lists all three modes when Builder, SQL and PromQL all have content", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("stream_type", "metrics");
      form.setFieldValue("query_condition.type", "promql");
      form.setFieldValue("query_condition.promql", "up");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);

      await clickSave();

      expect(dialogEl("option-custom")).not.toBeNull();
      expect(dialogEl("option-sql")).not.toBeNull();
      expect(dialogEl("option-promql")).not.toBeNull();
      expect(dialogEl("dialog")?.textContent).toContain("Builder, SQL and PromQL are all set up.");
      expect(noteText()).toBe("Only PromQL mode runs. Builder and SQL modes are not used.");
    });

    // The reported alert, as the GET returns it: Builder with no conditions
    // over the SQL that was meant to run.
    it("asks on Save when a loaded Builder alert has no conditions but stores SQL", async () => {
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: {
          name: "existing_alert",
          stream_type: "logs",
          stream_name: "default",
          is_real_time: false,
          query_condition: {
            type: "custom",
            conditions: { version: 2, conditions: { ...emptyTree, groupId: "g" } },
            sql: SQL,
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
        },
        destinations: [{ name: "email" }],
      });
      await flushPromises();

      await clickSave();

      expect(alertsService.update_by_alert_id).not.toHaveBeenCalled();
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
    });

    // A SQL alert saved through the dialog keeps its Builder filters, so without
    // the stored type as the confirmed mode every later edit would ask again.
    const mountSavedSqlAlert = () =>
      mountAlert({
        isUpdated: true,
        modelValue: {
          name: "existing_sql_alert",
          description: "",
          stream_type: "logs",
          stream_name: "default",
          is_real_time: false,
          query_condition: {
            type: "sql",
            conditions: { version: 2, conditions: { ...builderTree, groupId: "g" } },
            sql: SQL,
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
        },
        destinations: [{ name: "email" }],
      });

    it("saves an edit without asking when the stored mode is unchanged", async () => {
      wrapper = mountSavedSqlAlert();
      await flushPromises();

      await clickSave();

      expect(wrapper.vm.saveModeDialogOpen).toBe(false);
      expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
    });

    it("asks on an edit that switches away from the stored mode", async () => {
      wrapper = mountSavedSqlAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.type", "custom");

      await clickSave();

      expect(alertsService.update_by_alert_id).not.toHaveBeenCalled();
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
    });

    it("says no query is written when the picked SQL mode is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", "");
      form.setFieldValue("query_condition.conditions", builderTree);

      await clickSave();
      expect(dialogEl("option-sql")?.getAttribute("data-state")).toBe("on");

      expect(dialogEl("dialog")?.textContent).toContain("No query written yet");
    });

    it("warns that every row counts when Builder is picked with no filters", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, SQL);

      await clickSave();
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");

      expect(dialogEl("dialog")?.textContent).toContain("No filters, so every row in");
    });

    // The dialog content stays mounted through its exit animation, so a quick
    // second click can land on Save after the first save is done. jsdom drops
    // the content at once, so the second click calls the button's handler.
    it("saves once when the dialog Save is clicked twice quickly", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, SQL);

      await clickSave();
      await clickDialog("primary");
      await wrapper.vm.saveWithPickedMode();
      await flushPromises();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      // The saved form is reset, so a second submit would fail with this toast.
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("saves a SQL alert without asking when only SQL has content", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("query_condition.type", "sql");

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });

    it("saves nothing and changes nothing when the dialog is cancelled", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);

      await clickSave();
      await clickDialog("secondary");

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(form.state.values.query_condition.type).toBe("custom");
      expect(dialogEl("dialog")).toBeNull();
    });

    it("does not ask when the SQL tab holds only the starter query", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedEmptyBuilder(wrapper.vm.form, `SELECT * FROM "_rundata"`);

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });

    it("does not count the default metrics aggregation as Builder content", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, "");
      form.setFieldValue("stream_type", "metrics");
      form.setFieldValue("query_condition.aggregation", {
        function: "avg",
        group_by: [],
        having: { column: "value", operator: ">=", value: 1 },
      });
      form.setFieldValue("query_condition.type", "promql");
      form.setFieldValue("query_condition.promql", "up");
      form.setFieldValue("query_condition.promql_condition", { operator: ">=", value: 1 });

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });

    it("does not ask for a Realtime alert that keeps SQL text", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("is_real_time", "true");

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });

    // Anomaly and composite alerts have no query mode, so leftover query text never asks.
    it("does not ask for an anomaly alert that keeps SQL and a Builder condition", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      form.setFieldValue("name", "anom_alert");
      form.setFieldValue("stream_type", "logs");
      form.setFieldValue("stream_name", "_rundata");
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);
      await flushPromises();
      wrapper.vm.anomalyConfig.alert_enabled = false;
      wrapper.vm.anomalyConfig.query_mode = "filters";

      await wrapper.vm.handleSave();
      await flushPromises();

      expect(wrapper.vm.saveModeDialogOpen).toBe(false);
      expect(anomalyDetectionService.create).toHaveBeenCalledTimes(1);
    });

    it("does not ask for a composite alert that keeps SQL and a Builder condition", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      form.setFieldValue("is_real_time", "composite");
      form.setFieldValue("name", "checkout_degraded");
      form.setFieldValue("stream_type", "");
      form.setFieldValue("stream_name", "");
      form.setFieldValue("destinations", ["pager"]);
      form.setFieldValue("trigger_condition", { silence: 15 });
      form.setFieldValue("composite_condition", {
        expression: "{id-a} && {id-b}",
        warning_counts_as_firing: true,
        stale_child_policy: "use_last_state",
      });
      form.setFieldValue("children", [
        { alert_id: "id-a", name: "Error alert", accessible: true },
        { alert_id: "id-b", name: "Latency alert", accessible: true },
      ]);
      form.setFieldValue("query_condition.sql", SQL);
      form.setFieldValue("query_condition.conditions", builderTree);

      await wrapper.vm.handleSave();
      await flushPromises();

      expect(wrapper.vm.saveModeDialogOpen).toBe(false);
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    });
  });

  // The stream-name field follows the FROM table of the SQL query, debounced
  // 600 ms in useAlertForm. The clock is fake from before mount: a debounce
  // timer started on real time would swallow later calls, and the no-change
  // assertion would then pass without the sync ever running.
  describe("SQL → stream-name sync", () => {
    const fromTable = (sql: string) => ({
      ast: { from: [{ table: /FROM "([^"]+)"/i.exec(sql)?.[1] }] },
    });
    // Runs pending promises and any debounced sync (flushPromises would wait
    // on the fake clock).
    const settle = () => vi.advanceTimersByTimeAsync(700);

    beforeEach(() => {
      vi.useFakeTimers();
      sqlParseMock.mockImplementation(fromTable);
    });
    afterEach(() => {
      vi.useRealTimers();
      sqlParseMock.mockReset();
      getStreamMock.mockReset();
      getStreamMock.mockResolvedValue(STREAM_SCHEMA);
    });

    it("follows the FROM table again after a stream that does not exist", async () => {
      wrapper = mountAlert();
      await settle();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      getStreamMock.mockImplementation((name: string) =>
        name === "missing_stream"
          ? Promise.reject(new Error("Stream not found"))
          : Promise.resolve(STREAM_SCHEMA),
      );

      form.setFieldValue("query_condition.sql", 'SELECT count(*) FROM "missing_stream"');
      await settle();
      expect(form.state.values.stream_name).toBe("missing_stream");

      form.setFieldValue("query_condition.sql", 'SELECT count(*) FROM "other_stream"');
      await settle();
      expect(form.state.values.stream_name).toBe("other_stream");
    });

    it("keeps the saved stream when an edit changes the FROM table", async () => {
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: {
          name: "existing_sql_alert",
          description: "",
          stream_type: "logs",
          stream_name: "default",
          is_real_time: false,
          query_condition: { type: "sql", sql: 'SELECT count(*) FROM "default"' },
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
        },
        destinations: [{ name: "email" }],
      });
      await settle();
      const form = wrapper.vm.form;

      form.setFieldValue("query_condition.sql", 'SELECT count(*) FROM "other_stream"');
      await settle();

      expect(form.state.values.stream_name).toBe("default");
    });
  });
});
