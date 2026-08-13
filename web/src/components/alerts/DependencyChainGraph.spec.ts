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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

// VueFlow mock renders the #node-dep slot per node so node cards (and their
// open / delete inline-confirm handlers) are exercised.
vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges"],
    template: `<div class="vue-flow-mock">
      <div v-for="n in nodes" :key="n.id"><slot name="node-dep" :data="n.data" /></div>
    </div>`,
  },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  MarkerType: { Arrow: "arrow", ArrowClosed: "arrowclosed" },
  Handle: { name: "Handle", template: "<div class='handle-mock' />" },
}));
vi.mock("@vue-flow/background", () => ({
  Background: { name: "Background", template: "<div class='background-mock' />" },
}));

vi.mock("@/services/alerts", () => ({
  default: { listByFolderId: vi.fn(), delete_by_alert_id: vi.fn() },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/services/alert_templates", () => ({
  default: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

import DependencyChainGraph from "./DependencyChainGraph.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const TEMPLATES = [{ name: "tpl-http", type: "http" }];
const DESTINATIONS = [{ name: "slack", type: "http", template: "tpl-http" }];
const seedAlerts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    alert_id: `a${i}`,
    name: `alert-${i}`,
    destinations: ["slack"],
    enabled: true,
    folder_id: "default",
  }));

function mountGraph(focus: Record<string, unknown>): VueWrapper {
  return mount(DependencyChainGraph, {
    props: { focus },
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OIcon: { template: "<i />" },
        OTag: { template: "<span><slot /></span>" },
        OSpinner: { template: "<div class='spinner' />" },
        OBanner: { template: "<div class='banner' />" },
      },
    },
  });
}

const nodeTests = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test^="dependency-graph-node-"]').map((n) => n.attributes("data-test"));

describe("DependencyChainGraph", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(destinationService.list).mockResolvedValue({ data: DESTINATIONS } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: TEMPLATES } as any);
    vi.mocked(destinationService.delete).mockResolvedValue({} as any);
  });
  afterEach(() => wrapper?.unmount());

  it("renders the focused chain as graph nodes (template + destination + alerts)", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(3) },
    } as any);
    wrapper = mountGraph({ kind: "destination", name: "slack" });
    await flushPromises();
    const tests = nodeTests(wrapper);
    expect(tests).toContain("dependency-graph-node-template-tpl-http");
    expect(tests).toContain("dependency-graph-node-destination-slack");
    expect(tests).toContain("dependency-graph-node-alert-alert-0");
    expect(wrapper.find('[data-test="dependency-graph-pager"]').exists()).toBe(false);
  });

  it("pages the alert nodes 10 at a time with prev/next", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(25) },
    } as any);
    wrapper = mountGraph({ kind: "destination", name: "slack" });
    await flushPromises();

    const alertNodes = () =>
      wrapper
        .findAll('[data-test^="dependency-graph-node-alert-"]')
        .map((n) => n.attributes("data-test"));

    expect(alertNodes()).toHaveLength(10);
    expect(alertNodes()).toContain("dependency-graph-node-alert-alert-0");
    expect(alertNodes()).not.toContain("dependency-graph-node-alert-alert-10");

    await wrapper.find('[data-test="dependency-graph-next"]').trigger("click");
    await nextTick();
    expect(alertNodes()).toContain("dependency-graph-node-alert-alert-10");
    expect(alertNodes()).not.toContain("dependency-graph-node-alert-alert-0");
  });

  it("delete → inline confirm → confirm-yes calls the API and emits 'deleted'", async () => {
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: { list: seedAlerts(1) },
    } as any);
    wrapper = mountGraph({ kind: "destination", name: "slack" });
    await flushPromises();
    await wrapper.find('[data-test="dependency-graph-delete-slack"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="dependency-graph-confirm-yes-slack"]').trigger("click");
    await flushPromises();
    expect(destinationService.delete).toHaveBeenCalledWith(
      expect.objectContaining({ destination_name: "slack" }),
    );
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });
});
