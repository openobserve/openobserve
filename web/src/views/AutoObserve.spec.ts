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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveIncidents.json";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import AutoObserveActivityTab from "@/components/autoobserve/AutoObserveActivityTab.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import LivePolicy from "@/components/autoobserve/detailed/LivePolicy.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import AutoObserve from "./AutoObserve.vue";

const routeQuery: Record<string, string> = {};
const replace = vi.fn();
const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace, push, back: vi.fn() }),
  useRoute: () => ({ query: routeQuery }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.mocked(autoobserve.incidents);
const pending = () => new Promise<never>(() => undefined);

const NOW = Date.UTC(2026, 10, 6, 12, 0);
const BASE = (fixture as unknown as AutoObserveIncidentList).items[0];

const item = (n: number, status: "open" | "resolved"): AutoObserveIncidentItem => ({
  ...BASE,
  finding: { ...BASE.finding, id: `f-${n}`, first_seen_at: NOW * 1000 - n },
  incident: { ...BASE.incident, id: `inc-${n}`, status, created_at: NOW * 1000 - n },
});

const originalOrg = store.state.selectedOrganization;

let wrappers: { unmount: () => void }[] = [];
const mountNerd = () => {
  const wrapper = mount(AutoObserve, {
    global: {
      plugins: [i18n, store],
      stubs: {
        LiveIssues: true,
        AutoObserveCoverageTab: true,
        AutoObserveActivityTab: true,
        LivePolicy: true,
        AllSuggestionsDrawer: true,
        HowItWorksDrawer: true,
        ViewSwitch: true,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const tabNames = (wrapper: ReturnType<typeof mountNerd>) =>
  wrapper
    .findAll('[data-test^="autoobserve-tab-"]')
    .map((tab) => tab.attributes("data-test")?.replace("autoobserve-tab-", ""))
    .filter((name) => !name?.endsWith("-badge"));

describe("AutoObserve Nerd view", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    replace.mockReset();
    push.mockReset();
    api.mockReset();
    api.mockReturnValue(pending());
    vi.mocked(autoobserve.coverage).mockReturnValue(pending());
    vi.mocked(autoobserve.suggestions).mockReturnValue(pending());
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "demo-org" });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    vi.useRealTimers();
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("keeps all four tabs and lists live issues", () => {
    const wrapper = mountNerd();
    expect(tabNames(wrapper)).toEqual(["issues", "coverage", "activity", "policy"]);
    const issues = wrapper.findComponent(LiveIssues);
    expect(issues.exists()).toBe(true);
    expect(issues.props("range")).toBe("30d");
  });

  it("is live whatever the query says: a fixture flag shows the same live tabs", () => {
    Object.assign(routeQuery, { fixture: "1", tab: "coverage" });
    const wrapper = mountNerd();
    const coverage = wrapper.findComponent(AutoObserveCoverageTab);
    expect(coverage.exists()).toBe(true);
    expect(coverage.props("source")).toBeDefined();
    expect(wrapper.text()).not.toContain("Sample scenarios");
  });

  it("Activity is the live ledger, and its empty action opens the suggestions by URL", async () => {
    Object.assign(routeQuery, { tab: "activity" });
    const wrapper = mountNerd();
    await flushPromises();
    expect(replace).not.toHaveBeenCalled();
    const ledger = wrapper.findComponent(AutoObserveActivityTab);
    expect(ledger.props("requests")).toEqual([]);
    expect(wrapper.find('[data-test="autoobserve-tab-activity-badge"]').exists()).toBe(false);
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(false);
    ledger.vm.$emit("see-suggestions");
    await flushPromises();
    expect(push).toHaveBeenCalledWith({
      query: expect.objectContaining({ drawer: "suggestions" }),
    });
  });

  it("Policy is the live policy page, and How it works opens by URL", async () => {
    Object.assign(routeQuery, { tab: "policy" });
    const wrapper = mountNerd();
    await flushPromises();
    wrapper.findComponent(LivePolicy).vm.$emit("how-it-works");
    await flushPromises();
    expect(push).toHaveBeenCalledWith({ query: expect.objectContaining({ drawer: "howItWorks" }) });
  });

  it("a shared drawer link opens it, and closing drops it by replace, so Back never reopens it", async () => {
    for (const [name, comp] of [
      ["howItWorks", HowItWorksDrawer],
      ["suggestions", AllSuggestionsDrawer],
    ] as const) {
      for (const key of Object.keys(routeQuery)) delete routeQuery[key];
      Object.assign(routeQuery, { tab: "policy", drawer: name });
      const wrapper = mountNerd();
      const drawer = wrapper.findComponent(comp);
      expect(drawer.props("open"), name).toBe(true);
      drawer.vm.$emit("update:open", false);
      await flushPromises();
      const query = replace.mock.calls.at(-1)?.[0].query;
      expect(query.drawer, name).toBeUndefined();
      expect(query.tab, name).toBe("policy");
    }
  });

  it("an unknown drawer value opens nothing", () => {
    Object.assign(routeQuery, { drawer: "problem", issue: "INC-1051" });
    const wrapper = mountNerd();
    expect(wrapper.findComponent(HowItWorksDrawer).props("open")).toBe(false);
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(false);
  });

  it("the Issues badge counts open live rows, with a plus when more exist", async () => {
    // Page one holds 100 open rows; four resolved pages reach the cap while the server has more.
    api.mockImplementation(
      async (_org, { offset }) =>
        ({
          data: {
            paging: true,
            has_more: true,
            items: Array.from({ length: 100 }, (_, i) =>
              item(offset + i, offset === 0 ? "open" : "resolved"),
            ),
          },
        }) as never,
    );
    const wrapper = mountNerd();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(5));
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve-tab-issues-badge"]').text()).toBe("100+");
  });

  it("no badge when nothing is open", async () => {
    api.mockResolvedValue({ data: { paging: true, has_more: false, items: [] } } as never);
    const wrapper = mountNerd();
    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve-tab-issues-badge"]').exists()).toBe(false);
  });

  it("a picked tab is kept in the URL, so reload and Back return to it", async () => {
    const wrapper = mountNerd();
    await flushPromises();
    await wrapper.find('[data-test="autoobserve-tab-coverage"]').trigger("mousedown");
    await flushPromises();
    expect(replace).toHaveBeenCalledWith({ query: expect.objectContaining({ tab: "coverage" }) });
  });
});
