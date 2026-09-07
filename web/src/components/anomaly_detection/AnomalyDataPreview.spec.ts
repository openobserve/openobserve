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

// Spec for AnomalyDataPreview — the chart that renders in AddAlert's right-hand
// Preview card for an anomaly alert, mirroring where a scheduled alert puts its
// data preview, and auto-refreshing the same way. The buildPreviewSql /
// loadPreview cases moved here verbatim from AnomalyDetectionConfig.spec.ts when
// the chart was extracted out of that step.

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { template: '<div data-test="panel-schema-renderer" />' },
}));

import AnomalyDataPreview from "./AnomalyDataPreview.vue";

// ---------------------------------------------------------------------------
// Mount factory — keeps stubs and global plugins in one place
// ---------------------------------------------------------------------------
function buildConfig(configOverrides: Record<string, unknown> = {}) {
  return reactive({
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
  });
}

function mountPreview(configOverrides: Record<string, unknown> = {}) {
  return mount(AnomalyDataPreview, {
    global: { plugins: [store, i18n] },
    props: { config: buildConfig(configOverrides) },
  });
}

// Like mountPreview but also returns the config object, so a test can mutate it
// the way AnomalyDetectionConfig's write-back watch does.
function mountReturning(configOverrides: Record<string, unknown> = {}) {
  const config = buildConfig(configOverrides);
  const wrapper = mount(AnomalyDataPreview, {
    global: { plugins: [store, i18n] },
    props: { config },
  });
  return { wrapper, config };
}

// The refresh watcher debounces at 600ms; real timers keep the flush ordering honest.
const settleDebounce = () => new Promise((resolve) => setTimeout(resolve, 700));

// ---------------------------------------------------------------------------
// Helper: call loadPreview() and return the normalised SQL string
// ---------------------------------------------------------------------------
async function getSqlFromPreview(wrapper: VueWrapper): Promise<string> {
  (wrapper.vm as any).loadPreview();
  await flushPromises();
  return (wrapper.vm as any).previewPanelSchema?.queries?.[0]?.query ?? "";
}

