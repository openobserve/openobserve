import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, shallowMount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PanelLayoutSettings from "./PanelLayoutSettings.vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";

// Mock external dependencies
vi.mock("../../utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("mocked-image-url"),
}));

// ---------------------------------------------------------------------------
// ODialog stub — mirrors the migrated overlay surface.
// Exposes migrated props/emits so tests can drive primary/secondary actions
// and assert on title/labels/open without depending on real overlay markup.
// ---------------------------------------------------------------------------
const ODialogStub = {
  name: "ODialog",
  template:
    "<div class='o-drawer-stub' :data-open='open' :data-title='title'>" +
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

// Default Quasar child stubs used in shallowMount-style cases
const quasarStubs = {
  "q-btn": true,
  "q-separator": true,
  "q-form": true,
  "q-input": true,
  "OIcon": true,
  "q-tooltip": true,
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
      {
        path: "/",
        name: "home",
        component: { template: "<div>Home</div>" },
      },
      {
        path: "/dashboard",
        name: "dashboard",
        component: { template: "<div>Dashboard</div>" },
      },
    ],
  });
};

// Create mock i18n
const createMockI18n = () => {
  return createI18n({
    locale: "en",
    messages: {
      en: {
        panel: {
          layout: "Panel Layout",
        },
        dashboard: {
          panelHeight: "Panel Height",
          cancel: "Cancel",
          save: "Save",
        },
        common: {
          required: "Required",
          valueMustBeGreaterThanZero: "Value must be greater than zero",
        },
      },
    },
  });
};

