// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Spec for AnomalyDetectionConfig (the "Detection Config" step of the anomaly
// wizard). Two layers:
//   1. SURVIVING BEHAVIOR — the buildPreviewSql / loadPreview logic that the
//      migration kept unchanged (kept verbatim from the pre-rewrite spec).
//   2. OFORM BEHAVIOR — the real <OForm> the migration introduced: per-mode
//      required validation, the two §4-restored rules (training_window_days ≥1,
//      detection_function required — each only where its control renders),
//      z.coerce.number typing + write-back egress, the custom_sql bare-Monaco
//      bridge with submission-gated errors (R3), the filters[] field-array
//      keying (rendered-inputs delete test), and the exposed validate() surface
//      the parent (useAlertForm) still calls to gate Next/Save.
//
// The step OWNS its <OForm> (Rule ③ useOForm owner) and returns `form` from
// setup(), so the TanStack form is reachable as `(wrapper.vm as any).form`.
// Submits are awaited deterministically via `await form.handleSubmit()`.

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import streamService from "@/services/stream";

// vi.mock must be hoisted — declared before component import
vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn().mockResolvedValue({ data: { schema: [] } }),
  },
}));

// The stored-value lookup the field-value resolver ends at. Stubbed so the
// resolver tests can assert the composite key it was asked for without an
// IndexedDB in jsdom. useSuggestions imports nothing else from this module.
// vi.hoisted, because vi.mock is lifted above ordinary declarations.
const { getFieldValuesForSuggestion } = vi.hoisted(() => ({
  getFieldValuesForSuggestion: vi.fn(async () => ["ERROR", "INFO"]),
}));
vi.mock("@/composables/fieldValueStore", () => ({ getFieldValuesForSuggestion }));

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { template: '<div data-test="panel-schema-renderer" />' },
}));

vi.mock("@/components/QueryEditor.vue", () => ({
  default: {
    template: '<div data-test="query-editor" />',
    props: ["query", "editorId", "language", "readOnly", "showAutoComplete", "hideNlToggle"],
  },
}));

import AnomalyDetectionConfig from "./AnomalyDetectionConfig.vue";
import { anomalyDetectionConfigDefaults } from "./AnomalyDetectionConfig.schema";
import { defaultAnomalyConfig } from "@/composables/useAlertForm";

// ---------------------------------------------------------------------------
// Mount factory — keeps stubs and global plugins in one place
// ---------------------------------------------------------------------------
function buildConfig(configOverrides: Record<string, unknown> = {}) {
  return {
    query_mode: "filters",
    stream_name: "my_stream",
    stream_type: "logs",
    histogram_interval_value: 5,
    histogram_interval_unit: "m",
    detection_function: "count",
    detection_function_field: "",
    filters: [] as Array<{ field: string; operator: string; value: string }>,
    custom_sql: "",
    detection_window_value: 30,
    detection_window_unit: "m",
    training_window_days: 7,
    threshold: 97,
    ...configOverrides,
  };
}

const mountOptions = {
  global: {
    plugins: [store, i18n],
    stubs: {
      PanelSchemaRenderer: true,
      QueryEditor: true,
    },
  },
};

function mountConfig(configOverrides: Record<string, unknown> = {}) {
  return mount(AnomalyDetectionConfig, {
    ...mountOptions,
    props: { config: buildConfig(configOverrides) },
  });
}

/** Like mountConfig but also returns the config object (the write-back egress
 * target — mutated in place by the form → props.config watch). */
function mountReturning(configOverrides: Record<string, unknown> = {}) {
  const config = buildConfig(configOverrides);
  const wrapper = mount(AnomalyDetectionConfig, {
    ...mountOptions,
    props: { config },
  });
  return { wrapper, config };
}

// The TanStack form the step owns (returned from setup()).
const getForm = (w: VueWrapper): any => (w.vm as any).form;

// First error message routed to a field (schema issue objects → .message).
const fieldError = (w: VueWrapper, name: string): string | undefined =>
  firstFieldError(getForm(w).getFieldMeta(name)?.errors);

// Rendered values of the filters[i].field selects, in render order.
const renderedFilterFields = (w: VueWrapper): unknown[] =>
  w
    .findAllComponents(OFormSelect)
    .filter((c: any) => /^filters\[\d+\]\.field$/.test(c.props("name") || ""))
    .map((c: any) => c.findComponent(OSelect).props("modelValue"));

// The sensitivity tiers, in render order (decreasing percentile).
const SENSITIVITY_TIERS = [99, 97, 95];

