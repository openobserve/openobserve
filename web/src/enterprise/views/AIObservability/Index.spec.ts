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
//
// @vitest-environment jsdom
//

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, type Component, type SetupContext } from "vue";

let mockIsEnterprise = "false";
let mockIsCloud = "false";
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return mockIsEnterprise;
    },
    get isCloud() {
      return mockIsCloud;
    },
  },
}));

const mockState = reactive<{
  selectedOrganization: { identifier: string };
  zoConfig: Record<string, unknown>;
}>({ selectedOrganization: { identifier: "test-org" }, zoConfig: {} });
vi.mock("vuex", () => ({
  useStore: () => ({ state: mockState }),
}));

const mockRoute = reactive<{ name: string; query: Record<string, string>; meta: object }>({
  name: "aiLLMInsights",
  query: {},
  meta: {},
});
const mockPush = vi.fn(() => Promise.resolve());
vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const SectionRailStub = {
  props: ["groups", "activeKey", "title", "icon", "collapsible", "collapsed"],
  // Rendered item keys, because findComponent loses this stub once the page swaps out.
  template:
    '<div class="section-rail"><template v-for="g in groups" :key="g.label"><i v-for="item in g.items" :key="item.key" :data-rail-item="item.key" /></template><slot name="footer" :collapsed="collapsed" /></div>',
};

const OTabsStub = {
  name: "OTabs",
  props: ["modelValue", "align"],
  emits: ["change"],
  template: '<div data-test="tabs-stub"><slot /></div>',
};

const OTabStub = {
  props: ["name", "label", "icon", "suffixIcon"],
  template: '<b :data-tab="name" :data-suffix="suffixIcon" />',
};

async function mountShell() {
  // Imported per test, after vi.resetModules, so each mount reads that test's edition flags.
  const Index = (await import("./Index.vue")).default;
  // The routed page draws the tabs the shell provides, under its title.
  const AiSectionTabs = (await import("@/enterprise/components/AIObservability/AiSectionTabs.vue"))
    .default;
  return mount(Index, {
    global: {
      stubs: {
        SectionRail: SectionRailStub,
        OTabs: OTabsStub,
        OTab: OTabStub,
        OPageLayout: { template: '<div><slot name="sidebar" /><slot /></div>' },
        OEmptyState: { template: "<div />" },
        OnlineEvalsDisabled: { template: '<div data-test="online-evals-disabled" />' },
        RouterView: {
          components: { AiSectionTabs },
          template: '<div data-test="router-view"><AiSectionTabs /></div>',
        },
      },
    },
  });
}

type Shell = VueWrapper;

interface RailItem {
  key: string;
  to: { name?: string; query?: Record<string, string> };
  locked?: boolean;
  lockedMessage?: unknown;
}

function groupsOf(wrapper: Shell) {
  return wrapper.findComponent(SectionRailStub).props("groups") as Array<{
    label: string;
    items: RailItem[];
  }>;
}

function itemsOf(wrapper: Shell) {
  return groupsOf(wrapper).flatMap((g) => g.items);
}

function item(wrapper: Shell, key: string) {
  return itemsOf(wrapper).find((i) => i.key === key)!;
}

function tabsOf(wrapper: Shell) {
  return wrapper.findAll("[data-tab]").map((tab) => tab.attributes("data-tab"));
}

function activeTabOf(wrapper: Shell) {
  return wrapper.findComponent(OTabsStub).props("modelValue");
}

const ALL_GROUP_LABELS = [
  "aiObservability.sections.monitor",
  "aiObservability.sections.evaluate",
  "aiObservability.sections.annotate",
];

const MONITOR_KEYS = ["llmInsights", "sessions", "costUsage", "agents"];

// Group order (`sectionGroupOrder`), not AI_OBSERVABILITY_SECTIONS's flat order; Playground sits outside the groups.
const ALL_ITEM_KEYS = [
  ...MONITOR_KEYS,
  "evaluations",
  "experiments",
  "scorers",
  "prompts",
  "discovery",
  "queues",
  "datasets",
];

// Listed in the rail foot's Tools menu, not as a group.
const CONFIGURE_KEYS = ["llmProviders", "agentMapping"];

