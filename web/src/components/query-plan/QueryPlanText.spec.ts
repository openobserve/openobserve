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
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { AGG_LOGICAL_PLAN, AGG_PHYSICAL_PLAN } from "@/utils/__fixtures__/queryProfile.fixture";
import QueryPlanText from "./QueryPlanText.vue";

const copyToClipboard = vi.fn(() => Promise.resolve(true));
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...(args as [])),
}));

function mountText(analyzePlan: string | null = null) {
  return mount(QueryPlanText, {
    props: { physicalPlan: AGG_PHYSICAL_PLAN, logicalPlan: AGG_LOGICAL_PLAN, analyzePlan },
    global: { plugins: [store, i18n] },
  });
}

async function selectTab(wrapper: VueWrapper, name: string) {
  wrapper.findComponent(OTabs).vm.$emit("update:modelValue", name);
  await wrapper.vm.$nextTick();
}

describe("QueryPlanText", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    copyToClipboard.mockClear();
  });

  it("shows the physical plan with line numbers, coloured operators and indent guides", () => {
    wrapper = mountText();
    const lines = wrapper.findAll('[data-test^="query-plan-text-line-"]');
    expect(lines).toHaveLength(12);
    expect(lines[0].text()).toMatch(/^1\s*SortPreservingMergeExec: \[cnt@1 DESC\], fetch=10$/);
    const filterLine = lines[10];
    expect(filterLine.findAll(".border-s")).toHaveLength(10);
    const op = wrapper.find('[data-test="query-plan-text-op-11"]');
    expect(op.text()).toBe("FilterExec");
    expect(op.classes()).toContain("text-badge-error-soft-text");
    expect(wrapper.find('[data-test="query-plan-text-op-12"]').classes()).toContain(
      "text-badge-teal-soft-text",
    );
  });

  it("switches to the logical plan and hides the analyze tab until a run exists", async () => {
    wrapper = mountText();
    expect(wrapper.find('[data-test="query-plan-text-tab-analyze"]').exists()).toBe(false);
    await selectTab(wrapper, "logical");
    expect(wrapper.find('[data-test="query-plan-text-line-1"]').text()).toContain(
      "Sort: cnt DESC NULLS FIRST",
    );
    expect(wrapper.find('[data-test="query-plan-text-op-5"]').text()).toBe("TableScan");
  });

  it("shows the analyze output when one exists", async () => {
    wrapper = mountText("ProjectionExec: expr=[a], metrics=[output_rows=1]\n  DataSourceExec: x");
    expect(wrapper.find('[data-test="query-plan-text-tab-analyze"]').exists()).toBe(true);
    await selectTab(wrapper, "analyze");
    expect(wrapper.findAll('[data-test^="query-plan-text-line-"]')).toHaveLength(2);
    await wrapper.setProps({ analyzePlan: null });
    expect(wrapper.find('[data-test="query-plan-text-line-1"]').text()).toContain(
      "SortPreservingMergeExec",
    );
  });

  it("toggles line wrapping", async () => {
    wrapper = mountText();
    const content = () => wrapper.find('[data-test="query-plan-text-line-1"] span:nth-child(2)');
    expect(content().classes()).toContain("whitespace-pre-wrap");
    await wrapper.find('[data-test="query-plan-text-wrap-btn"]').trigger("click");
    expect(content().classes()).toContain("whitespace-pre");
    expect(content().classes()).not.toContain("whitespace-pre-wrap");
  });

  it("copies the visible plan", async () => {
    wrapper = mountText();
    await selectTab(wrapper, "logical");
    await wrapper.find('[data-test="query-plan-text-copy"]').trigger("click");
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect((copyToClipboard.mock.calls[0] as unknown[])[0]).toBe(AGG_LOGICAL_PLAN);
  });

  it("shows an empty state when a plan is missing", () => {
    wrapper = mount(QueryPlanText, {
      props: { physicalPlan: "", logicalPlan: "", analyzePlan: null },
      global: { plugins: [store, i18n] },
    });
    expect(wrapper.find('[data-test="query-plan-text-empty"]').text()).toBe(
      "No physical plan available",
    );
    expect(wrapper.find('[data-test="query-plan-text-copy"]').attributes("disabled")).toBeDefined();
  });
});
