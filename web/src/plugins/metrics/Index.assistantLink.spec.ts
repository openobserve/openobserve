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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { inject, reactive } from "vue";
import { b64EncodeUnicode } from "@/utils/formatters";

const flag = vi.hoisted(() => ({ on: true }));
vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => flag.on }));

const api = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));

const route = vi.hoisted(() => ({ query: {} as Record<string, any> }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(() => Promise.resolve()) }),
  useRoute: () => ({
    get query() {
      return route.query;
    },
    fullPath: "/metrics/editor",
  }),
}));

const mockStore = vi.hoisted(() => ({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "org1" },
    zoConfig: { min_auto_refresh_interval: 5 },
  },
}));
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useStore: () => mockStore,
}));

const showErrorNotification = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification }),
}));

const shortcuts = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }));
vi.mock("@/lib/vue-shortcut-manager", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useShortcuts: (list: Array<{ id: string; handler: () => void }>) =>
    list.forEach((s) => (shortcuts.handlers[s.id] = s.handler)),
}));

const validatePanel = vi.hoisted(() => vi.fn());
const panel = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panel.current,
    resetDashboardPanelData: vi.fn(),
    resetAggregationFunction: vi.fn(),
    validatePanel,
  }),
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));
vi.mock("@/composables/dashboard/useDefaultPanelFields", () => ({
  default: () => ({ applyDefaultPanelFields: vi.fn() }),
}));

import MetricsIndex from "./Index.vue";

const editorRunQuery = vi.fn();
type RunQuery = (withoutCache?: boolean) => void;
const injected = { runQuery: null as RunQuery | null };
const picker = {
  refresh: vi.fn(),
  setSavedDate: vi.fn(),
  getConsumableDateTime: vi.fn(() => ({ startTime: 1_000_000, endTime: 2_000_000 })),
};

const makePanel = () =>
  reactive({
    data: {
      title: "",
      type: "line",
      queryType: "promql",
      config: {},
      queries: [
        { query: "up", customQuery: true, fields: { stream_type: "metrics", stream: "" } },
        { query: "rate(x[5m])", customQuery: true, fields: { stream_type: "metrics", stream: "" } },
      ],
    },
    meta: { dateTime: {} },
    layout: { showQueryBar: true, isConfigPanelOpen: false, currentQueryIndex: 0 },
  });

const mountIndex = () =>
  mount(MetricsIndex, {
    global: {
      stubs: {
        ShareButton: true,
        SyntaxGuideMetrics: true,
        MetricLegends: true,
        AddToDashboard: true,
        QueryHistoryDrawer: {
          emits: ["load"],
          template: '<div data-test="metrics-history" />',
        },
        PanelEditor: {
          setup: (_: any, { expose }: any) => {
            injected.runQuery = inject<RunQuery | null>("runQuery", null);
            expose({ runQuery: editorRunQuery });
            return {};
          },
          template: "<div />",
        },
        DateTimePickerDashboard: {
          setup: (_: any, { expose }: any) => {
            expose(picker);
            return {};
          },
          template: "<div />",
        },
        AutoRefreshInterval: {
          emits: ["trigger"],
          template: '<div data-test="metrics-auto-refresh" @click="$emit(\'trigger\')" />',
        },
      },
    },
  });

describe("Metrics editor — assistant links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    flag.on = true;
    panel.current = makePanel();
    validatePanel.mockImplementation(() => {});
    api.record.mockResolvedValue({ data: {} });
  });

  const assistantLink = () => ({
    org_identifier: "org1",
    type: "ai_chat_query",
    t: "1",
    query_type: "promql",
    query: b64EncodeUnicode("histogram_quantile(0.95, rate(x[5m]))"),
    from: "1760000000000",
    to: "1760000900000",
  });

  it("applies the PromQL and the window of an assistant link without running it", async () => {
    route.query = assistantLink();
    mountIndex();
    await flushPromises();
    expect(panel.current.data.queries[0].query).toBe("histogram_quantile(0.95, rate(x[5m]))");
    expect(panel.current.data.queries[0].customQuery).toBe(true);
    expect(editorRunQuery).not.toHaveBeenCalled();
  });

  it("keeps today's deep-link auto-run with the flag off", async () => {
    flag.on = false;
    route.query = assistantLink();
    mountIndex();
    await flushPromises();
    expect(editorRunQuery).toHaveBeenCalled();
  });
});