function configureItemsOf(wrapper: Shell) {
  return (wrapper.vm as any).$.setupState.configureItems as Array<{ key: string; to: any }>;
}

// The first import transforms the shell's whole import graph; pay for it once, outside a test's timeout.
beforeAll(() => import("./Index.vue"), 30_000);

beforeEach(() => {
  vi.resetModules();
  mockPush.mockClear();
  mockIsEnterprise = "false";
  mockIsCloud = "false";
  mockState.zoConfig = {};
  mockRoute.name = "aiLLMInsights";
  mockRoute.query = {};
  mockRoute.meta = {};
});

describe("AIObservabilityShell — OSS builds (isEnterprise and isCloud both false)", () => {
  // Configure is the exception: Settings listed those pages only with evaluations on, OSS included.
  it("shows every other group and item — nothing is hidden", async () => {
    const wrapper = await mountShell();
    expect(groupsOf(wrapper).map((g) => g.label)).toEqual(ALL_GROUP_LABELS);
    expect(itemsOf(wrapper).map((i) => i.key)).toEqual(ALL_ITEM_KEYS);
  });

  it("leaves the sections OSS serves for real unlocked", async () => {
    const wrapper = await mountShell();
    for (const key of ["llmInsights", "sessions", "costUsage"]) {
      expect(item(wrapper, key).locked, key).toBeFalsy();
    }
  });

  it("locks every other item with a message, instead of hiding it", async () => {
    const wrapper = await mountShell();
    for (const key of [
      "agents",
      "evaluations",
      "scorers",
      "prompts",
      "experiments",
      "discovery",
      "queues",
      "datasets",
    ]) {
      expect(item(wrapper, key).locked, `${key} should be locked on a true OSS build`).toBe(true);
      expect(item(wrapper, key).lockedMessage, `${key} should carry a lockedMessage`).toBeTruthy();
    }
  });

  it("points each tabbed item at its first tab's route", async () => {
    const wrapper = await mountShell();
    expect(item(wrapper, "llmInsights").to.name).toBe("aiLLMInsights");
    expect(item(wrapper, "costUsage").to.name).toBe("aiUsers");
    expect(item(wrapper, "agents").to.name).toBe("aiAgentGraph");
    expect(item(wrapper, "prompts").to.name).toBe("aiPrompts");
    expect(item(wrapper, "experiments").to.name).toBe("aiExperiments");
    expect(item(wrapper, "evaluations").to).toEqual({
      name: "aiEvaluations",
      query: { org_identifier: "test-org", tab: "quality" },
    });
    expect(item(wrapper, "scorers").to).toEqual({
      name: "aiEvaluations",
      query: { org_identifier: "test-org", tab: "scorers" },
    });
  });

  it("sends a locked tab to the enterprise features page, not its route", async () => {
    mockRoute.name = "aiEvaluations";
    mockRoute.query = { tab: "quality" };
    const wrapper = await mountShell();
    expect(wrapper.find('[data-tab="jobs"]').attributes("data-suffix")).toBe("lock");
    wrapper.findComponent(OTabsStub).vm.$emit("change", "jobs");
    expect(mockPush).toHaveBeenCalledWith({ name: "enterpriseFeatures" });
  });
});

