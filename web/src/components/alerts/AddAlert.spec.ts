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
import { computed, defineComponent, h, ref } from "vue";
import { describe, it, expect, vi, afterEach, beforeEach, onTestFinished } from "vitest";
import AddAlert from "@/components/alerts/AddAlert.vue";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertsService from "@/services/alerts";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import anomalyDetectionService from "@/services/anomaly_detection";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { generateWhereClause } from "@/utils/alerts/alertQueryBuilder";

// Shared so the SQL → stream-name sync tests can parse a FROM clause and fail a
// stream lookup; the defaults match the old per-call mocks.
const { getStreamMock, getStreamsMock, sqlParseMock, sqlAstifyMock } = vi.hoisted(() => ({
  getStreamMock: vi.fn(),
  getStreamsMock: vi.fn(),
  sqlParseMock: vi.fn(),
  sqlAstifyMock: vi.fn(() => ({ columns: [] as { expr: { column: string } }[] })),
}));
const STREAM_SCHEMA = {
  schema: [
    { name: "field1", type: "string" },
    { name: "field2", type: "int" },
  ],
};
getStreamMock.mockResolvedValue(STREAM_SCHEMA);
getStreamsMock.mockResolvedValue({ list: [] });

// Desktop by default; a test sets it false to read the form as it renders below lg.
const breakpoint = vi.hoisted(() => ({ lgUp: null as { value: boolean } | null }));
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useBreakpoint")>();
  const { ref } = await import("vue");
  breakpoint.lgUp = ref(true);
  return { ...actual, default: () => ({ ...actual.default(), lgUp: breakpoint.lgUp }) };
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: getStreamMock,
    getStreams: getStreamsMock,
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
      astify: sqlAstifyMock,
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
      toggle_state_by_alert_id: vi.fn((_org: string, _id: string, enable: boolean) =>
        Promise.resolve({ data: { enabled: enable } }),
      ),
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

/** jsdom has no scrolling; the section jump calls one of these. */
const stubScrolling = () => {
  const saved = [
    [HTMLElement.prototype, "scrollTo"],
    [Element.prototype, "scrollIntoView"],
  ] as const;
  const originals = saved.map(([proto, key]) => Object.getOwnPropertyDescriptor(proto, key));
  for (const [proto, key] of saved) {
    Object.defineProperty(proto, key, { configurable: true, writable: true, value: vi.fn() });
  }
  return () =>
    saved.forEach(([proto, key], i) => {
      const original = originals[i];
      if (original) Object.defineProperty(proto, key, original);
      else delete (proto as unknown as Record<string, unknown>)[key];
    });
};

const focusedTestId = () => document.activeElement?.getAttribute("data-test");

/** A saved scheduled alert as the edit page loads it. */
const savedAlert = (over: Record<string, any> = {}) => ({
  id: "alert-1",
  name: "errors_alert",
  stream_type: "logs",
  stream_name: "app_logs",
  is_real_time: false,
  pending_period_sec: 0,
  query_condition: {
    type: "custom",
    conditions: null,
    sql: "",
    promql: "",
    promql_condition: null,
    aggregation: null,
    vrl_function: "",
    multi_time_range: [],
  },
  trigger_condition: {
    period: 10,
    operator: ">=",
    frequency: 10,
    threshold: 3,
    silence: 10,
    frequency_type: "minutes",
    timezone: "UTC",
  },
  destinations: ["email"],
  context_attributes: {},
  description: "",
  row_template: "",
  row_template_type: "String",
  enabled: true,
  ...over,
});

