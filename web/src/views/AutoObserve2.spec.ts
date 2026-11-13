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
import { nextTick, reactive } from "vue";
import { flushPromises, shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve, { type AutoObserveIncidentItem } from "@/services/autoobserve";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import { MAIN_PAGED_CAP } from "@/components/autoobserve/live/incidentsCopy";
import TopBar from "@/components/autoobserve/v2/TopBar.vue";
import TopBarStatus from "@/components/autoobserve/v2/TopBarStatus.vue";
import PageFooter from "@/components/autoobserve/v2/PageFooter.vue";
import ChangesPage from "@/components/autoobserve/v2/ChangesPage.vue";
import HistoryDrawer from "@/components/autoobserve/v2/HistoryDrawer.vue";
import SettingsDrawer from "@/components/autoobserve/v2/SettingsDrawer.vue";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import AutoObserve2 from "./AutoObserve2.vue";

// Reactive, so a test can change the URL under a mounted view as the router would.
const routeQuery = reactive<Record<string, string | undefined>>({});
const replace = vi.fn();
const push = vi.fn();
const back = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace, push, back }),
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

// The router is mocked, so a push or replace is applied to the query by hand, as the router would.
const applyLast = (spy: typeof push) => {
  const query = spy.mock.calls.at(-1)?.[0].query as Record<string, string | undefined>;
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  Object.assign(routeQuery, query);
};

