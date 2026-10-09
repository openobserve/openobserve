// @vitest-environment jsdom
import { defineComponent, h } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { traceDetailsKeys } from "@/services/search.querykeys";
import { onlineEvalKeys } from "@/services/online-evals.service.querykeys";
import type { QualityScoresParams } from "@/services/online-evals.service";

// An absolute range in the URL, so the window only moves when the test says so.
const { START, END, DAY, mocks, route, replace, picker } = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  const START = 1_791_100_000_000_000;
  return {
    START,
    END: START + 3_600_000_000,
    DAY: 86_400_000_000,
    mocks: {
      list: vi.fn(),
      scores: vi.fn(),
      failedRuns: vi.fn(),
      listAgents: vi.fn(),
    },
    route: reactive({ name: "aiEvaluations", query: {} as Record<string, string> }),
    replace: vi.fn(() => Promise.resolve()),
    picker: { window: { startTime: START, endTime: START + 3_600_000_000 } },
  };
});

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  const empty = () => Promise.resolve([]);
  return {
    ...actual,
    default: {
      ...actual.default,
      providers: { ...actual.default.providers, list: empty },
      scoreConfigs: { ...actual.default.scoreConfigs, list: empty },
      scorers: { ...actual.default.scorers, list: empty },
      jobs: { ...actual.default.jobs, list: empty },
      quality: { list: mocks.list, scores: mocks.scores, failedRuns: mocks.failedRuns },
    },
  };
});

vi.mock("@/services/gen-ai-agent-mapping.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, listAgents: mocks.listAgents } };
});

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    push: vi.fn(() => Promise.resolve()),
    replace,
    back: vi.fn(),
    resolve: () => ({ href: "/" }),
  }),
}));

import OnlineEvals from "./OnlineEvals.vue";
import { useAiDateRange } from "@/enterprise/composables/useAiDateRange";

const PickerStub = defineComponent({
  name: "DateTimePickerDashboard",
  inheritAttrs: false,
  props: { modelValue: { type: Object, default: null } },
  emits: ["update:modelValue"],
  setup(props, { expose }) {
    expose({ getConsumableDateTime: () => picker.window });
    return () =>
      h("div", {
        "data-test": "picker-stub",
        "data-type": props.modelValue?.valueType,
        "data-period": props.modelValue?.relativeTimePeriod ?? "",
      });
  },
});

// Lets the test page the score list the way the real table's pager does.
const ScoresTableStub = defineComponent({
  name: "OTable",
  inheritAttrs: false,
  emits: ["update:current-page"],
  setup(_, { emit }) {
    return () =>
      h("button", { "data-test": "next-page", onClick: () => emit("update:current-page", 2) });
  },
});

const PaneStub = defineComponent({
  name: "QualityScorePane",
  props: ["score"],
  setup(props) {
    return () => h("div", { "data-test": "pane-stub" }, props.score?.id ?? "");
  },
});

const scoreRow = (id: string) => ({
  id,
  timestamp: 1,
  refTimestamp: 1,
  sourceType: "llm_judge",
  targetScope: "trace",
  targetId: id,
  spanId: null,
  traceId: id,
  sessionId: null,
  sourceStream: "default",
  sourceStreamType: "traces",
  value: "low",
  unhealthy: false,
  reasoning: null,
  evaluatorTraceId: null,
  taskId: null,
  inputPreview: null,
  outputPreview: null,
});

const PAGE = {
  average: null,
  distribution: [
    { key: "low", count: 10, unhealthy: 0 },
    { key: "medium", count: 15, unhealthy: 15 },
  ],
  total: 25,
};

const scoreCalls = () => mocks.scores.mock.calls.map((call) => call[2] as QualityScoresParams);

