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

// WorkflowRunSwitcher — the shared run-history dropdown (editor toolbar "History"
// and the NDV header). Contract tested here: which runs the menu offers. It reads
// the SAME shared runs list as the Runs table, so it has to make the same call
// about test runs — a published workflow's history is otherwise buried under
// rehearsals, and a menu that drops rows with no way to get them back is its own
// bug.

import { vi } from "vitest";

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("@/services/workflows", () => ({
  default: { getWorkflowHistory: (...a: any[]) => mockList(...a) },
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunSwitcher from "./WorkflowRunSwitcher.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

// ODropdown renders its menu in a portal behind an `open` model; render the
// content inline so the rows are assertable without driving the overlay.
const ODropdownStub = {
  name: "ODropdown",
  props: ["open", "align", "side"],
  template: `<div class="o-dropdown"><slot name="trigger" /><slot /></div>`,
};
const ODropdownItemStub = {
  name: "ODropdownItem",
  emits: ["click"],
  template: `<div class="o-dropdown-item" @click="$emit('click')"><slot /></div>`,
};
const stub = (name: string, props: string[] = []) => ({
  name,
  props,
  template: `<div class="${name}"><slot /></div>`,
});

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    ODropdown: ODropdownStub,
    ODropdownItem: ODropdownItemStub,
    OIcon: stub("OIcon", ["name", "size"]),
    OBadge: stub("OBadge", ["variant", "size"]),
    OTooltip: stub("OTooltip", ["side", "content", "maxWidth"]),
    OTimeCell: stub("OTimeCell", ["value", "unit", "mode", "timezone", "emptyLabel"]),
    ORefreshButton: stub("ORefreshButton", ["lastRunAt", "loading"]),
    OButton: stub("OButton", ["variant", "size", "iconLeft", "loading"]),
  },
};

const TEST_RUN = (id: string) => ({
  run_id: id,
  event_type: "Test",
  start_time: 1000,
  error: null,
});
const REAL_RUN = (id: string) => ({
  run_id: id,
  event_type: "AlertFired",
  start_time: 2000,
  error: null,
});

const mountSwitcher = (props: Record<string, any> = {}) =>
  mount(WorkflowRunSwitcher, {
    props: { currentRunId: "", orgId: "default", workflowId: "wf-1", ...props },
    global: globalCfg,
  });

const runIds = (wrapper: any) =>
  wrapper.findAll("[data-run-id]").map((el: any) => el.attributes("data-run-id"));

describe("WorkflowRunSwitcher — test runs in the History dropdown", () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    mockList.mockClear();
    mockList.mockResolvedValue({ data: [] });
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    } as any;
    workflowObj.currentSelectedWorkflow = { id: "wf-1", nodes: [], edges: [] } as any;
  });

  // The reported bug: 24 test runs on a published workflow, no real ones findable.
  it("hides test runs on a PUBLISHED workflow", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), REAL_RUN("r1"), TEST_RUN("t2")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    expect(runIds(wrapper)).toEqual(["r1"]);
  });

  // The regression risk: a draft's history is almost entirely test runs, and
  // that is exactly what its author wants to see.
  it("shows test runs on a DRAFT", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = true;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), REAL_RUN("r1")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    expect(runIds(wrapper).sort()).toEqual(["r1", "t1"]);
  });

  // Silently dropping rows is the bug this fix must not introduce.
  it("offers a reveal control naming how many runs are withheld", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), TEST_RUN("t2"), REAL_RUN("r1")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    const toggle = wrapper.find('[data-test="workflow-run-switcher-show-test"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain("2");
  });

  it("reveals the hidden test runs when that control is used", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), REAL_RUN("r1")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    await wrapper.find('[data-test="workflow-run-switcher-show-test"]').trigger("click");
    expect(runIds(wrapper).sort()).toEqual(["r1", "t1"]);
  });

  // A control that claims to hide something when nothing is hidden is noise, and
  // on a draft (where they are already shown) it would misdescribe the state.
  it("offers no reveal control when there are no test runs to withhold", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [REAL_RUN("r1")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-run-switcher-show-test"]').exists()).toBe(false);
  });

  // A published workflow whose ONLY runs are tests must not look like it never
  // ran — the empty state has to point at the runs it is holding back.
  it("still offers the reveal control when every run is withheld", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), TEST_RUN("t2")] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    expect(runIds(wrapper)).toEqual([]);
    expect(wrapper.find('[data-test="workflow-run-switcher-show-test"]').exists()).toBe(true);
  });

  // The run loaded on the canvas must stay reachable/visible even if it is a test
  // run, or the checkmarked "current" row vanishes from its own menu.
  it("keeps the currently-loaded run listed even when it is a test run", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    workflowObj.runsHistory.list = [TEST_RUN("t1"), REAL_RUN("r1")] as any;
    const wrapper = mountSwitcher({ currentRunId: "t1" });
    await flushPromises();
    expect(runIds(wrapper).sort()).toEqual(["r1", "t1"]);
  });

  it("still sorts newest-first and emits the picked run id", async () => {
    workflowObj.currentSelectedWorkflow.isDraft = true;
    workflowObj.runsHistory.list = [
      { ...REAL_RUN("old"), start_time: 1 },
      { ...REAL_RUN("new"), start_time: 9 },
    ] as any;
    const wrapper = mountSwitcher();
    await flushPromises();
    expect(runIds(wrapper)).toEqual(["new", "old"]);
    await wrapper.findAll(".o-dropdown-item")[1].trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["old"]);
  });
});
