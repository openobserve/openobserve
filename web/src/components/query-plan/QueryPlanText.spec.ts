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
import type { AnalyzeRow } from "@/utils/queryProfile";
import QueryPlanText from "./QueryPlanText.vue";

const copyToClipboard = vi.fn(() => Promise.resolve(true));
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...(args as [])),
}));

const ROWS: AnalyzeRow[] = [
  {
    id: 0,
    phase: 0,
    node: "querier-0",
    address: "http://q0:5081",
    plan: "ProjectionExec: expr=[a], metrics=[output_rows=1]\n  RemoteScanExec: x",
  },
  { id: 1, phase: 1, node: "ingester-1", address: "http://i1:5081", plan: "EmptyExec, metrics=[]" },
];

function mountText(analyzeRows: AnalyzeRow[] | null = null) {
  return mount(QueryPlanText, {
    props: { physicalPlan: AGG_PHYSICAL_PLAN, logicalPlan: AGG_LOGICAL_PLAN, analyzeRows },
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

  it("lists the analyze output one row per node, with its phase and address", async () => {
    wrapper = mountText(ROWS);
    expect(wrapper.find('[data-test="query-plan-text-tab-analyze"]').exists()).toBe(true);
    await selectTab(wrapper, "analyze");
    const table = wrapper.find('[data-test="query-plan-text-analyze-table"]');
    const headers = table.findAll("th").map((th) => th.text());
    expect(headers).toEqual(["Phase", "Node", "Address", "Plan"]);
    const rows = table.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("querier-0");
    expect(rows[0].text()).toContain("http://q0:5081");
    expect(rows[0].findAll('[data-test^="query-plan-text-line-"]')).toHaveLength(2);
    expect(rows[0].find('[data-test="query-plan-text-op-2"]').text()).toBe("RemoteScanExec");
    expect(rows[1].text()).toContain("ingester-1");
    await wrapper.setProps({ analyzeRows: null });
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

  it("copies the analyze output as the JSON rows the logs page shows", async () => {
    wrapper = mountText(ROWS);
    await selectTab(wrapper, "analyze");
    await wrapper.find('[data-test="query-plan-text-copy"]').trigger("click");
    const copied = JSON.parse((copyToClipboard.mock.calls[0] as unknown[])[0] as string);
    expect(copied).toEqual([
      { phase: 0, node_address: "http://q0:5081", node_name: "querier-0", plan: ROWS[0].plan },
      { phase: 1, node_address: "http://i1:5081", node_name: "ingester-1", plan: ROWS[1].plan },
    ]);
    expect(Object.keys(copied[0])).toEqual(["phase", "node_address", "node_name", "plan"]);
  });

  it("shows an empty state when a plan is missing", () => {
    wrapper = mount(QueryPlanText, {
      props: { physicalPlan: "", logicalPlan: "", analyzeRows: null },
      global: { plugins: [store, i18n] },
    });
    expect(wrapper.find('[data-test="query-plan-text-empty"]').text()).toBe(
      "No physical plan available",
    );
    expect(wrapper.find('[data-test="query-plan-text-copy"]').attributes("disabled")).toBeDefined();
  });
});