function mountPage() {
  return mount(OnlineEvals, {
    props: { hideTabBar: true },
    global: {
      plugins: [store],
      stubs: {
        DateTimePickerDashboard: PickerStub,
        AgentScopeCascade: true,
        AiLastRefreshed: true,
        OTable: ScoresTableStub,
        QualityDistributionChart: true,
        QualityScorePane: PaneStub,
        QualityConfigsTable: true,
        ScorerFormPage: true,
        JobFormPage: true,
        ImportScoreConfig: true,
        ImportScorer: true,
        ScoreConfigList: true,
        ScorerList: true,
        EvalJobList: true,
        ScorerTypeDialog: true,
        ScoreConfigDialog: true,
        ScoreConfigDetail: true,
        ScorerDetail: true,
        EvalJobDetail: true,
        ScoreConfigLibrary: true,
        ScorerLibrary: true,
        ConfirmDialog: true,
        ODrawer: true,
      },
    },
  });
}

/** Opens the toxicity detail on page 2, so page 1 stays in the cache as an earlier view. */
async function openOnSecondPage() {
  const wrapper = mountPage();
  await flushPromises();
  await wrapper.find('[data-test="next-page"]').trigger("click");
  await flushPromises();
  expect(scoreCalls().map((params) => params.from)).toEqual([0, 10]);
  for (const mock of Object.values(mocks)) mock.mockClear();
  return wrapper;
}

const cachedPage = (from: number) =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: onlineEvalKeys.quality("default") })
    .filter((query) => query.queryKey[4] === "scores" && (query.queryKey[6] as any).from === from);

// Mounted pages read the shared reactive route, so each test unmounts its own.
enableAutoUnmount(afterEach);

function resetMocks() {
  picker.window = { startTime: START, endTime: END };
  replace.mockClear();
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.failedRuns.mockReset().mockResolvedValue(0);
  mocks.listAgents.mockReset().mockResolvedValue({ agents: [] });
  mocks.scores.mockReset().mockImplementation((_org, _id, params) =>
    Promise.resolve({
      ...PAGE,
      list: [scoreRow(`s${params.from}`), scoreRow(`s${params.from + 1}`)],
      from: params.from,
      size: params.size,
    }),
  );
}

const listWindow = () => {
  const params = mocks.list.mock.calls.at(-1)?.[1];
  return params ? params.end_time - params.start_time : null;
};

describe("OnlineEvals Quality range", () => {
  beforeEach(() => {
    route.query = { tab: "quality" };
    resetMocks();
  });

  it("opens Quality at Past 24 Hours, while the shared AI range keeps its 15-minute default", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const pickerStub = wrapper.find('[data-test="picker-stub"]');
    expect(pickerStub.attributes("data-type")).toBe("relative");
    expect(pickerStub.attributes("data-period")).toBe("24h");
    expect(listWindow()).toBe(DAY);
    expect(useAiDateRange().state.value.relativeTimePeriod).toBe("15m");
  });

  it("keeps a chosen range in the URL and leaves the LLM Insights and Sessions range alone", async () => {
    const shared = JSON.stringify(useAiDateRange().state.value);
    const wrapper = mountPage();
    await flushPromises();
    picker.window = { startTime: START, endTime: START + 7 * DAY };
    wrapper.findComponent(PickerStub).vm.$emit("update:modelValue", {
      valueType: "relative",
      relativeTimePeriod: "7d",
      startTime: START,
      endTime: START + 7 * DAY,
    });
    await flushPromises();
    expect(listWindow()).toBe(7 * DAY);
    expect(replace).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ tab: "quality", period: "7d" }),
    });
    expect(JSON.stringify(useAiDateRange().state.value)).toBe(shared);
    expect(localStorage.getItem("aiObservability:dateRange")).toBeNull();
  });

  it("reopens at the range in the URL after a reload", async () => {
    route.query = { tab: "quality", period: "7d" };
    const relative = mountPage();
    await flushPromises();
    expect(relative.find('[data-test="picker-stub"]').attributes("data-period")).toBe("7d");
    expect(listWindow()).toBe(7 * DAY);

    route.query = { tab: "quality", from: String(START), to: String(END) };
    const absolute = mountPage();
    await flushPromises();
    expect(absolute.find('[data-test="picker-stub"]').attributes("data-type")).toBe("absolute");
    expect(mocks.list).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ start_time: START, end_time: END }),
    );
  });
});

