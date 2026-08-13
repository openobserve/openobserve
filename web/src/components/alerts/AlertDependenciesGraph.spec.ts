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

// ── vue-flow + service + toast mocks (hoisted above imports) ──────────────────
// The VueFlow mock RENDERS the #node-dep slot per node so node cards (and their
// click / Open / Delete handlers) are exercised — the real canvas isn't needed.
vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges"],
    template: `<div class="vue-flow-mock">
      <div v-for="n in nodes" :key="n.id" class="vf-node">
        <slot name="node-dep" :data="n.data" />
      </div>
    </div>`,
  },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  MarkerType: { Arrow: "arrow", ArrowClosed: "arrowclosed" },
  Handle: { name: "Handle", template: "<div class='handle-mock' />" },
  useVueFlow: vi.fn(() => ({ fitView: vi.fn(), setNodes: vi.fn() })),
}));
vi.mock("@vue-flow/background", () => ({
  Background: { name: "Background", template: "<div class='background-mock' />" },
}));
vi.mock("@vue-flow/controls", () => ({
  Controls: { name: "Controls", template: "<div class='controls-mock'><slot name='top' /></div>" },
  ControlButton: { name: "ControlButton", template: "<button><slot /></button>" },
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

import AlertDependenciesGraph from "./AlertDependenciesGraph.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ── fixtures ──────────────────────────────────────────────────────────────────
// tpl-http feeds slack (linked); tpl-orphan feeds nothing (unused). slack is used
// by 1 alert; pager is used by none (unused); ghost is referenced by an alert but
// isn't a real destination (dangling/broken).
const TEMPLATES = [
  { name: "tpl-http", type: "http" },
  { name: "tpl-orphan", type: "email" },
];
const DESTINATIONS = [
  { name: "slack", type: "http", template: "tpl-http" },
  { name: "pager", type: "http" },
];
const ALERTS = [
  { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true, folder_id: "default" },
  { alert_id: "a2", name: "disk", destinations: ["ghost"], enabled: true, folder_id: "default" },
];

// Bind $attrs only (the parent's @click lands here as onClick). Re-emitting a
// 'click' on top would double-fire handlers via the passed-through listener.
const OStub = (tag: string) => ({
  template: `<${tag} v-bind="$attrs"><slot /></${tag}>`,
});

function mountGraph(props: Record<string, unknown> = {}): VueWrapper {
  return mount(AlertDependenciesGraph, {
    props,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OButton: OStub("button"),
        OIcon: { template: "<i />" },
        OTag: { template: "<span class='o-tag'><slot /></span>" },
        OTooltip: { template: "<span />" },
        OSearchInput: { template: "<input />" },
        OToggleGroup: { template: "<div><slot /></div>" },
        OToggleGroupItem: { template: "<button><slot /></button>" },
        OSpinner: { template: "<div class='spinner' />" },
        OBanner: { template: "<div class='banner' />" },
        OEmptyState: { template: "<div class='empty-state' />" },
        ConfirmDialog: {
          name: "ConfirmDialog",
          props: ["modelValue", "title", "message"],
          emits: ["update:ok", "update:cancel"],
          template: "<div class='confirm-dialog' />",
        },
      },
    },
  });
}

const nodeTests = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test^="alert-dependencies-node-"]').map((n) => n.attributes("data-test"));