describe("PanelLayoutSettings.vue", () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let i18n: any;

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

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount component successfully", () => {
    wrapper = shallowMount(PanelLayoutSettings, {
      props: defaultProps,
      global: {
        plugins: [store, router, i18n],
        stubs: { ODialog: ODialogStub, ...quasarStubs },
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  it("should accept layout prop correctly", () => {
    const layout = { h: 10, w: 8, x: 2, y: 3, i: "test-panel" };

    wrapper = shallowMount(PanelLayoutSettings, {
      props: { layout, open: true },
      global: {
        plugins: [store, router, i18n],
        stubs: { ODialog: ODialogStub, ...quasarStubs },
      },
    });

    expect(wrapper.props("layout")).toEqual(layout);
    expect(wrapper.vm.updatedLayout).toEqual(layout);
  });

  it("should initialize updatedLayout with props layout", () => {
    wrapper = shallowMount(PanelLayoutSettings, {
      props: defaultProps,
      global: {
        plugins: [store, router, i18n],
        stubs: { ODialog: ODialogStub, ...quasarStubs },
      },
    });

    expect(wrapper.vm.updatedLayout).toEqual(defaultProps.layout);
  });

  it("should default open prop to false when not provided", () => {
    wrapper = shallowMount(PanelLayoutSettings, {
      props: { layout: defaultProps.layout },
      global: {
        plugins: [store, router, i18n],
        stubs: { ODialog: ODialogStub, ...quasarStubs },
      },
    });

    expect(wrapper.props("open")).toBe(false);
  });

  describe("Computed Properties", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });
    });

    it("should calculate getRowCount correctly with positive height", () => {
      // Formula: Math.ceil((h * 30 - 24) / 28.5)
      // For h = 5: Math.ceil((5 * 30 - 24) / 28.5) = Math.ceil(126 / 28.5) = 5
      wrapper.vm.updatedLayout.h = 5;
      expect(wrapper.vm.getRowCount).toBe(5);
    });

    it("should return 0 when getRowCount calculation results in negative", () => {
      wrapper.vm.updatedLayout.h = 0.5; // 0.5 * 30 - 24 = -9, which is negative
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });

    it("should calculate getRowCount correctly for height of 1", () => {
      // For h = 1: Math.ceil((1 * 30 - 24) / 28.5) = Math.ceil(6 / 28.5) = 1
      wrapper.vm.updatedLayout.h = 1;
      expect(wrapper.vm.getRowCount).toBe(1);
    });

    it("should calculate getRowCount correctly for large height", () => {
      // For h = 10: Math.ceil((10 * 30 - 24) / 28.5) = Math.ceil(276 / 28.5) = 10
      wrapper.vm.updatedLayout.h = 10;
      expect(wrapper.vm.getRowCount).toBe(10);
    });
  });

  describe("Methods", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });
    });

    it("should emit save:layout event with updated layout when savePanelLayout is called", () => {
      wrapper.vm.updatedLayout.h = 8;
      wrapper.vm.updatedLayout.w = 10;

      wrapper.vm.savePanelLayout();

      const emittedEvents = wrapper.emitted("save:layout");
      expect(emittedEvents).toBeTruthy();
      expect(emittedEvents!.length).toBe(1);
      expect(emittedEvents![0][0]).toEqual({
        h: 8,
        w: 10,
        x: 0,
        y: 0,
        i: "panel1",
      });
    });

    it("should emit save:layout with a copy of updatedLayout", () => {
      const originalLayout = { ...wrapper.vm.updatedLayout };

      wrapper.vm.savePanelLayout();

      const emittedEvents = wrapper.emitted("save:layout");
      const emittedLayout = emittedEvents![0][0];

      wrapper.vm.updatedLayout.h = 999;
      expect(emittedLayout).toEqual(originalLayout);
      expect(emittedLayout).not.toBe(wrapper.vm.updatedLayout);
    });

    it("should emit save:layout when submitForm is invoked with valid height", () => {
      wrapper.vm.updatedLayout.h = 5; // valid positive height
      wrapper.vm.heightError = "";

      wrapper.vm.submitForm();

      const emittedEvents = wrapper.emitted("save:layout");
      expect(emittedEvents).toBeTruthy();
      expect(emittedEvents!.length).toBe(1);
    });

    it("should set height error when submitForm is called with zero height", () => {
      wrapper.vm.updatedLayout.h = 0;

      wrapper.vm.submitForm();

      expect(wrapper.vm.heightError).toBeTruthy();
      expect(wrapper.emitted("save:layout")).toBeFalsy();
    });
  });

  describe("ODrawer Integration", () => {
    // QForm stub exposes a submit() method so panelFormRef.value?.submit() works.
    // Submitting the form re-emits the "submit" event which triggers savePanelLayout.
    const QFormStub = {
      name: "QForm",
      template:
        "<form class='q-form' @submit.prevent='$emit(\"submit\")'><slot /></form>",
      emits: ["submit"],
      methods: {
        submit() {
          (this as any).$emit("submit");
        },
      },
    };

    const mountWithDrawer = (props = {}) =>
      mount(PanelLayoutSettings, {
        props: { ...defaultProps, ...props },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            ODialog: ODialogStub,
            QForm: QFormStub,
            QInput: true,
            QIcon: true,
            QTooltip: true,
          },
        },
      });

    it("forwards open prop to ODrawer", () => {
      wrapper = mountWithDrawer({ open: true });
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
    });

    it("passes title and button labels to ODrawer", () => {
      wrapper = mountWithDrawer();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("title")).toBe("Panel Layout");
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
      expect(drawer.props("size")).toBe("sm");
    });

    it("re-emits update:open from ODrawer", async () => {
      wrapper = mountWithDrawer();
      const drawer = wrapper.findComponent(ODialogStub);

      await drawer.vm.$emit("update:open", false);

      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![0]).toEqual([false]);
    });

    it("emits update:open with false when ODrawer emits click:secondary", async () => {
      wrapper = mountWithDrawer();
      const drawer = wrapper.findComponent(ODialogStub);

      await drawer.vm.$emit("click:secondary");

      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![0]).toEqual([false]);
    });

    it("calls submitForm and triggers save:layout when ODrawer emits click:primary", async () => {
      wrapper = mountWithDrawer();
      const drawer = wrapper.findComponent(ODialogStub);

      // QForm stub re-emits submit on form submit, which calls savePanelLayout
      await drawer.vm.$emit("click:primary");
      await nextTick();

      const saveEvents = wrapper.emitted("save:layout");
      expect(saveEvents).toBeTruthy();
      expect(saveEvents!.length).toBe(1);
      expect(saveEvents![0][0]).toEqual(defaultProps.layout);
    });

    it("does not throw when click:primary fires with zero/invalid height", async () => {
      wrapper = mountWithDrawer();
      // Set invalid height so submitForm sets an error instead of emitting save:layout
      wrapper.vm.updatedLayout.h = 0;
      wrapper.vm.heightError = "";
      const drawer = wrapper.findComponent(ODialogStub);

      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
      await nextTick();
      // save:layout should NOT have been emitted because height is invalid
      expect(wrapper.emitted("save:layout")).toBeFalsy();
    });
  });

  describe("Template Rendering", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });
    });

    it("should apply dark mode class when theme is dark", async () => {
      store.state.theme = "dark";

      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });

      await nextTick();

      const contentDiv = wrapper.find('[data-test="panel-layout-settings-content"]');
      expect(contentDiv.exists()).toBe(true);
      expect(contentDiv.attributes("class")).toContain("dark-mode");
    });

    it("should apply light mode class when theme is light", () => {
      const contentDiv = wrapper.find('[data-test="panel-layout-settings-content"]');
      expect(contentDiv.exists()).toBe(true);
      expect(contentDiv.attributes("class")).not.toContain("dark-mode");
    });

    it("should expose panel layout title via ODrawer prop", () => {
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("title")).toBe("Panel Layout");
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

  describe("Edge Cases and Error Scenarios", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });
    });

    it("should handle zero height correctly in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 0;
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });

    it("should handle very large height in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 1000;
      const result = wrapper.vm.getRowCount;
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });

    it("should handle decimal heights in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 2.5;
      const result = wrapper.vm.getRowCount;
      expect(typeof result).toBe("number");
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should work with different layout props", () => {
      const customLayout = {
        h: 3,
        w: 6,
        x: 1,
        y: 2,
        i: "custom-panel",
      };

      wrapper = shallowMount(PanelLayoutSettings, {
        props: { layout: customLayout, open: true },
        global: {
          plugins: [store, router, i18n],
          stubs: { ODialog: ODialogStub, ...quasarStubs },
        },
      });

      expect(wrapper.vm.updatedLayout).toEqual(customLayout);
      expect(wrapper.vm.getRowCount).toBeGreaterThanOrEqual(0);
    });

    it("should maintain layout integrity when props change", async () => {
      const newLayout = {
        h: 7,
        w: 10,
        x: 2,
        y: 3,
        i: "updated-panel",
      };

      await wrapper.setProps({ layout: newLayout });
      expect(wrapper.props("layout")).toEqual(newLayout);
    });

    it("should emit correct event name", () => {
      wrapper.vm.savePanelLayout();
      const emittedEvents = Object.keys(wrapper.emitted());
      expect(emittedEvents).toContain("save:layout");
    });

    it("should handle negative result in getRowCount calculation", () => {
      // Hits the if (count < 0) return 0 branch
      wrapper.vm.updatedLayout.h = 0.7;
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });
  });
});
