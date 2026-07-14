import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PanelLayoutSettings from "./PanelLayoutSettings.vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import i18n from "@/locales";

// Mock external dependencies
vi.mock("../../utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("mocked-image-url"),
}));

// ---------------------------------------------------------------------------
// ODialog stub — passthrough that renders the body slot so the REAL <OForm>
// inside it mounts (the migration is verified through the real form, not a
// stub). Exposes the migrated props/emits (incl. `formId` for the Enter/footer
// Save wiring) so tests can assert them and drive secondary/open actions.
// ---------------------------------------------------------------------------
const ODialogStub = {
  name: "ODialog",
  template:
    "<div class='o-dialog-stub' :data-open='open' :data-title='title' :data-form-id='formId'>" +
    "<slot name='header' />" +
    "<slot />" +
    "<slot name='footer' />" +
    "</div>",
  props: [
    "open",
    "side",
    "persistent",
    "size",
    "width",
    "title",
    "subTitle",
    "showClose",
    "seamless",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

// Create mock store
const createMockStore = () => {
  return createStore({
    state: {
      theme: "light",
      selectedOrganization: {
        identifier: "test-org",
      },
      zoConfig: {
        base_uri: "http://localhost:5080",
        theme: "light",
      },
    },
    getters: {},
    mutations: {},
    actions: {},
  });
};

// Create mock router
const createMockRouter = () => {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div>Home</div>" } },
      {
        path: "/dashboard",
        name: "dashboard",
        component: { template: "<div>Dashboard</div>" },
      },
    ],
  });
};

describe("PanelLayoutSettings.vue", () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;

  const defaultProps = {
    layout: {
      h: 5,
      w: 12,
      x: 0,
      y: 0,
      i: "panel1",
    },
    open: true,
  };

  const mountComponent = (props: Record<string, any> = {}) =>
    mount(PanelLayoutSettings, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [store, router, i18n],
        stubs: { ODialog: ODialogStub },
      },
    });

  // Drive the real form's submit so the schema runs + the handler is awaited
  // deterministically (a fire-and-forget native submit would not be).
  const submitForm = async (w: any) => {
    await w.vm.form.handleSubmit();
    await flushPromises();
  };

  const setHeight = async (w: any, v: unknown) => {
    w.vm.form.setFieldValue("h", v);
    await nextTick();
  };

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("Mount + container wiring", () => {
    it("mounts and renders the ODialog overlay", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
    });

    it("forwards open / title / labels to the ODialog", () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
      expect(dialog.props("title")).toBe("Layout");
      expect(dialog.props("primaryButtonLabel")).toBe("Save");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog.props("size")).toBe("sm");
    });

    it("wires Enter / footer Save via form-id == OForm id (R4)", () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("formId")).toBe("panel-layout-settings-form");
      const form = wrapper.find("#panel-layout-settings-form");
      expect(form.exists()).toBe(true);
    });

    it("does NOT disable the Save button (R3 — save stays enabled)", () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent(ODialogStub);
      // primaryButtonDisabled is never bound → defaults to undefined/false.
      expect(dialog.props("primaryButtonDisabled")).toBeFalsy();
    });

    it("re-emits update:open from the ODialog", async () => {
      wrapper = mountComponent();
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("emits update:open=false when the ODialog emits click:secondary", async () => {
      wrapper = mountComponent();
      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });
  });

  describe("Validation through the real OForm (R3 + restored rule)", () => {
    it("shows no error on open and keeps the form valid by default", () => {
      wrapper = mountComponent();
      expect(wrapper.text()).not.toContain("A value is required");
      expect(wrapper.vm.form.state.isValid).toBe(true);
    });

    it("blocks submit and does NOT emit save:layout when height is zero (required)", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, 0);

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(wrapper.emitted("save:layout")).toBeFalsy();
      expect(wrapper.text()).toContain("A value is required");
    });

    it("blocks submit and does NOT emit save:layout when height is empty (required)", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, "");

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(wrapper.emitted("save:layout")).toBeFalsy();
      expect(wrapper.text()).toContain("A value is required");
    });

    it("restored rule: negative height shows 'greater than zero' (not 'required')", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, -4);

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(wrapper.emitted("save:layout")).toBeFalsy();
      expect(wrapper.text()).toContain("Value must be greater than zero");
      expect(wrapper.text()).not.toContain("A value is required");
    });

    it("submits and emits save:layout (merged with the existing layout) when valid", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, 8);

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      const events = wrapper.emitted("save:layout");
      expect(events).toBeTruthy();
      expect(events!.length).toBe(1);
      expect(events![0][0]).toEqual({
        h: 8,
        w: 12,
        x: 0,
        y: 0,
        i: "panel1",
      });
    });

    it("error clears on change after the first submit", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, 0);
      await submitForm(wrapper);
      expect(wrapper.text()).toContain("A value is required");

      await setHeight(wrapper, 6);
      await flushPromises();
      expect(wrapper.text()).not.toContain("A value is required");
    });
  });

  describe("Row-count preview", () => {
    it("seeds the preview from the layout prop height", () => {
      wrapper = mountComponent();
      // h = 5: Math.ceil((5*30 - 24) / 28.5) = Math.ceil(126/28.5) = 5
      expect(wrapper.vm.getRowCount).toBe(5);
    });

    it("tracks the live (form-owned) height", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, 10);
      // h = 10: Math.ceil((10*30 - 24)/28.5) = Math.ceil(276/28.5) = 10
      expect(wrapper.vm.getRowCount).toBe(10);
    });

    it("never returns a negative row count", async () => {
      wrapper = mountComponent();
      await setHeight(wrapper, 0.5); // 0.5*30 - 24 = -9 → clamp to 0
      expect(wrapper.vm.getRowCount == 0).toBe(true);
    });
  });

  describe("Template Rendering", () => {
    beforeEach(() => {
      wrapper = mountComponent();
    });

    it("should not hardcode a background on the content area in dark mode", async () => {
      store.state.theme = "dark";
      wrapper = mountComponent();
      await nextTick();

      // The content area is theme-agnostic — its background now comes from the
      // dialog surface, not a hardcoded class. It must not force a light bg
      // (which previously showed a lighter band in dark mode).
      const contentDiv = wrapper.find('[data-test="panel-layout-settings-content"]');
      expect(contentDiv.exists()).toBe(true);
      expect(contentDiv.attributes("class")).toContain("p-0");
      expect(contentDiv.attributes("class")).not.toContain("bg-white");
      expect(contentDiv.attributes("class")).not.toContain(
        "bg-(--color-surface-base)",
      );
    });

    it("should keep the content area theme-agnostic in light mode", () => {
      const contentDiv = wrapper.find('[data-test="panel-layout-settings-content"]');
      expect(contentDiv.exists()).toBe(true);
      expect(contentDiv.attributes("class")).toContain("p-0");
      expect(contentDiv.attributes("class")).not.toContain(
        "bg-(--color-surface-base)",
      );
    });

    it("should expose panel layout title via ODrawer prop", () => {
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("title")).toBe("Layout");
    });

    it("should render the ODrawer overlay", () => {
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
    });

    it("should still expose getImageURL helper on the instance", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.getImageURL("images/common/close_icon.svg")).toBe(
        "mocked-image-url",
      );
    });
  });

  describe("data-test preservation", () => {
    it("keeps the height input data-test", () => {
      wrapper = mountComponent();
      expect(
        wrapper.find('[data-test="panel-layout-settings-height-input"]').exists(),
      ).toBe(true);
    });
  });
});
