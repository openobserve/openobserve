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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataHeaderChip from "./SampleDataHeaderChip.vue";

const ORG = "test-org";

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const data = vi.hoisted(() => ({
  sample: true,
  own: false,
  loadingHere: false,
  loadingElsewhere: false,
}));
vi.mock("@/composables/sampleData/useSampleDataPresence", async () => {
  const { computed } = await import("vue");
  return {
    useSampleDataPresence: () => ({
      ready: computed(() => true),
      hasSample: computed(() => data.sample),
      hasRealData: computed(() => data.own),
    }),
  };
});

const remove = vi.fn();
const startTourAndShow = vi.fn();
const loadInDialog = vi.fn();
vi.mock("@/composables/sampleData/useSampleDataSession", () => ({
  useSampleDataSession: () => ({
    remove,
    startTourAndShow,
    loadInDialog,
    status: { value: data.loadingHere || data.loadingElsewhere ? "loading" : "idle" },
    loadingOrg: { value: data.loadingHere ? ORG : data.loadingElsewhere ? "other-org" : "" },
  }),
}));

// Render the menu inline instead of inside a closed reka-ui popover.
const SlotStub = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", [slots.trigger?.(), slots.default?.()]),
});
const ItemStub = defineComponent({
  emits: ["select"],
  setup:
    (_, { slots, emit }) =>
    () =>
      h("button", { class: "menu-item", onClick: () => emit("select") }, slots.default?.()),
});
const ConfirmStub = defineComponent({
  props: { modelValue: Boolean, title: String, okLabel: String },
  emits: ["update:ok", "update:cancel"],
  setup:
    (props, { emit }) =>
    () =>
      props.modelValue
        ? h("div", { class: "confirm" }, [
            props.title,
            h("button", { class: "ok", onClick: () => emit("update:ok") }, props.okLabel),
            h("button", { class: "cancel", onClick: () => emit("update:cancel") }),
          ])
        : null,
});

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

describe("SampleDataHeaderChip", () => {
  let wrapper: VueWrapper;

  let store: ReturnType<typeof createStore<any>>;
  const mountChip = (sampleDataFlow = true) => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: ORG },
        kioskMode: false,
        zoConfig: { sample_data_onboarding_enabled: sampleDataFlow },
      },
    });
    wrapper = mount(SampleDataHeaderChip, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ODropdown: SlotStub,
          ODropdownItem: ItemStub,
          ODropdownSeparator: true,
          ConfirmDialog: ConfirmStub,
        },
      },
    });
  };
  const items = () => wrapper.findAll(".menu-item");
  const deleteItem = () => wrapper.find('[data-test="header-sample-data-delete"]');

  beforeEach(() => {
    toastMock.mockClear();
    push.mockClear();
    startTourAndShow.mockClear();
    loadInDialog.mockClear();
    Object.assign(data, { sample: true, own: false, loadingHere: false, loadingElsewhere: false });
    remove.mockReset();
    remove.mockResolvedValue(undefined);
    mountChip();
  });

  describe("before sample data", () => {
    const tryBtn = () => wrapper.find('[data-test="header-sample-data-try"]');

    it("offers Try Sample Data in an empty org and starts the load in one click", async () => {
      Object.assign(data, { sample: false, own: false });
      mountChip();
      expect(items()).toEqual([]);
      expect(tryBtn().text()).toBe("Try Sample Data");
      await tryBtn().trigger("click");
      expect(loadInDialog).toHaveBeenCalledWith(ORG, undefined);
    });

    it("offers no Try Sample Data when the deployment runs another first-run flow", () => {
      Object.assign(data, { sample: false, own: false });
      mountChip(false);
      expect(tryBtn().exists()).toBe(false);
    });

    it.each([
      ["the org holds its own data", { sample: false, own: true }],
      ["sample data is loading here", { sample: false, own: false, loadingHere: true }],
      // one load runs at a time, so a click here would be dropped
      [
        "sample data is loading in another org",
        { sample: false, own: false, loadingElsewhere: true },
      ],
    ])("shows nothing when %s", (_name, state) => {
      Object.assign(data, state);
      mountChip();
      expect(tryBtn().exists()).toBe(false);
      expect(items()).toEqual([]);
    });
  });

  it("offers only the guided tour and Delete Sample Data", () => {
    expect(items().map((i) => i.text())).toEqual(["Start the Guided Tour", "Delete Sample Data"]);
  });

  it("keeps the menu for loaded sample data when the deployment runs another first-run flow", () => {
    mountChip(false);
    expect(items().map((i) => i.text())).toEqual(["Start the Guided Tour", "Delete Sample Data"]);
  });

  it("starts the tour", async () => {
    await items()[0].trigger("click");
    await flushPromises();
    expect(startTourAndShow).toHaveBeenCalledWith(ORG, expect.any(Function), { push });
    expect(startTourAndShow.mock.calls[0][1]()).toBe(ORG);
  });

  it("asks before deleting, and Cancel deletes nothing", async () => {
    expect(wrapper.find(".confirm").exists()).toBe(false);
    await deleteItem().trigger("click");
    expect(wrapper.find(".confirm").text()).toContain("Delete sample data?");
    expect(remove).not.toHaveBeenCalled();
    await wrapper.find(".cancel").trigger("click");
    expect(wrapper.find(".confirm").exists()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes on confirm and says so", async () => {
    await deleteItem().trigger("click");
    await wrapper.find(".ok").trigger("click");
    await flushPromises();
    expect(remove).toHaveBeenCalledWith(ORG);
    expect(toastMock).toHaveBeenCalledWith({ variant: "success", message: "Sample data removed" });
    expect(wrapper.find(".confirm").exists()).toBe(false);
  });

  it("never deletes the sample data of an org selected after the confirmation opened", async () => {
    await deleteItem().trigger("click");
    store.state.selectedOrganization = { identifier: "other-org" };
    await nextTick();
    expect(wrapper.find(".confirm").exists()).toBe(false);
    wrapper.findComponent(ConfirmStub).vm.$emit("update:ok");
    await flushPromises();
    expect(remove).not.toHaveBeenCalledWith("other-org");
  });

  it("shows the server's message when deleting fails", async () => {
    remove.mockRejectedValue({ response: { data: { message: "stream locked" } } });
    await deleteItem().trigger("click");
    await wrapper.find(".ok").trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: "stream locked" });
  });
});
