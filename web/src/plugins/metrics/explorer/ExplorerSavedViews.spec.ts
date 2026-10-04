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
import store from "@/test/unit/helpers/store";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getViewDetail: vi.fn(),
}));
vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: api });
});

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));

import ExplorerSavedViews from "./ExplorerSavedViews.vue";

const VIEWS = [
  { view_id: "l1", view_name: "logs one" },
  { view_id: "l2", view_name: "logs two", view_type: "logs" },
  { view_id: "m1", view_name: "errors by job", view_type: "metrics_explorer" },
];

const GRID_STATE = {
  search: "http",
  labels: ["job=api"],
  sort: "z-a",
  period: "1h",
  metric: "up",
  tab: "breakdown",
  breakdown_label: "job",
  refresh: "30s",
};

const mountViews = (
  state: Record<string, unknown> = GRID_STATE,
  extraProps: Record<string, unknown> = {},
) =>
  mount(ExplorerSavedViews, {
    props: { state, ...extraProps },
    global: {
      plugins: [store],
      stubs: {
        ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
        ODropdownItem: {
          props: ["disabled"],
          emits: ["select"],
          template: '<button type="button" @click="$emit(\'select\')"><slot /></button>',
        },
        ODropdownSeparator: true,
        ODialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
        ConfirmDialog: true,
        OForm: { template: "<form><slot /></form>" },
        OFormInput: true,
      },
    },
  });

describe("ExplorerSavedViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { views: VIEWS } });
  });

  it("lists only metrics explorer views", async () => {
    const wrapper = mountViews();
    await flushPromises();

    expect(wrapper.find('[data-test="metrics-explorer-view-m1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="metrics-explorer-view-l1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="metrics-explorer-view-l2"]').exists()).toBe(false);
  });

  it("saves the allow-listed grid state as a metrics_explorer view", async () => {
    api.post.mockResolvedValue({ data: { view_id: "new1" } });
    const wrapper = mountViews();
    await flushPromises();

    await (wrapper.vm as any).saveAs({ viewName: "my view" });
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("default", {
      data: {
        version: 1,
        state: { search: "http", labels: ["job=api"], sort: "z-a", period: "1h" },
      },
      view_name: "my view",
      view_type: "metrics_explorer",
    });
    expect(wrapper.emitted("saved")?.[0]).toEqual(["created"]);
  });

  it("shows the server's duplicate-name error as-is", async () => {
    const message = "Saved view with name 'my view' already exists in this organization";
    api.post.mockRejectedValue({ response: { status: 400, data: { message } } });
    const wrapper = mountViews();
    await flushPromises();

    await (wrapper.vm as any).saveAs({ viewName: "my view" });
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ message, variant: "error" }));
    expect(wrapper.emitted("saved")).toBeUndefined();
  });

  it("applies a view by emitting its allow-listed query", async () => {
    api.getViewDetail.mockResolvedValue({
      data: {
        view_id: "m1",
        view_name: "errors by job",
        data: { version: 1, state: { sort: "z-a", prefix: "node", metric: "up", tab: "related" } },
      },
    });
    const wrapper = mountViews();
    await flushPromises();

    await wrapper.find('[data-test="metrics-explorer-view-m1"]').trigger("click");
    await flushPromises();

    expect(api.getViewDetail).toHaveBeenCalledWith("default", "m1");
    expect(wrapper.emitted("apply")?.[0]).toEqual([{ sort: "z-a", prefix: "node" }]);
  });

  it("takes the active view from its parent, so it survives a remount", async () => {
    api.getViewDetail.mockResolvedValue({
      data: { view_id: "m1", view_name: "errors by job", data: { version: 1, state: {} } },
    });
    const remounted = mountViews(GRID_STATE, { activeViewId: "m1" });
    await flushPromises();
    expect(remounted.find('[data-test="metrics-explorer-views-update"]').exists()).toBe(true);

    const fresh = mountViews();
    await flushPromises();
    await fresh.find('[data-test="metrics-explorer-view-m1"]').trigger("click");
    await flushPromises();
    expect(fresh.emitted("update:activeViewId")?.at(-1)).toEqual(["m1"]);
  });

  it("marks the applied view modified once the grid moves off it, and clean again on update", async () => {
    const saved = { search: "http", labels: ["job=api"], sort: "z-a", period: "1h" };
    api.getViewDetail.mockResolvedValue({
      data: { view_id: "m1", view_name: "errors by job", data: { version: 1, state: saved } },
    });
    api.put.mockResolvedValue({ data: {} });
    // The parent owns both models; feed each update back the way v-model would.
    const wrapper: any = mountViews(
      { ...saved, metric: "up" },
      {
        "onUpdate:activeViewId": (v: any) => wrapper.setProps({ activeViewId: v }),
        "onUpdate:activeViewState": (v: any) => wrapper.setProps({ activeViewState: v }),
      },
    );
    await flushPromises();
    const label = () => wrapper.find('[data-test="metrics-explorer-views-btn"]').text();

    await wrapper.find('[data-test="metrics-explorer-view-m1"]').trigger("click");
    await flushPromises();
    // Detail-view keys are not part of a view, so opening a metric is no change.
    expect(label()).toContain("errors by job");
    expect(label()).not.toContain("(modified)");

    await wrapper.setProps({ state: { ...saved, search: "grpc" } });
    expect(label()).toContain("errors by job (modified)");

    await wrapper.find('[data-test="metrics-explorer-views-update"]').trigger("click");
    await flushPromises();
    expect(label()).not.toContain("(modified)");
  });

  it("updates and deletes the applied view", async () => {
    api.getViewDetail.mockResolvedValue({
      data: { view_id: "m1", view_name: "errors by job", data: { version: 1, state: {} } },
    });
    api.put.mockResolvedValue({ data: {} });
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = mountViews();
    await flushPromises();

    expect(wrapper.find('[data-test="metrics-explorer-views-update"]').exists()).toBe(false);
    await wrapper.find('[data-test="metrics-explorer-view-m1"]').trigger("click");
    await flushPromises();

    await wrapper.find('[data-test="metrics-explorer-views-update"]').trigger("click");
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("default", "m1", {
      data: {
        version: 1,
        state: { search: "http", labels: ["job=api"], sort: "z-a", period: "1h" },
      },
      view_name: "errors by job",
      view_type: "metrics_explorer",
    });

    await (wrapper.vm as any).deleteActive();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("default", "m1");
  });
});
