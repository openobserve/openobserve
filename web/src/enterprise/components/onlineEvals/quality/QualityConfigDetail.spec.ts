// @vitest-environment jsdom
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { QualityScorePage, ScoreConfig } from "@/services/online-evals.service";
import type { QualityRow } from "../utils/qualityFormat";

const { scores } = vi.hoisted(() => ({ scores: vi.fn() }));

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, quality: { list: vi.fn(), scores, failedRuns: vi.fn() } },
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "aiEvaluations", query: {} }),
  useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: "/" }) }),
}));

import QualityConfigDetail from "./QualityConfigDetail.vue";

// Emits a copy of the row, so the detail cannot rely on object identity.
const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array, default: () => [] },
    pageSize: Number,
    pageSizeOptions: Array,
  },
  emits: ["row-click"],
  template: `<div data-test="score-list"><div v-for="row in data" :key="row.id" :data-test="'score-' + row.id" @click="$emit('row-click', { ...row })"><slot name="cell-score" :row="row" /></div></div>`,
});

const PaneStub = defineComponent({
  name: "QualityScorePane",
  props: { score: Object, thresholdLabel: String, loading: Boolean },
  template: `<div data-test="pane-stub" :data-loading="String(!!loading)">{{ score?.id }}</div>`,
});

const score = (id: string) => ({
  id,
  timestamp: 1,
  refTimestamp: 1,
  sourceType: "llm_judge",
  targetScope: "span",
  targetId: id,
  spanId: id,
  traceId: "t",
  sessionId: null,
  sourceStream: "default",
  sourceStreamType: "traces",
  value: "medium",
  unhealthy: true,
  reasoning: null,
  evaluatorTraceId: null,
  taskId: null,
  inputPreview: null,
  outputPreview: null,
});

function row(overrides: Partial<QualityRow> = {}): QualityRow {
  return {
    configId: "tox",
    name: "toxicity",
    dataType: "categorical",
    status: "attention",
    total: 114,
    unhealthy: 67,
    average: null,
    lastScoredAt: 1,
    scopeCounts: { span: 77, trace: 37, session: 0 },
    topValue: { key: "medium", count: 67 },
    description: "Toxicity level of the response.",
    version: 1,
    thresholdLabel: "low",
    range: { min: 0, max: 1 },
    ...overrides,
  };
}

const PAGE: QualityScorePage = {
  average: null,
  distribution: [
    { key: "low", count: 47, unhealthy: 0 },
    { key: "medium", count: 67, unhealthy: 67 },
  ],
  list: [],
  total: 114,
  from: 0,
  size: 10,
};

function mountDetail(
  overrides: Partial<QualityRow> = {},
  extra: {
    row?: QualityRow | null;
    config?: ScoreConfig | null;
    initialPage?: number;
    initialScoreId?: string | null;
    realTable?: boolean;
  } = {},
) {
  const current = row(overrides);
  return mount(QualityConfigDetail, {
    props: {
      configId: current.configId,
      row: extra.row === undefined ? current : extra.row,
      config: extra.config ?? null,
      scope: "all",
      only: "all",
      dateWindow: { startUs: 1, endUs: 2 },
      agentParams: {},
      enabled: true,
      initialPage: extra.initialPage ?? 0,
      initialScoreId: extra.initialScoreId ?? null,
    },
    global: {
      plugins: [store, withQueryClient()],
      stubs: {
        ...(extra.realTable ? {} : { OTable: OTableStub }),
        QualityDistributionChart: true,
        QualityScorePane: PaneStub,
      },
    },
  });
}