// data-state of each tier button. A missing button reads as undefined so a
// "no tier is active" assertion cannot pass just because nothing rendered.
const tierStates = (w: VueWrapper): Array<string | undefined> =>
  SENSITIVITY_TIERS.map((value) => {
    const button = w.find(`[data-test="anomaly-sensitivity-tier-${value}"]`);
    return button.exists() ? button.attributes("data-state") : undefined;
  });

// The exact-percentile <input> (data-test lands on the OInput wrapper div).
const percentileInput = (w: VueWrapper) =>
  w.find('[data-test="anomaly-sensitivity-percentile"] input');

// The one copy string the tests pin: it is the only anchor proving the range
// message is the translated one rather than zod's raw English default.
const RANGE_MESSAGE = "Enter a whole number between 50 and 99";

const sensitivityHintText = (w: VueWrapper): string | undefined => {
  const hint = w.find('[data-test="anomaly-sensitivity-hint"]');
  return hint.exists() ? hint.text() : undefined;
};

// ---------------------------------------------------------------------------
// Helper: call loadPreview() and return the normalised SQL string
// ---------------------------------------------------------------------------
async function getSqlFromPreview(wrapper: VueWrapper): Promise<string> {
  (wrapper.vm as any).loadPreview();
  await flushPromises();
  return (wrapper.vm as any).previewPanelSchema?.queries?.[0]?.query ?? "";
}

// A valid custom SQL query (aliases time_bucket, NOT the timestamp column).
const VALID_CUSTOM_SQL =
  "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"events\" GROUP BY time_bucket ORDER BY time_bucket";