describe("OnlineEvals Quality detail header", () => {
  beforeEach(() => {
    route.query = { tab: "quality", config: "tox", from: String(START), to: String(END) };
    resetMocks();
  });

  it("uses one header, the detail header, with the range, Refresh and the agent filters kept", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const headers = wrapper.findAll("header");
    expect(headers).toHaveLength(1);
    expect(headers[0].find('[data-test="quality-detail-back"]').exists()).toBe(true);
    expect(headers[0].find('[data-test="quality-detail-edit-config"]').exists()).toBe(true);
    expect(headers[0].find('[data-test="picker-stub"]').exists()).toBe(true);
    expect(headers[0].find('[data-test="quality-refresh-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="quality-scope-bar"] agent-scope-cascade-stub').exists()).toBe(
      true,
    );
  });
});

describe("OnlineEvals Quality round trip through a link", () => {
  beforeEach(() => {
    route.query = { tab: "quality", config: "tox", from: String(START), to: String(END) };
    resetMocks();
  });

  it("writes the page and score with replace, then reopens them from the cache after Back", async () => {
    const wrapper = await openOnSecondPage();
    expect(replace).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: expect.objectContaining({ config: "tox", page: "2", score: "s10" }),
    });
    wrapper.unmount();

    // Back from the trace: the page remounts from the URL it left with.
    route.query = { ...route.query, page: "2", score: "s11" };
    const restored = mountPage();
    await flushPromises();
    expect(restored.find('[data-test="pane-stub"]').text()).toBe("s11");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.failedRuns).not.toHaveBeenCalled();
    expect(mocks.scores).not.toHaveBeenCalled();
    expect(mocks.listAgents).not.toHaveBeenCalled();
  });
});

describe("OnlineEvals Quality Refresh", () => {
  beforeEach(() => {
    route.query = { tab: "quality", config: "tox", from: String(START), to: String(END) };
    resetMocks();
  });

  it("fetches each read once, keeps the scores page, and marks earlier views stale", async () => {
    const wrapper = await openOnSecondPage();
    await wrapper.find('[data-test="quality-refresh-btn"]').trigger("click");
    await flushPromises();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.failedRuns).toHaveBeenCalledTimes(1);
    expect(mocks.listAgents).toHaveBeenCalledTimes(1);
    expect(scoreCalls()).toEqual([expect.objectContaining({ from: 10, start_time: START })]);
    expect(cachedPage(0).every((query) => query.state.isInvalidated)).toBe(true);
    expect(cachedPage(10).every((query) => !query.state.isInvalidated)).toBe(true);
  });

  it("forces the score pane's cached trace too, like the other reads on the view", async () => {
    const wrapper = await openOnSecondPage();
    // Loaded before the Refresh, so the "not fetched by this Refresh" rule applies.
    const updatedAt = Date.now() - 1000;
    const traceKey = traceDetailsKeys.detail("default", "default", "trace-1");
    queryClient.setQueryData(traceKey, [], { updatedAt });
    const otherOrg = traceDetailsKeys.detail("other", "default", "trace-1");
    queryClient.setQueryData(otherOrg, [], { updatedAt });
    await wrapper.find('[data-test="quality-refresh-btn"]').trigger("click");
    await flushPromises();
    expect(queryClient.getQueryState(traceKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherOrg)?.isInvalidated).toBe(false);
  });

  it("fetches each read once when the Refresh moves the window into a new minute", async () => {
    const wrapper = await openOnSecondPage();
    picker.window = { startTime: START + 120_000_000, endTime: END + 120_000_000 };
    await wrapper.find('[data-test="quality-refresh-btn"]').trigger("click");
    await flushPromises();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ start_time: START + 120_000_000 }),
    );
    expect(mocks.failedRuns).toHaveBeenCalledTimes(1);
    expect(scoreCalls()).toEqual([
      expect.objectContaining({ from: 10, start_time: START + 120_000_000 }),
    ]);
    // The reads of the old window stay in the cache, marked stale.
    const oldWindow = cachedPage(10).filter(
      (query) => (query.queryKey[6] as any).start_time < START + 60_000_000,
    );
    expect(oldWindow.length).toBe(1);
    expect(oldWindow[0].state.isInvalidated).toBe(true);
  });
});
