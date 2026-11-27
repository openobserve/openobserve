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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";
import { raw } from "@/types/i18n";
import type { NavItem } from "./ONavbar.types";
import OSidebar from "./OSidebar.vue";

vi.mock("@/composables/useTrialPaywall", () => ({
  useTrialPaywall: () => ({ isPaywalled: () => false }),
}));

const page = { template: "<div />" };
const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: page },
      { path: "/logs", name: "logs", component: page },
      { path: "/alerts", name: "alertList", component: page },
      { path: "/slos", name: "sloList", component: page },
      { path: "/settings", name: "settings", component: page },
      { path: "/alerts/destinations", name: "alertDestinations", component: page },
      { path: "/downtimes", name: "downtimes", component: page },
      { path: "/oncall/pages", name: "onCallResponses", component: page },
      { path: "/oncall/teams", name: "onCallTeams", component: page },
      { path: "/dashboards", name: "dashboards", component: page },
      { path: "/reports", name: "reports", component: page },
    ],
  });

const links: NavItem[] = [
  { title: raw("Home"), icon: "home", link: "/", name: "home" },
  { title: raw("Logs"), icon: "search", link: "/logs", name: "logs" },
  { title: raw("Alerts"), icon: "home", link: "/alerts", name: "alertList" },
  { title: raw("SLOs"), icon: "home", link: "/slos", name: "sloList" },
  { title: raw("Settings"), icon: "settings", link: "/settings", name: "settings" },
];

let wrapper: VueWrapper;

async function mountAt(
  path: string,
  zoConfig: Record<string, unknown> = {},
  collapsible = true,
  linksList: NavItem[] = links,
) {
  const router = makeRouter();
  await router.push(path);
  const store = createStore({
    state: { selectedOrganization: { identifier: "default" }, zoConfig, theme: "light" },
  });
  wrapper = mount(OSidebar, {
    props: { linksList, collapsible },
    attachTo: document.body,
    global: {
      plugins: [router, store],
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.useRealTimers();
  wrapper?.unmount();
  localStorage.clear();
});

describe("OSidebar", () => {
  it("renders a labelled nav landmark with the sections", async () => {
    await mountAt("/logs");
    const nav = wrapper.find("nav[data-test='sidebar']");
    expect(nav.attributes("aria-label")).toBeTruthy();
    expect(wrapper.find("[data-test='sidebar-group-top']").exists()).toBe(true);
    expect(wrapper.find("[data-test='sidebar-group-explore']").exists()).toBe(true);
    expect(wrapper.find("[data-test='sidebar-group-monitor']").exists()).toBe(true);
  });

  it("marks the active page with aria-current", async () => {
    await mountAt("/logs");
    expect(wrapper.find("[data-test='sidebar-item-logs']").attributes("aria-current")).toBe("page");
    expect(
      wrapper.find("[data-test='sidebar-item-home']").attributes("aria-current"),
    ).toBeUndefined();
  });

  it("lists a group's main pages as direct rows that navigate", async () => {
    await mountAt("/slos");
    expect(wrapper.find("[data-test='sidebar-item-reliability']").exists()).toBe(false);
    const slos = wrapper.find("[data-test='sidebar-item-sloList']");
    expect(slos.attributes("aria-current")).toBe("page");
    expect(slos.attributes("href")).toContain("/slos");
    const alerts = wrapper.find("[data-test='sidebar-item-alertList']");
    expect(alerts.text()).toContain("Alerts");
    expect(alerts.attributes("role")).toBeUndefined();
  });

  it("opens the row holding the current sub-page", async () => {
    await mountAt("/alerts/destinations");
    expect(wrapper.find("[data-test='sidebar-expand-alertList']").attributes("aria-expanded")).toBe(
      "true",
    );
    expect(
      wrapper.find("[data-test='sidebar-item-alertDestinations']").attributes("aria-current"),
    ).toBe("page");
  });

  it("collapses to icons and remembers it", async () => {
    await mountAt("/logs");
    await wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");
    expect(wrapper.find("nav").attributes("data-collapsed")).toBe("true");
    expect(localStorage.getItem("o2-sidebar-collapsed")).toBe("true");
  });

  it("keeps the logo out of the nav, expanded or collapsed", async () => {
    await mountAt("/logs");
    expect(wrapper.find("[data-test='sidebar-logo']").exists()).toBe(false);
    await wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");
    expect(wrapper.find("[data-test='sidebar-logo']").exists()).toBe(false);
    expect(wrapper.find("[data-test='navbar-organizations-select']").exists()).toBe(false);
  });

  it("ends the bottom group with an always-visible Collapse row that turns icon-only", async () => {
    await mountAt("/logs");
    const nav = () => wrapper.find("nav").attributes("data-collapsed");
    const toggle = wrapper.find("[data-test='sidebar-collapse-toggle']");
    expect(toggle.element.parentElement?.lastElementChild).toBe(toggle.element);
    expect(toggle.classes()).not.toContain("opacity-0");
    expect(toggle.isVisible()).toBe(true);
    expect(toggle.text()).toContain("Collapse");
    expect(toggle.find("[data-test='o-shortcut']").exists()).toBe(false);
    expect(toggle.attributes("aria-label")).toBe("Collapse Sidebar");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(nav()).toBe("true");
    expect(toggle.attributes("aria-label")).toBe("Expand Sidebar");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).not.toContain("Collapse");
    expect(toggle.find("[data-test='o-shortcut']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-edge']").exists()).toBe(false);
  });

  it("toggles on [ but not while typing or with a modifier", async () => {
    await mountAt("/logs");
    const nav = () => wrapper.find("nav").attributes("data-collapsed");
    const press = async (target: EventTarget, init: KeyboardEventInit = {}) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "[", bubbles: true, ...init }));
      await flushPromises();
    };
    await press(document.body);
    expect(nav()).toBe("true");
    await press(document.body, { metaKey: true });
    expect(nav()).toBe("true");
    const input = document.createElement("input");
    document.body.appendChild(input);
    await press(input);
    expect(nav()).toBe("true");
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    editor.appendChild(document.createElement("span"));
    document.body.appendChild(editor);
    await press(editor.firstChild!);
    expect(nav()).toBe("true");
    input.remove();
    editor.remove();
    await press(document.body);
    expect(nav()).toBeUndefined();
  });

  it("leaves the brand row to the mobile drawer's own header", async () => {
    await mountAt("/logs", {}, false);
    expect(wrapper.find("[data-test='sidebar-logo']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-collapse-toggle']").exists()).toBe(false);
  });

  it("shows no page search or edition label", async () => {
    await mountAt("/logs");
    expect(wrapper.find("[data-test='sidebar-search']").exists()).toBe(false);
    expect(wrapper.find("[data-test='sidebar-edition']").exists()).toBe(false);
  });
});

