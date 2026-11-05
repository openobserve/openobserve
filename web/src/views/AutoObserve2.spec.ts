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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve from "@/services/autoobserve";
import { SCENARIOS, problemsIn } from "@/components/autoobserve/data/facts";
import { scenarioData } from "@/components/autoobserve/v2/fixtures";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import { MAIN_PAGED_CAP } from "@/components/autoobserve/live/incidentsCopy";
import ThisWeek from "@/components/autoobserve/v2/ThisWeek.vue";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import AutoObserve2 from "./AutoObserve2.vue";

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

const pending = () => new Promise<never>(() => undefined);

// A fixture scenario with no suggestions of its own, so only live mode can hold the rail open.
const quiet = SCENARIOS.find(
  (s) => scenarioData(s).requests.filter((r) => r.kind !== "fixNow").length === 0,
);

const mountView = () =>
  shallowMount(AutoObserve2, {
    global: { plugins: [i18n, store] },
  });

describe("AutoObserve2 rail column (OSS-9)", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    replace.mockReset();
    localStorage.setItem("autoobserve2.howItWorksSeen", "1");
    vi.mocked(autoobserve.coverage).mockReturnValue(pending());
    vi.mocked(autoobserve.suggestions).mockReturnValue(pending());
    vi.mocked(autoobserve.incidents).mockReset();
    vi.mocked(autoobserve.incidents).mockReturnValue(pending());
  });

  it("has a fixture scenario with no suggestions to test against", () => {
    expect(quiet).toBeDefined();
  });

  it("holds the rail's column from first paint in live mode, before anything loads", () => {
    Object.assign(routeQuery, { live: "1", scenario: quiet ?? "" });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-rail"]').exists()).toBe(true);
    expect(wrapper.html()).toContain("@min-[60rem]:grid-cols-[minmax(0,44rem)_20rem]");
  });

  it("keeps the single column in fixture mode when there is nothing to suggest", () => {
    Object.assign(routeQuery, { scenario: quiet ?? "" });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-rail"]').exists()).toBe(false);
  });

  it("live mode shows the paged findings card in the main column, not the fixture", () => {
    for (const scenario of SCENARIOS) {
      Object.assign(routeQuery, { live: "1", scenario });
      const wrapper = mountView();
      const paged = wrapper.findComponent(LivePaged);
      expect(paged.exists(), scenario).toBe(true);
      expect(paged.props("cap")).toBe(MAIN_PAGED_CAP);
      expect(MAIN_PAGED_CAP).toBe(10);
      expect(paged.classes()).toContain("order-1");
      expect(wrapper.findComponent(ThisWeek).exists()).toBe(false);
      const rail = wrapper.find('[data-test="autoobserve2-rail-scroll"]');
      expect(rail.element.contains(paged.element)).toBe(false);
      expect(Array.from(rail.element.children)).toEqual([
        wrapper.findComponent(LiveSuggestions).element,
      ]);
      wrapper.unmount();
    }
  });

  it("fixture mode is unchanged", () => {
    Object.assign(routeQuery, { scenario: SCENARIOS[0] });
    const wrapper = mountView();
    expect(wrapper.findComponent(ThisWeek).exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(true);
    expect(wrapper.findComponent(LivePaged).exists()).toBe(false);
    expect(wrapper.findComponent(TopBar).props("live")).toBe(false);
    expect(wrapper.findComponent(PageFooter).props("live")).toBe(false);
  });

  it("live mode hides the fixture-only controls", () => {
    Object.assign(routeQuery, { live: "1", scenario: SCENARIOS[0] });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(false);
    const bar = wrapper.findComponent(TopBar);
    expect(bar.props("live")).toBe(true);
    expect(bar.props("checked")).toEqual({ kind: "loading" });
    expect(wrapper.findComponent(PageFooter).props("live")).toBe(true);
    const footer = mount(PageFooter, { props: { live: true }, global: { plugins: [i18n] } });
    expect(footer.find('[data-test="autoobserve2-footer-activity"]').exists()).toBe(false);
    expect(footer.find('[data-test="autoobserve2-footer-coverage"]').exists()).toBe(true);
  });

  it("a fixture problem drawer in the URL is dropped in live mode", async () => {
    const scenario = SCENARIOS.find((s) => problemsIn(s, "quarter").length) ?? SCENARIOS[0];
    const problem = problemsIn(scenario, "quarter")[0].id;
    Object.assign(routeQuery, { live: "1", scenario, drawer: "problem", problem });
    const wrapper = mountView();
    await flushPromises();
    expect(replace).toHaveBeenCalledTimes(1);
    const query = replace.mock.calls[0][0].query;
    expect(query.drawer).toBeUndefined();
    expect(query.problem).toBeUndefined();
    expect(query.live).toBe("1");
    expect(wrapper.findComponent(AutoObserveIssueDrawer).props("open")).toBe(false);

    wrapper.unmount();
    replace.mockReset();
    delete routeQuery.live;
    const fixtureView = mountView();
    await flushPromises();
    expect(fixtureView.findComponent(AutoObserveIssueDrawer).props("open")).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("the fixture view never fetches paged findings", () => {
    Object.assign(routeQuery, { scenario: quiet ?? "" });
    const fixtureView = mountView();
    expect(fixtureView.findComponent(LivePaged).exists()).toBe(false);
    expect(autoobserve.incidents).not.toHaveBeenCalled();
  });
});
