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

// ── The prefill handover, end to end ────────────────────────────────────────
// A source surface's adapter → normalizePrefill → sessionStorage → the real
// AddAlert on the ?prefill= route. The unit specs cover each link; this covers
// the seam, which is where "Customize in editor" opened a library alert on the
// form's DEFAULT threshold, frequency and silence instead of the alert's own —
// every link green, the chain still wrong.
//
// Driven with the library adapter because the library is the one source that
// carries a real, curated trigger (and lets the drawer tune it). The
// assertions are about the FORM, not the library.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import AddAlert from "@/components/alerts/AddAlert.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";
import { normalizePrefill } from "@/utils/alerts/alertPrefill";
import { ALERT_PREFILL_KEY } from "@/utils/alerts/alertPrefillStorage";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "event_count", type: "int" },
        { name: "k8s_cluster", type: "string" },
        { name: "value", type: "float" },
      ],
    }),
    getStreams: vi
      .fn()
      .mockResolvedValue({ list: [{ name: "k8s_events" }, { name: "eth_rpc_status" }] }),
  }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));

// The SQL preview asks the backend what the query's result set looks like.
// Shape mirrors a real GROUP BY response so the chart lands on "line".
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
    result_schema: vi.fn(() =>
      Promise.resolve({
        data: {
          group_by: ["k8s_cluster"],
          projections: ["event_count", "k8s_cluster"],
          timeseries_field: null,
        },
      }),
    ),
  },
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));

vi.mock("@/utils/zincutils", async () => {
  const actual: any = await vi.importActual("@/utils/zincutils");
  return {
    ...actual,
    getUUID: vi.fn(() => "mock-uuid"),
    getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
  } as any;
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

// The form reads `route.query.prefill` to decide whether a prefill is pending.
const prefillRoute: any = {
  value: {
    query: { prefill: "library", folder: "default" },
    params: {},
    name: "addAlert",
    path: "/alerts/add",
  },
};
vi.mock("vue-router", async () => {
  const actual: any = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({
      currentRoute: prefillRoute,
      push: vi.fn(),
      replace: vi.fn(),
      resolve: () => ({ href: "" }),
    }),
    useRoute: () => prefillRoute.value,
  };
});

vi.mock("@/services/alerts", () => ({
  default: {
    create_by_alert_id: vi.fn(() => Promise.resolve({ data: {} })),
    update_by_alert_id: vi.fn(() => Promise.resolve({ data: {} })),
    generate_sql: vi.fn(() => Promise.resolve({ data: { sql: "SELECT * FROM test" } })),
    listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
  },
}));
vi.mock("@/services/anomaly_detection", () => ({ default: { get: vi.fn() } }));
vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

// QueryConfig and PreviewAlert are deliberately NOT stubbed — the defects this
// spec pins live in what they do to the form on a whole-form seed, and in the
// chart config PreviewAlert builds. Only the leaf chart renderer is stubbed.
const stubs = {
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PanelSchemaRenderer: true,
  AlertSummary: true,
  AnomalyDetectionConfig: true,
  AnomalyAlerting: true,
  AnomalySummary: true,
  QueryEditor: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

const sqlEntry = (): AlertLibraryEntry =>
  ({
    id: "k8s/high_warning_event_rate",
    name: "high_warning_event_rate",
    pack: "k8s",
    category: "k8s-events",
    title: "High warning event rate",
    severity: "warning",
    description: "",
    stream: "k8s_events",
    stream_type: "logs",
    query_type: "sql",
    required_streams: ["k8s_events"],
    path: "packs/k8s/alerts/k8s-events/high_warning_event_rate.json",
    content_hash: "abc123",
  }) as AlertLibraryEntry;

/** A real library SQL alert: threshold lives in the SQL, trigger is curated. */
const sqlFile = (): AlertLibraryFile => ({
  name: "high_warning_event_rate",
  stream_type: "logs",
  stream_name: "k8s_events",
  query_condition: {
    type: "sql",
    sql: 'SELECT count(*) as event_count, k8s_cluster FROM "k8s_events" GROUP BY k8s_cluster HAVING event_count > 100',
    promql: null,
    promql_condition: null,
    aggregation: null,
    vrl_function: null,
  },
  trigger_condition: {
    period: 5,
    operator: ">=",
    threshold: 1,
    frequency: 5,
    cron: "",
    frequency_type: "minutes",
    silence: 30,
    timezone: "UTC",
  },
});

const promqlEntry = (): AlertLibraryEntry =>
  ({
    ...sqlEntry(),
    id: "applications/provider_failed",
    name: "provider_failed",
    pack: "applications",
    title: "Provider failed",
    severity: "critical",
    stream: "eth_rpc_status",
    stream_type: "metrics",
    query_type: "promql",
    required_streams: ["eth_rpc_status"],
  }) as AlertLibraryEntry;

/** A real library PromQL alert — the shape 1224 of the library's 1242 share. */
const promqlFile = (): AlertLibraryFile => ({
  name: "provider_failed",
  stream_type: "metrics",
  stream_name: "eth_rpc_status",
  query_condition: {
    type: "promql",
    sql: null,
    promql: "eth_rpc_status",
    promql_condition: { column: "value", operator: "=", value: 2, ignore_case: false },
    aggregation: null,
    vrl_function: null,
  },
  trigger_condition: {
    period: 1,
    operator: ">=",
    threshold: 1,
    frequency: 1,
    cron: "",
    frequency_type: "minutes",
    silence: 60,
    timezone: "UTC",
  },
});

/** Stash a prefill the way the launcher does, then open the form on it. */
const openWithPrefill = async (entry: AlertLibraryEntry, file: AlertLibraryFile) => {
  sessionStorage.setItem(
    ALERT_PREFILL_KEY,
    JSON.stringify(normalizePrefill(buildPrefillFromLibrary({ entry, file }))),
  );
  const wrapper = mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n], stubs },
    props: { modelValue: {}, isUpdated: false, destinations: [] },
  });
  await flushPromises();
  // The prefill path awaits stream metadata and then a debounced preview
  // refresh; both have to land before the form has settled.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await flushPromises();
  return wrapper;
};