// ===========================================================================
describe("AnomalyDetectionConfig", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  describe("filters mode — detection function", () => {
    it("should use count(*) AS value when detection_function is count", async () => {
      wrapper = mountConfig({ detection_function: "count" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("count(*) AS value");
    });

    it("should use count(*) AS value when detection_function is not set", async () => {
      wrapper = mountConfig({ detection_function: "" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("count(*) AS value");
    });

    it("should use avg(response_time) AS value when detection_function is avg", async () => {
      wrapper = mountConfig({
        detection_function: "avg",
        detection_function_field: "response_time",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("avg(response_time) AS value");
    });

    it("should use sum(bytes) AS value when detection_function is sum", async () => {
      wrapper = mountConfig({
        detection_function: "sum",
        detection_function_field: "bytes",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("sum(bytes) AS value");
    });

    it("should use approx_percentile_cont(latency, 0.95) AS value when detection_function is p95", async () => {
      wrapper = mountConfig({
        detection_function: "p95",
        detection_function_field: "latency",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("approx_percentile_cont(latency, 0.95) AS value");
    });

    it("should use approx_percentile_cont(latency, 0.99) AS value when detection_function is p99", async () => {
      wrapper = mountConfig({
        detection_function: "p99",
        detection_function_field: "latency",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("approx_percentile_cont(latency, 0.99) AS value");
    });

    it("should include the stream name in FROM clause", async () => {
      wrapper = mountConfig({ stream_name: "my_stream" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain('FROM "my_stream"');
    });

    it("should include GROUP BY and ORDER BY time_bucket", async () => {
      wrapper = mountConfig();
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("GROUP BY time_bucket");
      expect(sql).toContain("ORDER BY time_bucket");
    });

    it("should produce a full default count query with no filters", async () => {
      wrapper = mountConfig();
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(
        "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"my_stream\" GROUP BY time_bucket ORDER BY time_bucket",
      );
    });
  });

  // =========================================================================
  describe("filters mode — histogram interval", () => {
    it("should embed 15m interval when histogram_interval_value is 15 and unit is m", async () => {
      wrapper = mountConfig({
        histogram_interval_value: 15,
        histogram_interval_unit: "m",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("histogram(_timestamp, '15m')");
    });

    it("should embed 1h interval when histogram_interval_value is 1 and unit is h", async () => {
      wrapper = mountConfig({
        histogram_interval_value: 1,
        histogram_interval_unit: "h",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("histogram(_timestamp, '1h')");
    });

    it("should leave previewPanelSchema null when stream_name is empty", async () => {
      wrapper = mountConfig({ stream_name: "" });
      (wrapper.vm as any).loadPreview();
      await flushPromises();
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });
  });

  // =========================================================================
  describe("filters mode — WHERE clause from filters", () => {
    it("should not include WHERE clause when filters array is empty", async () => {
      wrapper = mountConfig({ filters: [] });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).not.toContain("WHERE");
    });

    it("should include WHERE status = '200' for a single equality filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "status", operator: "=", value: "200" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status = '200'");
    });

    it("should chain additional filters with AND for multiple filters", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "status", operator: "=", value: "200" },
          { field: "env", operator: "=", value: "prod" },
        ],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status = '200'");
      expect(sql).toContain("AND env = 'prod'");
    });

    it("should include field IS NULL for an Is Null filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "error_msg", operator: "Is Null", value: "" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE error_msg IS NULL");
    });

    it("should include field IS NOT NULL for an Is Not Null filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "error_msg", operator: "Is Not Null", value: "" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE error_msg IS NOT NULL");
    });

    it("should include field IN (values) for an IN filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "status", operator: "IN", value: "200,404,500" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status IN (200,404,500)");
    });

    it("should include field NOT IN (values) for a NOT IN filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "status", operator: "NOT IN", value: "500,503" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status NOT IN (500,503)");
    });

    it("should use str_match for a Contains filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "message", operator: "Contains", value: "error" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE str_match(message, 'error')");
    });

    it("should use str_match for a str_match filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "message", operator: "str_match", value: "timeout" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE str_match(message, 'timeout')");
    });

    it("should use str_match_ignore_case for a str_match_ignore_case filter", async () => {
      wrapper = mountConfig({
        filters: [
          {
            field: "message",
            operator: "str_match_ignore_case",
            value: "ERROR",
          },
        ],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE str_match_ignore_case(message, 'ERROR')");
    });

    it("should use re_match for a re_match filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "level", operator: "re_match", value: "^(error|warn)$" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE re_match(level, '^(error|warn)$')");
    });

    it("should use match_all for a match_all filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "message", operator: "match_all", value: "critical" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE match_all('critical')");
    });

    it("should use LIKE pattern for a Starts With filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "path", operator: "Starts With", value: "/api" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE path LIKE '/api%'");
    });

    it("should use LIKE pattern for an Ends With filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "path", operator: "Ends With", value: ".json" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE path LIKE '%.json'");
    });

    it("should use NOT LIKE pattern for a Not Contains filter", async () => {
      wrapper = mountConfig({
        filters: [{ field: "message", operator: "Not Contains", value: "debug" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE message NOT LIKE '%debug%'");
    });

    it("should skip a filter whose field is empty", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "", operator: "=", value: "200" },
          { field: "env", operator: "=", value: "prod" },
        ],
      });
      const sql = await getSqlFromPreview(wrapper);
      // The empty-field filter must not produce a stray fragment
      expect(sql).not.toContain("= '200'");
      // The valid filter must still appear
      expect(sql).toContain("WHERE env = 'prod'");
    });

    it("should skip a filter whose value is empty and operator needs a value", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "status", operator: "=", value: "" },
          { field: "env", operator: "=", value: "prod" },
        ],
      });
      const sql = await getSqlFromPreview(wrapper);
      // The valueless filter (= '') should be skipped
      expect(sql).not.toContain("status =");
      expect(sql).toContain("WHERE env = 'prod'");
    });

    it("should produce a complete WHERE clause with three filters", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "status", operator: "=", value: "200" },
          { field: "env", operator: "=", value: "prod" },
          { field: "region", operator: "=", value: "us-east" },
        ],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status = '200'");
      expect(sql).toContain("AND env = 'prod'");
      expect(sql).toContain("AND region = 'us-east'");
    });
  });

  // =========================================================================
  describe("custom_sql mode — query passed through as-is (normalized)", () => {
    it("should use custom SQL directly when query_mode is custom_sql", async () => {
      const customSql =
        "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"events\" GROUP BY time_bucket ORDER BY time_bucket";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: customSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(customSql);
    });

    it("should pass through a JOIN query unchanged after normalization", async () => {
      const rawSql =
        'SELECT histogram(_timestamp, \'5m\') AS time_bucket, count(*) AS value FROM "events" e JOIN "users" u ON e.user_id = u.id GROUP BY time_bucket ORDER BY time_bucket';
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: rawSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(rawSql);
    });

    it("should pass through a subquery unchanged after normalization", async () => {
      const rawSql =
        "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM (SELECT * FROM \"raw_events\" WHERE env = 'prod') sub GROUP BY time_bucket ORDER BY time_bucket";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "raw_events",
        custom_sql: rawSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(rawSql);
    });

    it("should pass through a CTE query unchanged after normalization", async () => {
      const rawSql =
        "WITH filtered AS (SELECT * FROM \"events\" WHERE level = 'error') SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM filtered GROUP BY time_bucket ORDER BY time_bucket";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: rawSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(rawSql);
    });

    it("should collapse multiline SQL to a single line", async () => {
      const multilineSql =
        "SELECT histogram(_timestamp, '5m') AS time_bucket,\n       count(*) AS value\nFROM \"events\"\nGROUP BY time_bucket\nORDER BY time_bucket";
      const expectedSql =
        "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"events\" GROUP BY time_bucket ORDER BY time_bucket";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: multilineSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(expectedSql);
    });

    it("should leave previewPanelSchema null when custom_sql is empty and stream_name is empty", async () => {
      // stream_name must also be empty — the immediate watcher seeds custom_sql
      // from buildDefaultSql() when stream_name is set and custom_sql is blank.
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "",
        custom_sql: "",
      });
      (wrapper.vm as any).loadPreview();
      await flushPromises();
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });
  });

  // =========================================================================
  // OForm behavior — the real <OForm> the migration introduced
  // =========================================================================
  describe("OForm — a fully valid form passes and does not block", () => {
    it("filters mode: valid config → isValid true, validate() true", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
      await expect((wrapper.vm as any).validate()).resolves.toBe(true);
    });

    it("custom_sql mode: valid SQL → isValid true", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  describe("OForm — per-mode empty-required blocks submit (errors only post-submit)", () => {
    it("filters mode: empty numeric interval → coerced to 0, blocked, error post-submit", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      // pre-submit: submit-then-change timing → no errors surfaced yet
      expect(form.state.submissionAttempts).toBe(0);
      expect((form.getFieldMeta("detection_window_value")?.errors ?? []).length).toBe(0);

      form.setFieldValue("detection_window_value", ""); // OFormInput emits ""
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false); // "" → coerce 0 → min(1) fails
      expect(fieldError(wrapper, "detection_window_value")).toBe("Field is required!");
      // validate() (the exposed surface) blocks Next/Save
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: empty SQL → blocked, and NOTHING renders pre-submit (R3)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "",
        custom_sql: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      // R3: before the first submit the bare-Monaco error gate is closed
      expect((wrapper.vm as any).showSqlErrors).toBe(false);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect((wrapper.vm as any).showSqlErrors).toBe(true);
    });
  });

  // =========================================================================
  // §4 RESTORE 1 — training_window_days ≥ 1 ("Minimum 1 day").
  // Always-rendered control → the rule applies in BOTH query modes (its
  // applicable scope), so it is an unconditional base-field rule, NOT
  // mode-gated. Prove it fires in both modes.
  // =========================================================================
  describe("§4 restore — training_window_days ≥ 1 (Minimum 1 day)", () => {
    it("filters mode: value < 1 → 'Minimum 1 day' + blocked", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", 0);
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: value < 1 → still blocked (rule is unconditional)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      // sanity: everything else valid → the ONLY failing rule is training window
      form.setFieldValue("training_window_days", 0);
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
    });

    it("string '0' from the number input is coerced (z.coerce.number) and rejected", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", "0"); // input emits a string
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
    });

    it("a valid training window (≥1) does not block", async () => {
      wrapper = mountConfig({ training_window_days: 14 });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  // =========================================================================
  // §4 RESTORE 2 — detection_function required, ONLY in filters mode (the
  // control does not render in custom_sql mode). Prove it fires in filters
  // mode and does NOT fire in custom_sql mode.
  // =========================================================================
  describe("§4 restore — detection_function required (filters mode only)", () => {
    it("filters mode: empty detection_function → 'Detection function is required' + blocked", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("detection_function", "");
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "detection_function")).toBe("Detection function is required");
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: empty detection_function does NOT block (rule is mode-gated)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("detection_function", "");
      await form.handleSubmit();
      await nextTick();

      // detection_function is not a control in custom_sql mode → its required
      // rule must not fire; the form is otherwise valid.
      expect(form.state.isValid).toBe(true);
    });

    it("filters mode: non-count function requires detection_function_field", async () => {
      wrapper = mountConfig({
        detection_function: "avg",
        detection_function_field: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "detection_function_field")).toBe("Field is required");
    });

    it("filters mode: count function does NOT require detection_function_field", async () => {
      wrapper = mountConfig({
        detection_function: "count",
        detection_function_field: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  // =========================================================================
  // custom_sql bare-Monaco bridge — value bridged into the schema via
  // setFieldValue; timestamp-alias ban; submission-gated bare error divs (R3).
  // =========================================================================
  describe("custom_sql — bridged value, timestamp-alias ban, R3-gated error divs", () => {
    it("bridges the editor value into the form (onCustomSqlChange → setFieldValue)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      (wrapper.vm as any).onCustomSqlChange(VALID_CUSTOM_SQL);
      await nextTick();

      expect(form.state.values.custom_sql).toBe(VALID_CUSTOM_SQL);
      await form.handleSubmit();
      await nextTick();
      expect(form.state.isValid).toBe(true);
    });

    it("timestamp-column used as an alias is blocked, and its error div is R3-gated", async () => {
      const badSql =
        "SELECT histogram(_timestamp, '5m') AS _timestamp, count(*) AS value FROM \"events\" GROUP BY 1 ORDER BY 1";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: badSql,
      });
      await flushPromises();
      const form = getForm(wrapper);

      // R3: pre-submit the alias error div (a bare, data-test-selectable div)
      // must NOT render even though the SQL is already invalid.
      expect(wrapper.find('[data-test="anomaly-custom-sql-timestamp-alias-error"]').exists()).toBe(
        false,
      );

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      // post-submit the gate opens and the div renders
      expect(wrapper.find('[data-test="anomaly-custom-sql-timestamp-alias-error"]').exists()).toBe(
        true,
      );
    });

    it("detection-window error div (kept data-test) is submission-gated", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);
      form.setFieldValue("detection_window_value", 0);
      await nextTick();

      // pre-submit: no error div
      expect(wrapper.find('[data-test="anomaly-detection-window-error"]').exists()).toBe(false);

      await form.handleSubmit();
      await nextTick();

      expect(wrapper.find('[data-test="anomaly-detection-window-error"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Payload / egress typing (Rule ④ b) — numeric fields come out of OFormInput
  // as strings → z.coerce.number(); the write-back watch re-coerces so
  // props.config (which the parent's saveAnomalyDetection payload reads) keeps
  // NUMBER types.
  // =========================================================================
  describe("egress — write-back to props.config keeps number types", () => {
    it("string numeric input is written back to props.config as a number", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", "10"); // string, as OFormInput emits
      form.setFieldValue("histogram_interval_value", "20");
      await flushPromises();
      await nextTick();

      expect(config.training_window_days).toBe(10);
      expect(typeof config.training_window_days).toBe("number");
      expect(config.histogram_interval_value).toBe(20);
      expect(typeof config.histogram_interval_value).toBe("number");
    });

    // The threshold_min absence is asserted against a config built by
    // defaultAnomalyConfig() — the object the real app hands this step. A local
    // fixture that never had the key could not prove the write-back stopped
    // adding it.
    it("threshold is written back as a number", async () => {
      const config = defaultAnomalyConfig();
      wrapper = mount(AnomalyDetectionConfig, { ...mountOptions, props: { config } });
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("threshold", 95);
      await flushPromises();
      await nextTick();

      expect(config.threshold).toBe(95);
      expect(typeof config.threshold).toBe("number");
      expect("threshold_min" in config).toBe(false);
    });

    it("query_mode is mirrored to props.config (egress, not into-form mirror)", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("query_mode", "custom_sql");
      await flushPromises();
      await nextTick();

      expect(config.query_mode).toBe("custom_sql");
    });
  });

  // =========================================================================
  // Sensitivity — ONE form field (`threshold`, always a number) behind two
  // controls: the three-tier toggle group and the exact percentile input.
  // Picking a tier sets the number; typing a number re-highlights the matching
  // tier, or none. The derived hint line states what the setting costs in
  // flagged buckets, and the single error message is rendered by the step (both
  // wrappers suppress their own).
  //
  // The sliding pill is NOT asserted here: jsdom lays nothing out, so
  // OToggleGroup's measure() always bails on offsetParent === null and
  // indicatorVisible is false from mount forever. data-state on the buttons is
  // the assertable selection state; the indicator case lives in
  // OToggleGroup.spec.ts, which has the geometry harness for it.
  // =========================================================================
  describe("sensitivity — tier toggle + exact percentile on one field", () => {
    it("clicking a tier sets threshold and writes it back to props.config", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      await wrapper.find('[data-test="anomaly-sensitivity-tier-95"]').trigger("click");
      await flushPromises();
      await nextTick();

      expect(form.state.values.threshold).toBe(95);
      expect(config.threshold).toBe(95);
    });

    it("a seeded tier value renders that tier active", async () => {
      wrapper = mountConfig({ threshold: 99 });
      await flushPromises();

      expect(tierStates(wrapper)).toEqual(["on", "off", "off"]);
    });

    it("a seeded non-tier value renders no tier active and shows the exact percentile", async () => {
      wrapper = mountConfig({ threshold: 88 });
      await flushPromises();

      expect(tierStates(wrapper)).toEqual(["off", "off", "off"]);
      expect((percentileInput(wrapper).element as HTMLInputElement).value).toBe("88");
      expect(sensitivityHintText(wrapper)).toContain("12%");
    });

    it("typing a tier value lights that tier up", async () => {
      wrapper = mountConfig({ threshold: 99 });
      await flushPromises();
      expect(tierStates(wrapper)).toEqual(["on", "off", "off"]);

      await percentileInput(wrapper).setValue("95");
      await flushPromises();
      await nextTick();

      expect(tierStates(wrapper)).toEqual(["off", "off", "on"]);
    });

    it("moving to a non-tier value after picking a tier leaves no tier active", async () => {
      wrapper = mountConfig({ threshold: 97 });
      await flushPromises();
      const form = getForm(wrapper);

      await wrapper.find('[data-test="anomaly-sensitivity-tier-99"]').trigger("click");
      await flushPromises();
      await nextTick();
      expect(tierStates(wrapper)).toEqual(["on", "off", "off"]);

      form.setFieldValue("threshold", 88);
      await flushPromises();
      await nextTick();

      expect(tierStates(wrapper)).toEqual(["off", "off", "off"]);
    });

    it("the percentile input emits a number, not a string", async () => {
      wrapper = mountConfig({ threshold: 97 });
      await flushPromises();
      const form = getForm(wrapper);

      await percentileInput(wrapper).setValue("95");
      await flushPromises();
      await nextTick();

      expect(form.state.values.threshold).toBe(95);
      expect(typeof form.state.values.threshold).toBe("number");
    });

    it("hint states the anomaly rate and the flagged buckets per day", async () => {
      wrapper = mountConfig({
        threshold: 97,
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
      });
      await flushPromises();

      const hint = sensitivityHintText(wrapper);
      expect(hint).toBeDefined();
      expect(hint).toContain("3%");
      expect(hint).toContain("9 per day");
      // Without this an implementation that drops `resolution` from the named
      // params renders "... at  resolution." and still passes.
      expect(hint).toContain("5m");
    });

    it("hint rounds before branching — 0.96/day is 'per day', not 'one every 1 days'", async () => {
      wrapper = mountConfig({
        threshold: 99,
        histogram_interval_value: 15,
        histogram_interval_unit: "m",
      });
      await flushPromises();

      const hint = sensitivityHintText(wrapper);
      expect(hint).toBeDefined();
      expect(hint).toContain("1 per day");
      expect(hint).not.toContain("every");
      expect(hint).toContain("15m");
    });

    it("hint switches to 'one every N days' below one flagged bucket a day", async () => {
      wrapper = mountConfig({
        threshold: 99,
        histogram_interval_value: 1,
        histogram_interval_unit: "h",
      });
      await flushPromises();

      const hint = sensitivityHintText(wrapper);
      expect(hint).toBeDefined();
      expect(hint).toContain("every 4");
      expect(hint).toContain("1h");
    });

    it("hint is suppressed when the detection resolution is empty", async () => {
      wrapper = mountConfig({
        threshold: 97,
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
      });
      await flushPromises();
      // Sanity first: without it, "absent" would also be satisfied by the whole
      // row failing to render.
      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(true);

      for (const bad of ["", 0, -5]) {
        getForm(wrapper).setFieldValue("histogram_interval_value", bad);
        await flushPromises();
        await nextTick();
        expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(false);
      }
    });

    // toModelNumber passes "" through unchanged, so the parent's config briefly
    // holds a non-number. Submit must stay blocked for as long as it does.
    it("blocks submit while the percentile is cleared", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      await percentileInput(wrapper).setValue("");
      await flushPromises();
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("a percentile below the accepted range blocks submit with exactly one message", async () => {
      wrapper = mountConfig({ threshold: 40 });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "threshold")).toBe(RANGE_MESSAGE);
      // Two OForm* wrappers on one field, but only the step's own message renders.
      // Counting the step's own node cannot detect a duplicate — OFormInput's
      // built-in message has a different data-test and OFormToggleGroup's has
      // none — so count occurrences of the message TEXT.
      const occurrences = wrapper.text().split(RANGE_MESSAGE).length - 1;
      expect(occurrences).toBe(1);
      expect(wrapper.find('[data-test="anomaly-sensitivity-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-sensitivity-percentile-error"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="anomaly-sensitivity-error"]').attributes("role")).toBe(
        "alert",
      );
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("a non-integer percentile is rejected with the translated message", async () => {
      // A bare .int() would emit zod's untranslated "expected int, received
      // number" here; the spinner and paste both produce decimals.
      wrapper = mountConfig({ threshold: 95.5 });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "threshold")).toBe(RANGE_MESSAGE);
    });

    it("a percentile above 99 blocks submit (99 is the real server ceiling)", async () => {
      wrapper = mountConfig({ threshold: 100 });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "threshold")).toBe(RANGE_MESSAGE);
    });

    it("hint is suppressed for a percentile outside the accepted range", async () => {
      wrapper = mountConfig({
        threshold: 97,
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
      });
      await flushPromises();
      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(true);

      getForm(wrapper).setFieldValue("threshold", 40);
      await flushPromises();
      await nextTick();

      // An invalid percentile gets the error message, not a hint quoting a
      // "60% anomaly rate" as though it were a real setting.
      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(false);
    });

    it("tier labels re-resolve when the locale changes", async () => {
      wrapper = mountConfig({ threshold: 99 });
      await flushPromises();
      const before = wrapper.find('[data-test="anomaly-sensitivity-tier-99"]').text();

      const previous = i18n.global.locale.value;
      try {
        i18n.global.locale.value = "de-DE";
        await nextTick();
        // A module-level const array would still read the English label captured
        // at import time; a computed over t() re-resolves.
        expect(wrapper.find('[data-test="anomaly-sensitivity-tier-99"]').text()).toBe(
          i18n.global.t("alerts.anomaly.sensitivityConservative"),
        );
      } finally {
        i18n.global.locale.value = previous;
        await nextTick();
      }

      expect(wrapper.find('[data-test="anomaly-sensitivity-tier-99"]').text()).toBe(before);
    });

    it("hint is suppressed for a fractional percentile", async () => {
      wrapper = mountConfig({
        threshold: 97,
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
      });
      await flushPromises();
      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(true);

      // 100 - 97.3 is 2.700000000000003 in binary floating point; a fractional
      // percentile is as invalid as an out-of-range one, so it gets the error.
      getForm(wrapper).setFieldValue("threshold", 97.3);
      await flushPromises();
      await nextTick();

      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(false);
    });

    it("the schema default threshold is 97 when the config carries none", () => {
      expect(anomalyDetectionConfigDefaults(undefined).threshold).toBe(97);
    });
  });

  // =========================================================================
  // The dual-handle slider and its mark lines are GONE, not merely bypassed.
  // Without these an additive implementation that leaves the old control in
  // place would pass every test above.
  // =========================================================================
  describe("sensitivity — the removed slider and mark lines", () => {
    it("no longer declares a threshold_range form field or renders the slider", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(getForm(wrapper).state.values).not.toHaveProperty("threshold_range");
      expect(wrapper.find('[data-test="anomaly-threshold-range"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="anomaly-threshold-range-label"]').exists()).toBe(false);
    });

    it("builds the preview panel with no mark lines", async () => {
      wrapper = mountConfig();
      await flushPromises();

      await getSqlFromPreview(wrapper);

      // The old lines were drawn at (percentile/100) * max(y) — a percentile
      // multiplied by a bucket count, which nothing in the system computes.
      expect((wrapper.vm as any).previewPanelSchema?.config?.mark_line).toEqual([]);
    });

    // The chart moves OUT of the sensitivity row into its own labelled row; it
    // is not deleted. The 34 SQL tests call loadPreview() directly, so they
    // would all stay green even if the markup vanished.
    it("still renders the load-data button and the chart placeholder", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-data-preview-load-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-data-preview-empty"]').exists()).toBe(true);
    });

    it("labels the preview row and drops the score-range framing", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(wrapper.text()).toContain("Data preview");
      expect(wrapper.text()).not.toContain("Anomaly Score Range");
    });

    it("gives the tier group an accessible name", async () => {
      wrapper = mountConfig();
      await flushPromises();

      // The row's "Sensitivity" text is a plain div bound to neither control,
      // so aria-label is the group's only accessible name.
      const group = wrapper.find('[data-test="anomaly-sensitivity-tier"]');
      expect(group.exists()).toBe(true);
      expect(group.attributes("aria-label")).toBe("Sensitivity");
    });

    it("exposes no mark-line or series-max machinery", async () => {
      wrapper = mountConfig();
      await flushPromises();

      // Only symbols actually exposed today are asserted — `updateMarkLines` was
      // never in the setup() return, so asserting it would pass either way.
      expect((wrapper.vm as any).onSeriesDataUpdate).toBeUndefined();
      expect((wrapper.vm as any).previewHasData).toBeUndefined();
    });
  });

  // =========================================================================
  // filters[] field-array (Rule ① — indexed names + :key=index). The
  // non-negotiable gate: delete a NON-last row and assert the RENDERED inputs
  // (each OFormSelect→OSelect model-value), not just form.state.values.
  // =========================================================================
  describe("filters[] field-array — rendered inputs stay in sync on non-last delete", () => {
    it("removing the MIDDLE of three filter rows leaves the rendered field selects correct", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "alpha", operator: "=", value: "1" },
          { field: "beta", operator: "=", value: "2" },
          { field: "gamma", operator: "=", value: "3" },
        ],
      });
      await flushPromises();
      await nextTick();

      // sanity — all three rendered in order
      expect(renderedFilterFields(wrapper)).toEqual(["alpha", "beta", "gamma"]);

      (wrapper.vm as any).removeFilter(1); // delete "beta" (non-last)
      await nextTick();
      await flushPromises();

      // form DATA is correct
      expect(getForm(wrapper).state.values.filters.map((f: any) => f.field)).toEqual([
        "alpha",
        "gamma",
      ]);

      // the RENDERED inputs must match — not shifted, not blank (:key=index)
      expect(renderedFilterFields(wrapper)).toEqual(["alpha", "gamma"]);
    });

    it("addFilter / removeFilter mutate the form array (single source of truth)", async () => {
      wrapper = mountConfig({ filters: [] });
      await flushPromises();
      const form = getForm(wrapper);

      (wrapper.vm as any).addFilter();
      (wrapper.vm as any).addFilter();
      await nextTick();
      expect(form.state.values.filters.length).toBe(2);

      (wrapper.vm as any).removeFilter(0);
      await nextTick();
      expect(form.state.values.filters.length).toBe(1);
    });
  });

  // =========================================================================
  // Exposed validate() — the surface the parent (useAlertForm) still calls to
  // gate Next/Save. Driven by form.handleSubmit() (flips submissionAttempts),
  // NEVER TanStack formRef.validate().
  // =========================================================================
  describe("exposed validate() — parent hand-off surface", () => {
    it("returns false for an invalid form and flips the submission gate", async () => {
      wrapper = mountConfig({ detection_function: "" });
      await flushPromises();

      expect((wrapper.vm as any).showSqlErrors).toBe(false);
      const ok = await (wrapper.vm as any).validate();
      await nextTick();

      expect(ok).toBe(false);
      expect((wrapper.vm as any).showSqlErrors).toBe(true); // submissionAttempts > 0
    });

    it("returns true for a valid form", async () => {
      wrapper = mountConfig();
      await flushPromises();

      const ok = await (wrapper.vm as any).validate();
      expect(ok).toBe(true);
    });
  });

  // =========================================================================
  // Editor autocomplete wiring. Both halves shipped broken: loadStreamFields
  // cleared the field keywords on failure but never SET them on success, and
  // the stream context the value resolver keys on was never populated at all.
  // Neither was visible from the outside — the editor still opened, just with
  // nothing stream-specific in it.
  // =========================================================================
  describe("SQL editor autocomplete", () => {
    it("feeds the selected stream's fields to the editor", async () => {
      (streamService.schema as any).mockResolvedValueOnce({
        data: {
          schema: [
            { name: "level", type: "Utf8" },
            { name: "code", type: "Int64" },
          ],
        },
      });
      wrapper = mountConfig();
      await flushPromises();

      const labels = ((wrapper.vm as any).effectiveKeywords ?? []).map((k: any) => k.label);
      expect(labels).toContain("level");
      expect(labels).toContain("code");
    });

    it("resolves field values under the selected stream's key", async () => {
      wrapper = mountConfig({ stream_name: "my_stream", stream_type: "logs" });
      await flushPromises();

      const values = await (wrapper.vm as any).resolveFieldValues("level");

      expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(
        {
          org: store.state.selectedOrganization.identifier,
          streamType: "logs",
          streamName: "my_stream",
        },
        "level",
      );
      expect(values).toEqual(["ERROR", "INFO"]);
    });
  });
});
