// @vitest-environment jsdom

import { computed, defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/languages/en-US.json";
import QualityPage from "./QualityPage.vue";

const refreshers = vi.hoisted(() => ({
  data: vi.fn(),
  configs: vi.fn(),
  detail: vi.fn(),
  charts: vi.fn(),
  runs: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "evaluations", query: {} }),
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()), replace: vi.fn() }),
}));

vi.mock("./composables/useQualityData", () => ({
  useQualityData: () => ({
    isLoading: ref(false),
    kpis: ref([]),
    deltaByKpi: computed(() => ({})),
    refresh: refreshers.data,
  }),
}));

vi.mock("./composables/useQualityScoreConfigs", () => ({
  useQualityScoreConfigs: () => ({
    rows: ref([]),
    isLoading: ref(false),
    refresh: refreshers.configs,
  }),
}));

vi.mock("./composables/useQualityConfigDetail", () => ({
  useQualityConfigDetail: () => ({
    isLoading: ref(false),
    dataType: ref(null),
    kpis: ref([]),
    hasScores: ref(false),
    booleanAgg: ref(null),
    categoricalRows: ref([]),
    refresh: refreshers.detail,
  }),
}));

vi.mock("./composables/useQualityDetailCharts", () => ({
  useQualityDetailCharts: () => ({
    isLoading: ref(false),
    numericTrend: ref([]),
    numericDistribution: ref([]),
    booleanTrend: ref([]),
    booleanTrendSeries: ref([]),
    refresh: refreshers.charts,
  }),
}));

vi.mock("./composables/useQualityRuns", () => ({
  useQualityRuns: () => ({
    runs: ref([]),
    counts: ref({}),
    activeFilter: ref("all"),
    currentPage: ref(1),
    pageSize: ref(20),
    totalCount: ref(0),
    isLoading: ref(false),
    error: ref(null),
    refresh: refreshers.runs,
    setFilter: vi.fn(),
    setPagination: vi.fn(),
    resolveEvaluatorSpanId: vi.fn(),
  }),
}));

const TableStub = defineComponent({
  name: "QualityScoreConfigsTable",
  emits: ["refresh", "select"],
  template: `<button data-test="table-refresh" @click="$emit('refresh')" />`,
});

function mountPage() {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });
  return mount(QualityPage, {
    props: {
      scoreConfigs: [],
      dateWindow: { startUs: 1, endUs: 2 },
    },
    global: {
      plugins: [i18n],
      stubs: {
        QualityScoreConfigsTable: TableStub,
        QualityDetailPanel: true,
        QualityKpiCard: true,
        QualityKpiSkeleton: true,
        KpiCardRow: true,
        ODrawer: true,
        OSelect: true,
        OTag: true,
        OSkeleton: true,
      },
    },
  });
}

function refreshCalls() {
  return Object.values(refreshers).map((fn) => fn.mock.calls.length);
}

describe("QualityPage reloads", () => {
  beforeEach(() => {
    Object.values(refreshers).forEach((fn) => fn.mockReset().mockResolvedValue(undefined));
  });

  it("only signals ready on mount, without asking for the lists", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.emitted("ready")).toHaveLength(1);
    expect(wrapper.emitted("reload-configs")).toBeUndefined();
  });

  it("recomputes without re-reading the lists on a mount, date or agent reload", async () => {
    const wrapper = mountPage();
    await (wrapper.vm as any).refreshAll();

    expect(refreshCalls()).toEqual([1, 1, 1, 1, 1]);
    expect(wrapper.emitted("reload-configs")).toBeUndefined();
  });

  it("asks for the lists on a user refresh", async () => {
    const wrapper = mountPage();
    await (wrapper.vm as any).refreshAll(true);

    expect(wrapper.emitted("reload-configs")).toHaveLength(1);
    expect(refreshCalls()).toEqual([1, 1, 1, 1, 1]);
  });

  it("asks for the lists when the table's refresh button is clicked", async () => {
    const wrapper = mountPage();
    await wrapper.find('[data-test="table-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("reload-configs")).toHaveLength(1);
    expect(refreshCalls()).toEqual([1, 1, 1, 1, 1]);
  });
});
