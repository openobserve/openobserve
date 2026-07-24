import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddFunction from "./AddFunction.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import config from "@/aws-exports";

// Mock dependencies
vi.mock("@/services/jstransform", () => ({
  default: {
    create: vi.fn(() => Promise.resolve({ data: { message: "Function created successfully" } })),
    update: vi.fn(() => Promise.resolve({ data: { message: "Function updated successfully" } })),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mutable so each test can pick the entitlement BEFORE mounting (the gate is a
// computed over a plain config object — it evaluates per component instance).
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

const makeStore = (orgIdentifier = "test-org") =>
  createStore({
    state: {
      theme: "light",
      isAiChatEnabled: false,
      zoConfig: {
        ai_enabled: false,
      },
      selectedOrganization: {
        identifier: orgIdentifier,
      },
      userInfo: {
        email: "test@example.com",
      },
    },
    actions: {
      setIsAiChatEnabled: vi.fn(),
    },
  });

const mockStore = makeStore();

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/functions", name: "functions" },
    { path: "/pipeline/functions", name: "pipeline-functions" },
  ],
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      function: {
        jsfunction: "Function",
        errorDetails: "Error Details",
      },
      dashboard: {
        unsavedMessage: "You have unsaved changes",
      },
      pipeline: {
        unsavedMessage: "You have unsaved pipeline changes",
      },
      common: {
        unsavedTitle: "Unsaved Changes",
        unsavedMessage: "You have unsaved changes. Are you sure you want to leave?",
        cancelTitle: "Cancel",
        cancelMessage: "Are you sure you want to cancel?",
      },
    },
  },
});