describe("AlertDependenciesGraph", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: ALERTS } } as any);
    vi.mocked(destinationService.list).mockResolvedValue({ data: DESTINATIONS } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: TEMPLATES } as any);
    vi.mocked(destinationService.delete).mockResolvedValue({} as any);
    vi.mocked(templateService.delete).mockResolvedValue({} as any);
    vi.mocked(alertsService.delete_by_alert_id).mockResolvedValue({} as any);
  });
  afterEach(() => wrapper?.unmount());

  it("defaults to the Linked filter: shows in-use destinations + their template, collapsed", async () => {
    wrapper = mountGraph();
    await flushPromises();
    const tests = nodeTests(wrapper);
    // slack (linked) + tpl-http (feeds it); pager/ghost/tpl-orphan hidden; no alerts yet.
    expect(tests).toContain("alert-dependencies-node-destination-slack");
    expect(tests).toContain("alert-dependencies-node-template-tpl-http");
    expect(tests).not.toContain("alert-dependencies-node-destination-pager");
    expect(tests.some((t) => t?.startsWith("alert-dependencies-node-alert-"))).toBe(false);
  });

  it("Expand all reveals the alerts under a linked destination", async () => {
    wrapper = mountGraph();
    await flushPromises();
    (wrapper.vm as any).toggleExpandAll();
    await nextTick();
    expect(nodeTests(wrapper)).toContain("alert-dependencies-node-alert-cpu");
    // Collapsing again hides them.
    (wrapper.vm as any).toggleExpandAll();
    await nextTick();
    expect(nodeTests(wrapper)).not.toContain("alert-dependencies-node-alert-cpu");
  });

  it("All shows orphan templates too (regression: they used to appear only under Unused)", async () => {
    wrapper = mountGraph();
    await flushPromises();
    (wrapper.vm as any).activeFilter = "all";
    await nextTick();
    const tests = nodeTests(wrapper);
    expect(tests).toContain("alert-dependencies-node-template-tpl-orphan");
    expect(tests).toContain("alert-dependencies-node-destination-pager");
  });

  it("Unused shows only orphan destinations and templates", async () => {
    wrapper = mountGraph();
    await flushPromises();
    (wrapper.vm as any).activeFilter = "orphan";
    await nextTick();
    const tests = nodeTests(wrapper);
    expect(tests).toContain("alert-dependencies-node-destination-pager");
    expect(tests).toContain("alert-dependencies-node-template-tpl-orphan");
    expect(tests).not.toContain("alert-dependencies-node-destination-slack");
  });

  it("Broken shows the missing destination and the alert pointing at it", async () => {
    wrapper = mountGraph();
    await flushPromises();
    (wrapper.vm as any).activeFilter = "broken";
    await nextTick();
    const tests = nodeTests(wrapper);
    expect(tests).toContain("alert-dependencies-node-destination-ghost");
    expect(tests).toContain("alert-dependencies-node-alert-disk");
  });

  it("focus on a destination shows its template + alerts, not sibling destinations", async () => {
    wrapper = mountGraph({ embedded: true, focus: { kind: "destination", name: "slack" } });
    await flushPromises();
    const tests = nodeTests(wrapper);
    expect(tests).toContain("alert-dependencies-node-destination-slack");
    expect(tests).toContain("alert-dependencies-node-template-tpl-http");
    expect(tests).toContain("alert-dependencies-node-alert-cpu");
    // A shared template must NOT drag in the unrelated 'pager' destination.
    expect(tests).not.toContain("alert-dependencies-node-destination-pager");
  });

  it("a bare click on a template/alert does NOT navigate (Open button is the only redirect)", async () => {
    wrapper = mountGraph();
    await flushPromises();
    const push = vi.spyOn(router, "push");
    await wrapper.find('[data-test="alert-dependencies-node-template-tpl-http"]').trigger("click");
    expect(push).not.toHaveBeenCalled();

    // The Open button DOES navigate.
    await wrapper.find('[data-test="alert-dependencies-open-tpl-http"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alertTemplates",
        query: expect.objectContaining({ name: "tpl-http" }),
      }),
    );
  });

  it("clicking a linked destination expands its alerts (no navigation)", async () => {
    wrapper = mountGraph();
    await flushPromises();
    const push = vi.spyOn(router, "push");
    await wrapper.find('[data-test="alert-dependencies-node-destination-slack"]').trigger("click");
    await nextTick();
    expect(push).not.toHaveBeenCalled();
    expect(nodeTests(wrapper)).toContain("alert-dependencies-node-alert-cpu");
  });

  it("deleting an unused destination calls the API and emits 'deleted'", async () => {
    wrapper = mountGraph();
    await flushPromises();
    (wrapper.vm as any).activeFilter = "orphan";
    await nextTick();
    await wrapper.find('[data-test="alert-dependencies-delete-pager"]').trigger("click");
    await (wrapper.vm as any).performDelete();
    await flushPromises();
    expect(destinationService.delete).toHaveBeenCalledWith(
      expect.objectContaining({ destination_name: "pager" }),
    );
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });

  it("emits 'close' when the focused entity is deleted and no longer exists", async () => {
    wrapper = mountGraph({ embedded: true, focus: { kind: "template", name: "tpl-orphan" } });
    await flushPromises();
    // After the delete-triggered reload, tpl-orphan is gone.
    vi.mocked(templateService.list).mockResolvedValueOnce({
      data: [{ name: "tpl-http", type: "http" }],
    } as any);
    await wrapper.find('[data-test="alert-dependencies-delete-tpl-orphan"]').trigger("click");
    await (wrapper.vm as any).performDelete();
    await flushPromises();
    expect(templateService.delete).toHaveBeenCalledWith(
      expect.objectContaining({ template_name: "tpl-orphan" }),
    );
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("windows a destination's alerts to 10 with working prev/next paging", async () => {
    // One destination feeding 25 alerts (the many-alerts-per-destination case).
    const many = Array.from({ length: 25 }, (_, i) => ({
      alert_id: `b${i}`,
      name: `bulk-${i}`,
      destinations: ["bulk"],
      enabled: true,
      folder_id: "default",
    }));
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: many } } as any);
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ name: "bulk", type: "http" }],
    } as any);
    vi.mocked(templateService.list).mockResolvedValue({ data: [] } as any);

    wrapper = mountGraph({ embedded: true, focus: { kind: "destination", name: "bulk" } });
    await flushPromises();

    const alertCount = () =>
      wrapper.findAll('[data-test^="alert-dependencies-node-alert-"]').length;

    // Page 1: 10 of 25, pager visible, bulk-0 shown but bulk-10 not.
    expect(alertCount()).toBe(10);
    expect(wrapper.find('[data-test="alert-dependencies-pager-bulk"]').exists()).toBe(true);
    expect(nodeTests(wrapper)).toContain("alert-dependencies-node-alert-bulk-0");
    expect(nodeTests(wrapper)).not.toContain("alert-dependencies-node-alert-bulk-10");

    // Next -> page 2: the next 10.
    await wrapper.find('[data-test="alert-dependencies-pager-next-bulk"]').trigger("click");
    await nextTick();
    expect(alertCount()).toBe(10);
    expect(nodeTests(wrapper)).toContain("alert-dependencies-node-alert-bulk-10");
    expect(nodeTests(wrapper)).not.toContain("alert-dependencies-node-alert-bulk-0");
  });

  it("hides the toolbar/summary when embedded", async () => {
    wrapper = mountGraph({ embedded: true, focus: { kind: "destination", name: "slack" } });
    await flushPromises();
    expect(wrapper.find('[data-test="alert-dependencies-toolbar"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-dependencies-summary"]').exists()).toBe(false);
  });
});
