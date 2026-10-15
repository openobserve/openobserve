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

// A right-clicked threshold on a builder query picked in the multi-query dialog
// has to reach the form once, as a HAVING in the SQL the form saves.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import AddAlert from "@/components/alerts/AddAlert.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { buildPrefillFromPanel } from "@/utils/alerts/prefill/fromPanel";
import { normalizePrefill } from "@/utils/alerts/alertPrefill";
import { ALERT_PREFILL_KEY } from "@/utils/alerts/alertPrefillStorage";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "_timestamp", type: "int" },
        { name: "level", type: "string" },
      ],
    }),
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "triggers" }] }),
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
    query: { prefill: "panel", folder: "default" },
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
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
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

const builtQuery = {
  query:
    'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "triggers" GROUP BY x_axis_1',
  customQuery: false,
  fields: {
    stream: "triggers",
    stream_type: "logs",
    x: [{ alias: "x_axis_1" }],
    y: [{ alias: "y_axis_1", column: "_timestamp", aggregationFunction: "count" }],
  },
};

const openPickedBuilderQuery = async () => {
  const prefill = buildPrefillFromPanel({
    panelTitle: "Retries",
    panelType: "line",
    queryType: "sql",
    queries: [builtQuery, builtQuery],
    queryIndex: 1,
    queryChoices: [
      { index: 0, query: builtQuery.query },
      { index: 1, query: builtQuery.query },
    ],
    executedQuery: builtQuery.query,
    threshold: 4.42,
    condition: "above",
    yAxisColumn: "y_axis_1",
    timeRange: { value_type: "relative", relative_value: 15, relative_period: "Minutes" },
  });
  sessionStorage.setItem(ALERT_PREFILL_KEY, JSON.stringify(normalizePrefill(prefill)));
  const wrapper = mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n], stubs },
    props: { modelValue: {}, isUpdated: false, destinations: [] },
  });
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await flushPromises();
  return wrapper;
};

describe("AddAlert — a threshold right-clicked on a picked builder query", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("lands once, as a HAVING in the SQL, with the aggregation left at its default", async () => {
    wrapper = await openPickedBuilderQuery();
    const condition = wrapper.vm.formData.query_condition;

    expect(condition.type).toBe("sql");
    expect(condition.sql.match(/HAVING/g)).toHaveLength(1);
    expect(condition.sql).toContain('HAVING "y_axis_1" >= 4.42');
    expect(wrapper.vm.isAggregationEnabled).toBe(true);
    expect(condition.aggregation.having).toMatchObject({ operator: ">=", value: 1 });
    expect(wrapper.vm.formData.trigger_condition).toMatchObject({ operator: ">=", threshold: 1 });
  });
});