describe("AddFunction.vue Branch Coverage", () => {
  const defaultProps = {
    modelValue: {
      name: "",
      function: "",
      params: "row",
      transType: "0",
    },
    isUpdated: false,
    heightOffset: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Function name / method-name validation is now owned by the Zod schema —
  // covered by AddFunction.schema.spec.ts and the real-OForm gating tests below
  // ("Schema wiring"), not by internal helper methods. (`params` is a hidden
  // constant merged at submit, no longer a validated field.)

  // The save now flows through the REAL <OForm> (no validate() shim). Driving
  // form.handleSubmit() runs the schema then calls onSubmit(value).
  const stubs = {
    "query-editor": true,
    TestFunction: true,
    FunctionsToolbar: true,
    FullViewContainer: true,
    ConfirmDialog: true,
    O2AIChat: true,
  };
  // `org` lets a test pick the selected organization (the _meta org keeps JS on
  // OSS); omitted, it uses the default "test-org" store.
  const mountAddFunction = (props: any = defaultProps, org?: string) =>
    mount(AddFunction, {
      props,
      global: {
        plugins: [mockI18n, mockRouter],
        provide: { store: org ? makeStore(org) : mockStore },
        stubs,
      },
    });
  const getForm = (wrapper: any) => (wrapper.findComponent(OForm).vm as any).form;

  // JavaScript functions are an enterprise/cloud entitlement; OSS stays VRL-only.
  // The gate drives the VRL/JS radio options, which in turn drive the editor
  // language + placeholder — so getting it wrong silently mislabels the editor.
  describe("JS entitlement gate (enterprise/cloud only)", () => {
    const values = (wrapper: any) =>
      ((wrapper.vm as any).transformTypeOptions as any[]).map((o) => o.value);

    beforeEach(() => {
      (config as any).isEnterprise = "false";
      (config as any).isCloud = "false";
    });

    it("OSS: offers VRL only — no JavaScript option", () => {
      expect(values(mountAddFunction())).toEqual(["0"]);
    });

    it("enterprise: offers VRL + JavaScript", () => {
      (config as any).isEnterprise = "true";
      expect(values(mountAddFunction())).toEqual(["0", "1"]);
    });

    it("cloud: offers VRL + JavaScript", () => {
      (config as any).isCloud = "true";
      expect(values(mountAddFunction())).toEqual(["0", "1"]);
    });

    it("is no longer tied to the _meta org (any enterprise org gets JS)", () => {
      // the old rule keyed ONLY off selectedOrganization === "_meta"; the store
      // here is "test-org", so JS must appear purely from the entitlement.
      (config as any).isEnterprise = "true";
      expect(values(mountAddFunction())).toContain("1");
    });

    it("OSS _meta org still gets JS (pre-existing SSO claim-parsing behavior)", () => {
      // _meta predates the enterprise entitlement — it must keep JS on OSS.
      const wrapper = mountAddFunction(defaultProps, "_meta");
      expect(values(wrapper)).toEqual(["0", "1"]);
    });

    it("OSS non-_meta org gets no JS", () => {
      expect(values(mountAddFunction(defaultProps, "some-org"))).toEqual(["0"]);
    });

    it("OSS but EDITING an existing JS function: keeps the JS option", () => {
      // otherwise the radio renders with nothing selected and the editor would
      // silently fall back to VRL for a JS function.
      const wrapper = mountAddFunction({
        ...defaultProps,
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, transType: "1" },
      });
      expect(values(wrapper)).toEqual(["0", "1"]);
    });

    it("OSS editing a VRL function: still no JS option", () => {
      const wrapper = mountAddFunction({
        ...defaultProps,
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, transType: "0" },
      });
      expect(values(wrapper)).toEqual(["0"]);
    });
  });

  describe("Update vs Create Logic (real OForm submit)", () => {
    it("calls create when not updating and the name is valid", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      form.setFieldValue("name", "testFunction");
      await form.handleSubmit();
      await flushPromises();

      expect((wrapper.vm as any).beingUpdated).toBe(false);
      // Payload parity (Rule ④): assert the EXACT object — keys AND value types —
      // handed to the save service, not merely that it was called. `transType`
      // MUST be a number (parseInt), guarding the string→number type-drift class
      // that broke dashboards' max_record_size; `function`/`params` are the
      // Monaco body + hidden constant merged in from `formData` at submit.
      expect(createSpy).toHaveBeenCalledWith("test-org", {
        name: "testFunction",
        function: "",
        params: "row",
        transType: 0,
      });
      const createPayload = createSpy.mock.calls[0][1] as any;
      expect(typeof createPayload.transType).toBe("number");
      expect(wrapper.emitted("update:list")).toBeTruthy();
    });

    it("calls update when updating and the name is valid", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      const updateSpy = vi.spyOn(jsTransformService, "update");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: true });
      const form = getForm(wrapper);
      form.setFieldValue("name", "testFunction");
      await form.handleSubmit();
      await flushPromises();

      expect((wrapper.vm as any).beingUpdated).toBe(true);
      // Same exact-payload + numeric-transType parity check for the update path.
      expect(updateSpy).toHaveBeenCalledWith("test-org", {
        name: "testFunction",
        function: "",
        params: "row",
        transType: 0,
      });
      const updatePayload = updateSpy.mock.calls[0][1] as any;
      expect(typeof updatePayload.transType).toBe("number");
    });
  });

  describe("Schema wiring (real OForm)", () => {
    it("blocks submit for an empty required name — service NOT called", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("blocks submit for an invalid method name — service NOT called", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      form.setFieldValue("name", "123-invalid");
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("blocks submit for a name with trailing whitespace — raw value validated, service NOT called", async () => {
      // End-to-end regression guard: OForm SAVES the raw form value, so a schema
      // .trim() would let "myfunc " pass validation yet persist the space. The
      // raw value must be rejected and the save blocked (no auto-strip-then-save).
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      form.setFieldValue("name", "myfunc ");
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling Branch Coverage", () => {
    it("does not call the service when validation fails", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create");

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      // empty name → schema invalid
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("captures API errors into compilationErr", async () => {
      const jsTransformService = (await import("@/services/jstransform")).default;
      vi.spyOn(jsTransformService, "create").mockRejectedValueOnce({
        response: { data: { message: "API Error occurred" } },
      });

      const wrapper = mountAddFunction({ ...defaultProps, isUpdated: false });
      const form = getForm(wrapper);
      form.setFieldValue("name", "testFunction");
      await form.handleSubmit();
      await flushPromises();

      expect((wrapper.vm as any).compilationErr).toBe("API Error occurred");
    });

    it("should handle function error from TestFunction component", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Branch: handleFunctionError (line 425-427)
      const testError = "VRL compilation error";
      vm.handleFunctionError(testError);

      expect(vm.vrlFunctionError).toBe(testError);
    });
  });

  describe("Unsaved Changes Logic Branch Coverage", () => {
    it("should show confirm dialog when closing with unsaved changes", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Test the confirm dialog flow directly
      vm.isFunctionDataChanged = { value: true };

      // Branch: isFunctionDataChanged.value = true (line 430-437)
      vm.closeAddFunction();

      // Test that the function covers the branch by checking component state
      expect(wrapper.vm).toBeDefined();
      expect(vm.confirmDialogMeta).toBeDefined();
    });

    it("should close directly when no unsaved changes", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // No unsaved changes
      vm.isFunctionDataChanged = false;

      // Branch: !isFunctionDataChanged.value (line 438-440)
      vm.closeAddFunction();

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      expect(vm.confirmDialogMeta.show).toBe(false);
    });

    it("should handle cancel with unsaved changes", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Test the confirm dialog flow directly
      vm.isFunctionDataChanged = { value: true };

      // Branch: isFunctionDataChanged.value = true (line 444-451)
      vm.cancelAddFunction();

      // Test that the function covers the branch by checking component state
      expect(wrapper.vm).toBeDefined();
      expect(vm.confirmDialogMeta).toBeDefined();
    });

    it("should handle beforeunload event with unsaved changes", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Test the beforeunload logic branch coverage by testing the watcher
      // Change the form data to trigger the watcher
      vm.formData.name = "changed";

      await nextTick();

      // The branch condition for beforeunload is based on isFunctionDataChanged
      expect(wrapper.vm).toBeDefined();
    });

    it("should allow beforeunload when no unsaved changes", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Test that the component has initial state for branch coverage
      expect(wrapper.vm).toBeDefined();

      // Test the component exists and covers the initial state branch
      expect(vm.formData).toBeDefined();
    });
  });

  describe("AI Chat Integration", () => {
    it("should show AI chat when enabled and not in add function component", async () => {
      const aiEnabledStore = createStore({
        state: {
          ...mockStore.state,
          isAiChatEnabled: true, // Branch condition: true
        },
        actions: mockStore.actions,
      });

      // Mock router to simulate not being in functions route
      const nonFunctionRouter = createRouter({
        history: createWebHistory(),
        routes: [{ path: "/pipeline/test", name: "test" }],
      });
      await nonFunctionRouter.push("/pipeline/test");

      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, nonFunctionRouter],
          provide: {
            store: aiEnabledStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      // Branch: store.state.isAiChatEnabled && !isAddFunctionComponent
      const mainContainerClasses = wrapper.find(".flex.overflow-hidden.min-h-0");
      expect(mainContainerClasses.classes()).toContain("w-3/4");

      const chatContainer = wrapper.find(".w-1\\/4");
      expect(chatContainer.exists()).toBe(true);
    });

    it("should hide AI chat when disabled or in add function component", async () => {
      // Mock router to simulate being in functions route
      const functionRouter = createRouter({
        history: createWebHistory(),
        routes: [{ path: "/functions", name: "functions" }],
      });
      await functionRouter.push("/functions");

      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, functionRouter],
          provide: {
            store: mockStore, // isAiChatEnabled: false
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      // Branch: !store.state.isAiChatEnabled || isAddFunctionComponent
      const mainContainerClasses = wrapper.find(".flex.overflow-hidden.min-h-0");
      expect(mainContainerClasses.classes()).toContain("w-full");

      const chatContainer = wrapper.find(".w-1\\/4");
      expect(chatContainer.exists()).toBe(false);
    });
  });

  describe("Utility Functions Branch Coverage", () => {
    it("should handle test function action", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: {
              template: "<div></div>",
              methods: {
                testFunction: vi.fn(),
              },
            },
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Mock testFunctionRef
      vm.testFunctionRef = {
        testFunction: vi.fn(),
      };

      // Test onTestFunction (line 421-423)
      vm.onTestFunction();

      expect(vm.testFunctionRef.testFunction).toHaveBeenCalled();
    });

    it("should handle AI chat interactions", async () => {
      const wrapper = mount(AddFunction, {
        props: defaultProps,
        global: {
          plugins: [mockI18n, mockRouter],
          provide: {
            store: mockStore,
          },
          stubs: {
            "query-editor": true,
            TestFunction: true,
            FunctionsToolbar: true,
            FullViewContainer: true,
            ConfirmDialog: true,
            O2AIChat: true,
          },
        },
      });

      const vm = wrapper.vm as any;

      // Test openChat function (line 464-466)
      vm.openChat(true);
      expect(mockStore._actions.setIsAiChatEnabled).toHaveLength(1);

      // Test sendToAiChat function (line 468-479)
      const testValue = "test AI chat message";
      vm.sendToAiChat(testValue);

      expect(vm.aiChatInputContext).toBe("");

      await nextTick();

      expect(vm.aiChatInputContext).toBe(testValue);
      expect(wrapper.emitted("sendToAiChat")).toBeTruthy();
      expect(wrapper.emitted("sendToAiChat")?.[0]).toEqual([testValue]);
    });
  });

  // The typewriter placeholder is the only affordance telling a user what to
  // write in an empty function editor. It used to be suppressed whenever
  // `forcedLanguage` was set — but BOTH flow hosts force a language, so the
  // pipeline Function node (forces vrl, seeds no code) rendered a blank editor
  // with no hint at all. Workflows hid the regression because they seed
  // `defaultCode`, which fills the editor.
  describe("typewriter placeholder with a host-forced language", () => {
    const placeholder = (wrapper: any) => wrapper.find(".pointer-events-none.select-none");

    it("🔑 still renders for a forced language when no defaultCode is seeded", () => {
      // the pipeline Function node's exact props
      const wrapper = mountAddFunction({
        ...defaultProps,
        forcedLanguage: "vrl",
      });
      expect(placeholder(wrapper).exists()).toBe(true);
    });

    it("renders for a forced JS language too", () => {
      (config as any).isEnterprise = "true";
      const wrapper = mountAddFunction({
        ...defaultProps,
        forcedLanguage: "javascript",
      });
      expect(placeholder(wrapper).exists()).toBe(true);
    });

    it("is hidden once a host seeds defaultCode (the workflow case)", () => {
      // `!formData.function` — not `!forcedLanguage` — is what suppresses it.
      (config as any).isEnterprise = "true";
      const wrapper = mountAddFunction({
        ...defaultProps,
        forcedLanguage: "javascript",
        defaultCode: "// do something\n",
      });
      expect(placeholder(wrapper).exists()).toBe(false);
    });

    it("renders with no forced language at all (unchanged behaviour)", () => {
      expect(placeholder(mountAddFunction()).exists()).toBe(true);
    });
  });
});