describe("OSidebar sub-pages", () => {
  const withDashboards: NavItem[] = [
    ...links,
    { title: raw("Dashboards"), icon: "home", link: "/dashboards", name: "dashboards" },
    { title: raw("Reports"), icon: "home", link: "/reports", name: "reports" },
  ];
  const chevron = (name: string) => wrapper.find(`[data-test='sidebar-expand-${name}']`);

  it("toggles sub-pages from the chevron without navigating", async () => {
    await mountAt("/logs");
    expect(chevron("alertList").attributes("aria-expanded")).toBe("false");
    await chevron("alertList").trigger("click");
    await flushPromises();
    expect(chevron("alertList").attributes("aria-expanded")).toBe("true");
    expect(wrapper.vm.$router.currentRoute.value.path).toBe("/logs");
  });

  it("keeps one row open at a time", async () => {
    await mountAt("/logs", {}, true, withDashboards);
    await chevron("dashboards").trigger("click");
    await chevron("alertList").trigger("click");
    expect(chevron("dashboards").attributes("aria-expanded")).toBe("false");
    expect(chevron("alertList").attributes("aria-expanded")).toBe("true");
  });

  it("gives a row without secondary pages no chevron", async () => {
    await mountAt("/logs");
    expect(chevron("sloList").exists()).toBe(false);
  });
});

describe("OSidebar collapsed peek", () => {
  const nav = () => wrapper.find("nav[data-test='sidebar']");
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const collapse = () => wrapper.find("[data-test='sidebar-collapse-toggle']").trigger("click");

  it("opens only once the pointer rests on the rail", async () => {
    await mountAt("/logs");
    await collapse();
    fakeTimers();
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(200);
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(nav().attributes("data-peek")).toBeUndefined();
    vi.advanceTimersByTime(80);
    await flushPromises();
    expect(nav().attributes("data-peek")).toBe("true");
    expect(nav().attributes("data-collapsed")).toBeUndefined();
  });

  it("closes when the pointer leaves", async () => {
    await mountAt("/logs");
    await collapse();
    fakeTimers();
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(280);
    await nav().trigger("mouseleave");
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(nav().attributes("data-peek")).toBeUndefined();
  });

  it("closes after navigating and stays shut until the pointer leaves", async () => {
    await mountAt("/logs");
    await collapse();
    fakeTimers();
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(280);
    await flushPromises();
    await wrapper.vm.$router.push("/slos");
    await flushPromises();
    expect(nav().attributes("data-peek")).toBeUndefined();
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(nav().attributes("data-peek")).toBeUndefined();
  });

  it("never peeks in the mobile drawer", async () => {
    await mountAt("/logs", {}, false);
    fakeTimers();
    await nav().trigger("mousemove");
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(nav().attributes("data-peek")).toBeUndefined();
  });
});

describe("OSidebar recents", () => {
  it("lists visited pages, newest first, without the current one", async () => {
    await mountAt("/logs");
    await wrapper.vm.$router.push("/slos");
    await flushPromises();
    await wrapper.vm.$router.push("/settings");
    await flushPromises();
    const items = wrapper.findAll("[data-test^='sidebar-recent-']").map((w) => w.text());
    expect(items[0]).toContain("SLOs");
    expect(items[1]).toContain("Logs");
    expect(items.join(" ")).not.toContain("Settings");
  });

  it("names the group under a recent sub-page", async () => {
    await mountAt("/slos");
    await wrapper.vm.$router.push("/logs");
    await flushPromises();
    expect(
      wrapper
        .find(
          "[data-test='sidebar-recent-child:reliability:sloList'], [data-test^='sidebar-recent-child:reliability']",
        )
        .text(),
    ).toContain("Reliability");
  });
});
