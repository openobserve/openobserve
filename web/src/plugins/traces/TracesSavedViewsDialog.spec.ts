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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import TracesSavedViewsDialog from "@/plugins/traces/TracesSavedViewsDialog.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

const views = [
  { view_id: "t1", view_name: "checkout errors" },
  { view_id: "t2", view_name: "slow payments" },
];

// The real ODialog portals out of the wrapper; render its body inline instead.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title"],
  emits: ["update:open"],
  template: '<div v-if="open" data-test="dialog-stub"><slot /></div>',
};

describe("TracesSavedViewsDialog", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountDialog = (props: Record<string, unknown> = {}) =>
    mount(TracesSavedViewsDialog, {
      props: { open: true, views, ...props },
      global: { stubs: { ODialog: ODialogStub } },
    });

  const find = (dataTest: string) => wrapper!.find(`[data-test="${dataTest}"]`);

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("lists only the views passed in", async () => {
    wrapper = mountDialog({ views: [views[0]] });
    await flushPromises();

    expect(find("traces-saved-views-dialog-apply-t1").text()).toBe("checkout errors");
    expect(find("traces-saved-views-dialog-apply-t2").exists()).toBe(false);
  });

  it("filters the list by name, case-insensitively", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "SLOW");
    await flushPromises();

    expect(find("traces-saved-views-dialog-apply-t1").exists()).toBe(false);
    expect(find("traces-saved-views-dialog-apply-t2").exists()).toBe(true);
  });

  it("emits apply and closes when a view is chosen", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await find("traces-saved-views-dialog-apply-t2").trigger("click");

    expect(wrapper.emitted("apply")?.[0]).toEqual([views[1]]);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("emits update and delete without closing", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await find("traces-saved-views-dialog-update-t1").trigger("click");
    await find("traces-saved-views-dialog-delete-t2").trigger("click");

    expect(wrapper.emitted("update")?.[0]).toEqual([views[0]]);
    expect(wrapper.emitted("delete")?.[0]).toEqual([views[1]]);
    expect(wrapper.emitted("apply")).toBeUndefined();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("shows the empty state when there are no views", async () => {
    wrapper = mountDialog({ views: [] });
    await flushPromises();

    expect(find("traces-saved-views-dialog-empty").text()).toBe("search.savedViewsNotFound");
  });

  it("clears the search each time it opens", async () => {
    wrapper = mountDialog();
    await flushPromises();
    await wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "slow");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(find("traces-saved-views-dialog-apply-t1").exists()).toBe(true);
  });
});
