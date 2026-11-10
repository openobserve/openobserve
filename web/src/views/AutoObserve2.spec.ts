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
import { nextTick } from "vue";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve from "@/services/autoobserve";
import { SCENARIOS, problemsIn } from "@/components/autoobserve/data/facts";
import { scenarioData } from "@/components/autoobserve/v2/fixtures";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import { MAIN_PAGED_CAP } from "@/components/autoobserve/live/incidentsCopy";
import { SKELETON_DELAY_MS } from "@/components/autoobserve/live/liveModel";
import ThisWeek from "@/components/autoobserve/v2/ThisWeek.vue";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import TopBarStatus from "@/components/autoobserve/v2/TopBarStatus.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import AutoObserveIssuesTab from "@/components/autoobserve/AutoObserveIssuesTab.vue";
import ChangesPage from "@/components/autoobserve/v2/ChangesPage.vue";
import HistoryDrawer from "@/components/autoobserve/v2/HistoryDrawer.vue";
import SettingsDrawer from "@/components/autoobserve/v2/SettingsDrawer.vue";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import LiveHistory from "@/components/autoobserve/live/LiveHistory.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import AutoObserve2 from "./AutoObserve2.vue";

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

const pending = () => new Promise<never>(() => undefined);

// A fixture scenario with no suggestions of its own, so only live mode can hold the rail open.
const quiet = SCENARIOS.find(
  (s) => scenarioData(s).requests.filter((r) => r.kind !== "fixNow").length === 0,
);

// The page header is the shared layout's; its slots render so the body and actions stay reachable.
const PageLayoutStub = {
  props: ["title", "subtitle", "back", "icon", "titleDataTest"],
  template:
    "<div><h1 :data-test='titleDataTest'>{{ title }}</h1><p>{{ subtitle }}</p><slot name='subtitle' /><slot name='actions' /><slot /></div>",
};

const mountView = () =>
  shallowMount(AutoObserve2, {
    global: { plugins: [i18n, store], stubs: { OPageLayout: PageLayoutStub } },
  });

const DrawerStub = {
  props: ["open"],
  template: "<div><slot name='header-right' /><slot /></div>",
};

// Drawers render their body whether open or not, so a test can read and click inside them.
const mountOpen = () =>
  mount(AutoObserve2, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: DrawerStub,
        LivePaged: true,
        LiveSuggestions: true,
        AllSuggestionsDrawer: true,
        LiveHistory: true,
        HowItWorksDrawer: true,
        AutoObserveIssueDrawer: true,
        TopBar: true,
        OPageLayout: PageLayoutStub,
      },
    },
  });

