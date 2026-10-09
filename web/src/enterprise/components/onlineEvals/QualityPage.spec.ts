// @vitest-environment jsdom
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { onlineEvalKeys } from "@/services/online-evals.service.querykeys";
import type { QualityConfigSummary } from "@/services/online-evals.service";

const { list, failedRuns, route, push, replace, back } = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return {
    list: vi.fn(),
    failedRuns: vi.fn(),
    route: reactive({ name: "aiEvaluations", query: {} as Record<string, string> }),
    push: vi.fn(() => Promise.resolve()),
    replace: vi.fn(() => Promise.resolve()),
    back: vi.fn(),
  };
});

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, quality: { list, scores: vi.fn(), failedRuns } },
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => route,
  // A string resolves like the router does for history.state.back; only name and query matter here.
  useRouter: () => ({
    push,
    replace,
    back,
    resolve: (to: string) => {
      const url = new URL(to, "http://o2.test");
      return { name: "aiEvaluations", query: Object.fromEntries(url.searchParams) };
    },
  }),
}));

import QualityPage from "./QualityPage.vue";

const TableStub = defineComponent({
  name: "QualityConfigsTable",
  props: ["rows", "tiles", "failedRuns"],
  emits: ["open"],
  template: `<div data-test="table-stub">{{ rows.length }} rows</div>`,
});
const DetailStub = defineComponent({
  name: "QualityConfigDetail",
  props: ["configId", "row", "scope", "only", "initialPage", "initialScoreId"],
  emits: ["back", "position"],
  template: `<div data-test="detail-stub">{{ configId }} {{ row?.name }} {{ scope }} {{ only }}</div>`,
});

const LIST: QualityConfigSummary[] = [
  {
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
  },
  {
    configId: "sen",
    name: "sentiment",
    dataType: "categorical",
    status: "unset",
    total: 30,
    unhealthy: null,
    average: null,
    lastScoredAt: 1,
    scopeCounts: { span: 0, trace: 0, session: 30 },
    topValue: { key: "neutral", count: 16 },
  },
];

const TOX_CONFIG = {
  id: "row-1",
  entityId: "tox",
  name: "toxicity",
  version: 2,
  dataType: "categorical" as const,
  description: "Toxicity level of the response.",
  healthyThreshold: { healthy_categories: ["low"] },
};

function mountPage(
  dateWindow = { startUs: 1_000_000_000, endUs: 2_000_000_000 },
  scoreConfigs: any[] = [],
) {
  return mount(QualityPage, {
    props: {
      scoreConfigs,
      configsLoading: false,
      dateWindow,
      agentParams: {},
      evaluatorAgents: null,
      enabled: true,
    },
    global: {
      plugins: [store],
      stubs: { QualityConfigsTable: TableStub, QualityConfigDetail: DetailStub },
    },
    slots: {
      "header-actions": '<span data-test="header-actions-slot" />',
      filters: '<span data-test="filters-slot" />',
    },
  });
}

