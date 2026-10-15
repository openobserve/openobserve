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

// A right-clicked threshold on a builder query must reach the saved alert once, as a HAVING in its SQL.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import AddAlert from "@/components/alerts/AddAlert.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { buildPrefillFromPanel } from "@/utils/alerts/prefill/fromPanel";
import { normalizePrefill, warn } from "@/utils/alerts/alertPrefill";
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

// The SQL preview asks the backend for the query's result shape; a GROUP BY shape keeps the chart a line.
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
  const actual = await vi.importActual<typeof import("@/utils/zincutils")>("@/utils/zincutils");
  return {
    ...actual,
    getUUID: vi.fn(() => "mock-uuid"),
    getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

// The form reads `route.query.prefill` to decide whether a prefill is pending.
const prefillRoute = {
  value: {
    query: { prefill: "panel", folder: "default" },
    params: {},
    name: "addAlert",
    path: "/alerts/add",
  },
};
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof import("vue-router")>("vue-router");
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

// QueryConfig stays real: it is what seeds the SQL and aggregation this spec checks.
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

interface AlertFormView {
  formData: {
    query_condition: {
      type: string;
      sql: string;
      aggregation: { having: Record<string, unknown> } | null;
    };
  };
  getAlertPayload: () => {
    query_condition: { type: string; sql: string; aggregation: unknown };
  };
}

const formOf = (wrapper: ReturnType<typeof mount>) => wrapper.vm as unknown as AlertFormView;

const openBuilderQuery = async (picked: boolean, guessed = false) => {
  const prefill = buildPrefillFromPanel({
    panelTitle: "Retries",
    panelType: "line",
    queryType: "sql",
    queries: picked ? [builtQuery, builtQuery] : [builtQuery],
    queryIndex: picked ? 1 : 0,
    ...(picked
      ? {
          queryChoices: [
            { index: 0, query: builtQuery.query },
            { index: 1, query: builtQuery.query },
          ],
        }
      : {}),
    executedQuery: builtQuery.query,
    threshold: 4.42,
    condition: "above",
    yAxisColumn: "y_axis_1",
    timeRange: { value_type: "relative", relative_value: 15, relative_period: "Minutes" },
  });
  if (guessed)
    prefill.warnings.push(warn("thresholdColumnGuessed", "warning", { column: "y_axis_1" }));
  sessionStorage.setItem(ALERT_PREFILL_KEY, JSON.stringify(normalizePrefill(prefill)));
  const wrapper = mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n], stubs },
    props: { modelValue: {}, isUpdated: false, destinations: [] },
  });
  for (let round = 0; round < 5; round++) await flushPromises();
  return wrapper;
};

describe("AddAlert — a threshold right-clicked on a builder query", () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it.each([
    ["picked in the multi-query dialog", true],
    ["on a single-query panel", false],
  ])("%s, is saved once, as a HAVING in the SQL", async (_name, picked) => {
    wrapper = await openBuilderQuery(picked);
    const condition = formOf(wrapper).formData.query_condition;

    expect(condition.type).toBe("sql");
    expect(condition.sql.match(/HAVING/g)).toHaveLength(1);
    expect(condition.sql).toContain('HAVING "y_axis_1" >= 4.42');
    expect(condition.aggregation?.having).toMatchObject({ operator: ">=", value: 1 });

    const saved = formOf(wrapper).getAlertPayload().query_condition;
    expect(saved.type).toBe("sql");
    expect(saved.sql.match(/HAVING/g)).toHaveLength(1);
    expect(saved.sql).toContain('HAVING "y_axis_1" >= 4.42');
    expect(saved.aggregation).toBeNull();
  });

  it("states on the form when the threshold column was a guess", async () => {
    wrapper = await openBuilderQuery(false, true);

    expect(
      wrapper.find('[data-test="add-alert-prefill-warning-thresholdColumnGuessed"]').text(),
    ).toContain("The threshold was applied to y_axis_1; check it is the value you meant.");
  });
});