describe("AutoObserve2 home (live only)", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    replace.mockReset();
    push.mockReset();
    back.mockReset();
    localStorage.setItem("autoobserve2.howItWorksSeen", "1");
    vi.mocked(autoobserve.coverage).mockReturnValue(pending());
    vi.mocked(autoobserve.suggestions).mockReturnValue(pending());
    vi.mocked(autoobserve.incidents).mockReset();
    vi.mocked(autoobserve.incidents).mockReturnValue(pending());
  });

  it("holds the rail's column from first paint, before anything loads", () => {
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-rail"]').exists()).toBe(true);
  });

  it("shows the paged card in the main column and suggestions alone in the rail", () => {
    const wrapper = mountView();
    const paged = wrapper.findComponent(LivePaged);
    expect(paged.props("cap")).toBe(MAIN_PAGED_CAP);
    const rail = wrapper.find('[data-test="autoobserve2-rail-scroll"]');
    expect(rail.element.contains(paged.element)).toBe(false);
    expect(Array.from(rail.element.children)).toEqual([
      wrapper.findComponent(LiveSuggestions).element,
    ]);
  });

  it("has no scenario picker or sample surface, whatever the query says", () => {
    Object.assign(routeQuery, { fixture: "1", scenario: "allclear" });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-scenario"]').exists()).toBe(false);
    expect(wrapper.findComponent(LivePaged).exists()).toBe(true);
    expect(wrapper.findComponent(TopBarStatus).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Sample scenarios");
  });

  it("the footer waits for the paged card, so it is never painted and then pushed down", async () => {
    const wrapper = mountView();
    expect(wrapper.findComponent(TopBar).exists()).toBe(true);
    expect(wrapper.findComponent(TopBarStatus).props("checked")).toEqual({ kind: "loading" });
    expect(wrapper.findComponent(PageFooter).exists()).toBe(false);
    wrapper.findComponent(LivePaged).vm.$emit("settled");
    await nextTick();
    expect(wrapper.findComponent(PageFooter).exists()).toBe(true);
  });

  it("a home row opens the issue drawer over the issues list", async () => {
    Object.assign(routeQuery, { drawer: "history", history: "change" });
    const wrapper = mountView();
    const item = { incident: { id: "inc-7" } } as AutoObserveIncidentItem;
    wrapper.findComponent(LivePaged).vm.$emit("open-incident", item);
    await flushPromises();
    expect(push).toHaveBeenCalledTimes(1);
    const query = push.mock.calls[0][0].query;
    expect(query).toMatchObject({ page: "issues", incident: "inc-7" });
    expect(query.drawer).toBeUndefined();
    expect(query.history).toBeUndefined();
  });

  it("the can't-see line opens coverage filtered to what needs attention", async () => {
    const wrapper = mountView();
    wrapper.findComponent(LivePaged).vm.$emit("open-coverage", "attention");
    await flushPromises();
    expect(push.mock.calls[0][0].query).toMatchObject({ page: "coverage", filter: "attention" });
  });

  it("the Issues page lists live incidents for its range", () => {
    for (const issuesRange of [undefined, "7d", "90d"]) {
      Object.assign(routeQuery, { page: "issues", issuesRange });
      const wrapper = mountView();
      const issues = wrapper.findComponent(LiveIssues);
      expect(issues.props("range")).toBe(issuesRange ?? "30d");
      expect(issues.props("initialFilter")).toBe("all");
      wrapper.unmount();
    }
  });

  it("names the sub-page back button once: the header adds its own 'Back to'", () => {
    for (const page of ["issues", "coverage", "activity"]) {
      Object.assign(routeQuery, { page });
      const wrapper = mountView();
      const back = wrapper.findComponent(PageLayoutStub).props("back") as { label: string };
      expect(back.label, page).toBe("AutoObserve");
      wrapper.unmount();
    }
  });

  it("the Activity page keeps the change highlighted by the link and offers suggestions", async () => {
    Object.assign(routeQuery, { page: "activity", change: "c-1" });
    const wrapper = mountView();
    const changes = wrapper.findComponent(ChangesPage);
    expect(changes.props("highlightId")).toBe("c-1");
    expect(wrapper.findComponent(AllSuggestionsDrawer).props("open")).toBe(false);
    changes.vm.$emit("see-suggestions");
    await flushPromises();
    expect(push.mock.calls.at(-1)?.[0].query).toMatchObject({ drawer: "suggestions" });
  });

  describe("drawers live in the URL", () => {
    it.each([
      ["history", HistoryDrawer],
      ["settings", SettingsDrawer],
      ["howItWorks", HowItWorksDrawer],
    ] as const)(
      "%s opens by push, so Back closes it, and a shared link restores it",
      async (name, comp) => {
        const wrapper = mountView();
        expect(wrapper.findComponent(comp).props("open")).toBe(false);
        wrapper.findComponent(TopBar).vm.$emit("open", name);
        await flushPromises();
        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][0].query.drawer).toBe(name);
        wrapper.unmount();

        applyLast(push);
        const shared = mountView();
        expect(shared.findComponent(comp).props("open")).toBe(true);
        shared.findComponent(comp).vm.$emit("update:open", false);
        await flushPromises();
        expect(replace.mock.calls.at(-1)?.[0].query.drawer).toBeUndefined();
      },
    );

    it("the history filter is kept with the drawer and dropped when it closes", async () => {
      Object.assign(routeQuery, { drawer: "history", history: "decision" });
      const wrapper = mountView();
      const history = wrapper.findComponent(HistoryDrawer);
      expect(history.props("filter")).toBe("decision");
      history.vm.$emit("update:filter", "all");
      await flushPromises();
      expect(replace.mock.calls.at(-1)?.[0].query.history).toBeUndefined();
      history.vm.$emit("update:filter", "change");
      expect(replace.mock.calls.at(-1)?.[0].query.history).toBe("change");
      history.vm.$emit("see-issues");
      await flushPromises();
      const query = push.mock.calls.at(-1)?.[0].query;
      expect(query.page).toBe("issues");
      expect(query.drawer).toBeUndefined();
      expect(query.history).toBeUndefined();
    });

    it("an unknown drawer value opens nothing", () => {
      Object.assign(routeQuery, { drawer: "problem", problem: "p-1" });
      const wrapper = mountView();
      for (const comp of [HistoryDrawer, SettingsDrawer, HowItWorksDrawer, AllSuggestionsDrawer])
        expect(wrapper.findComponent(comp).props("open")).toBe(false);
    });

    it("Settings hands off to How it works", async () => {
      Object.assign(routeQuery, { drawer: "settings" });
      const wrapper = mountView();
      wrapper.findComponent(SettingsDrawer).vm.$emit("how-it-works");
      await flushPromises();
      expect(push.mock.calls.at(-1)?.[0].query.drawer).toBe("howItWorks");
    });

    it("All suggestions opens by push and closes by replace", async () => {
      const wrapper = mountView();
      wrapper.findComponent(LiveSuggestions).vm.$emit("see-all");
      await flushPromises();
      expect(push.mock.calls.at(-1)?.[0].query.drawer).toBe("suggestions");
      wrapper.unmount();
      applyLast(push);
      const shared = mountView();
      const drawer = shared.findComponent(AllSuggestionsDrawer);
      expect(drawer.props("open")).toBe(true);
      drawer.vm.$emit("update:open", false);
      await flushPromises();
      expect(replace.mock.calls.at(-1)?.[0].query.drawer).toBeUndefined();
    });

    it("How it works opens itself once on a first visit, and is marked seen on close", async () => {
      localStorage.removeItem("autoobserve2.howItWorksSeen");
      const wrapper = mountView();
      await flushPromises();
      expect(replace.mock.calls.at(-1)?.[0].query.drawer).toBe("howItWorks");
      wrapper.unmount();
      applyLast(replace);
      const opened = mountView();
      expect(opened.findComponent(HowItWorksDrawer).props("open")).toBe(true);
      delete routeQuery.drawer;
      await flushPromises();
      expect(localStorage.getItem("autoobserve2.howItWorksSeen")).toBe("1");
    });
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
    expect(query.drawer).toBeUndefined();
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
    expect(replace).not.toHaveBeenCalled();
    drawer.vm.$emit("update:kind", null);
    await flushPromises();
    expect(replace.mock.calls.at(-1)?.[0].query.suggestions).toBeUndefined();
  });
});

describe("AutoObserve2 coverage page learning line", () => {
  const data = (learning?: Record<string, unknown>, streams: unknown[] = []) => ({
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
          streams,
          traffic_per_hour: null,
          cells: {},
        },
      ],
      ...(learning ? { learning } : {}),
    },
  });

  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    Object.assign(routeQuery, { page: "coverage" });
  });

  it("counts the learning service and its own streams, as the page lists them", async () => {
    const ready = (Date.now() + 5 * 86_400_000) * 1000;
    vi.mocked(autoobserve.coverage).mockResolvedValue(
      data(
        { streams_learning: 9, streams_ready: 3, history_days_needed: 14, next_ready_at: ready },
        [{ type: "logs", name: "app_logs", learning_until: ready }],
      ) as never,
    );
    const wrapper = mountView();
    await flushPromises();
    const sentence = wrapper.find('[data-test="autoobserve2-coverage-sentence"]').text();
    expect(sentence).toContain("of your 1 service");
    expect(sentence).toMatch(/\b1 stream\b/);
    expect(sentence).not.toMatch(/\b9 streams\b/);
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
