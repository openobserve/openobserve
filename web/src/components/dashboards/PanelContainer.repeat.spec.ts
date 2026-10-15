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
import PanelContainer from "@/components/dashboards/PanelContainer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/utils/commons", () => ({ addPanel: vi.fn().mockResolvedValue(undefined) }));

const source = {
  id: "cpu",
  title: "CPU",
  description: "",
  type: "line",
  queries: [],
  layout: { x: 0, y: 0, w: 96, h: 18 },
  repeat: { variable: "host", direction: "h", maxPerRow: 4 },
};
const copy = { ...source, id: "cpu__r__web" };

const pinnedVariables = {
  isVariablesLoading: false,
  values: [{ name: "host", scope: "global", type: "query_values", value: ["web"] }],
};

const copyRepeat = {
  sourceId: "cpu",
  sourceTitle: "CPU",
  variable: "host",
  value: "web",
  index: 0,
  count: 50,
  total: 132,
};

describe("PanelContainer – repeat by variable", () => {
  let wrapper: any;

  beforeEach(() => {
    store.state.selectedOrganization = { identifier: "test-org" };
    (store.state as any).zoConfig = { quick_mode_enabled: false };
  });

  afterEach(() => wrapper?.unmount());

  const createWrapper = (
    props: Record<string, any>,
    extraStubs: Record<string, any> = {},
    provide: Record<string, any> = {},
  ) =>
    mount(PanelContainer, {
      props: {
        data: source,
        variablesData: pinnedVariables,
        currentVariablesData: pinnedVariables,
        selectedTimeDate: {},
        viewOnly: false,
        layoutMode: "view",
        dashboardId: "d1",
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        provide,
        stubs: {
          PanelSchemaRenderer: {
            name: "PanelSchemaRenderer",
            props: ["panelSchema"],
            template: '<div data-test="panel-schema-renderer"></div>',
          },
          QueryInspector: true,
          ShowLegendsPopup: true,
          PanelErrorButtons: true,
          ...extraStubs,
        },
      },
    });

  it("shows a copy's value beside the title, outside the truncating part", () => {
    wrapper = createWrapper({ data: copy, repeat: copyRepeat });
    expect(wrapper.find('[data-test="dashboard-panel-header"]').text()).toBe("CPU");
    const value = wrapper.find('[data-test="dashboard-panel-repeat-value"]');
    expect(value.text()).toContain("web");
    expect(wrapper.find('[data-test="dashboard-panel-header"]').classes()).toContain("shrink-[4]");
    expect(wrapper.find('[data-test="dashboard-panel-repeat-copy-icon"]').exists()).toBe(true);
  });

  it("cuts a long value in the middle so copies sharing a prefix stay distinguishable", () => {
    const id = "01a11532b0287c23f9e0d1c2b3a4f5e6d7c8";
    wrapper = createWrapper({ data: copy, repeat: { ...copyRepeat, value: id } });
    const tail = wrapper.find('[data-test="dashboard-panel-repeat-value-tail"]');
    expect(tail.text()).toBe(id.slice(-8));
    expect(tail.classes()).toContain("shrink-0");
  });

  it("keeps the value visible when the title names the variable, so the title cuts first", () => {
    wrapper = createWrapper({
      data: { ...copy, title: "pt-repeat-layout2 tabpanel $host" },
      repeat: { ...copyRepeat, value: "alert" },
    });
    const header = wrapper.find('[data-test="dashboard-panel-header"]');
    expect(header.text()).toBe("pt-repeat-layout2 tabpanel");
    expect(header.classes()).toContain("shrink-[4]");
    const value = wrapper.find('[data-test="dashboard-panel-repeat-value"]');
    expect(value.text()).toBe("alert");
    expect(value.find(".shrink-0").text()).toBe("alert");
  });

  it("says only the first values are shown when the total is unknown", () => {
    wrapper = createWrapper({
      data: copy,
      repeat: { ...copyRepeat, count: 10, total: 10, more: true },
    });
    expect(wrapper.find('[data-test="dashboard-panel-repeat-cap"]').text()).toBe(
      "Showing the first 10 values — narrow the selection",
    );
  });

  it("shows the real total below the header, not in it", () => {
    wrapper = createWrapper({ data: copy, repeat: { ...copyRepeat, total: 3472 } });
    const notice = wrapper.find('[data-test="dashboard-panel-repeat-cap"]');
    expect(notice.text()).toBe("Showing 50 of 3472 values — narrow the selection");
    const bar = wrapper.find('[data-test="dashboard-panel-bar"]');
    expect(bar.find('[data-test="dashboard-panel-repeat-cap"]').exists()).toBe(false);
  });

  it("warns that deleting a copy removes the original and every copy", () => {
    wrapper = createWrapper({ data: copy, repeat: { ...copyRepeat, count: 5 } });
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("message")).toBe(
      "This deletes the original panel CPU and all 5 copies. Are you sure?",
    );
    expect(dialog.props("okLabel")).toBe("Delete");
  });

  it("says a copy's delete in a per-value tab removes it from every per-value tab", async () => {
    await router.replace({ query: { tab: "svc__r__web" } });
    wrapper = createWrapper({ data: copy, repeat: { ...copyRepeat, count: 4 } });
    expect(wrapper.findComponent({ name: "ConfirmDialog" }).props("message")).toBe(
      "This deletes the original panel “CPU” and all 4 copies from every per-value tab. Are you sure?",
    );
    await router.replace({ query: {} });
  });

  it("keeps main's delete dialog for an ordinary panel", () => {
    wrapper = createWrapper({ data: { ...source, repeat: undefined } });
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("message")).toBe("Are you sure you want to delete this Panel?");
    expect(dialog.props("okLabel")).toBeUndefined();
  });

  it("names the original in the copy's edit and delete actions", () => {
    wrapper = createWrapper(
      { data: copy, repeat: copyRepeat },
      {
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        ODropdownItem: { template: "<div v-bind='$attrs'><slot /></div>" },
        ODropdownGroup: { template: "<div v-bind='$attrs'><slot /></div>" },
      },
    );
    expect(wrapper.find('[data-test="dashboard-edit-panel"]').text()).toContain(
      "Edit original panel",
    );
    expect(wrapper.find('[data-test="dashboard-delete-panel"]').text()).toContain(
      "Delete original panel",
    );
    expect(wrapper.find('[data-test="dashboard-duplicate-panel"]').text()).toContain(
      "Duplicate original panel",
    );
    expect(wrapper.find('[data-test="dashboard-move-to-another-panel"]').text()).toContain(
      "Move original panel to another tab",
    );
    const order = wrapper
      .findAll("[data-test]")
      .map((el: any) => el.attributes("data-test"))
      .filter((id: string) =>
        [
          "dashboard-delete-panel",
          "dashboard-move-to-another-panel",
          "dashboard-panel-copy-actions-label",
          "dashboard-refresh-without-cache",
        ].includes(id),
      );
    expect(order).toEqual([
      "dashboard-delete-panel",
      "dashboard-move-to-another-panel",
      "dashboard-panel-copy-actions-label",
      "dashboard-refresh-without-cache",
    ]);
  });

  it("shows the cap notice on the first copy only", () => {
    wrapper = createWrapper({ data: copy, repeat: copyRepeat });
    expect(wrapper.find('[data-test="dashboard-panel-repeat-cap"]').text()).toContain("50");
    wrapper.unmount();
    wrapper = createWrapper({ data: copy, repeat: { ...copyRepeat, index: 1 } });
    expect(wrapper.find('[data-test="dashboard-panel-repeat-cap"]').exists()).toBe(false);
  });

  it("substitutes $var in a plain panel title", () => {
    wrapper = createWrapper({ data: { ...source, title: "CPU on $host", repeat: undefined } });
    expect(wrapper.find('[data-test="dashboard-panel-header"]').text()).toBe("CPU on web");
  });

  it("sends delete and move from a copy to the source panel", async () => {
    wrapper = createWrapper({ data: copy, repeat: copyRepeat });
    await wrapper.vm.deletePanelDialog();
    await wrapper.vm.movePanelDialog("tab-2");
    expect(wrapper.emitted("onDeletePanel")[0]).toEqual(["cpu"]);
    expect(wrapper.emitted("onMovePanel")[0]).toEqual(["cpu", "tab-2"]);
  });

  it("acts on the source panel and tab from a panel inside a virtual tab", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
    await router.replace({ query: { tab: "svc__r__web" } });
    const data = { ...source, id: "cpu__r__web", repeat: undefined, panels: [{ tabId: "t" }] };
    const variablesManager = {
      getUrlParams: () => ({ "var-status": ["error", "firing"], "var-trace": ["_o2_all_"] }),
    };
    wrapper = createWrapper({ data }, {}, { variablesManager });
    await wrapper.vm.deletePanelDialog();
    expect(wrapper.emitted("onDeletePanel")[0]).toEqual(["cpu"]);
    await wrapper.vm.onEditPanel(data);
    expect(push.mock.calls[0][0].query).toMatchObject({
      panelId: "cpu",
      tab: "svc",
      fromTab: "svc__r__web",
      "var-status": ["error", "firing"],
      "var-trace": ["_o2_all_"],
    });
    expect(wrapper.findComponent({ name: "ConfirmDialog" }).props("message")).toBe(
      "“CPU” belongs to the original tab, so deleting it removes it from every per-value tab. Are you sure?",
    );
    push.mockRestore();
    await router.replace({ query: {} });
  });

  it("opens the source panel in the editor from a copy", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
    const data = { ...copy, panels: [{ tabId: "t1" }] };
    wrapper = createWrapper({ data, repeat: copyRepeat });
    await wrapper.vm.onEditPanel(data);
    expect(push.mock.calls[0][0].query.panelId).toBe("cpu");
    push.mockRestore();
  });

  it("shows the repeat chip on the source while the layout is edited", () => {
    wrapper = createWrapper({
      layoutMode: "edit",
      repeat: { sourceId: "cpu", variable: "host", count: 5, total: 5 },
    });
    const chip = wrapper.find('[data-test="dashboard-panel-repeat-chip"]');
    expect(chip.text()).toContain("$host");
    expect(chip.text()).toContain("5");
    expect(wrapper.find('[data-test="dashboard-panel-header"]').text()).toBe("CPU");
  });
});
