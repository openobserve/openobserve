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
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";
import SolutionSwitcher from "./SolutionSwitcher.vue";
import { solutionOfPath } from "./solutionLanding";

const Page = defineComponent({ render: () => h("div") });
const PATHS = [
  "/",
  "/logs",
  "/metrics",
  "/security/overview",
  "/security/events",
  "/security/mitre",
  "/settings/general",
];

let router: Router;
let store: ReturnType<typeof createStore>;
let wrapper: VueWrapper | undefined;

const mountSwitcher = async (start: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: PATHS.map((path) => ({ path, name: path, component: Page })),
  });
  await router.push(start);
  store = createStore({
    state: {
      solutionMode: start.startsWith("/security") ? "security" : "observability",
      selectedOrganization: { identifier: "acme" },
    },
    mutations: {
      setSolutionMode(state: any, mode: string) {
        state.solutionMode = mode;
      },
    },
  });
  wrapper = mount(SolutionSwitcher, {
    global: {
      plugins: [i18n, router, store],
      stubs: {
        ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
        ODropdownItem: {
          emits: ["select"],
          template: "<button @click=\"$emit('select')\"><slot /></button>",
        },
      },
    },
  });
  await flushPromises();
};

const switchTo = async (key: "observability" | "security") => {
  await wrapper!.get(`[data-test="solution-${key}"]`).trigger("click");
  await flushPromises();
  return router.currentRoute.value.fullPath;
};

// The layout sets the mode from the URL; a shared page keeps the current one.
const visit = async (path: string) => {
  await router.push(path);
  const mode = solutionOfPath(router.currentRoute.value.path);
  if (mode) store.commit("setSolutionMode", mode);
  await flushPromises();
};

describe("SolutionSwitcher", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => wrapper?.unmount());

  it("lands on the matching page, with the org", async () => {
    await mountSwitcher("/logs");
    expect(await switchTo("security")).toBe("/security/events?org_identifier=acme");
  });

  it("returns to the page last open in the solution when nothing matches", async () => {
    await mountSwitcher("/security/mitre?tactic=TA0001");
    await visit("/metrics");
    expect(await switchTo("security")).toBe("/security/mitre?tactic=TA0001&org_identifier=acme");
  });

  it("goes straight back after a switch, even where another page matches", async () => {
    await mountSwitcher("/security/mitre");
    await visit("/logs?stream=app");
    await visit("/security/mitre");
    expect(await switchTo("observability")).toBe("/logs?stream=app&org_identifier=acme");
    expect(await switchTo("security")).toBe("/security/mitre?org_identifier=acme");
  });

  it("lands on the matching page again once the user has moved on", async () => {
    await mountSwitcher("/security/mitre");
    await switchTo("observability");
    await visit("/logs");
    expect(await switchTo("security")).toBe("/security/events?org_identifier=acme");
  });

  it("stays on a page both solutions share", async () => {
    await mountSwitcher("/settings/general");
    expect(await switchTo("security")).toBe("/settings/general");
  });
});
