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
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";

// vi.mock must be hoisted — declared before component import
vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn().mockResolvedValue({ data: { schema: [] } }),
  },
}));

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
    threshold_min: 0,
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

    it("threshold range max/min are written back to threshold / threshold_min", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("threshold_range", { min: 10, max: 80 });
      await flushPromises();
      await nextTick();

      expect(config.threshold).toBe(80);
      expect(config.threshold_min).toBe(10);
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
});
