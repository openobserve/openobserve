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
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import { queryClient } from "@/composables/query/queryClient";
import SampleDataHeaderChip from "./SampleDataHeaderChip.vue";

const ORG = "test-org";

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => viewport.mobile),
      isTablet: computed(() => false),
      isDesktop: computed(() => !viewport.mobile),
      mdUp: computed(() => !viewport.mobile),
      lgUp: computed(() => !viewport.mobile),
    }),
  };
});

const data = vi.hoisted(() => ({
  sample: true,
  own: false,
  loadingHere: false,
  loadingElsewhere: false,
  removing: false,
  state: "loaded",
}));
vi.mock("@/services/sample_data", () => ({
  default: { getState: async () => ({ data: { status: data.state } }) },
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

const removeInDialog = vi.fn();
const startTourAndShow = vi.fn();
const loadInDialog = vi.fn();
vi.mock("@/composables/sampleData/useSampleDataSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/sampleData/useSampleDataSession")>()),
  useSampleDataSession: () => ({
    removeInDialog,
    startTourAndShow,
    loadInDialog,
    status: { value: data.loadingHere || data.loadingElsewhere ? "loading" : "idle" },
    loadingOrg: { value: data.loadingHere ? ORG : data.loadingElsewhere ? "other-org" : "" },
    removing: { value: data.removing },
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
  const mountChip = (
    sampleDataFlow = true,
    version: string | null = "v0.0.0",
    realMenu = false,
  ) => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: ORG },
        kioskMode: false,
        zoConfig: {
          // null leaves the version absent, as before /config has loaded
          ...(version === null ? {} : { version }),
          sample_data_onboarding_enabled: sampleDataFlow,
        },
      },
    });
    wrapper = mount(SampleDataHeaderChip, {
      global: {
        plugins: [i18n, store],
        stubs: realMenu
          ? { ConfirmDialog: ConfirmStub }
          : {
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
    Object.assign(data, {
      sample: true,
      own: false,
      loadingHere: false,
      loadingElsewhere: false,
      removing: false,
      state: "loaded",
    });
    removeInDialog.mockReset();
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

    it("offers no Try Sample Data until the full config has loaded, then offers it", async () => {
      Object.assign(data, { sample: false, own: false });
      mountChip(true, null);
      expect(tryBtn().exists()).toBe(false);
      // the app swaps in the full config as a whole
      store.state.zoConfig = { ...store.state.zoConfig, version: "v0.0.0" };
      await nextTick();
      expect(tryBtn().exists()).toBe(true);
    });

    it("offers Try Sample Data on an untagged build whose version is empty", () => {
      Object.assign(data, { sample: false, own: false });
      mountChip(true, "");
      expect(tryBtn().exists()).toBe(true);
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

  describe("on a phone", () => {
    beforeEach(() => (viewport.mobile = true));
    afterEach(() => {
      viewport.mobile = false;
      wrapper.unmount();
    });

    it("shows an icon-only button with a name, and it opens the same menu", async () => {
      mountChip(true, "v0.0.0", true);
      const btn = wrapper.find('[data-test="header-sample-data-btn"]');
      expect(btn.attributes("aria-label")).toBe("Sample Data");
      expect(btn.text()).toBe("");
      expect(btn.classes()).not.toContain("max-md:hidden");
      await btn.trigger("click");
      await flushPromises();
      const labels = [...document.body.querySelectorAll('[role="menuitem"]')].map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(["Start the Guided Tour", "Delete Sample Data"]);
    });
  });

  it("offers only the guided tour and Delete Sample Data", () => {
    expect(items().map((i) => i.text())).toEqual(["Start the Guided Tour", "Delete Sample Data"]);
  });

  describe("after a load that never finished", () => {
    // the beforeEach mount already cached the loaded state
    beforeEach(() => queryClient.clear());

    it("offers Finish Loading, which runs the load again", async () => {
      data.state = "none";
      mountChip();
      await flushPromises();
      expect(items().map((i) => i.text())).toEqual([
        "Finish Loading",
        "Start the Guided Tour",
        "Delete Sample Data",
      ]);
      await items()[0].trigger("click");
      expect(loadInDialog).toHaveBeenCalledWith(ORG, undefined);
    });

    it("disables Finish Loading while a removal runs", async () => {
      Object.assign(data, { state: "none", removing: true });
      mountChip();
      await flushPromises();
      expect(items()[0].attributes("disabled")).toBeDefined();
    });

    it("offers no Finish Loading while a load runs", async () => {
      Object.assign(data, { state: "none", loadingHere: true });
      mountChip();
      await flushPromises();
      expect(items().map((i) => i.text())).toEqual(["Start the Guided Tour", "Delete Sample Data"]);
    });
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
    expect(removeInDialog).not.toHaveBeenCalled();
    await wrapper.find(".cancel").trigger("click");
    expect(wrapper.find(".confirm").exists()).toBe(false);
    expect(removeInDialog).not.toHaveBeenCalled();
  });

  it("deletes on confirm in the progress dialog", async () => {
    await deleteItem().trigger("click");
    await wrapper.find(".ok").trigger("click");
    await flushPromises();
    expect(removeInDialog).toHaveBeenCalledWith(ORG);
    expect(wrapper.find(".confirm").exists()).toBe(false);
  });

  it("never deletes the sample data of an org selected after the confirmation opened", async () => {
    await deleteItem().trigger("click");
    store.state.selectedOrganization = { identifier: "other-org" };
    await nextTick();
    expect(wrapper.find(".confirm").exists()).toBe(false);
    wrapper.findComponent(ConfirmStub).vm.$emit("update:ok");
    await flushPromises();
    expect(removeInDialog).not.toHaveBeenCalledWith("other-org");
  });

  it("disables Delete while a removal runs", () => {
    expect(deleteItem().attributes("disabled")).toBeUndefined();
    data.removing = true;
    mountChip();
    expect(deleteItem().attributes("disabled")).toBeDefined();
  });
});