// ===========================================================================
describe("AnomalyDataPreview", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  describe("filters mode — detection function", () => {
    it("should use count(*) AS value when detection_function is count", async () => {
      wrapper = mountPreview({ detection_function: "count" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("count(*) AS value");
    });

    it("should use count(*) AS value when detection_function is not set", async () => {
      wrapper = mountPreview({ detection_function: "" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("count(*) AS value");
    });

    it("should use avg(response_time) AS value when detection_function is avg", async () => {
      wrapper = mountPreview({
        detection_function: "avg",
        detection_function_field: "response_time",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("avg(response_time) AS value");
    });

    it("should use sum(bytes) AS value when detection_function is sum", async () => {
      wrapper = mountPreview({
        detection_function: "sum",
        detection_function_field: "bytes",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("sum(bytes) AS value");
    });

    it("should use approx_percentile_cont(latency, 0.95) AS value when detection_function is p95", async () => {
      wrapper = mountPreview({
        detection_function: "p95",
        detection_function_field: "latency",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("approx_percentile_cont(latency, 0.95) AS value");
    });

    it("should use approx_percentile_cont(latency, 0.99) AS value when detection_function is p99", async () => {
      wrapper = mountPreview({
        detection_function: "p99",
        detection_function_field: "latency",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("approx_percentile_cont(latency, 0.99) AS value");
    });

    it("should include the stream name in FROM clause", async () => {
      wrapper = mountPreview({ stream_name: "my_stream" });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain('FROM "my_stream"');
    });

    it("should include GROUP BY and ORDER BY time_bucket", async () => {
      wrapper = mountPreview();
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("GROUP BY time_bucket");
      expect(sql).toContain("ORDER BY time_bucket");
    });

    it("should produce a full default count query with no filters", async () => {
      wrapper = mountPreview();
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(
        "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"my_stream\" GROUP BY time_bucket ORDER BY time_bucket",
      );
    });
  });

  // =========================================================================
  describe("filters mode — histogram interval", () => {
    it("should embed 15m interval when histogram_interval_value is 15 and unit is m", async () => {
      wrapper = mountPreview({
        histogram_interval_value: 15,
        histogram_interval_unit: "m",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("histogram(_timestamp, '15m')");
    });

    it("should embed 1h interval when histogram_interval_value is 1 and unit is h", async () => {
      wrapper = mountPreview({
        histogram_interval_value: 1,
        histogram_interval_unit: "h",
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("histogram(_timestamp, '1h')");
    });

    it("should leave previewPanelSchema null when stream_name is empty", async () => {
      wrapper = mountPreview({ stream_name: "" });
      (wrapper.vm as any).loadPreview();
      await flushPromises();
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });
  });

  // =========================================================================
  describe("filters mode — WHERE clause from filters", () => {
    it("should not include WHERE clause when filters array is empty", async () => {
      wrapper = mountPreview({ filters: [] });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).not.toContain("WHERE");
    });

    it("should include WHERE status = '200' for a single equality filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "status", operator: "=", value: "200" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status = '200'");
    });

    it("should chain additional filters with AND for multiple filters", async () => {
      wrapper = mountPreview({
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
      wrapper = mountPreview({
        filters: [{ field: "error_msg", operator: "Is Null", value: "" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE error_msg IS NULL");
    });

    it("should include field IS NOT NULL for an Is Not Null filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "error_msg", operator: "Is Not Null", value: "" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE error_msg IS NOT NULL");
    });

    it("should include field IN (values) for an IN filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "status", operator: "IN", value: "200,404,500" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status IN (200,404,500)");
    });

    it("should include field NOT IN (values) for a NOT IN filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "status", operator: "NOT IN", value: "500,503" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE status NOT IN (500,503)");
    });

    it("should use str_match for a Contains filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "message", operator: "Contains", value: "error" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE str_match(message, 'error')");
    });

    it("should use str_match for a str_match filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "message", operator: "str_match", value: "timeout" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE str_match(message, 'timeout')");
    });

    it("should use str_match_ignore_case for a str_match_ignore_case filter", async () => {
      wrapper = mountPreview({
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
      wrapper = mountPreview({
        filters: [{ field: "level", operator: "re_match", value: "^(error|warn)$" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE re_match(level, '^(error|warn)$')");
    });

    it("should use match_all for a match_all filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "message", operator: "match_all", value: "critical" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE match_all('critical')");
    });

    it("should use LIKE pattern for a Starts With filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "path", operator: "Starts With", value: "/api" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE path LIKE '/api%'");
    });

    it("should use LIKE pattern for an Ends With filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "path", operator: "Ends With", value: ".json" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE path LIKE '%.json'");
    });

    it("should use NOT LIKE pattern for a Not Contains filter", async () => {
      wrapper = mountPreview({
        filters: [{ field: "message", operator: "Not Contains", value: "debug" }],
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toContain("WHERE message NOT LIKE '%debug%'");
    });

    it("should skip a filter whose field is empty", async () => {
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
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
      wrapper = mountPreview({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: multilineSql,
      });
      const sql = await getSqlFromPreview(wrapper);
      expect(sql).toBe(expectedSql);
    });

    it("should leave previewPanelSchema null when custom_sql is empty and stream_name is empty", async () => {
      wrapper = mountPreview({
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
  describe("automatic preview", () => {
    it("loads the chart on mount when a stream is already selected", async () => {
      wrapper = mountPreview();
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(true);
      expect(wrapper.find('[data-test="anomaly-data-preview-chart"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-data-preview-empty"]').exists()).toBe(false);
    });

    it("shows the empty state and builds nothing without a stream", async () => {
      wrapper = mountPreview({ stream_name: "" });
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(false);
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
      expect(wrapper.find('[data-test="anomaly-data-preview-empty"]').exists()).toBe(true);
    });

    it("waits for a SQL query before previewing in custom_sql mode", async () => {
      wrapper = mountPreview({ query_mode: "custom_sql", custom_sql: "" });
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(false);
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });

    it("holds the old query until the debounce elapses, then rebuilds once", async () => {
      const mounted = mountReturning();
      wrapper = mounted.wrapper;
      await flushPromises();
      const sqlOf = () => (wrapper.vm as any).previewPanelSchema.queries[0].query;
      expect(sqlOf()).toContain("'5m'");

      // A burst of edits inside one debounce window must not each cost a query
      mounted.config.histogram_interval_value = 10;
      await flushPromises();
      mounted.config.histogram_interval_value = 15;
      await flushPromises();
      expect(sqlOf()).toContain("'5m'");

      await settleDebounce();
      await flushPromises();

      expect(sqlOf()).toContain("'15m'");
      expect(sqlOf()).not.toContain("'10m'");
    });

    // An empty filter row replaces config.filters but changes no SQL; refetching
    // would remount the panel and re-run the search for identical results.
    it("does not refetch when an edit leaves the query unchanged", async () => {
      const mounted = mountReturning();
      wrapper = mounted.wrapper;
      await flushPromises();
      const before = (wrapper.vm as any).previewTimeObj;

      mounted.config.filters = [{ field: "", operator: "=", value: "" }];
      await settleDebounce();
      await flushPromises();

      expect((wrapper.vm as any).previewTimeObj).toBe(before);
    });

    it("blocks the query while a required detection field is still empty", async () => {
      wrapper = mountPreview({ detection_function: "avg", detection_function_field: "" });
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(false);
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });

    // "" is what a cleared number input emits, and ?? does not catch it —
    // histogram(_timestamp, 'm') and a zero-width time range both used to slip through.
    it("blocks the query while an interval or window is cleared", async () => {
      wrapper = mountPreview({ histogram_interval_value: "" });
      await flushPromises();
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();

      wrapper.unmount();
      wrapper = mountPreview({ detection_window_value: "" });
      await flushPromises();
      expect((wrapper.vm as any).previewPanelSchema).toBeNull();
    });

    it("keeps the last chart when a number goes momentarily invalid", async () => {
      const mounted = mountReturning();
      wrapper = mounted.wrapper;
      await flushPromises();
      expect((wrapper.vm as any).previewActive).toBe(true);

      mounted.config.histogram_interval_value = "";
      await settleDebounce();
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(true);
    });

    it("drops the preview when the stream is cleared", async () => {
      const mounted = mountReturning();
      wrapper = mounted.wrapper;
      await flushPromises();
      expect((wrapper.vm as any).previewActive).toBe(true);

      mounted.config.stream_name = "";
      await flushPromises();

      expect((wrapper.vm as any).previewActive).toBe(false);
      expect(wrapper.find('[data-test="anomaly-data-preview-empty"]').exists()).toBe(true);
    });

    it("exposes no load-data button — the preview is automatic", async () => {
      wrapper = mountPreview();
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-data-preview-load-btn"]').exists()).toBe(false);
    });

    it("builds the preview panel with no mark lines", async () => {
      wrapper = mountPreview();
      await getSqlFromPreview(wrapper);

      // The old lines were drawn at (percentile/100) * max(y) — a percentile
      // multiplied by a bucket count, which nothing in the system computes.
      expect((wrapper.vm as any).previewPanelSchema?.config?.mark_line).toEqual([]);
    });
  });
});
