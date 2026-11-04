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
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import PipelineSectionTabs from "./PipelineSectionTabs.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { provideFeatureLock } from "@/composables/useFeatureLock";

const Empty = { template: "<div />" };
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: Empty },
    { path: "/pipelines", name: "pipelines", component: Empty },
    { path: "/functions", name: "functionList", component: Empty },
    { path: "/enrichment", name: "enrichmentTables", component: Empty },
  ],
});

const mountTabs = (component: unknown = PipelineSectionTabs) =>
  mount(component as typeof PipelineSectionTabs, {
    global: { provide: { store }, plugins: [i18n, router] },
  });

const lock = (wrapper: ReturnType<typeof mountTabs>, key: string) =>
  wrapper.find(`[data-test="pipeline-section-tab-${key}-lock"]`).exists();

describe("PipelineSectionTabs license", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    store.state.zoConfig.custom_hide_menus = "";
    await router.push({ name: "pipelines" });
    await router.isReady();
  });

  afterEach(() => {
    delete store.state.zoConfig.features;
  });

  it("locks only the stream pipelines tab when pipelines is locked", () => {
    store.state.zoConfig.features = { pipelines: "locked" };
    const wrapper = mountTabs();
    expect(lock(wrapper, "streamPipelines")).toBe(true);
    expect(lock(wrapper, "functions")).toBe(false);
    expect(lock(wrapper, "enrichmentTables")).toBe(false);
  });

  it("shows every tab without a lock when pipelines is enabled", () => {
    store.state.zoConfig.features = { pipelines: "enabled" };
    const wrapper = mountTabs();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(3);
    expect(wrapper.find('[data-test$="-lock"]').exists()).toBe(false);
  });

  it("drops the stream pipelines tab when pipelines is hidden", () => {
    store.state.zoConfig.features = { pipelines: "hidden" };
    const wrapper = mountTabs();
    expect(wrapper.find('[data-test="pipeline-section-tab-streamPipelines"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="pipeline-section-tab-functions"]').exists()).toBe(true);
  });

  it("still navigates to the free functions from a license-locked pipelines page", async () => {
    store.state.zoConfig.features = { pipelines: "locked" };
    const push = vi.spyOn(router, "push");
    const LockedPage = defineComponent({
      setup() {
        provideFeatureLock(ref("pipelines"));
        return () => h(PipelineSectionTabs);
      },
    });
    const wrapper = mountTabs(LockedPage);
    await wrapper.find('[data-test="pipeline-section-tab-functions"]').trigger("mousedown");
    expect(push).toHaveBeenCalledWith({
      name: "functionList",
      query: { org_identifier: store.state.selectedOrganization.identifier },
    });
  });
});