describe("AutoObserve2 rail column (OSS-9)", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    replace.mockReset();
    push.mockReset();
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
    Object.assign(routeQuery, { fixture: "1", scenario: quiet ?? "" });
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
    Object.assign(routeQuery, { fixture: "1", scenario: SCENARIOS[0] });
    const wrapper = mountView();
    expect(wrapper.findComponent(ThisWeek).exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(true);
    expect(wrapper.findComponent(LivePaged).exists()).toBe(false);
    expect(wrapper.findComponent(TopBarStatus).props("live")).toBe(false);
  });

  it("live mode hides only the scenario picker; the footer keeps See changes", async () => {
    Object.assign(routeQuery, { live: "1", scenario: SCENARIOS[0] });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(false);
    expect(wrapper.findComponent(TopBar).exists()).toBe(true);
    const bar = wrapper.findComponent(TopBarStatus);
    expect(bar.props("live")).toBe(true);
    expect(bar.props("checked")).toEqual({ kind: "loading" });
    // The footer waits for the paged card, so it is never painted and then pushed down (T5-N6).
    expect(wrapper.findComponent(PageFooter).exists()).toBe(false);
    wrapper.findComponent(LivePaged).vm.$emit("settled");
    await nextTick();
    expect(wrapper.findComponent(PageFooter).exists()).toBe(true);
    const footer = mount(PageFooter, { global: { plugins: [i18n] } });
    expect(footer.find('[data-test="autoobserve2-footer-activity"]').exists()).toBe(true);
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
    const drawer = wrapper.findComponent(AutoObserveIssueDrawer);
    expect(drawer.props("open")).toBe(false);
    expect(drawer.props("issue")).toBeNull();

    wrapper.unmount();
    replace.mockReset();
    delete routeQuery.live;
    routeQuery.fixture = "1";
    const fixtureView = mountView();
    await flushPromises();
    expect(fixtureView.findComponent(AutoObserveIssueDrawer).props("open")).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("the fixture view never fetches paged findings", () => {
    Object.assign(routeQuery, { fixture: "1", scenario: quiet ?? "" });
    const fixtureView = mountView();
    expect(fixtureView.findComponent(LivePaged).exists()).toBe(false);
    expect(autoobserve.incidents).not.toHaveBeenCalled();
  });

  it("is live with no query param: the home shows the paged card, not the fixture", () => {
    const wrapper = mountView();
    expect(wrapper.findComponent(LivePaged).exists()).toBe(true);
    expect(wrapper.findComponent(ThisWeek).exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(false);
  });

  it("the Issues page lists live incidents with no query param, never the fixture table", () => {
    for (const issuesRange of [undefined, "7d", "90d"]) {
      Object.assign(routeQuery, { page: "issues", issuesRange });
      const wrapper = mountView();
      const issues = wrapper.findComponent(LiveIssues);
      expect(issues.exists(), issuesRange).toBe(true);
      expect(issues.props("range")).toBe(issuesRange ?? "30d");
      expect(issues.props("initialFilter")).toBe("all");
      expect(wrapper.findComponent(AutoObserveIssuesTab).exists()).toBe(false);
      expect(wrapper.find('[data-test="autoobserve-issues-table"]').exists()).toBe(false);
      expect(wrapper.html()).not.toContain("INC-1051");
      wrapper.unmount();
    }
  });

  it("names the sub-page back button once: the header adds its own 'Back to' (T5-N1)", () => {
    for (const page of ["issues", "coverage", "activity"]) {
      Object.assign(routeQuery, { page });
      const wrapper = mountView();
      const back = wrapper.findComponent(PageLayoutStub).props("back") as { label: string };
      expect(back.label, page).toBe("AutoObserve");
      wrapper.unmount();
    }
  });

  it("a Slack suggestion link opens All suggestions on that item, and closing drops the link", async () => {
    Object.assign(routeQuery, { suggestion: "sug-9" });
    const wrapper = mountView();
    await flushPromises();
    const drawer = wrapper.findComponent(AllSuggestionsDrawer);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("focusId")).toBe("sug-9");
    expect(drawer.props("kind")).toBeNull();
    expect(wrapper.findComponent(HowItWorksDrawer).props("open")).toBe(false);
    drawer.vm.$emit("update:open", false);
    await flushPromises();
    const query = replace.mock.calls.at(-1)?.[0].query;
    expect(query.suggestion).toBeUndefined();
    expect(query.suggestions).toBeUndefined();
  });

  it("a Slack grouped link opens All suggestions filtered to its kind", async () => {
    localStorage.removeItem("autoobserve2.howItWorksSeen");
    Object.assign(routeQuery, { suggestions: "no_absence_check" });
    const wrapper = mountView();
    await flushPromises();
    const drawer = wrapper.findComponent(AllSuggestionsDrawer);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("kind")).toBe("no_absence_check");
    expect(wrapper.findComponent(HowItWorksDrawer).props("open")).toBe(false);
    drawer.vm.$emit("update:kind", null);
    await flushPromises();
    expect(replace.mock.calls.at(-1)?.[0].query.suggestions).toBeUndefined();
  });

  it("live mode keeps the Changes page with an honest empty state, never the fixture ledger", async () => {
    Object.assign(routeQuery, { page: "activity", change: "c-1" });
    const wrapper = mountOpen();
    await flushPromises();
    expect(replace).not.toHaveBeenCalled();
    const changes = wrapper.findComponent(ChangesPage);
    expect(changes.exists()).toBe(true);
    expect(changes.props("ledger")).toEqual([]);
    expect(wrapper.find('[data-test="autoobserve2-activity-empty"]').exists()).toBe(false);
    const empty = wrapper.find('[data-test="autoobserve-live-empty-changes"]');
    expect(empty.text()).toContain("No changes yet");
    expect(empty.text()).toContain("hasn't changed any alert or setting");
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(false);
    await wrapper.find('[data-test="autoobserve-live-empty-changes-action"]').trigger("click");
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(true);
  });

  it("live History shows the live feed, no fixture entries, and can send the reader to Issues (G6)", async () => {
    const wrapper = mountOpen();
    await flushPromises();
    const history = wrapper.findComponent(HistoryDrawer);
    expect(history.props("entries")).toEqual([]);
    expect(wrapper.find('[data-test="autoobserve2-history-filter"]').exists()).toBe(false);
    const feed = wrapper.findComponent(LiveHistory);
    expect(feed.exists()).toBe(true);
    wrapper.findComponent(TopBar).vm.$emit("open", "history");
    await flushPromises();
    expect(history.props("open")).toBe(true);
    feed.vm.$emit("see-issues");
    await flushPromises();
    expect(history.props("open")).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].query.page).toBe("issues");
  });

  it("live Settings shows no local controls and points to How it works", async () => {
    const wrapper = mountOpen();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-settings-reach"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-settings-autonomy"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve-live-empty-settings"]').text()).toContain(
      "Nothing to set here yet",
    );
    wrapper.findComponent(TopBar).vm.$emit("open", "settings");
    await flushPromises();
    const settings = wrapper.findComponent(SettingsDrawer);
    expect(settings.props("open")).toBe(true);
    await wrapper.find('[data-test="autoobserve-live-empty-settings-action"]').trigger("click");
    expect(settings.props("open")).toBe(false);
    expect(wrapper.findComponent(HowItWorksDrawer).props("open")).toBe(true);
  });

  it("fixture=1 keeps the fixture History and Settings bodies", async () => {
    Object.assign(routeQuery, { fixture: "1", scenario: SCENARIOS[0] });
    const wrapper = mountOpen();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-history-filter"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-settings-reach"]').exists()).toBe(true);
    expect(wrapper.find('[data-test^="autoobserve-live-empty-"]').exists()).toBe(false);
  });

  it("live mode shows no scenario surface and makes no claim about samples", async () => {
    const wrapper = mountOpen();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-scenario-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-scenario-live"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Sample scenarios");
  });

  it("fixture=1 shows the scenario picker and no live-data note", () => {
    Object.assign(routeQuery, { fixture: "1", scenario: SCENARIOS[0] });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-scenario-live"]').exists()).toBe(false);
  });

  it("fixture=1 in a test build keeps the fixture design path", () => {
    Object.assign(routeQuery, { fixture: "1", scenario: SCENARIOS[0] });
    const home = mountView();
    expect(home.findComponent(ThisWeek).exists()).toBe(true);
    expect(home.findComponent(AutoObserveIssueDrawer).exists()).toBe(true);
    expect(home.findComponent(HistoryDrawer).exists()).toBe(true);
    home.unmount();
    Object.assign(routeQuery, { page: "issues" });
    const issues = mountView();
    expect(issues.findComponent(AutoObserveIssuesTab).exists()).toBe(true);
    expect(issues.findComponent(LiveIssues).exists()).toBe(false);
    issues.unmount();
    Object.assign(routeQuery, { page: "activity" });
    const changes = mountView();
    expect(changes.findComponent(ChangesPage).exists()).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("AutoObserve2 coverage page learning line (W3)", () => {
  const data = (learning?: Record<string, unknown>) => ({
    data: {
      view: "strict",
      pass_at: null,
      refreshed_at: null,
      quality: null,
      classes: [],
      rows: [
        {
          service_id: "s",
          service_name: "svc-a",
          cluster: null,
          namespace: null,
          streams: [],
          traffic_per_hour: null,
          cells: {},
        },
      ],
      ...(learning ? { learning } : {}),
    },
  });

  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    Object.assign(routeQuery, { live: "1", page: "coverage" });
  });

  it("follows the coverage sentence while streams learn", async () => {
    vi.mocked(autoobserve.coverage).mockResolvedValue(
      data({
        streams_learning: 9,
        streams_ready: 3,
        history_days_needed: 14,
        next_ready_at: Date.UTC(2026, 10, 24, 12) * 1000,
      }) as never,
    );
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-coverage-sentence"]').text()).toMatch(
      /^.+\. Learning 9 streams\. The first is ready on Nov 24; AutoObserve needs 14 days of history to judge a stream\.$/,
    );
  });

  it("reserves the loaded sentence's two lines while it loads, so the page never drops", async () => {
    vi.mocked(autoobserve.coverage).mockReturnValue(new Promise(() => undefined) as never);
    const loading = mountView();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, SKELETON_DELAY_MS + 20));
    const sentence = loading.find('[data-test="autoobserve2-coverage-sentence"]');
    expect(sentence.findAll('[data-test="autoobserve2-coverage-sentence-skeleton"]')).toHaveLength(
      2,
    );
    expect(sentence.classes()).toContain("min-h-11.5");
    vi.mocked(autoobserve.coverage).mockResolvedValue(data() as never);
    const loaded = mountView();
    await flushPromises();
    expect(loaded.find('[data-test="autoobserve2-coverage-sentence"]').classes()).toContain(
      "min-h-11.5",
    );
  });

  it("a server without the learning block keeps today's sentence", async () => {
    vi.mocked(autoobserve.coverage).mockResolvedValue(data() as never);
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-coverage-sentence"]').text()).not.toContain(
      "Learning",
    );
  });
});
