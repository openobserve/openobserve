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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createStore } from "vuex";

import i18n from "@/locales";
import { encodeHomeReturn, HOME_RETURN_QUERY_KEY } from "@/composables/goto/homeReturn";

import HomeReturnBar from "./HomeReturnBar.vue";

const Page = defineComponent({ setup: () => () => h("div") });

describe("HomeReturnBar", () => {
  let wrapper: VueWrapper | undefined;
  let router: Router;
  let store: ReturnType<typeof createStore>;

  const ret = encodeHomeReturn({ row: "service:checkout", period: "1h" });
  const bar = () => wrapper!.find('[data-test="home-return-bar"]');

  const mountBar = async (to: Parameters<Router["push"]>[0]) => {
    await router.push(to);
    wrapper = mount(HomeReturnBar, { global: { plugins: [i18n, router, store] } });
    await flushPromises();
  };

  beforeEach(() => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "home", component: Page },
        { path: "/traces", name: "traces", component: Page },
        { path: "/logs", name: "logs", component: Page },
      ],
    });
    store = createStore({ state: { selectedOrganization: { identifier: "acme" } } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("shows on a valid home_return", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    expect(bar().exists()).toBe(true);
    expect(bar().text()).toContain("Back to Overview");
  });

  it("stays hidden on a malformed home_return", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: "row=bogus" } });
    expect(bar().exists()).toBe(false);
  });

  it("survives a same-route query replace that drops home_return", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    await router.replace({ name: "traces", query: { query: "c3RhdHVz" } });
    await flushPromises();
    expect(bar().exists()).toBe(true);
  });

  it("clears on another route", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    await router.push({ name: "logs" });
    await flushPromises();
    expect(bar().exists()).toBe(false);
    await router.push({ name: "traces" });
    await flushPromises();
    expect(bar().exists()).toBe(false);
  });

  it("clears on an org switch", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    (store.state as any).selectedOrganization = { identifier: "other" };
    await flushPromises();
    expect(bar().exists()).toBe(false);
  });

  it("keeps the bar when the org first resolves on a cold load", async () => {
    (store.state as any).selectedOrganization = null;
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    (store.state as any).selectedOrganization = { identifier: "acme" };
    await flushPromises();
    expect(bar().exists()).toBe(true);
  });

  it("pushes home with the Overview tab and the saved state", async () => {
    await mountBar({
      name: "traces",
      query: {
        [HOME_RETURN_QUERY_KEY]: encodeHomeReturn({
          row: "incident:7",
          from: 10,
          to: 20,
          focus: "ask",
        }),
      },
    });
    await wrapper!.find('[data-test="home-return-bar-back"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(router.currentRoute.value.query).toEqual({
      home_tab: "overview",
      row: "incident:7",
      from: "10",
      to: "20",
      focus: "ask",
      org_identifier: "acme",
    });
    expect(bar().exists()).toBe(false);
  });

  it("closes by hand", async () => {
    await mountBar({ name: "traces", query: { [HOME_RETURN_QUERY_KEY]: ret } });
    await wrapper!.find('[data-test="home-return-bar-close"]').trigger("click");
    expect(bar().exists()).toBe(false);
  });
});