describe("AIObservabilityShell — enterprise/cloud builds with online evaluations on", () => {
  beforeEach(() => {
    mockState.zoConfig = { version: "v1", online_evals_enabled: true };
  });

  it("shows every group and every item, all unlocked, when isEnterprise is true", async () => {
    mockIsEnterprise = "true";
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups.map((g) => g.label)).toEqual(ALL_GROUP_LABELS);
    expect(groups[0].items.map((i) => i.key)).toEqual(MONITOR_KEYS);
    expect(itemsOf(wrapper).map((i) => i.key)).toEqual(ALL_ITEM_KEYS);
    expect(configureItemsOf(wrapper).map((i) => i.key)).toEqual(CONFIGURE_KEYS);
    expect(wrapper.find('[data-test="ai-rail-tools"]').exists()).toBe(true);
    expect(itemsOf(wrapper).every((i) => !i.locked)).toBe(true);
  });

  it("shows every group and every item, all unlocked, when isCloud is true, even with isEnterprise false", async () => {
    mockIsCloud = "true";
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups).toHaveLength(3);
    expect(groups[0].items.map((i) => i.key)).toEqual(MONITOR_KEYS);
    expect(itemsOf(wrapper).every((i) => !i.locked)).toBe(true);
  });

  it("renders the page on an evaluation route", async () => {
    mockIsEnterprise = "true";
    mockRoute.name = "aiDatasets";
    mockRoute.meta = { requiresOnlineEvals: true };
    const wrapper = await mountShell();
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="online-evals-disabled"]').exists()).toBe(false);
  });

  it("lights Tools on a Configure page, kept under its Settings route name", async () => {
    mockIsEnterprise = "true";
    mockRoute.name = "genAiAgentMapping";
    const wrapper = await mountShell();
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe("agentMapping");
    expect(configureItemsOf(wrapper).find((i) => i.key === "agentMapping")!.to.name).toBe(
      "genAiAgentMapping",
    );
    expect((wrapper.vm as any).$.setupState.configureActive).toBe(true);
  });

  it("pins Playground to the rail's foot and lights it on its page", async () => {
    mockIsEnterprise = "true";
    mockRoute.name = "aiPlayground";
    const wrapper = await mountShell();
    expect(itemsOf(wrapper).map((i) => i.key)).not.toContain("playground");
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe("playground");
    expect(wrapper.find('[data-test="ai-section-tabs"]').exists()).toBe(false);
    const button = wrapper.find('[data-test="ai-secondary-nav-playground"]');
    expect(button.attributes("aria-current")).toBe("page");
    mockPush.mockClear();
    await button.trigger("click");
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ name: "aiPlayground" }));
  });
});

