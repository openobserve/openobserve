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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// hoisted runs before imports, so it can't use `ref`. The component reads
// `.value` off these, which plain objects satisfy — the reactivity these tests
// exercise is driven by explicit re-assignment, not deep tracking.
const composable = vi.hoisted(() => ({
  views: { value: [] as any[] },
  loading: { value: false },
  activeViewId: { value: "" },
  listViews: vi.fn(async () => []),
  createView: vi.fn(async () => "new-id"),
  updateView: vi.fn(async () => {}),
  deleteView: vi.fn(async () => {}),
  getViewSnapshot: vi.fn(async () => ({
    kind: "metrics",
    filters: { type: "counter" },
    pinned: ["m1"],
  })),
}));

vi.mock("@/composables/metrics/useMetricsSavedViews", () => ({
  default: () => composable,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import MetricsSavedViews from "./MetricsSavedViews.vue";

const buildSnapshot = vi.fn(() => ({
  kind: "metrics" as const,
  filters: { type: "gauge" },
  pinned: ["node_memory"],
}));

const mountSV = () =>
  mount(MetricsSavedViews, {
    props: { buildSnapshot },
    global: {
      stubs: {
        // Render-through the shells so triggers/table/form slots exist; the O2
        // internals are not what these wiring tests assert.
        OButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        OTag: true,
        OTooltip: true,
        OIcon: true,
        ODialog: { template: "<div><slot /></div>" },
        OTable: {
          props: ["data"],
          template:
            '<table><tr v-for="row in data" :key="row.view_id"><slot name="cell-actions" :row="row" /></tr></table>',
        },
        OForm: {
          // Expose a submit that calls @submit with a name, so onSubmit runs.
          template:
            '<form data-test="form" @submit.prevent="$emit(\'submit\', { savedViewName: \'My view\' })"><slot /><button type="submit" data-test="do-submit" /></form>',
        },
        OFormInput: true,
        OEmptyState: true,
        ConfirmDialog: {
          props: ["modelValue"],
          emits: ["update:ok", "update:cancel"],
          template:
            '<div v-if="modelValue" data-test="confirm"><button data-test="confirm-ok" @click="$emit(\'update:ok\')" /></div>',
        },
      },
    },
  });

describe("MetricsSavedViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composable.views.value = [];
  });

  it("lists views on mount and again when the list is opened", async () => {
    const wrapper = mountSV();
    await flushPromises();
    expect(composable.listViews).toHaveBeenCalled();

    await wrapper
      .find('[data-test="metrics-saved-views-list-btn"]')
      .trigger("click");
    await flushPromises();
    expect(composable.listViews).toHaveBeenCalledTimes(2);
  });

  it("saves the current snapshot under the submitted name", async () => {
    const wrapper = mountSV();
    await wrapper
      .find('[data-test="metrics-saved-views-create-btn"]')
      .trigger("click");
    await wrapper.find('[data-test="do-submit"]').trigger("submit");
    await flushPromises();

    expect(buildSnapshot).toHaveBeenCalled();
    expect(composable.createView).toHaveBeenCalledWith("My view", {
      kind: "metrics",
      filters: { type: "gauge" },
      pinned: ["node_memory"],
    });
  });

  it("applies a view: fetches its snapshot and emits apply", async () => {
    composable.views.value = [{ view_id: "v1", view_name: "Morning" }];
    const wrapper = mountSV();
    await wrapper
      .find('[data-test="metrics-saved-views-list-btn"]')
      .trigger("click");
    await flushPromises();

    await wrapper
      .find('[data-test="metrics-saved-views-apply-Morning"]')
      .trigger("click");
    await flushPromises();

    expect(composable.getViewSnapshot).toHaveBeenCalledWith("v1");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toMatchObject({
      filters: { type: "counter" },
      pinned: ["m1"],
    });
  });

  it("deletes a view only after the confirm dialog is accepted", async () => {
    composable.views.value = [{ view_id: "v1", view_name: "Morning" }];
    const wrapper = mountSV();
    await wrapper
      .find('[data-test="metrics-saved-views-list-btn"]')
      .trigger("click");
    await flushPromises();

    // Ask to delete → confirm dialog opens; nothing deleted yet.
    await wrapper
      .find('[data-test="metrics-saved-views-delete-Morning"]')
      .trigger("click");
    expect(composable.deleteView).not.toHaveBeenCalled();

    // Accept the confirm.
    await wrapper.find('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(composable.deleteView).toHaveBeenCalledWith("v1");
  });
});
