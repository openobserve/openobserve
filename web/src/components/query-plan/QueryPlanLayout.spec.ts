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
import { computed, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import QueryPlanLayout from "./QueryPlanLayout.vue";

const desktop = ref(true);
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isDesktop: computed(() => desktop.value) }),
}));

let wrapper: VueWrapper;

function mountLayout(selectedId: string | null = "op") {
  return mount(QueryPlanLayout, {
    props: { selectedId },
    slots: {
      summary: '<div data-test="summary-content">summary</div>',
      canvas:
        '<template #canvas="{ leftInset }"><div data-test="inset">{{ leftInset }}</div></template>',
      detail: '<div data-test="detail-content">detail</div>',
    },
    global: { plugins: [i18n] },
  });
}

const visible = (selector: string) =>
  wrapper.find(`[data-test="${selector}"]`).attributes("style")?.includes("display: none") !== true;

afterEach(async () => {
  if (wrapper.find('[data-test="query-plan-show-summary"]').exists()) {
    await wrapper.find('[data-test="query-plan-show-summary"]').trigger("click");
  }
  if (wrapper.find('[data-test="query-plan-show-detail"]').exists()) {
    await wrapper.find('[data-test="query-plan-show-detail"]').trigger("click");
  }
  wrapper.unmount();
  desktop.value = true;
});

describe("QueryPlanLayout", () => {
  it("hides and restores the summary panel, moving the canvas inset", async () => {
    wrapper = mountLayout();
    expect(visible("query-plan-summary-panel")).toBe(true);
    await wrapper.find('[data-test="query-plan-hide-summary"]').trigger("click");
    expect(visible("query-plan-summary-panel")).toBe(false);
    expect(wrapper.find('[data-test="inset"]').text()).toBe("56");
    await wrapper.find('[data-test="query-plan-show-summary"]').trigger("click");
    expect(visible("query-plan-summary-panel")).toBe(true);
    expect(wrapper.find('[data-test="query-plan-show-summary"]').exists()).toBe(false);
  });

  it("hides the detail panel and gives its column back to the canvas", async () => {
    wrapper = mountLayout();
    await wrapper.find('[data-test="query-plan-hide-detail"]').trigger("click");
    expect(visible("query-plan-detail-panel")).toBe(false);
    expect(wrapper.classes()).toContain("grid-cols-[minmax(0,1fr)]");
    expect(wrapper.find('[data-test="query-plan-show-detail"]').exists()).toBe(true);
  });

  it("brings the detail panel back when another operator is picked", async () => {
    wrapper = mountLayout("a");
    await wrapper.find('[data-test="query-plan-hide-detail"]').trigger("click");
    await wrapper.setProps({ selectedId: "b" });
    expect(visible("query-plan-detail-panel")).toBe(true);
  });

  it("keeps a hidden panel hidden in the other view", async () => {
    wrapper = mountLayout();
    await wrapper.find('[data-test="query-plan-hide-summary"]').trigger("click");
    wrapper.unmount();
    wrapper = mountLayout();
    expect(visible("query-plan-summary-panel")).toBe(false);
  });

  it("shows both panels and no toggles in the stacked layout", async () => {
    desktop.value = false;
    wrapper = mountLayout();
    expect(visible("query-plan-summary-panel")).toBe(true);
    expect(visible("query-plan-detail-panel")).toBe(true);
    expect(wrapper.find('[data-test="query-plan-hide-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="query-plan-hide-detail"]').exists()).toBe(false);
  });
});