describe("AddAlert (OForm owner)", () => {
  let wrapper: any;
  let unstubScrolling: () => void;

  beforeEach(() => {
    unstubScrolling = stubScrolling();
    vi.mocked(searchService.search).mockResolvedValue({ data: {} } as never);
    sqlAstifyMock.mockReturnValue({ columns: [] });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
    unstubScrolling();
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

    it("auto-names a nameless alert on Save rather than blocking, once a stream is chosen", async () => {
      // The schema rule above is the backstop for the case where the generator has nothing to offer.
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("name", "");
      await wrapper.vm.saveAlert();
      await flushPromises();
      expect(JSON.stringify(vi.mocked(alertsService.create_by_alert_id).mock.calls)).toContain(
        '"name":"_rundata_alert"',
      );
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

    it("saves an alert with no destination", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("destinations", []);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect((alertsService.create_by_alert_id as any).mock.calls[0][1].destinations).toEqual([]);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: i18n.global.t("alerts.messages.alertSavedNoDestination"),
        }),
      );
    });
    // The host leaves after a save; a reset first would flash a blank alert of another type.
    it("keeps the saved real-time alert on screen until the host leaves", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("is_real_time", "true");

      await form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted("update:list")).toBeTruthy();
      expect(form.state.values).toMatchObject({ name: "test_alert", is_real_time: "true" });
    });
  });

  // The pre-save gates that are NOT schema rules — re-homed from the old
  // QueryConfig.validate() into useAlertForm.runImperativeQueryChecks (run at
  // the top of onSubmit, i.e. only after the composed schema passes). Same
  // toast messages as pre-migration.
  describe("imperative query-text gates (runImperativeQueryChecks)", () => {
    it("opens the SQL tab with the builder's alert SQL, and keeps a query of the user's own", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      await flushPromises();
      form.setFieldValue("query_condition.type", "sql");
      await vi.waitFor(() =>
        expect(form.state.values.query_condition.sql).toBe("SELECT _timestamp FROM test"),
      );

      form.setFieldValue("query_condition.sql", "SELECT a FROM b");
      form.setFieldValue("query_condition.type", "custom");
      await flushPromises();
      form.setFieldValue("query_condition.type", "sql");
      await flushPromises();
      expect(form.state.values.query_condition.sql).toBe("SELECT a FROM b");
    });

    it("blocks a SQL save when the SQL query is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      vi.mocked(alertsService.generate_sql).mockRejectedValueOnce(new Error("no builder SQL"));
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("_meta.tab", "sql");
      form.setFieldValue("query_condition.sql", "");

      await form.handleSubmit();
      await flushPromises();

      // With no other mode holding a query, an empty editor is a field error, not a toast.
      expect(form.state.isValid).toBe(false);
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      const condition = wrapper.vm.sectionItems.find(
        (item: { id: string }) => item.id === "condition",
      );
      expect(condition.state).toBe("error");
    });

    it("blocks a SQL save when the SQL check reports an error", async () => {
      vi.mocked(searchService.search).mockRejectedValueOnce({
        response: { status: 400, data: { message: "Invalid syntax" } },
      });
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", "SELECT * FROM logs");
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;

      await form.handleSubmit();
      await flushPromises();

      expect(scrollToSection).toHaveBeenCalledWith("condition");

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Please fix the SQL error before saving.",
        }),
      );
      const condition = wrapper.vm.sectionItems.find(
        (item: { id: string }) => item.id === "condition",
      );
      expect(condition.state).toBe("error");
    });

    // The blur-triggered check has not run yet when Save is clicked straight from the editor.
    describe("SQL validated at Save", () => {
      type SeedableForm = { setFieldValue: (path: string, value: unknown) => void };
      const seedSql = (form: SeedableForm, sql: string) => {
        seedValidScheduled(form);
        form.setFieldValue("is_real_time", "false");
        form.setFieldValue("query_condition.type", "sql");
        form.setFieldValue("query_condition.sql", sql);
      };

      const saveSettled = async () => {
        await wrapper.vm.form.handleSubmit();
        await flushPromises();
      };

      it("blocks an immediate save of invalid SQL and makes no save request", async () => {
        vi.mocked(searchService.search).mockRejectedValueOnce({
          response: { status: 400, data: { message: "SQL error: syntax error at FROM" } },
        });
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, "SELECT FROM WHERE oops");
        const scrollToSection = vi.fn();
        wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;

        await wrapper.vm.form.handleSubmit();
        await vi.waitFor(() => expect(scrollToSection).toHaveBeenCalledWith("condition"), {
          timeout: 2000,
        });
        await flushPromises();

        expect(searchService.search).toHaveBeenCalledWith(
          expect.objectContaining({ validate: true }),
        );
        expect(wrapper.vm.sqlQueryErrorMsg).toBe("SQL error: syntax error at FROM");
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Please fix the SQL error before saving." }),
        );
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      });

      it("saves valid SQL after checking that same SQL", async () => {
        const sql = 'SELECT count(*) AS total FROM "_rundata"';
        vi.mocked(searchService.search).mockResolvedValueOnce({ data: {} } as never);
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, sql);

        await wrapper.vm.form.handleSubmit();
        await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1), {
          timeout: 2000,
        });

        const [check] = vi.mocked(searchService.search).mock.calls[0];
        expect(check).toEqual(expect.objectContaining({ validate: true }));
        // The validator sends the SQL as typed; any base64 encoding happens later in the service.
        expect(check.query.query.sql).toBe(sql);
        const [, payload] = vi.mocked(alertsService.create_by_alert_id).mock.calls[0];
        expect(payload.query_condition.sql).toBe(check.query.query.sql);
        expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
      });

      it("runs the cheap save gates before the SQL check", async () => {
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT count(*) AS total FROM "_rundata"');
        wrapper.vm.form.setFieldValue("trigger_condition.frequency_type", "cron");
        wrapper.vm.form.setFieldValue("trigger_condition.cron", "not-a-cron");

        await saveSettled();

        expect(searchService.search).not.toHaveBeenCalled();
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      });

      it("saves once the fresh check clears an error left from an earlier query", async () => {
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT count(*) AS total FROM "_rundata"');
        wrapper.vm.sqlQueryErrorMsg = "Search stream not found: where";

        await wrapper.vm.form.handleSubmit();
        await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1), {
          timeout: 2000,
        });
      });

      it("blocks the save without a SQL error when the VRL function fails", async () => {
        vi.mocked(searchService.search).mockResolvedValueOnce({
          data: { function_error: "vrl failed" },
        } as never);
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT count(*) AS total FROM "_rundata"');
        const scrollToSection = vi.fn();
        wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;

        await saveSettled();

        expect(scrollToSection).toHaveBeenCalledWith("condition");
        expect(wrapper.vm.vrlFunctionError).toBe("vrl failed");
        expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      });

      it.each([
        ["a 500", { response: { status: 500, data: { message: "upstream down" } } }],
        ["a network error", new Error("Network Error")],
      ])("saves with a warning, not a SQL error, when the check hits %s", async (_, failure) => {
        vi.mocked(searchService.search).mockRejectedValueOnce(failure);
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT count(*) AS total FROM "_rundata"');

        await saveSettled();

        expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "warning",
            message: i18n.global.t("alerts.messages.sqlCheckUnavailable"),
          }),
        );
        expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
        const variants = vi.mocked(toast).mock.calls.map(([options]) => options.variant);
        expect(variants).toContain("success");
        expect(variants.indexOf("warning")).toBeGreaterThan(variants.indexOf("success"));
      });

      it("does not claim an unchecked save when the save itself fails", async () => {
        vi.mocked(searchService.search).mockRejectedValueOnce(new Error("Network Error"));
        vi.mocked(alertsService.create_by_alert_id).mockRejectedValueOnce(new Error("save failed"));
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT count(*) AS total FROM "_rundata"');

        await saveSettled();

        expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
        expect(toast).not.toHaveBeenCalledWith(
          expect.objectContaining({
            message: i18n.global.t("alerts.messages.sqlCheckUnavailable"),
          }),
        );
      });

      it("shows the select-all message for a SELECT * query", async () => {
        sqlAstifyMock.mockReturnValue({ columns: [{ expr: { column: "*" } }] });
        wrapper = mountAlert();
        await flushPromises();
        seedSql(wrapper.vm.form, 'SELECT * FROM "_rundata"');

        await saveSettled();

        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            message: i18n.global.t("alerts.messages.selectAllColumnsNotAllowed"),
          }),
        );
        expect(searchService.search).not.toHaveBeenCalled();
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      });

      it("skips the check when an edit keeps the stored SQL", async () => {
        const sql = 'SELECT count(*) AS total FROM "app_logs"';
        wrapper = mountAlert({
          isUpdated: true,
          modelValue: savedAlert({
            query_condition: { ...savedAlert().query_condition, type: "sql", sql },
          }),
          destinations: [{ name: "email" }],
        });
        await flushPromises();
        wrapper.vm.form.setFieldValue("query_condition.sql", `  ${sql}\n`);
        wrapper.vm.sqlQueryErrorMsg = "Search stream not found: app_logs";

        await saveSettled();

        expect(searchService.search).not.toHaveBeenCalled();
        expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
      });

      it("checks the stored SQL again when an edit changes its VRL function", async () => {
        const sql = 'SELECT count(*) AS total FROM "app_logs"';
        wrapper = mountAlert({
          isUpdated: true,
          modelValue: savedAlert({
            query_condition: { ...savedAlert().query_condition, type: "sql", sql },
          }),
          destinations: [{ name: "email" }],
        });
        await flushPromises();
        wrapper.vm.form.setFieldValue("query_condition.vrl_function", ".a = 1");

        await saveSettled();

        expect(searchService.search).toHaveBeenCalledWith(
          expect.objectContaining({ validate: true }),
        );
        expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
      });

      it("checks the SQL when an edit changes it", async () => {
        wrapper = mountAlert({
          isUpdated: true,
          modelValue: savedAlert({
            query_condition: {
              ...savedAlert().query_condition,
              type: "sql",
              sql: 'SELECT count(*) AS total FROM "app_logs"',
            },
          }),
          destinations: [{ name: "email" }],
        });
        await flushPromises();
        wrapper.vm.form.setFieldValue("query_condition.sql", 'SELECT count(*) FROM "app_logs"');

        await saveSettled();

        expect(searchService.search).toHaveBeenCalledWith(
          expect.objectContaining({ validate: true }),
        );
        expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
      });

      it("does not run the SQL check for a PromQL save", async () => {
        wrapper = mountAlert();
        await flushPromises();
        const form = wrapper.vm.form;
        seedValidScheduled(form);
        form.setFieldValue("query_condition.type", "promql");
        form.setFieldValue("query_condition.promql", "up");
        form.setFieldValue("query_condition.promql_condition", {
          column: "value",
          operator: ">=",
          value: 1,
        });

        await form.handleSubmit();
        await flushPromises();

        expect(searchService.search).not.toHaveBeenCalled();
        expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
      });
    });

    it("blocks a PromQL save when the PromQL query is empty", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "promql");
      form.setFieldValue("query_condition.promql", "");
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;

      await form.handleSubmit();
      await flushPromises();

      expect(scrollToSection).toHaveBeenCalledWith("condition");

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "PromQL query cannot be empty." }),
      );
    });

    it("keeps the newer stream type's list when an older type's list arrives last", async () => {
      const replies: Record<string, (value: unknown) => void> = {};
      getStreamsMock.mockImplementation(
        (type: string) => new Promise((resolve) => (replies[type] = resolve)),
      );
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_type", "logs");
      wrapper.vm.updateStreams();
      wrapper.vm.form.setFieldValue("stream_type", "metrics");
      wrapper.vm.updateStreams();

      replies.metrics({ list: [{ name: "cpu_usage" }] });
      await flushPromises();
      replies.logs({ list: [{ name: "app_logs" }] });
      await flushPromises();

      expect(wrapper.vm.indexOptions).toEqual(["cpu_usage"]);
      getStreamsMock.mockResolvedValue({ list: [] });
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

    it.each([
      ["below the org minimum", "0 * * * * *", "UTC"],
      ["unparseable", "not-a-cron", "UTC"],
      ["5 fields, not the 6 the server needs", "0 9 * * 1-5", "UTC"],
      ["missing its timezone", "0 */10 * * * *", ""],
    ])("blocks a cron save %s as an issue in How often to check", async (_, cron, timezone) => {
      const restore = withMinInterval(300);
      try {
        wrapper = mountAlert();
        await flushPromises();
        seedCron(wrapper.vm.form, cron, timezone);

        await wrapper.vm.handleSave();
        await flushPromises();

        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
        expect(wrapper.get('[data-test="o-section-nav-item-schedule"]').text()).toContain(
          i18n.global.t("alerts.sections.needsFix", { count: 1 }, 1),
        );
      } finally {
        restore();
      }
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
          "suppress_repeats",
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
    it.each([1, 30, 240])(
      "preserves a rule pending duration of %s seconds when editing",
      async (seconds) => {
        wrapper = mountAlert({
          isUpdated: true,
          modelValue: {
            name: "pending_rule",
            stream_type: "metrics",
            stream_name: "up",
            is_real_time: false,
            pending_period_sec: seconds,
            query_condition: {
              type: "promql",
              promql: "up",
              promql_rule_mode: true,
              promql_multi_alert: true,
              promql_condition: null,
              sql: "",
              aggregation: null,
              conditions: null,
              vrl_function: "",
              multi_time_range: [],
            },
            trigger_condition: {
              period: 5,
              operator: ">=",
              frequency: 60,
              threshold: 1,
              silence: 0,
              frequency_type: "minutes",
              timezone: "UTC",
            },
            destinations: ["email"],
            context_attributes: {},
            description: "",
            row_template: "",
            row_template_type: "String",
            enabled: true,
          },
          destinations: [{ name: "email" }],
        });
        await flushPromises();
        expect(wrapper.vm.form.state.values.pending_period_sec).toBeCloseTo(seconds / 60);
        const payload = wrapper.vm.getAlertPayload();
        expect(payload.pending_period_sec).toBe(seconds);
        expect(payload.query_condition.promql_multi_alert).toBe(true);
      },
    );

    it("moves the response-only locked names into _ui, out of every save path", async () => {
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: {
          name: "locked_alert",
          stream_type: "metrics",
          stream_name: "up",
          is_real_time: false,
          query_condition: {
            type: "promql",
            promql: "up",
            promql_condition: null,
            sql: "",
            aggregation: null,
            conditions: null,
            vrl_function: "",
            multi_time_range: [],
          },
          trigger_condition: {
            period: 5,
            operator: ">=",
            frequency: 60,
            threshold: 1,
            silence: 0,
            frequency_type: "minutes",
            timezone: "UTC",
          },
          destinations: [],
          workflows: ["wf1"],
          oncall_team: "tm_sre",
          locked_target_names: { wf1: "Restart pods", tm_sre: "Platform SRE" },
          context_attributes: {},
          description: "",
          row_template: "",
          row_template_type: "String",
          enabled: true,
        },
        destinations: [],
      });
      await flushPromises();

      const values = wrapper.vm.form.state.values;
      expect(values._ui.lockedTargetNames).toEqual({
        wf1: "Restart pods",
        tm_sre: "Platform SRE",
      });
      expect(values.locked_target_names).toBeUndefined();
      const payload = wrapper.vm.getAlertPayload();
      expect(payload.locked_target_names).toBeUndefined();
      expect(payload._ui).toBeUndefined();
      expect(payload.workflows).toEqual(["wf1"]);
      expect(payload.oncall_team).toBe("tm_sre");
    });

    // RBAC lists only the destinations this user may read. One they cannot read must
    // survive a list refresh (it shows as "Missing"), or saving would silently drop it.
    it("keeps a saved destination that the refreshed destinations list does not include", async () => {
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: {
          name: "rbac_alert",
          stream_type: "metrics",
          stream_name: "up",
          is_real_time: false,
          query_condition: {
            type: "promql",
            promql: "up",
            promql_condition: null,
            sql: "",
            aggregation: null,
            conditions: null,
            vrl_function: "",
            multi_time_range: [],
          },
          trigger_condition: {
            period: 5,
            operator: ">=",
            frequency: 60,
            threshold: 1,
            silence: 0,
            frequency_type: "minutes",
            timezone: "UTC",
          },
          destinations: ["dest-a"],
          context_attributes: {},
          description: "",
          row_template: "",
          row_template_type: "String",
          enabled: true,
        },
        destinations: [],
      });
      await flushPromises();

      await wrapper.setProps({ destinations: [{ name: "dest-c" }] });
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual(["dest-a"]);
      expect(wrapper.vm.getAlertPayload().destinations).toEqual(["dest-a"]);
    });

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

    it("drops builder SQL that lands after a switch to PromQL", async () => {
      let answer: (v: unknown) => void = () => {};
      vi.mocked(alertsService.generate_sql).mockImplementationOnce(
        () => new Promise((resolve) => (answer = resolve)) as any,
      );
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      form.setFieldValue("stream_type", "metrics");
      form.setFieldValue("stream_name", "cpu");
      form.setFieldValue("query_condition.type", "custom");
      form.setFieldValue("query_condition.conditions", {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [{ filterType: "condition", column: "host", operator: "=", value: "a" }],
      });
      await vi.waitFor(() => expect(alertsService.generate_sql).toHaveBeenCalled(), {
        timeout: 3000,
      });

      form.setFieldValue("query_condition.type", "promql");
      await flushPromises();
      answer({ data: { sql: 'SELECT avg("value") FROM "cpu"' } });
      await flushPromises();

      expect(wrapper.vm.previewQuery).toBe("");
    });

    it.each([
      ["name", "cpu high"],
      ["description", "why it fires"],
      ["destinations", ["ops"]],
      ["template", "tpl"],
      ["row_template", "{host}"],
      ["trigger_condition.threshold", 25],
    ])("asks the server for no SQL when %s changes", async (field, value) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        wrapper = mountAlert();
        const form = wrapper.vm.form;
        form.setFieldValue("stream_name", "logs_a");
        form.setFieldValue("query_condition.conditions", {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [{ filterType: "condition", column: "host", operator: "=", value: "a" }],
        });
        await vi.advanceTimersByTimeAsync(2000);
        await vi.waitFor(() => expect(alertsService.generate_sql).toHaveBeenCalled());
        await flushPromises();
        vi.mocked(alertsService.generate_sql).mockClear();

        form.setFieldValue(field, value);
        await vi.advanceTimersByTimeAsync(2000);
        expect(alertsService.generate_sql).not.toHaveBeenCalled();

        form.setFieldValue("query_condition.conditions.conditions.0.value", "b");
        await vi.advanceTimersByTimeAsync(2000);
        expect(alertsService.generate_sql).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
    it.each([
      ["the SQL check fails", true, false],
      ["the preview run fails", false, true],
    ])("says the query needs fixing and gives no verdict when %s", async (_, check, run) => {
      const queryFailed = ref(false);
      const PreviewAlert = defineComponent({
        name: "PreviewAlert",
        setup(_props, { expose }) {
          // As the real preview, a failed run withdraws its own verdict.
          const evaluationStatus = computed(() =>
            queryFailed.value ? null : { wouldTrigger: true, reason: "", count: 1000 },
          );
          expose({ evaluationStatus, queryFailed });
          return () => h("div");
        },
      });
      wrapper = mountAlert(
        {},
        {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: { ...stubs, PreviewAlert },
          },
        },
      );
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.form.setFieldValue("query_condition.sql", 'SELECT nosuchcol FROM "app_logs"');
      await flushPromises();
      const verdict = () => wrapper.find('[data-test="add-alert-rail-verdict"]');
      const navItem = () => wrapper.find('[data-test="o-section-nav-item-condition"]');
      expect(verdict().exists()).toBe(true);

      if (check) wrapper.vm.sqlQueryErrorMsg = "Search field not found";
      queryFailed.value = run;
      await flushPromises();

      expect(verdict().exists()).toBe(false);
      expect(navItem().text()).toContain(i18n.global.t("alerts.sections.condition.fixQuery"));
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
      // Percentile mode: threshold on the wire, and the budget sent as an explicit
      // null rather than omitted. The update endpoint's `alert_budget_per_day` is a
      // double-Option, so an absent key means "leave as-is" and a stored budget
      // could never clear; create reads the same null as None, so one payload
      // shape serves both.
      expect(payload.anomaly_config.threshold).toBe(97);
      expect(payload.anomaly_config.alert_budget_per_day).toBeNull();
    });

    // B5: with notifications off the picker is hidden, so the stored override is cleared.
    it("sends a null template when notifications are off", async () => {
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
      wrapper.vm.anomalyConfig.template = "ops-card";

      await wrapper.vm.handleSave();
      await flushPromises();

      const [, payload] = (anomalyDetectionService.create as any).mock.calls[0];
      expect(payload.anomaly_config.template).toBeNull();
    });

    it.each([3.25, 4.234, "", "invalid", "Infinity", 0.5, 10.5])(
      "validates a real sensitivity draft %j before saving its payload",
      async (draft) => {
        wrapper = mountAlert(
          {},
          {
            global: {
              provide: { store },
              plugins: [i18n, router],
              stubs: { ...stubs, AnomalyDetectionConfig: false, QueryEditor: true },
            },
          },
        );
        await flushPromises();
        const form = wrapper.vm.form;
        form.setFieldValue("is_real_time", "anomaly");
        await flushPromises();
        form.setFieldValue("name", "anom_alert");
        form.setFieldValue("stream_type", "logs");
        form.setFieldValue("stream_name", "_rundata");
        await flushPromises();
        wrapper.vm.anomalyConfig.alert_enabled = false;
        await wrapper.find('[data-test="anomaly-sensitivity-row-change"]').trigger("click");
        await wrapper.find('[data-test="anomaly-sensitivity-tier-4"]').trigger("click");
        await wrapper.find('[data-test="anomaly-sensitivity-level"] input').setValue(String(draft));
        await flushPromises();

        await wrapper.vm.handleSave();
        await flushPromises();

        if (typeof draft === "number" && draft >= 1 && draft <= 10) {
          expect(anomalyDetectionService.create).toHaveBeenCalledTimes(1);
          const [, payload] = (anomalyDetectionService.create as any).mock.calls[0];
          expect(payload.anomaly_config.band_width).toBe(draft);
          expect(typeof payload.anomaly_config.band_width).toBe("number");
        } else {
          expect(anomalyDetectionService.create).not.toHaveBeenCalled();
          expect(wrapper.find('[data-test="anomaly-sensitivity-error"]').text()).toBe(
            "Enter a band width from 1 to 10.",
          );
        }
      },
    );

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

  describe("sections layout", () => {
    afterEach(() => {
      breakpoint.lgUp!.value = true;
    });

    it.each([true, false])("the tiers are the same below lg and at lg (lg %s)", async (lg) => {
      breakpoint.lgUp!.value = lg;
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-section-condition-more"]').exists()).toBe(true);
      for (const section of ["condition", "notify", "details"] as const) {
        expect(wrapper.vm.tiers.view(section).expanded).toBe(false);
      }
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(false);
    });

    it("Show all on hides every More options line and opens every + link", async () => {
      wrapper = mountAlert();
      await flushPromises();
      await wrapper.get('[data-test="add-alert-show-all"] button').trigger("click");
      await flushPromises();
      // Show all is remembered per user, so later tests must not inherit it.
      const { setShowAll } = wrapper.vm;
      onTestFinished(() => setShowAll(false));
      expect(wrapper.find('[data-test$="-more"][data-test^="add-alert-section-"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test^="add-alert-add-"]').exists()).toBe(false);
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(true);
      expect(wrapper.vm.tiers.isVisible("description")).toBe(true);
    });

    it("section 4 puts Check every and Looking at the last in one row", async () => {
      wrapper = mountAlert(
        {},
        {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: { ...stubs, QueryConfig: false, AlertSettings: false },
          },
        },
      );
      await flushPromises();
      const row = wrapper.get('[data-test="add-alert-schedule-row"]');
      expect(row.find('[data-test="alert-check-every-input"]').exists()).toBe(true);
      expect(row.find('[data-test="alert-settings-period-input"]').exists()).toBe(true);
    });

    it.each([
      ["create", {}],
      ["edit", { isUpdated: true, modelValue: savedAlert() }],
    ])("%s puts the query before the limit", async (_mode, props) => {
      wrapper = mountAlert(props);
      await flushPromises();
      const slot = wrapper.get('[data-test="add-alert-query-condition-slot"]').element;
      const card = wrapper.get('[data-test="add-alert-query-card"]').element;
      expect(card.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("section 3 puts what the message says before the incident rows", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const { advancedMessage, settingsNotifyMore } = wrapper.vm.sectionTargets;
      expect(
        advancedMessage.compareDocumentPosition(settingsNotifyMore) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("moves the preview under the condition step below lg and back beside it at lg", async () => {
      breakpoint.lgUp!.value = false;
      wrapper = mountAlert();
      await flushPromises();
      const inCondition = () =>
        wrapper.find('[data-test="add-alert-narrow-preview"] [data-test="add-alert-rail-content"]');
      expect(inCondition().exists()).toBe(true);
      expect(wrapper.get('[data-test="add-alert-rail"]').classes()).toContain("hidden");

      breakpoint.lgUp!.value = true;
      await flushPromises();
      expect(inCondition().exists()).toBe(false);
      expect(
        wrapper.find('[data-test="add-alert-rail"] [data-test="add-alert-rail-content"]').exists(),
      ).toBe(true);
    });

    it("keeps Find a setting and fits the condition subtitle for anomaly and composite", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const help = () => wrapper.get('[data-test="add-alert-section-condition-help"]').text();
      expect(help()).toContain("how many is a problem");

      wrapper.vm.form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-find-setting"]').exists()).toBe(true);
      expect(help()).toBe(
        "Choose what to measure and how unusual a value must be before it alerts you.",
      );
      wrapper.vm.settingFind.query.value = "sensitivity";
      await flushPromises();
      expect(wrapper.vm.settingFind.items.value.map((i: { id: string }) => i.id)).toEqual([
        "anomalySensitivity",
      ]);

      wrapper.vm.form.setFieldValue("is_real_time", "composite");
      await flushPromises();
      expect(help()).toBe("Pick the alerts to combine and how they must fire together.");
    });

    it("keeps Save the filled primary on every section", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const save = () => wrapper.findComponent('[data-test="add-alert-submit-btn"]');
      for (const section of ["watch", "details"]) {
        wrapper.vm.activeSection = section;
        await flushPromises();
        expect(save().props("variant")).toBe("primary");
      }
      expect(wrapper.find('[data-test="add-alert-footer"]').text()).not.toContain("Next");
    });

    it("ticks a section with a value once the user moves past it", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const state = (id: string) =>
        wrapper.vm.sectionItems.find((item: { id: string }) => item.id === id).state;
      wrapper.vm.form.setFieldValue("stream_name", "k8s_logs");
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      wrapper.vm.activeSection = "notify";
      await flushPromises();
      expect(state("condition")).toBe("done");
    });

    it("renders the five sections in order beside the section list", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const ids = wrapper
        .findAll("[data-snap-section]")
        .map((el) => el.attributes("data-snap-section"));
      expect(ids).toEqual(["watch", "condition", "notify", "schedule", "details"]);
      expect(wrapper.findAll('[data-test^="o-section-nav-item-"]')).toHaveLength(5);
      expect(wrapper.find('[data-test="add-alert-tab-condition"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="add-alert-tab-advanced"]').exists()).toBe(false);
    });

    it.each(["true", "composite"])(
      "a %s alert has no schedule step: four steps, its one sentence in step 2",
      async (type) => {
        wrapper = mountAlert();
        await flushPromises();
        wrapper.vm.onAlertTypeChange(type);
        await flushPromises();
        const ids = wrapper
          .findAll("[data-snap-section]")
          .map((el) => el.attributes("data-snap-section"));
        expect(ids).toEqual(["watch", "condition", "notify", "details"]);
        expect(wrapper.findAll('[data-test^="o-section-nav-item-"]')).toHaveLength(4);
        const condition = wrapper.get('[data-test="add-alert-section-condition"]');
        expect(condition.find('[data-test="add-alert-schedule-note"]').exists()).toBe(true);
        const scrollToSection = vi.fn();
        wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
        await wrapper.get('[data-test="add-alert-section-notify-next"]').trigger("click");
        // A real-time alert says nothing about a schedule; a combined one says when it checks.
        const line = type === "true" ? "condition" : "schedule";
        await wrapper.get(`[data-test="add-alert-review-${line}"]`).trigger("click");
        expect(scrollToSection.mock.calls).toEqual([["details"], ["condition"]]);
      },
    );

    it("asks the alert type first, because it decides the fields that follow", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const tabs = '[data-test="add-alert-type-tabs"]';
      expect(wrapper.find(`[data-test="add-alert-section-watch"] ${tabs}`).exists()).toBe(true);
      expect(wrapper.find(`[data-test="add-alert-section-schedule"] ${tabs}`).exists()).toBe(false);
    });

    it("steps from each section header: Next names the following step, the ends stay in place disabled", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const btn = (id: string, dir: string) => `[data-test="add-alert-section-${id}-${dir}"]`;
      const firstBack = wrapper.find(btn("watch", "prev"));
      expect(firstBack.attributes("disabled")).toBeDefined();
      expect(firstBack.attributes("aria-label")).toBe("Previous step");
      expect(wrapper.find(btn("watch", "next")).attributes("aria-label")).toBe(
        "Next: When to alert",
      );
      expect(wrapper.find(btn("notify", "next")).attributes("aria-label")).toBe(
        "Next: How often to check",
      );
      const lastNext = wrapper.find(btn("details", "next"));
      expect(lastNext.attributes("disabled")).toBeDefined();
      expect(lastNext.attributes("aria-label")).toBe("Next step");

      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
      await wrapper.find(btn("notify", "next")).trigger("click");
      expect(scrollToSection).toHaveBeenCalledWith("schedule");
      await wrapper.find(btn("notify", "prev")).trigger("click");
      expect(scrollToSection).toHaveBeenCalledWith("condition");
    });

    it("the footer Next scrolls to the next section and focuses its first control", async () => {
      const rects = vi
        .spyOn(Element.prototype, "getClientRects")
        .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
      await wrapper.find('[data-test="add-alert-section-4-next"]').trigger("click");
      await flushPromises();
      expect(scrollToSection).toHaveBeenCalledWith("details");
      const name = wrapper.find('[data-test="add-alert-details-name-input"] input').element;
      // Focus waits for the glide to land, so a control scrolling itself into view cannot stop it.
      expect(document.activeElement).not.toBe(name);
      await vi.waitFor(() => expect(document.activeElement).toBe(name));
      // Back to a section whose step 1 is folded skips the summary line's Change link.
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.activeSection = "watch";
      await flushPromises();
      wrapper.vm.activeSection = "condition";
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="add-alert-watch-summary"]').exists()).toBe(true),
      );
      await wrapper.find('[data-test="add-alert-section-3-back"]').trigger("click");
      await vi.waitFor(() =>
        expect(
          (document.activeElement?.closest("[data-snap-section]") as HTMLElement)?.dataset
            .snapSection,
        ).toBe("condition"),
      );
      expect(
        wrapper
          .get('[data-test="add-alert-section-condition-card"]')
          .element.contains(document.activeElement),
      ).toBe(true);
      // The picked stream plus the focus moves count as edits, so a draft would greet the next test.
      wrapper.vm.alertDraft.discard();
      rects.mockRestore();
    });

    it("names the alert types as ways of checking, keeping their ids", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-type-tab-false"]').text()).toContain(
        "On a schedule",
      );
      expect(wrapper.find('[data-test="add-alert-type-tab-true"]').text()).toContain(
        "As it happens",
      );
    });

    it.each([
      ["false", "alerts.sections.condition.help"],
      ["true", "alerts.sections.condition.helpRealtime"],
      ["composite", "alerts.sections.condition.helpComposite"],
    ])("step 2's help fits a %s alert, with no count for real time", async (mode, key) => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("is_real_time", mode);
      await flushPromises();
      expect(wrapper.vm.conditionHelp).toBe(i18n.global.t(key));
    });

    it("keeps the rail to the chart and verdict; the alert reads back in section 5 only", async () => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "k8s_logs");
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-rail-sentence"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="add-alert-read-back"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="alerts-alert-summary"]').exists()).toBe(false);
    });

    it("names the rare condition settings on one line that expands in place", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const more = () => wrapper.find('[data-test="add-alert-section-condition-more"]');
      // No stream yet, so no generated SQL to list.
      expect(wrapper.vm.tiers.view("condition").more.map((d: { id: string }) => d.id)).toEqual([
        "holdFor",
      ]);
      expect(wrapper.find('[data-test="add-alert-section-condition-more-names"]').exists()).toBe(
        true,
      );
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(false);

      await more().trigger("click");
      expect(more().attributes("aria-expanded")).toBe("true");
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(true);
      expect(wrapper.vm.tiers.isVisible("warning")).toBe(false);

      await more().trigger("click");
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(false);
    });

    it("shows a rare setting that holds a value and drops it from the line", async () => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("pending_period_sec", 5);
      await flushPromises();
      expect(wrapper.vm.tiers.isVisible("holdFor")).toBe(true);
      expect(wrapper.vm.tiers.view("condition").more).toEqual([]);
    });

    it("keeps the message settings one click away and names tags and priority on the line", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.vm.tiers.isVisible("template")).toBe(false);
      await wrapper.find('[data-test="add-alert-add-template"]').trigger("click");
      expect(wrapper.vm.tiers.isVisible("template")).toBe(true);
      expect(wrapper.find('[data-test="add-alert-add-template"]').exists()).toBe(false);
      await wrapper.find('[data-test="add-alert-add-variables"]').trigger("click");
      expect(wrapper.vm.form.getFieldValue("context_attributes")).toHaveLength(1);
      expect(wrapper.vm.tiers.isVisible("tags")).toBe(false);
      expect(wrapper.vm.tiers.view("details").more.map((d: { id: string }) => d.id)).toEqual([
        "tags",
        "priority",
      ]);
    });

    it("finds a setting by its old name and reveals just that setting when picked", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-find-setting"]').exists()).toBe(true);
      wrapper.vm.settingFind.query.value = "flapping";
      await flushPromises();
      expect(wrapper.vm.settingFind.items.value[0]).toMatchObject({
        id: "keepFiring",
        label: "Keep firing for",
      });
      expect(wrapper.vm.tiers.isVisible("keepFiring")).toBe(false);
      // jsdom has no layout: the stubbed step renders no control, so the jump falls back to the section.
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: scrollTo,
      });
      await wrapper.vm.settingFind.select("keepFiring");
      await flushPromises();
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
      expect(wrapper.vm.tiers.isVisible("keepFiring")).toBe(true);
      expect(scrollTo).toHaveBeenCalled();
      expect(wrapper.vm.tiers.view("notify").more.map((d: { id: string }) => d.id)).not.toContain(
        "keepFiring",
      );
    });

    it("lists only the settings the alert type has", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const found = (q: string): string[] => {
        wrapper.vm.settingFind.query.value = q;
        return wrapper.vm.settingFind.items.value.map((i: { id: string }) => i.id);
      };
      expect(found("cron")).toContain("cron");
      wrapper.vm.form.setFieldValue("is_real_time", "true");
      await flushPromises();
      expect(found("cron")).not.toContain("cron");
      expect(found("flapping")).not.toContain("keepFiring");
      expect(found("suppress")).not.toContain("suppressRepeats");
      expect(found("cooldown")).toContain("cooldown");
    });

    it("names the alert in a text field in section 5, offering the suggestion back once renamed", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-details-name-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-alert-details-rename-btn"]').exists()).toBe(false);

      wrapper.vm.form.setFieldValue("stream_name", "k8s_logs");
      wrapper.vm.activeSection = "details";
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-details-name-auto"]').exists()).toBe(true);

      const input = wrapper.get('[data-test="add-alert-details-name-input"] input');
      const savedAs = () => wrapper.find('[data-test="add-alert-details-name-saved-as"]');
      await input.setValue("checkout errors > 5%");
      await flushPromises();
      expect(wrapper.vm.formData.name).toBe("checkout errors > 5%");
      expect(savedAs().text()).toBe(
        i18n.global.t("alerts.form.names.savesAs", { name: "checkout_errors_>_5" }),
      );
      await input.trigger("blur");
      await flushPromises();
      expect(wrapper.vm.formData.name).toBe("checkout_errors_>_5");
      expect(savedAs().exists()).toBe(false);
      expect(wrapper.find('[data-test="add-alert-details-name-rewritten"]').exists()).toBe(true);
      await input.trigger("input");
      await flushPromises();
      const suggest = wrapper.get('[data-test="add-alert-details-name-suggest"]');
      await suggest.trigger("click");
      await flushPromises();
      expect(wrapper.vm.formData.name).toBe(wrapper.vm.alertNameSuggestion);

      // Enter saves; a save the form blocks says what stopped it.
      await input.setValue("");
      await input.trigger("keydown.enter");
      await flushPromises();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining(i18n.global.t("alerts.sections.details.nav")),
        }),
      );
    });

    it("suggests a name no alert in the folder already has", async () => {
      vi.mocked(alertsService.listByFolderId).mockResolvedValue({
        data: { list: [{ name: "k8s_logs_alert" }] },
      } as any);
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "k8s_logs");
      wrapper.vm.activeSection = "details";
      await flushPromises();
      expect(wrapper.vm.alertNameSuggestion).toBe("k8s_logs_alert_2");
    });
  });

  describe("edit header and tucked settings", () => {
    it("keeps a header Disable through the next Save and does not count it as unsaved", async () => {
      wrapper = mountAlert({ isUpdated: true, modelValue: savedAlert() });
      await flushPromises();
      document.dispatchEvent(new Event("pointerdown"));

      await wrapper.vm.editHeader.toggleEnabled();
      await flushPromises();

      expect(alertsService.toggle_state_by_alert_id).toHaveBeenCalledWith(
        expect.any(String),
        "alert-1",
        false,
        expect.anything(),
      );
      expect(wrapper.vm.editHeader.enabled.value).toBe(false);
      expect(wrapper.vm.editHeader.state.value).toEqual({ kind: "disabled" });
      expect(wrapper.vm.form.state.values.enabled).toBe(false);
      expect(wrapper.vm.getAlertPayload().enabled).toBe(false);
      expect(wrapper.vm.unsavedChanges.map((c: { path: string }) => c.path)).not.toContain(
        "enabled",
      );
    });

    describe("measure switched to event count", () => {
      const measureAlert = () =>
        savedAlert({
          stream_type: "metrics",
          query_condition: {
            ...savedAlert().query_condition,
            aggregation: {
              function: "avg",
              group_by: [],
              having: { column: "field2", operator: ">=", value: 90 },
            },
          },
        });
      const mountWithQuery = async () => {
        wrapper = mountAlert(
          { isUpdated: true, modelValue: measureAlert() },
          {
            attachTo: document.body,
            global: {
              provide: { store },
              plugins: [i18n, router],
              stubs: { ...stubs, QueryConfig: false },
            },
          },
        );
        await flushPromises();
        document.dispatchEvent(new Event("pointerdown"));
        await flushPromises();
      };
      const pickEventCount = async () => {
        wrapper
          .findComponent({ name: "Step2QueryConfig" })
          .findAllComponents({ name: "OSelect" })
          .find((c: any) => c.props("modelValue") === "avg")!
          .vm.$emit("update:modelValue", "total_events");
        await flushPromises();
      };
      const savedMeasure = { function: "avg", having: { column: "field2", value: 90 } };

      it("counts the switch as an unsaved change", async () => {
        await mountWithQuery();
        await pickEventCount();
        expect(wrapper.vm.getAlertPayload().query_condition.aggregation).toBeNull();
        expect(wrapper.vm.unsavedChanges).toEqual([
          { path: "aggregation_enabled", before: true, after: false },
        ]);
      });

      it("Discard brings the saved measure back and drops the autosaved draft", async () => {
        await mountWithQuery();
        await pickEventCount();
        const discardDraft = vi.spyOn(wrapper.vm.alertDraft, "discard");
        await wrapper.vm.discardChanges();
        expect(discardDraft).toHaveBeenCalledOnce();
        await flushPromises();
        expect(wrapper.vm.isAggregationEnabled).toBe(true);
        expect(wrapper.vm.getAlertPayload().query_condition.aggregation).toMatchObject(
          savedMeasure,
        );
        expect(wrapper.vm.unsavedChanges).toEqual([]);
      });

      it("a header Disable before Discard keeps the saved measure as the baseline", async () => {
        await mountWithQuery();
        await pickEventCount();
        wrapper.vm.form.setFieldValue("description", "an unsaved edit");
        await flushPromises();
        await wrapper.vm.editHeader.toggleEnabled();
        await flushPromises();
        await wrapper.vm.discardChanges();
        await flushPromises();
        expect(wrapper.vm.form.state.values.enabled).toBe(false);
        expect(wrapper.vm.getAlertPayload().query_condition.aggregation).toMatchObject(
          savedMeasure,
        );
      });
    });

    it.each([
      ["holdFor", { pending_period_sec: 300 }, ["pending_period_sec", 0]],
      ["holdFor", { pending_period_sec: 300 }, ["pending_period_sec", -5]],
      ["recovery", { notify_on_recovery: true }, ["notify_on_recovery", false]],
      ["tags", { tags: ["payments"] }, ["tags", []]],
    ] as const)(
      "keeps %s on screen once its value is cleared",
      async (id, loaded, [field, cleared]) => {
        wrapper = mountAlert({ isUpdated: true, modelValue: savedAlert(loaded) });
        await flushPromises();
        expect(wrapper.vm.tiers.isVisible(id)).toBe(true);

        wrapper.vm.form.setFieldValue(field, cleared);
        await flushPromises();

        expect(wrapper.vm.tiers.isVisible(id)).toBe(true);
      },
    );

    it("keeps a negative hold-for and its error on screen, and flags the section", async () => {
      wrapper = mountAlert(
        { isUpdated: true, modelValue: savedAlert({ pending_period_sec: 300 }) },
        {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: { ...stubs, AlertSettings: false },
          },
        },
      );
      await flushPromises();
      const row = () => wrapper.find('[data-test="alert-settings-pending-period-input"]');
      expect(row().exists()).toBe(true);

      await row().find("input").setValue("-5");
      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(row().exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-settings-pending-period-error"]').text()).not.toBe("");
      expect(wrapper.find('[data-test="o-section-nav-item-condition"]').text()).toContain(
        i18n.global.t("alerts.sections.needsFix", { count: 1 }, 1),
      );
      expect(alertsService.update_by_alert_id).not.toHaveBeenCalled();
    });

    it("can focus hold-for after it appears, though it was hidden when the editor opened", async () => {
      breakpoint.lgUp.value = false;
      wrapper = mountAlert(
        { isUpdated: true, modelValue: savedAlert({ pending_period_sec: 0 }) },
        {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: { ...stubs, AlertSettings: false },
          },
        },
      );
      await flushPromises();
      expect(wrapper.find('[data-test="alert-settings-pending-period-input"]').exists()).toBe(
        false,
      );
      wrapper.vm.form.setFieldValue("pending_period_sec", 300);
      await flushPromises();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      wrapper.vm.focusManager.focusField("pending_period");

      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("not registered"));
      warn.mockRestore();
      breakpoint.lgUp.value = true;
    });

    it("moves focus to the picked section's heading", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      await wrapper.find('[data-test="o-section-nav-item-notify"]').trigger("click");
      expect(focusedTestId()).toBe("add-alert-section-notify-title");
    });

    it("gives a real-time alert a plain note instead of a verdict", async () => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.form.setFieldValue("is_real_time", "true");
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-rail-verdict"]').text()).toBe(
        "Fires on each matching event.",
      );
    });
  });

  describe("section 1: what to watch", () => {
    afterEach(async () => {
      store.state.zoConfig.custom_hide_menus = "";
      await router.replace({ query: {} });
    });

    it("stream type is a dropdown that feeds the stream list", async () => {
      wrapper = mountAlert();
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-stream-type-cards"]').exists()).toBe(false);
      const select = wrapper
        .findAllComponents(OSelect)
        .find((c: any) => c.attributes("data-test") === "add-alert-stream-type-select-dropdown");
      getStreamsMock.mockClear();
      select.vm.$emit("update:model-value", "metrics");
      await flushPromises();
      expect(wrapper.vm.form.state.values.stream_type).toBe("metrics");
      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false);
    });

    it.each([
      ["create", {}, "", true],
      ["edit", { isUpdated: true, modelValue: savedAlert() }, "", false],
      ["create with the library hidden", {}, "alertLibrary", false],
    ])("the Alert Library link on %s", async (_, props, hidden, shown) => {
      store.state.zoConfig.custom_hide_menus = hidden;
      const push = vi.spyOn(router, "push");
      wrapper = mountAlert(props);
      await flushPromises();
      const link = wrapper.find('[data-test="add-alert-library-link"]');
      expect(link.exists()).toBe(shown);
      if (!shown) return;
      await link.trigger("click");
      expect(push).toHaveBeenCalledWith({
        name: "alertLibrary",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });

    it("a ready-made alert saves with its pack tag, and starting from scratch takes it back off", async () => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "k8s_events");
      await flushPromises();
      await wrapper.vm.applySuggestion({
        kind: "library",
        id: "k8s/oom-killed",
        title: "OOM",
        sentence: null,
        severity: "high",
        alert_type: "scheduled",
        query_type: "sql",
        fit: "fits",
        matched_fields: [],
        missing: [],
        stream_swap: null,
        already_set_up: [],
        enterprise: false,
        library: { pack: "k8s", path: "k8s/oom.json", content_hash: "h1", docs_url: null },
        starter: null,
        prefill: { stream_type: "logs", stream_name: "k8s_events" },
      });
      await flushPromises();
      expect(wrapper.vm.form.getFieldValue("tags")).toEqual(["pack:k8s"]);
      wrapper.vm.startFromScratch();
      await flushPromises();
      expect(wrapper.vm.form.getFieldValue("tags")).toEqual([]);
    });

    it.each([
      ["a new alert", {}, {}, true, true],
      ["a new alert on a phone", {}, {}, false, false],
      ["an edit", { isUpdated: true, modelValue: savedAlert() }, {}, true, false],
      ["a prefilled open", {}, { prefill: "logs" }, true, false],
    ])("stream picker focus on %s", async (_, props, query, lg, focused) => {
      await router.replace({ query });
      breakpoint.lgUp!.value = lg;
      onTestFinished(() => {
        breakpoint.lgUp!.value = true;
      });
      wrapper = mountAlert(props, { attachTo: document.body });
      await flushPromises();
      const picker = document.querySelector('[data-test="add-alert-stream-name-select-dropdown"]');
      expect(!!picker?.contains(document.activeElement)).toBe(focused);
      if (!focused) return;
      expect(wrapper.vm.form.state.values.is_real_time).toBe("false");
      expect(wrapper.vm.form.state.values.stream_type).toBe("logs");
    });
  });

  describe("section 1 folds to a summary line", () => {
    it("edit opens on section 2, and the list, Back and leaving keep section 1 reachable and locked", async () => {
      const rects = vi
        .spyOn(Element.prototype, "getClientRects")
        .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
      onTestFinished(() => rects.mockRestore());
      wrapper = mountAlert(
        { isUpdated: true, modelValue: savedAlert() },
        { attachTo: document.body },
      );
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
      await flushPromises();
      expect(wrapper.vm.activeSection).toBe("condition");
      expect(scrollToSection.mock.calls).toEqual([["condition"]]);
      const watch = () => wrapper.find('[data-test="add-alert-section-watch"]');
      expect(watch().exists()).toBe(true);
      expect(watch().find('[data-test="add-alert-watch-locked"]').exists()).toBe(true);
      const trigger = watch().get('[data-test="add-alert-stream-name-select-dropdown-trigger"]');
      expect(trigger.attributes()).toHaveProperty("disabled");
      expect(wrapper.find('[data-test="add-alert-watch-summary"]').exists()).toBe(false);

      await wrapper.get('[data-test="o-section-nav-item-watch"]').trigger("click");
      expect(scrollToSection).toHaveBeenLastCalledWith("watch");
      await wrapper.get('[data-test="add-alert-section-2-back"]').trigger("click");
      expect(scrollToSection).toHaveBeenLastCalledWith("watch");
      await vi.waitFor(() => expect(watch().element.contains(document.activeElement)).toBe(true));

      wrapper.vm.activeSection = "watch";
      await flushPromises();
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      expect(watch().exists()).toBe(true);
    });

    it("create collapses section 1 after moving on and Change reopens it", async () => {
      wrapper = mountAlert();
      await flushPromises();
      wrapper.vm.activeSection = "watch";
      await flushPromises();
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-section-watch"]').exists()).toBe(true);
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.activeSection = "watch";
      await flushPromises();
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-section-watch"]').exists()).toBe(false);
      await wrapper.get('[data-test="add-alert-watch-summary-change"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-section-watch"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-alert-watch-summary"]').exists()).toBe(false);
    });

    it.each([
      ["a jump from the section list", true],
      ["a Tab into section 2", false],
    ])("%s folds section 1 without moving the view or focus", async (_, jump) => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.activeSection = "watch";
      await flushPromises();
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
      const control = wrapper.get('[data-test="add-alert-section-condition-next"]')
        .element as HTMLElement;
      if (jump) wrapper.vm.goToSection("schedule");
      else control.focus();
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      const watchOpen = () => wrapper.find('[data-test="add-alert-section-watch"]').exists();
      expect(watchOpen()).toBe(jump);
      if (jump) {
        wrapper.vm.activeSection = "schedule";
        await vi.waitFor(() => expect(watchOpen()).toBe(false));
      }
      expect(scrollToSection.mock.calls).toEqual(jump ? [["schedule"]] : []);
      if (!jump) expect(document.activeElement).toBe(control);
    });

    it("a fold while the view rests on section 2 lands on its start, above its new summary line", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.activeSection = "watch";
      await flushPromises();
      const scroller = wrapper.get('[data-test="add-alert-sections"]').element as HTMLElement;
      scroller.style.overflowY = "auto";
      let top = 638;
      Object.defineProperty(scroller, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      });
      const control = wrapper.get('[data-test="add-alert-section-condition-next"]').element;
      const section = wrapper.get('[data-snap-section="condition"]').element;
      // Folding removes 638 px above the view and adds a 36 px summary line atop section 2.
      const rects = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: Element) {
          const open = !!document.querySelector('[data-snap-section="watch"]');
          const y =
            this === section ? (open ? 0 : -638) : this === control ? (open ? 100 : -502) : 0;
          return new DOMRect(0, y, 10, 10);
        });
      (control as HTMLElement).focus();
      wrapper.vm.activeSection = "condition";
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-section-watch"]').exists()).toBe(false);
      expect(top).toBe(0);
      rects.mockRestore();
    });

    it("saving an untouched edit sends the loaded trigger values", async () => {
      const trigger = {
        period: 10,
        operator: ">=",
        frequency: 10,
        threshold: 3,
        silence: 90,
        frequency_type: "cron",
        cron: "0 0 9 * * 1-5",
        timezone: "Europe/Berlin",
      };
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: savedAlert({ trigger_condition: { ...trigger }, keep_firing_for: 45 }),
        destinations: [{ name: "email" }],
      });
      await flushPromises();
      await wrapper.vm.form.handleSubmit();
      await flushPromises();
      const payload = (alertsService.update_by_alert_id as any).mock.calls[0][1];
      expect(payload.trigger_condition).toMatchObject(trigger);
      expect(payload.keep_firing_for).toBe(45);
    });
  });

  describe("condition presets", () => {
    it.each([
      ["a new alert", null, null, "any"],
      ["a limit of 5", ">=", 5, "few"],
      ["a limit no card fits", ">=", 3, "custom"],
      ["a strict comparison", ">", 3, undefined],
    ])("%s selects its card", async (_, operator, threshold, preset) => {
      wrapper = mountAlert();
      await flushPromises();
      if (operator) wrapper.vm.form.setFieldValue("trigger_condition.operator", operator);
      if (threshold) wrapper.vm.form.setFieldValue("trigger_condition.threshold", threshold);
      await flushPromises();
      expect(wrapper.vm.activeConditionPreset).toBe(preset);
      if (!operator) expect(wrapper.vm.form.state.values.trigger_condition.threshold).toBe(1);
      const custom = wrapper.vm.conditionPresetOptions.find((o: any) => o.value === "custom");
      expect(custom?.description).toBe(
        preset === "custom"
          ? i18n.global.t("alerts.sections.presets.orMore", { count: threshold })
          : undefined,
      );
    });
  });

  describe("name and folder live in section 5", () => {
    const withHeader = (props: Record<string, any> = {}) =>
      mountAlert(props, {
        attachTo: document.body,
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: { ...stubs, OPageHeader: false },
        },
      });

    it("the name has one input and its error shows once", async () => {
      wrapper = withHeader();
      await flushPromises();
      expect(wrapper.findComponent(OFormInlineEdit).exists()).toBe(false);
      expect(wrapper.findAll('[data-test="add-alert-details-name-input"] input')).toHaveLength(1);
      wrapper.vm.form.setFieldValue("stream_name", "app_logs");
      wrapper.vm.form.setFieldValue("name", "bad#name");
      await wrapper.vm.handleSave();
      await flushPromises();
      const messages = wrapper
        .findAll('[role="alert"]')
        .filter((m: any) => m.text().includes(i18n.global.t("alerts.nameNoSpecialChars")));
      expect(messages).toHaveLength(1);
    });

    it("the header pencil focuses the Name field", async () => {
      wrapper = withHeader();
      await flushPromises();
      expect(wrapper.get('[data-test="add-alert-header-title"]').text()).toBe(
        i18n.global.t("alerts.sections.details.unnamed"),
      );
      await wrapper.get('[data-test="add-alert-header-name-edit"]').trigger("click");
      await flushPromises();
      const input = document.querySelector('[data-test="add-alert-details-name-input"] input');
      expect(document.activeElement).toBe(input);
    });

    it.each([
      ["create", {}, true],
      ["edit", { isUpdated: true, modelValue: savedAlert() }, false],
    ])(
      "folder is chosen in section 5 on %s and read-only in the header",
      async (_, props, pick) => {
        wrapper = withHeader(props);
        await flushPromises();
        const details = wrapper.get('[data-test="add-alert-section-details"]');
        expect(details.get('[data-test="add-alert-section-details-title"]').text()).toBe(
          i18n.global.t("alerts.sections.details.title"),
        );
        expect(details.find('[data-test="add-alert-details-name-input"]').exists()).toBe(pick);
        expect(details.find('[data-test="add-alert-details-name-text"]').exists()).toBe(!pick);
        expect(details.find('[data-test="add-alert-details-folder-select"]').exists()).toBe(pick);
        if (pick) {
          const picker = details.findComponent({ name: "InlineSelectFolderDropdown" });
          expect(picker.props("variant")).toBe("inline");
        }
        expect(details.find('[data-test="add-alert-details-folder-name"]').exists()).toBe(!pick);
        expect(wrapper.get('[data-test="add-alert-header-folder"]').text()).toBe("default");
        expect(wrapper.findAllComponents({ name: "InlineSelectFolderDropdown" })).toHaveLength(
          pick ? 1 : 0,
        );
        expect(wrapper.find('[data-test="add-alert-header-name-edit"]').exists()).toBe(pick);
      },
    );
  });

  it("reads the alert back in sentences, each with a Change link to its section", async () => {
    wrapper = mountAlert({ isUpdated: true, modelValue: savedAlert() });
    await flushPromises();
    const scrollToSection = vi.fn();
    wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
    const watchLine = wrapper.get('[data-test="add-alert-review-watch-text"]');
    expect(watchLine.text()).toBe("Watches Logs in app_logs, on a schedule.");
    expect(watchLine.findAll("strong").map((b) => b.text())).toEqual(["Logs", "app_logs"]);
    await wrapper.get('[data-test="add-alert-review-notify"]').trigger("click");
    expect(scrollToSection).toHaveBeenCalledWith("notify");
  });

  describe("Save names the issues to fix", () => {
    const submitText = () => wrapper.get('[data-test="add-alert-submit-btn"]').text();
    const failField = (name: string) =>
      wrapper.vm.form.setFieldMeta(name, (meta: object) => ({
        ...meta,
        isDirty: true,
        isBlurred: true,
        errorMap: { onSubmit: "invalid" },
      }));

    it.each([0, 1, 3])("%s issues", async (count) => {
      wrapper = mountAlert();
      await flushPromises();
      ["name", "destinations", "description"].slice(0, count).forEach(failField);
      await flushPromises();
      expect(submitText()).toBe(
        count
          ? i18n.global.t("alerts.form.save.fixIssues", { count }, count)
          : i18n.global.t("alerts.save"),
      );
    });

    it("a composite not yet passed by the server says why beside Save, which saves nothing and goes there", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const scrollToSection = vi.fn();
      wrapper.vm.$refs.snapScrollRef.scrollToSection = scrollToSection;
      const form = wrapper.vm.form;
      form.setFieldValue("is_real_time", "composite");
      form.setFieldValue("name", "combined");
      form.setFieldValue("trigger_condition", { silence: 15 });
      form.setFieldValue("composite_condition", { expression: "{id-a} && {id-b}" });
      form.setFieldValue("children", [
        { alert_id: "id-a", name: "errors_high", accessible: true },
        { alert_id: "id-b", name: "latency_high", accessible: true },
      ]);
      await flushPromises();
      wrapper.vm.onCompositeValidation({ valid: false });
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-save-reason"]').exists()).toBe(true);
      const save = wrapper.get('[data-test="add-alert-submit-btn"]');
      expect(save.attributes("disabled")).toBeUndefined();
      await save.trigger("click");
      await flushPromises();
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(scrollToSection).toHaveBeenCalledWith("condition"));
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    });

    it("an edit with an unknown column reads Fix 1 issue after Save and focuses the error", async () => {
      vi.mocked(searchService.search).mockRejectedValueOnce({
        response: { status: 400, data: { message: "Schema error: No field named servce" } },
      });
      wrapper = mountAlert(
        {
          isUpdated: true,
          modelValue: savedAlert({
            query_condition: {
              ...savedAlert().query_condition,
              type: "sql",
              sql: "SELECT service FROM app_logs",
            },
          }),
        },
        {
          attachTo: document.body,
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: { ...stubs, QueryConfig: false },
          },
        },
      );
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT servce FROM app_logs");
      await wrapper.vm.handleSave();
      await vi.waitFor(() => expect(wrapper.vm.sqlQueryErrorMsg).toBeTruthy(), { timeout: 2000 });
      await flushPromises();
      expect(submitText()).toBe(i18n.global.t("alerts.form.save.fixIssues", { count: 1 }, 1));
      const error = document.querySelector('[data-test="add-alert-sql-error"]');
      expect(error?.contains(document.activeElement)).toBe(true);
    });
  });

  // ── Error focus across sections ───────────────────────────────────────────
  // focusOnFirstError skips messages with a null offsetParent, so a slice the
  // current alert type hides is never focused into the void.
  describe("focusOnFirstError (sections)", () => {
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
     *  (a [role="alert"] message beside its control) into a section's body. */
    const seedFieldError = (section: string, hidden = false): HTMLInputElement => {
      const body = wrapper.find(`[data-test="add-alert-section-${section}"]`).element;
      const field = document.createElement("div");
      if (hidden) field.style.display = "none";
      field.innerHTML = '<span role="alert">At least one destination is required.</span><input />';
      body.appendChild(field);
      return field.querySelector("input") as HTMLInputElement;
    };

    it("a field left invalid counts at once, and the line beside Save names its section and goes to it", async () => {
      // Typing keeps an editor draft, which would greet the next mount with a restore dialog.
      onTestFinished(() => localStorage.clear());
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      expect(wrapper.find('[data-test="add-alert-save-reason"]').exists()).toBe(false);
      const input = wrapper.get('[data-test="add-alert-details-name-input"] input');
      await input.setValue("///");
      await flushPromises();
      expect(wrapper.get('[data-test="add-alert-submit-btn"]').text()).toBe(
        i18n.global.t("alerts.save"),
      );
      await input.trigger("blur");
      await vi.waitFor(() =>
        expect(wrapper.get('[data-test="add-alert-submit-btn"]').text()).toBe(
          i18n.global.t("alerts.form.save.fixIssues", { count: 1 }, 1),
        ),
      );
      const reason = wrapper.get('[data-test="add-alert-save-reason"]');
      expect(reason.text()).toContain(i18n.global.t("alerts.sections.details.nav"));
      (document.activeElement as HTMLElement | null)?.blur();
      await reason.get('[data-test="add-alert-save-reason-link"]').trigger("click");
      await flushPromises();
      expect(document.activeElement).toBe(input.element);
    });

    it("focuses an error in any section, since every section is always shown", async () => {
      // Attached: focusOnFirstError reaches for the live document (the real
      // <form> + focus()), which a detached wrapper has no place in.
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      const input = seedFieldError("notify");
      const revealElement = vi.fn();
      wrapper.vm.$refs.snapScrollRef.revealElement = revealElement;

      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(document.activeElement).toBe(input);
      expect(revealElement).toHaveBeenCalledWith(input);
    });

    it("focuses the earliest section's error when several sections have one", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      const later = seedFieldError("details");
      const earlier = seedFieldError("condition");

      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(document.activeElement).toBe(earlier);
      expect(document.activeElement).not.toBe(later);
    });

    it("skips a stale message in a slice the current mode hides", async () => {
      wrapper = mountAlert({}, { attachTo: document.body });
      await flushPromises();
      wrapper.vm.form.setFieldValue("is_real_time", "anomaly");
      await flushPromises();
      const hidden = seedFieldError("condition", true);
      const visible = seedFieldError("details");

      wrapper.vm.focusOnFirstError();
      await flushPromises();

      expect(document.activeElement).toBe(visible);
      expect(document.activeElement).not.toBe(hidden);
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
      const warning =
        "This alert's workflow will not run: Workflows is not included in your license.";
      (alertsService.update_by_alert_id as any).mockResolvedValueOnce({
        data: { code: 200, message: "Alert Updated", warnings: [warning] },
      });
      wrapper = mountAlert({ modelValue, isUpdated: true });
      await flushPromises();

      expect(wrapper.vm.form.state.values.composite_condition.expression).toBe("{id-a} && {id-b}");
      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warning", message: warning }),
      );

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

    it("locks the anomaly alert type while anomaly_detection is license-locked", async () => {
      store.state.zoConfig.features = { anomaly_detection: "locked" };
      try {
        wrapper = mountAlert();
        await flushPromises();
        const anomaly = wrapper.vm.alertTypeOptions.find((o: any) => o.value === "anomaly");
        expect(anomaly?.disabled).toBe(true);
        const item = wrapper.find('[data-test="add-alert-type-tab-anomaly"]');
        expect(item.attributes("disabled")).toBeDefined();
        wrapper.vm.onAlertTypeChange("anomaly");
        await flushPromises();
        expect(wrapper.vm.form.state.values.is_real_time).not.toBe("anomaly");
      } finally {
        delete store.state.zoConfig.features;
      }
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
        "Filters is selected but empty. SQL is set up.",
      );
      expect(dialogEl("dialog")?.textContent).not.toContain("-line query");
      // The dialog opens on the mode selected in the form; only a click changes it.
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
      expect(dialogButton("primary")?.textContent).toContain("Save with Filters Mode");
      expect(dialogEl("warning")?.textContent).toContain("No filters, so every row in");
      expect(noteText()).toBe("Only Filters mode runs. SQL mode is not used.");

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
      expect(dialogEl("dialog")?.textContent).toContain("Filters and SQL are both set up.");
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
      expect(noteText()).toBe("Only SQL mode runs. Filters mode is not used.");
      dialogEl("option-custom")!.click();
      await flushPromises();
      expect(noteText()).toBe("Only Filters mode runs. SQL mode is not used.");
      expect(dialogEl("dialog")?.textContent).not.toContain("filter condition");
      expect(dialogButton("primary")?.textContent).toContain("Save with Filters Mode");

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
    it("counts the field errors on Save, with no toast and no dialog", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("trigger_condition.silence", "");

      await clickSave();

      expect(dialogEl("dialog")).toBeNull();
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(wrapper.vm.issueCount).toBeGreaterThan(0);
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: i18n.global.t("alerts.messages.fixHighlightedFields") }),
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
      expect(dialogEl("dialog")?.textContent).toContain("Filters and SQL are both set up.");
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
    });

    // The warning and the lead line judge "empty" the same way.
    it("does not warn about filters when the picked Builder has an Alert if aggregation", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedEmptyBuilder(form, SQL);
      form.setFieldValue("query_condition.aggregation", {
        function: "min",
        group_by: [],
        having: { column: "_timestamp", operator: ">=", value: 3 },
      });
      wrapper.vm.isAggregationEnabled = true;

      await clickSave();

      expect(dialogEl("lead")?.textContent?.trim()).toBe("Filters and SQL are both set up.");
      expect(dialogEl("option-custom")?.getAttribute("data-state")).toBe("on");
      expect(dialogEl("warning")).toBeNull();
    });

    it("warns that no query is written when the picked SQL holds only the starter query", async () => {
      wrapper = mountAlert();
      await flushPromises();
      vi.mocked(alertsService.generate_sql).mockRejectedValueOnce(new Error("no builder SQL"));
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("query_condition.type", "sql");
      form.setFieldValue("query_condition.sql", 'SELECT * FROM "_rundata"');
      form.setFieldValue("query_condition.conditions", builderTree);

      await clickSave();

      expect(dialogEl("lead")?.textContent?.trim()).toBe(
        "SQL is selected but empty. Filters is set up.",
      );
      expect(dialogEl("option-sql")?.getAttribute("data-state")).toBe("on");
      expect(dialogEl("warning")?.textContent?.trim()).toBe("No query written yet");
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
      expect(dialogEl("dialog")?.textContent).toContain("Filters, SQL and PromQL are all set up.");
      expect(noteText()).toBe("Only PromQL mode runs. Filters and SQL modes are not used.");
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
      vi.mocked(alertsService.generate_sql).mockRejectedValueOnce(new Error("no builder SQL"));
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
