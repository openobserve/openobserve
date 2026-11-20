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
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import RoutePendingSkeleton from "./RoutePendingSkeleton.vue";

const Page = defineComponent({ render: () => h("div") });

const mountAt = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/streams", name: "logstreams", component: Page },
      { path: "/dashboards/view", name: "viewDashboard", component: Page },
      {
        path: "/iam",
        name: "iam",
        component: Page,
        children: [{ path: "roles", name: "roles", component: Page }],
      },
    ],
  });
  await router.push(path);
  return mount(RoutePendingSkeleton, { global: { plugins: [router, i18n] } });
};

describe("RoutePendingSkeleton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("draws a list's header, toolbar, column row and rows, and shows them only after the loader delay", async () => {
    const wrapper = await mountAt("/streams");
    const root = wrapper.get('[data-test="main-content-pending"]');
    expect(root.attributes("data-shape")).toBe("table");
    expect(root.classes()).toContain("invisible");
    for (const part of ["header", "toolbar", "thead"]) {
      expect(wrapper.find(`[data-test="main-content-pending-${part}"]`).exists()).toBe(true);
    }
    expect(wrapper.find('[data-preset="tableRows"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(150);
    expect(root.classes()).not.toContain("invisible");
  });

  it("draws a dashboard as a panel grid", async () => {
    const wrapper = await mountAt("/dashboards/view");
    expect(wrapper.get('[data-test="main-content-pending"]').attributes("data-shape")).toBe(
      "dashboard",
    );
    expect(wrapper.find('[data-test="main-content-pending-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="main-content-pending-toolbar"]').exists()).toBe(false);
  });

  it("keeps the IAM section rail beside the page", async () => {
    const wrapper = await mountAt("/iam/roles");
    expect(wrapper.find('[data-test="main-content-pending-rail"]').exists()).toBe(true);
  });
});