describe("QualityConfigDetail", () => {
  beforeEach(() => {
    scores.mockReset().mockResolvedValue(PAGE);
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("has no stat band: the toggle reads counts only, and the chart and review get the room", async () => {
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test^="quality-detail-stat-"]').exists()).toBe(false);
    const unhealthy = wrapper.find('[data-test="quality-detail-only-unhealthy"]');
    expect(unhealthy.text().replace(/\s+/g, " ")).toBe("Unhealthy 67");
    expect(unhealthy.text()).not.toContain("%");
    expect(wrapper.find('[data-test="quality-detail-only-all"]').text().replace(/\s+/g, " ")).toBe(
      "All 114",
    );
    expect(wrapper.find('[data-test="quality-detail-distribution"] .h-28').exists()).toBe(true);
    expect(wrapper.find('[data-test="quality-detail-review"]').classes()).toEqual(
      expect.arrayContaining(["flex-1", "min-h-0"]),
    );
  });

  it("puts the average of a numeric config in the chart title", async () => {
    scores.mockResolvedValue({
      ...PAGE,
      average: 0.37,
      distribution: [
        { key: 0, lower: 0, upper: 0.5, count: 20, unhealthy: 20 },
        { key: 1, lower: 0.5, upper: 1, count: 26, unhealthy: 0 },
      ],
    });
    const wrapper = mountDetail({ dataType: "numeric", thresholdLabel: "≥ 0.5" });
    await flushPromises();
    const title = wrapper.find('[data-test="quality-detail-distribution"]').text();
    expect(title.replace(/\s*·\s*/g, " · ")).toContain("Score distribution · average 0.37");
  });

  it("keeps the boolean and categorical chart titles without an average", async () => {
    const categorical = mountDetail();
    await flushPromises();
    expect(categorical.find('[data-test="quality-detail-average"]').exists()).toBe(false);
    expect(categorical.find('[data-test="quality-detail-distribution"]').text()).toContain(
      "Value distribution",
    );

    scores.mockResolvedValue({
      ...PAGE,
      average: 0.4,
      distribution: [
        { key: true, count: 10, unhealthy: 0 },
        { key: false, count: 4, unhealthy: 4 },
      ],
    });
    const boolean = mountDetail({ dataType: "boolean", thresholdLabel: "true" });
    await flushPromises();
    expect(boolean.find('[data-test="quality-detail-average"]').exists()).toBe(false);
  });

  it("disables Unhealthy with a reason when there is no threshold", async () => {
    scores.mockResolvedValue({
      ...PAGE,
      distribution: [
        { key: "neutral", count: 16, unhealthy: null },
        { key: "positive", count: 14, unhealthy: null },
      ],
    });
    const wrapper = mountDetail({ status: "unset", unhealthy: null, thresholdLabel: "" });
    await flushPromises();
    const unhealthy = wrapper.find('[data-test="quality-detail-only-unhealthy"]');
    expect(unhealthy.attributes("disabled")).toBeDefined();
    expect(unhealthy.text().replace(/\s+/g, " ")).toBe("Unhealthy 0");
    const item = wrapper
      .findAllComponents({ name: "OToggleGroupItem" })
      .find((found) => found.props("value") === "unhealthy");
    expect(item?.props("tooltip")).toBe("Set a healthy threshold to classify scores");
  });

  it("pages the score list ten at a time with no page-size select", async () => {
    const wrapper = mountDetail();
    await flushPromises();
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("pageSize")).toBe(10);
    expect(table.props("pageSizeOptions")).toEqual([]);

    // The real table, unchanged, renders no select for an empty option list.
    scores.mockResolvedValue({
      ...PAGE,
      list: Array.from({ length: 10 }, (_, index) => score(`s${index}`)),
    });
    const real = mountDetail({}, { realTable: true });
    await flushPromises();
    const bar = real.find('[data-test="o2-table-pagination-bottom"]');
    expect(bar.find('[data-test="o2-table-page-size-select"]').exists()).toBe(false);
    expect(bar.find('[data-test="o2-table-pagination-info"]').text()).toMatch(/1 - 10 .* 114/);
    expect(bar.find('[data-test="o2-table-next-page-btn"]').exists()).toBe(true);
  });

  it("puts the pane in its loading state on the first load, a page change and a scope change", async () => {
    const pane = (wrapper: ReturnType<typeof mountDetail>) =>
      wrapper.find('[data-test="pane-stub"]');
    let resolveFirst: (value: QualityScorePage) => void = () => {};
    scores.mockImplementationOnce(() => new Promise((done) => (resolveFirst = done)));
    const wrapper = mountDetail();
    await flushPromises();
    const firstLoad = wrapper.find('[data-test="quality-detail-loading"]');
    expect(firstLoad.find('[data-test="pane-stub"]').attributes("data-loading")).toBe("true");

    resolveFirst({ ...PAGE, list: [score("s1"), score("s2")] });
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-loading"]').exists()).toBe(false);
    expect(pane(wrapper).attributes("data-loading")).toBe("false");
    expect(pane(wrapper).text()).toBe("s1");

    scores.mockImplementationOnce(() => new Promise(() => {}));
    wrapper.findComponent({ name: "OTable" }).vm.$emit("update:current-page", 2);
    await flushPromises();
    expect(pane(wrapper).attributes("data-loading")).toBe("true");
    expect(pane(wrapper).text()).toBe("");

    scores.mockImplementationOnce(() => new Promise(() => {}));
    await wrapper.setProps({ scope: "trace" });
    await flushPromises();
    expect(pane(wrapper).attributes("data-loading")).toBe("true");
  });

  it("replaces the band and the review with an empty state when there are no scores", async () => {
    scores.mockResolvedValue({ ...PAGE, distribution: [{ key: "low", count: 0, unhealthy: 0 }] });
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="quality-detail-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-detail-review"]').exists()).toBe(false);
  });

  it("shows no access on a 403 and not found on a 404, both with a way back", async () => {
    scores.mockRejectedValue({ response: { status: 403 } });
    const denied = mountDetail();
    await flushPromises();
    expect(denied.find('[data-test="quality-detail-error"]').text()).toContain("access");
    expect(denied.text()).toContain("Back to all configs");

    scores.mockReset().mockRejectedValue({ response: { status: 404 } });
    const missing = mountDetail({ configId: "old-id" });
    await flushPromises();
    expect(missing.find('[data-test="quality-detail-error"]').text()).toContain(
      "Score Config not found",
    );
    expect(missing.text()).toContain("Back to all configs");
  });

  it("takes the type and the threshold from the Score Config when the list has no row", async () => {
    const config: ScoreConfig = {
      id: "row-1",
      entityId: "tox",
      name: "toxicity",
      version: 3,
      dataType: "categorical",
      description: "Toxicity level of the response.",
      healthyThreshold: { healthy_categories: ["low"] },
    };
    const wrapper = mountDetail({}, { row: null, config });
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-distribution"]').text()).toContain(
      "Value distribution",
    );
    expect(wrapper.findComponent(PaneStub).props("thresholdLabel")).toBe("low");
  });

  it("falls back to the distribution for the type when the config is unknown too", async () => {
    scores.mockResolvedValue({
      ...PAGE,
      distribution: [{ key: 0, lower: 0, upper: 1, count: 3, unhealthy: 1 }],
    });
    const wrapper = mountDetail({}, { row: null });
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-distribution"]').text()).toContain(
      "Score distribution",
    );
  });

  it("selects the clicked score row by id and shows it in the pane", async () => {
    scores.mockResolvedValue({ ...PAGE, list: [score("s1"), score("s2"), score("s3")], total: 3 });
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.find('[data-test="pane-stub"]').text()).toBe("s1");
    await wrapper.find('[data-test="score-s3"]').trigger("click");
    expect(wrapper.find('[data-test="pane-stub"]').text()).toBe("s3");
  });

  it("reports the page and the selected score, for the URL", async () => {
    scores.mockResolvedValue({ ...PAGE, list: [score("s1"), score("s2"), score("s3")], total: 3 });
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.emitted("position")?.at(-1)).toEqual([{ page: 0, scoreId: "s1" }]);
    await wrapper.find('[data-test="score-s3"]').trigger("click");
    expect(wrapper.emitted("position")?.at(-1)).toEqual([{ page: 0, scoreId: "s3" }]);
  });

  it("reopens the page and the score it is given", async () => {
    scores.mockImplementation((_org, _id, params) =>
      Promise.resolve({
        ...PAGE,
        list: [score(`s${params.from}`), score(`s${params.from + 1}`)],
        total: 12,
      }),
    );
    const wrapper = mountDetail({}, { initialPage: 1, initialScoreId: "s11" });
    await flushPromises();
    expect(scores.mock.calls[0][2]).toMatchObject({ from: 10 });
    expect(wrapper.find('[data-test="pane-stub"]').text()).toBe("s11");
  });

  it("goes back on Esc, unless an overlay is open", async () => {
    const wrapper = mountDetail();
    await flushPromises();
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    document.body.appendChild(overlay);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("back")).toBeUndefined();
    overlay.remove();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("back")).toHaveLength(1);
    wrapper.unmount();
  });
});