describe("QualityPage", () => {
  beforeEach(() => {
    route.query = {};
    list.mockReset().mockResolvedValue(LIST);
    failedRuns.mockReset().mockResolvedValue(0);
    push.mockClear();
    replace.mockClear();
    back.mockClear();
  });

  it("shows the configs table without ?config", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-test="table-stub"]').text()).toBe("2 rows");
    expect(wrapper.find('[data-test="detail-stub"]').exists()).toBe(false);
  });

  it("shows the detail of the entity id, scope and filter in the URL", async () => {
    route.query = { tab: "quality", config: "tox", scope: "trace", only: "unhealthy" };
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-test="detail-stub"]').text()).toBe("tox toxicity trace unhealthy");
    expect(wrapper.find('[data-test="table-stub"]').exists()).toBe(false);
  });

  it("titles the list with the module, with the shared header actions and filters", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-test="quality-page-title"]').text()).toBe("Quality");
    expect(wrapper.find('[data-test="quality-detail-back"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-detail-edit-config"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="header-actions-slot"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="filters-slot"]').exists()).toBe(true);
  });

  it("turns the page header into the detail header: back, name, description, tags, Edit config", async () => {
    route.query = { tab: "quality", config: "tox" };
    const wrapper = mountPage(undefined, [TOX_CONFIG]);
    await flushPromises();
    expect(wrapper.find('[data-test="quality-page-title"]').text()).toBe("toxicity");
    expect(wrapper.text()).toContain("Toxicity level of the response.");
    const tags = wrapper.find('[data-test="quality-detail-tags"]');
    expect(tags.findAllComponents({ name: "OTag" }).map((tag) => tag.text())).toEqual([
      "Categorical",
      "v2",
    ]);
    expect(wrapper.find('[data-test="quality-detail-switcher"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="header-actions-slot"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="filters-slot"]').exists()).toBe(true);

    // Opened from a link, the header's back button replaces the URL with the list.
    await wrapper.find('[data-test="quality-detail-back"]').trigger("click");
    expect(replace).toHaveBeenCalledWith({ name: "aiEvaluations", query: { tab: "quality" } });
  });

  it("puts the scope toggle with counts in the filter row, and hides it for a single scope", async () => {
    route.query = { tab: "quality", config: "tox" };
    const wrapper = mountPage();
    await flushPromises();
    const toggle = wrapper.find(
      '[data-test="quality-scope-bar"] [data-test="quality-detail-scope"]',
    );
    expect(toggle.text()).toMatch(/All\s*114/);
    expect(toggle.text()).toMatch(/Span\s*77/);
    expect(toggle.text()).toMatch(/Trace\s*37/);
    expect(toggle.text()).not.toContain("Session");
    await wrapper.find('[data-test="quality-detail-scope-trace"]').trigger("click");
    expect(replace).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { tab: "quality", config: "tox", scope: "trace" },
    });

    route.query = { tab: "quality", config: "sen" };
    await flushPromises();
    expect(wrapper.find('[data-test="quality-detail-scope"]').exists()).toBe(false);
  });

  it("ignores URL values the controls cannot show", async () => {
    route.query = { tab: "quality", config: "sen", scope: "trace", only: "unhealthy" };
    const wrapper = mountPage();
    await flushPromises();
    // sentiment has no threshold and only session scores.
    expect(wrapper.find('[data-test="detail-stub"]').text()).toBe("sen sentiment all all");
  });

  it("goes back through history when the entry before is the list, and replaces the URL after a deep link", async () => {
    route.query = { tab: "quality" };
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent(TableStub).vm.$emit("open", { configId: "tox" }, "all");
    // What vue-router records for the pushed entry; it survives a round trip through a link.
    window.history.replaceState({ back: "/ai/evaluations?tab=quality" }, "");
    route.query = { tab: "quality", config: "tox", page: "2", score: "s12" };
    await flushPromises();
    wrapper.findComponent(DetailStub).vm.$emit("back");
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();

    window.history.replaceState({ back: "/ai/evaluations?tab=jobs" }, "");
    route.query = { tab: "quality", config: "tox", scope: "span", page: "2", score: "s12" };
    const linked = mountPage();
    await flushPromises();
    linked.findComponent(DetailStub).vm.$emit("back");
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({ name: "aiEvaluations", query: { tab: "quality" } });
    window.history.replaceState(null, "");
  });

  it("round-trips the scores page and the selected score through the URL with replace", async () => {
    route.query = { tab: "quality", config: "tox", page: "3", score: "s27" };
    const wrapper = mountPage();
    await flushPromises();
    const detail = wrapper.findComponent(DetailStub);
    expect(detail.props("initialPage")).toBe(2);
    expect(detail.props("initialScoreId")).toBe("s27");

    detail.vm.$emit("position", { page: 2, scoreId: "s27" });
    expect(replace).not.toHaveBeenCalled();
    detail.vm.$emit("position", { page: 3, scoreId: "s30" });
    expect(replace).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { tab: "quality", config: "tox", page: "4", score: "s30" },
    });
    detail.vm.$emit("position", { page: 0, scoreId: null });
    expect(replace).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { tab: "quality", config: "tox" },
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps both keys when a scope change and the reset position land in one tick", async () => {
    route.query = { tab: "quality", config: "tox", page: "3", score: "s27" };
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-test="quality-detail-scope-trace"]').trigger("click");
    wrapper.findComponent(DetailStub).vm.$emit("position", { page: 0, scoreId: "t1" });
    expect(replace).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { tab: "quality", config: "tox", scope: "trace", score: "t1" },
    });
  });

  it("opens the Score Config editor in the same tab", async () => {
    route.query = { tab: "quality", config: "tox" };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-test="quality-detail-edit-config"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { org_identifier: "default", tab: "scoreConfigs", action: "update", id: "tox" },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves the status and the healthy rule to the score pane, with or without a threshold", async () => {
    for (const config of ["tox", "sen"]) {
      route.query = { tab: "quality", config };
      const wrapper = mountPage(undefined, [TOX_CONFIG]);
      await flushPromises();
      const tags = wrapper.find('[data-test="quality-detail-tags"]').text();
      expect(tags).not.toMatch(/Needs attention|Threshold not set|Healthy if|No healthy threshold/);
      expect(wrapper.find('[data-test="quality-detail-rule"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="quality-detail-set-threshold"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="quality-detail-edit-config"]').exists()).toBe(true);
      wrapper.unmount();
    }
  });

  it("puts the opened config and its filter in the URL", async () => {
    route.query = { tab: "quality", scope: "span" };
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent(TableStub).vm.$emit("open", { configId: "tox" }, "unhealthy");
    expect(push).toHaveBeenCalledWith({
      name: "aiEvaluations",
      query: { tab: "quality", config: "tox", only: "unhealthy" },
    });
  });

  it("reads the cache on remount and only a forced refetch reaches the server again", async () => {
    mountPage().unmount();
    await flushPromises();
    mountPage();
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
    expect(failedRuns).toHaveBeenCalledTimes(1);

    // The Refresh in OnlineEvals forces every active read under this scope.
    await queryClient.refetchQueries(
      { queryKey: onlineEvalKeys.quality("default"), type: "active" },
      { cancelRefetch: false },
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(failedRuns).toHaveBeenCalledTimes(2);
  });

  it("reads a moved window with its own times", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.setProps({ dateWindow: { startUs: 5_000_000_000, endUs: 9_000_000_000 } });
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith("default", {
      start_time: 5_000_000_000,
      end_time: 9_000_000_000,
    });
  });

  it("reports the oldest data time of the reads on screen", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const status = wrapper.emitted("status")?.at(-1)?.[0] as {
      updatedAt: number;
      fetching: boolean;
    };
    expect(status.fetching).toBe(false);
    expect(status.updatedAt).toBeGreaterThan(0);
  });
});
