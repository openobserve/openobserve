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
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const view = (name: string) =>
  defineComponent({ name, setup: () => () => h("div", { "data-test": name }) });

const FADE_CLASS = "motion-safe:animate-in";
const SLIDE_CLASS = "motion-safe:slide-in-from-bottom-1";
const Parent = defineComponent({
  name: "PipelineParent",
  setup: () => () => h(RouterView),
});
const childPage = (name: string) =>
  defineComponent({
    name,
    setup: () => () =>
      h(OPageLayout, { title: name }, () => h("div", { "data-test": `${name}-body` })),
  });
const PageWithLayout = defineComponent({
  name: "PageWithLayout",
  setup: () => () =>
    h(OPageLayout, { title: "Page" }, () => h("div", { "data-test": "page-body" })),
});

describe("MainLayout — route fade", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  const mountAt = async (path: string) => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: StubDiv },
        { path: "/traces", component: view("AppTraces") },
        { path: "/trace-details", component: view("TraceDetails") },
        { path: "/page", component: PageWithLayout },
        {
          path: "/pipeline",
          component: Parent,
          children: [
            { path: "functions", component: childPage("FunctionsChild") },
            { path: "enrichment", component: childPage("EnrichmentChild") },
          ],
        },
      ],
    });
    await router.push(path);
    wrapper = mount(MainLayout, {
      global: {
        plugins: [store, i18n, router],
        stubs: {
          AppHeader: StubDiv,
          ONavbar: StubDiv,
          O2AIChat: StubDiv,
          WebinarBanner: StubDiv,
          AnnouncementBanner: StubDiv,
          ShortcutCheatsheet: StubDiv,
          GetStarted: StubDiv,
          CommunitySlackInvite: StubDiv,
          ThemeSwitcher: StubDiv,
          PredefinedThemes: StubDiv,
          SlackIcon: StubDiv,
          ManagementIcon: StubDiv,
          ODialog: StubDiv,
        },
      },
    });
    (wrapper.vm as unknown as { isLoading: boolean }).isLoading = true;
    await flushPromises();
    return router;
  };
  const classesOf = (name: string) => wrapper!.find(`[data-test="${name}"]`).classes();

  it("fades a page in on a fresh navigation", async () => {
    const router = await mountAt("/traces");
    expect(classesOf("AppTraces")).toContain(FADE_CLASS);
    await router.push("/trace-details");
    await flushPromises();
    expect(classesOf("TraceDetails")).toContain(FADE_CLASS);
  });

  it("does not fade a kept-alive page back in when the user returns to it", async () => {
    const router = await mountAt("/traces");
    await router.push("/trace-details");
    await flushPromises();
    await router.push("/traces");
    await flushPromises();
    expect(classesOf("AppTraces")).not.toContain(FADE_CLASS);
    expect(classesOf("AppTraces")).toContain("h-full");
  });

  it("slides a page body in on a fresh navigation but not when Back restores it", async () => {
    const router = await mountAt("/page");
    const bodyClasses = () =>
      wrapper!.find('[data-test="page-body"]').element.parentElement!.className;
    expect(bodyClasses()).toContain(SLIDE_CLASS);
    await router.push("/trace-details");
    await flushPromises();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/page");
    expect(bodyClasses()).not.toContain(SLIDE_CLASS);
  });

  it("slides a child route's body in on a fresh navigation but not when Back or Forward restores it under the same parent", async () => {
    const router = await mountAt("/pipeline/functions");
    const bodyClasses = (name: string) =>
      wrapper!.find(`[data-test="${name}-body"]`).element.parentElement!.className;
    expect(bodyClasses("FunctionsChild")).toContain(SLIDE_CLASS);
    await router.push("/pipeline/enrichment");
    await flushPromises();
    expect(bodyClasses("EnrichmentChild")).toContain(SLIDE_CLASS);
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/pipeline/functions");
    expect(bodyClasses("FunctionsChild")).not.toContain(SLIDE_CLASS);
    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/pipeline/enrichment");
    expect(bodyClasses("EnrichmentChild")).not.toContain(SLIDE_CLASS);
    await router.push("/pipeline/functions");
    await flushPromises();
    expect(bodyClasses("FunctionsChild")).toContain(SLIDE_CLASS);
  });

  it("does not fade a page restored by Back", async () => {
    const router = await mountAt("/trace-details");
    await router.push("/traces");
    await flushPromises();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/trace-details");
    expect(classesOf("TraceDetails")).not.toContain(FADE_CLASS);
  });
});