describe("AIObservabilityShell — tabs of a rail item", () => {
  beforeEach(() => {
    mockIsEnterprise = "true";
    mockState.zoConfig = { version: "v1", online_evals_enabled: true };
  });

  it.each([
    ["aiAgentBehavior", {}, "agents", "agentBehavior", ["agentGraph", "agentBehavior"]],
    ["aiBudgets", {}, "costUsage", "budgets", ["users", "budgets"]],
    ["aiRemoteTaskDetail", {}, "experiments", "remoteTasks", ["experiments", "remoteTasks"]],
    ["aiEvaluations", { tab: "scorers" }, "scorers", "scorers", ["scorers", "scoreConfigs"]],
    [
      "aiEvaluations",
      { tab: "scoreConfigs" },
      "scorers",
      "scoreConfigs",
      ["scorers", "scoreConfigs"],
    ],
    ["aiEvaluations", {}, "evaluations", "quality", ["quality", "jobs"]],
  ])("on %s %o lights rail item %s and tab %s", async (name, query, railKey, tab, tabs) => {
    mockRoute.name = name;
    mockRoute.query = query as Record<string, string>;
    const wrapper = await mountShell();
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe(railKey);
    expect(tabsOf(wrapper)).toEqual(tabs);
    expect(activeTabOf(wrapper)).toBe(tab);
  });

  // Every tab of a rail item carries that item's header, as Alerts keeps "Alerts".
  it.each(["aiUsers", "aiBudgets"])("keeps Cost & Usage's header on %s", async (name) => {
    mockRoute.name = name;
    const wrapper = await mountShell();
    expect((wrapper.vm as any).$.setupState.activeItemHeader).toEqual({
      title: "aiObservability.nav.costUsage",
      subtitle: "aiObservability.itemSubtitle.costUsage",
      icon: "paid",
    });
  });

  it("draws no tab strip for a rail item of its own", async () => {
    mockRoute.name = "aiQueueDetail";
    const wrapper = await mountShell();
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe("queues");
    expect(wrapper.find('[data-test="ai-section-tabs"]').exists()).toBe(false);
  });

  it("opens another tab on its own route, keeping the org", async () => {
    mockRoute.name = "aiEvaluations";
    mockRoute.query = { tab: "scorers" };
    const wrapper = await mountShell();
    wrapper.findComponent(OTabsStub).vm.$emit("change", "scoreConfigs");
    expect(mockPush).toHaveBeenCalledWith({
      name: "aiEvaluations",
      query: { org_identifier: "test-org", tab: "scoreConfigs" },
    });
  });

  it("does not navigate when the active tab is picked again", async () => {
    mockRoute.name = "aiAgentGraph";
    const wrapper = await mountShell();
    wrapper.findComponent(OTabsStub).vm.$emit("change", "agentGraph");
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// O2_EVAL_ENABLED=false: evaluation sections leave the rail and deep links show the disabled state.
describe("AIObservabilityShell — enterprise/cloud builds with online evaluations off", () => {
  beforeEach(() => {
    mockIsEnterprise = "true";
    mockState.zoConfig = { version: "v1", online_evals_enabled: false };
  });

  it("lists only Monitor and Prompts — the sections whose APIs do not need evaluations", async () => {
    const wrapper = await mountShell();
    expect(groupsOf(wrapper).map((g) => g.label)).toEqual([
      "aiObservability.sections.monitor",
      "aiObservability.sections.evaluate",
    ]);
    expect(itemsOf(wrapper).map((i) => i.key)).toEqual([...MONITOR_KEYS, "prompts"]);
  });

  it("drops the Playground button, leaving Prompts as it is", async () => {
    mockRoute.name = "aiPrompts";
    const wrapper = await mountShell();
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe("prompts");
    expect(wrapper.find('[data-test="ai-secondary-nav-playground"]').exists()).toBe(false);
  });

  it("renders the disabled state instead of the page on a deep link to an evaluation route", async () => {
    mockRoute.name = "aiEvaluations";
    mockRoute.query = { tab: "scorers" };
    mockRoute.meta = { requiresOnlineEvals: true };
    const wrapper = await mountShell();
    expect(wrapper.find('[data-test="online-evals-disabled"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(false);
    // The rail item stays lit even though the rail no longer lists it.
    expect(wrapper.findComponent(SectionRailStub).props("activeKey")).toBe("scorers");
  });

  it("swaps the page for the disabled state and drops the sections when /config turns evaluations off", async () => {
    mockState.zoConfig = { version: "v1", online_evals_enabled: true };
    mockRoute.name = "aiExperiments";
    mockRoute.meta = { requiresOnlineEvals: true };
    const wrapper = await mountShell();
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-rail-item="experiments"]').exists()).toBe(true);
    expect(tabsOf(wrapper)).toEqual(["experiments", "remoteTasks"]);

    mockState.zoConfig = { version: "v1", online_evals_enabled: false };
    await nextTick();
    expect(wrapper.find('[data-test="online-evals-disabled"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-rail-item="prompts"]').exists()).toBe(true);
    expect(wrapper.find('[data-rail-item="experiments"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-section-tabs"]').exists()).toBe(false);
  });

  it("keeps every section, locked, on OSS — the edition gate applies there, not the flag", async () => {
    mockIsEnterprise = "false";
    const wrapper = await mountShell();
    expect(itemsOf(wrapper).map((i) => i.key)).toEqual(ALL_ITEM_KEYS);
  });
});

describe("AIObservabilityShell — Explain questions from the routed page", () => {
  async function mountWithPage(page: Component) {
    // Imported per test like mountShell, after vi.resetModules.
    const Index = (await import("./Index.vue")).default;
    return mount(Index, {
      global: {
        stubs: {
          SectionRail: SectionRailStub,
          OPageLayout: { template: '<div><slot name="sidebar" /><slot /></div>' },
          RouterView: {
            setup:
              (_: unknown, { slots }: SetupContext) =>
              () =>
                slots.default?.({ Component: h(page) }),
          },
        },
      },
    });
  }

  it("forwards a page's question to the main layout", async () => {
    const AskingPage = defineComponent({
      emits: ["sendToAiChat"],
      template: `<button data-test="ask" @click="$emit('sendToAiChat', 'why?', true)" />`,
    });
    const wrapper = await mountWithPage(AskingPage);
    await wrapper.find('[data-test="ask"]').trigger("click");
    expect(wrapper.emitted("sendToAiChat")).toEqual([["why?", true]]);
  });

  it("passes no listener to a fragment-root page that does not ask, so Vue does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const FragmentPage = defineComponent({ template: "<i data-test='a' /><i />" });
    const wrapper = await mountWithPage(FragmentPage);
    expect(wrapper.find('[data-test="a"]').exists()).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Extraneous non-emits event listeners/);
    warn.mockRestore();
  });
});
