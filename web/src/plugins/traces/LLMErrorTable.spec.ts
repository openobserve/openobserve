// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom
//
// "Recent errors" must not claim "No errors" before its query has answered:
// it shows its loading state until the first query returns, the empty message
// only after an empty result, and a load-failure message when the query fails.

const mockExecuteQuery = vi.fn();

vi.mock("./composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery: mockExecuteQuery, cancelAll: vi.fn() }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { timezone: "UTC", selectedOrganization: { identifier: "o" } } }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data", "loading", "emptyMessage"],
    template: `<div data-test="table">
      <span v-if="loading" data-test="table-loading" />
      <span v-else-if="!data.length" data-test="table-empty">{{ emptyMessage }}</span>
      <span v-else data-test="table-rows">{{ data.length }}</span>
    </div>`,
  },
}));

vi.mock("./LLMPanelCard.vue", () => ({
  default: {
    name: "LLMPanelCard",
    template: `<div><slot /></div>`,
    methods: {
      getRootEl(this: { $el: Element }) {
        return this.$el;
      },
    },
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMErrorTable from "./LLMErrorTable.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";
import { errorRowsCache } from "./llmInsightsCache";

const panel = LLM_INSIGHTS_PANELS.find((p) => p.type === "table")!;

// The panel loads when it scrolls into view; make "in view" a test switch.
let reportVisible: ((visible: boolean) => void) | null = null;
class FakeIntersectionObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    reportVisible = (visible) => cb([{ isIntersecting: visible }]);
  }
  observe() {}
  disconnect() {}
}

async function mountTable(streamName = "llm_traces") {
  const wrapper = mount(LLMErrorTable, {
    props: { panel, streamName, startTime: 1, endTime: 2, cacheKey: `k-${Math.random()}` },
  });
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  errorRowsCache.clear();
  reportVisible = null;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

describe("LLMErrorTable — loading vs empty", () => {
  it("shows loading, not the empty message, before the panel has queried", async () => {
    const wrapper = await mountTable();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="table-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="table-empty"]').exists()).toBe(false);
  });

  it("stays loading while there is no stream to query yet", async () => {
    const wrapper = await mountTable("");
    reportVisible!(true);
    await flushPromises();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="table-loading"]').exists()).toBe(true);
  });

  it("shows loading until the query returns, then the empty message for no rows", async () => {
    const q = Promise.withResolvers<unknown[]>();
    mockExecuteQuery.mockReturnValue(q.promise);
    const wrapper = await mountTable();

    reportVisible!(true);
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="table-loading"]').exists()).toBe(true);

    q.resolve([]);
    await flushPromises();
    expect(wrapper.find('[data-test="table-empty"]').text()).toBe(
      "traces.lLMErrorTable.noErrorsInRange",
    );
  });

  it("shows the rows when the query returns errors", async () => {
    mockExecuteQuery.mockResolvedValue([{ trace_id: "t1" }, { trace_id: "t2" }]);
    const wrapper = await mountTable();
    reportVisible!(true);
    await flushPromises();
    expect(wrapper.find('[data-test="table-rows"]').text()).toBe("2");
  });

  it("says the errors could not load when the query fails — never 'No errors'", async () => {
    mockExecuteQuery.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountTable();
    reportVisible!(true);
    await flushPromises();
    expect(wrapper.find('[data-test="table-empty"]').text()).toBe(
      "traces.lLMErrorTable.loadFailed",
    );
  });
});
