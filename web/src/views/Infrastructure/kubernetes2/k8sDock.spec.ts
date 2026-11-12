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

import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import K8sDock from "./K8sDock.vue";
import { emptyDock, openTab, type DockState } from "./dockState";
import type { DetailsRef } from "./kubernetesUrlState";

enableAutoUnmount(afterEach);

const pod: DetailsRef = { kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" };

const logsStub = defineComponent({
  name: "K8sLogsPanel",
  setup: () => () => h("div", { "data-test": "stub-logs" }),
});
const yamlStub = defineComponent({
  name: "K8sYamlPanel",
  props: { row: { type: Object, default: null } },
  setup: (props) => () => h("div", { "data-test": "stub-yaml" }, String(props.row?.name ?? "none")),
});

const mountDock = (dock: DockState, props: Record<string, unknown> = {}) =>
  mount(K8sDock, {
    props: { dock, orgId: "org1", range: { start: 1, end: 2 }, rowOf: () => null, ...props },
    global: {
      plugins: [i18n],
      stubs: { K8sLogsPanel: logsStub, K8sYamlPanel: yamlStub },
    },
  });

const twoTabs = () => openTab(openTab(emptyDock(), "logs", pod), "yaml", pod);

describe("K8sDock", () => {
  it("renders nothing without tabs", () => {
    expect(mountDock(emptyDock()).find('[data-test="k8s2-dock"]').exists()).toBe(false);
  });

  it("shows a tab per entry with its kind label and pod name", () => {
    const wrapper = mountDock(twoTabs());
    const tabs = wrapper.find('[data-test="k8s2-dock-tabs"]').text();
    expect(tabs).toContain("Logs");
    expect(tabs).toContain("YAML");
    expect(tabs).toContain("web-1");
    expect(wrapper.findAll('[data-test^="k8s2-dock-close-"]')).toHaveLength(2);
  });

  it("renders the panel of the active tab", () => {
    const wrapper = mountDock(twoTabs());
    expect(wrapper.find('[data-test="stub-yaml"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stub-logs"]').exists()).toBe(false);
  });

  it("emits minimize, maximize and dismiss from the header buttons", async () => {
    const wrapper = mountDock(twoTabs());
    await wrapper.find('[data-test="k8s2-dock-minimize"]').trigger("click");
    await wrapper.find('[data-test="k8s2-dock-maximize"]').trigger("click");
    await wrapper.find('[data-test="k8s2-dock-dismiss"]').trigger("click");
    expect(wrapper.emitted("minimize")).toHaveLength(1);
    expect(wrapper.emitted("maximize")).toHaveLength(1);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });

  it("emits close with the tab id", async () => {
    const dock = twoTabs();
    const wrapper = mountDock(dock);
    await wrapper.find('[data-test="k8s2-dock-close-logs"]').trigger("click");
    expect(wrapper.emitted("close")).toEqual([[dock.tabs[0].id]]);
  });

  it("hides the panel body while minimized", () => {
    const wrapper = mountDock({ ...twoTabs(), open: false });
    expect(wrapper.find('[data-test="k8s2-dock"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stub-yaml"]').exists()).toBe(false);
  });

  it("stops short of the drawer when reserveDrawer is set", () => {
    const wrapper = mountDock(twoTabs(), { reserveDrawer: true });
    expect(wrapper.find('[data-test="k8s2-dock"]').classes()).toContain("lg:me-[40rem]");
    const plain = mountDock(twoTabs());
    expect(plain.find('[data-test="k8s2-dock"]').classes()).not.toContain("lg:me-[40rem]");
  });

  it("gives the YAML panel the tab snapshot when the page no longer lists the row", () => {
    const snapshot = { name: "from-snapshot" } as any;
    const dock = openTab(emptyDock(), "yaml", pod, snapshot);
    expect(mountDock(dock).find('[data-test="stub-yaml"]').text()).toBe("from-snapshot");
  });

  it("falls back to the live row when the tab has no snapshot", () => {
    const wrapper = mountDock(openTab(emptyDock(), "yaml", pod), {
      rowOf: () => ({ name: "live" }),
    });
    expect(wrapper.find('[data-test="stub-yaml"]').text()).toBe("live");
  });
});
