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
import AutoObserveIssuesTab from "@/components/autoobserve/AutoObserveIssuesTab.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import AutoObserveActivityTab from "@/components/autoobserve/AutoObserveActivityTab.vue";
import AutoObservePolicyTab from "@/components/autoobserve/AutoObservePolicyTab.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import AutoObserve from "./AutoObserve.vue";

const routeQuery: Record<string, string> = {};
const replace = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
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
        AutoObserveIssuesTab: true,
        AutoObserveCoverageTab: true,
        AutoObserveActivityTab: true,
        AutoObservePolicyTab: true,
        AutoObserveIssueDrawer: true,
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

  it("live mode keeps all four tabs and lists live issues, never the fixture table", () => {
    const wrapper = mountNerd();
    expect(tabNames(wrapper)).toEqual(["issues", "coverage", "activity", "policy"]);
    const issues = wrapper.findComponent(LiveIssues);
    expect(issues.exists()).toBe(true);
    expect(issues.props("range")).toBe("30d");
    expect(wrapper.findComponent(AutoObserveIssuesTab).exists()).toBe(false);
    expect(wrapper.findComponent(AutoObserveIssueDrawer).props("open")).toBe(false);
  });

  it("live Activity is an honest empty state whose action opens the suggestions", async () => {
    Object.assign(routeQuery, { tab: "activity" });
    const wrapper = mountNerd();
    await flushPromises();
    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.findComponent(AutoObserveActivityTab).exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve-tab-activity"]').text()).not.toMatch(/\d/);
    const empty = wrapper.find('[data-test="autoobserve-live-empty-changes"]');
    expect(empty.text()).toContain("No changes yet");
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(false);
    await wrapper.find('[data-test="autoobserve-live-empty-changes-action"]').trigger("click");
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(true);
  });

  it("live Policy is an honest empty state whose action opens How it works", async () => {
    Object.assign(routeQuery, { tab: "policy" });
    const wrapper = mountNerd();
    await flushPromises();
    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.findComponent(AutoObservePolicyTab).exists()).toBe(false);
    const empty = wrapper.find('[data-test="autoobserve-live-empty-settings"]');
    expect(empty.text()).toContain("Nothing to set here yet");
    await wrapper.find('[data-test="autoobserve-live-empty-settings-action"]').trigger("click");
    expect(wrapper.findComponent(HowItWorksDrawer).props("open")).toBe(true);
  });

  it("a fixture issue link is dropped in live mode", async () => {
    Object.assign(routeQuery, { issue: "INC-1051" });
    const wrapper = mountNerd();
    await flushPromises();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0].query.issue).toBeUndefined();
    const drawer = wrapper.findComponent(AutoObserveIssueDrawer);
    expect(drawer.props("open")).toBe(false);
    expect(drawer.props("issue")).toBeNull();
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

  it("fixture=1 in a test build keeps the four fixture tabs and table", () => {
    Object.assign(routeQuery, { fixture: "1" });
    const wrapper = mountNerd();
    expect(tabNames(wrapper)).toEqual(["issues", "coverage", "activity", "policy"]);
    expect(wrapper.findComponent(AutoObserveIssuesTab).exists()).toBe(true);
    expect(wrapper.findComponent(LiveIssues).exists()).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it("fixture=1 keeps the fixture Activity and Policy tabs", () => {
    for (const tab of ["activity", "policy"]) {
      Object.assign(routeQuery, { fixture: "1", tab });
      const wrapper = mountNerd();
      const fixtureTab = tab === "activity" ? AutoObserveActivityTab : AutoObservePolicyTab;
      expect(wrapper.findComponent(fixtureTab).exists(), tab).toBe(true);
      expect(wrapper.find('[data-test^="autoobserve-live-empty-"]').exists(), tab).toBe(false);
    }
  });

  it("a picked tab is kept in the URL, so reload and Back return to it", async () => {
    const wrapper = mountNerd();
    await flushPromises();
    await wrapper.find('[data-test="autoobserve-tab-coverage"]').trigger("mousedown");
    await flushPromises();
    expect(replace).toHaveBeenCalledWith({ query: expect.objectContaining({ tab: "coverage" }) });
  });
});