const previewConfig = (wrapper: any) =>
  wrapper.findComponent({ name: "PreviewAlert" }).vm.chartData.config;

describe("AddAlert — a prefill seeds the form", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  describe("a SQL alert whose source carries a real trigger", () => {
    it("adopts the source's trigger rather than the form's defaults", async () => {
      wrapper = await openWithPrefill(sqlEntry(), sqlFile());
      const trigger = wrapper.vm.formData.trigger_condition;

      expect(trigger.threshold).toBe(1); // NOT the form default of 3
      expect(trigger.operator).toBe(">=");
      expect(trigger.period).toBe(5);
      // Was clamped to `max(form default, source)` — which silently rewrote an
      // alert that runs every 5 minutes to every 10.
      expect(trigger.frequency).toBe(5);
      expect(trigger.silence).toBe(30); // NOT the form default of 10
    });

    it("keeps the 'check every' display in step with the adopted frequency", async () => {
      wrapper = await openWithPrefill(sqlEntry(), sqlFile());
      expect(wrapper.vm.formData._ui.checkEvery).toBe(5);
    });

    it("carries the query through and drives the preview from it", async () => {
      wrapper = await openWithPrefill(sqlEntry(), sqlFile());

      expect(wrapper.vm.formData.query_condition.type).toBe("sql");
      expect(wrapper.vm.previewQuery).toBe(sqlFile().query_condition!.sql);
    });

    it("draws the threshold line at the adopted threshold, with room to be seen", async () => {
      wrapper = await openWithPrefill(sqlEntry(), sqlFile());
      const config = previewConfig(wrapper);

      expect(config.mark_line).toEqual([expect.objectContaining({ name: "Critical", value: "1" })]);
      expect(config.y_axis_max).toBeGreaterThan(1);
    });
  });

  describe("a PromQL alert, which also switches the stream type to metrics", () => {
    it("adopts the source's trigger", async () => {
      wrapper = await openWithPrefill(promqlEntry(), promqlFile());
      const trigger = wrapper.vm.formData.trigger_condition;

      expect(trigger.threshold).toBe(1);
      expect(trigger.period).toBe(1);
      expect(trigger.frequency).toBe(1);
      expect(trigger.silence).toBe(60);
    });

    it("carries the PromQL query and its structured threshold", async () => {
      wrapper = await openWithPrefill(promqlEntry(), promqlFile());

      expect(wrapper.vm.formData.query_condition.type).toBe("promql");
      expect(wrapper.vm.previewQuery).toBe("eth_rpc_status");
      expect(wrapper.vm.formData.query_condition.promql_condition).toMatchObject({
        column: "value",
        operator: "=",
        value: 2,
      });
    });

    it("does NOT invent an aggregation just because the stream became metrics", async () => {
      // The metrics defaults read the seed's stream-type change as a user
      // gesture and wrote `avg` + a `having` threshold over an alert that
      // already had one — a second threshold beside the real promql_condition.
      wrapper = await openWithPrefill(promqlEntry(), promqlFile());

      expect(wrapper.vm.isAggregationEnabled).toBe(false);
    });

    it("draws the PromQL threshold line with room to be seen", async () => {
      // The case that made this invisible: the metric sits at 0 and the
      // threshold is 2, so a chart scaled to its data alone puts the line off
      // the top of the plot.
      wrapper = await openWithPrefill(promqlEntry(), promqlFile());
      const config = previewConfig(wrapper);

      expect(config.mark_line).toEqual([expect.objectContaining({ name: "Critical", value: "2" })]);
      expect(config.y_axis_max).toBeGreaterThan(2);
      expect(config.y_axis_min).toBeLessThan(2);
    });
  });
});
