// Copyright 2026 OpenObserve Inc.
//
// Behavior spec for AddEnrichmentTable.vue after the OForm + Zod migration.
// Mounts the REAL <OForm> (not a stub) so the schema wiring is exercised: empty
// required fields block submit (the service is NOT called), and a valid payload
// flows through to the jstransform service.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import AddEnrichmentTable from "./AddEnrichmentTable.vue";
import OForm from "@/lib/forms/Form/OForm.vue";

// Mock dependencies
vi.mock("@/services/jstransform", () => ({
  default: {
    create_enrichment_table: vi.fn(() =>
      Promise.resolve({
        data: { message: "Enrichment table created successfully" },
      }),
    ),
    create_enrichment_table_from_url: vi.fn(() =>
      Promise.resolve({
        data: { message: "Enrichment table job started" },
      }),
    ),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

const { mockToast, mockDismiss } = vi.hoisted(() => {
  const dismiss = vi.fn();
  const toast = vi.fn(() => dismiss);
  return { mockToast: toast, mockDismiss: dismiss };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

describe("AddEnrichmentTable.vue", () => {
  let wrapper: any;
  let store: any;
  let i18n: any;

  // Non-form components are stubbed; OForm + OForm* fields render for real so the
  // schema is actually exercised.
  const OButtonStub = {
    name: "OButton",
    template:
      '<button :data-test="$attrs[\'data-test\']" :type="type" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["label", "type", "variant", "size", "iconLeft", "disabled", "loading"],
    emits: ["click"],
    inheritAttrs: false,
  };
  const OIconStub = { name: "OIcon", template: "<i></i>", props: ["name", "size"] };
  const OSeparatorStub = { name: "OSeparator", template: "<hr />" };

  const getForm = (w: any) => (w.findComponent(OForm).vm as any).form;

  const createWrapper = (propsData = {}) => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org-id",
          name: "Test Organization",
        },
        userInfo: {
          email: "test@example.com",
          name: "Test User",
        },
        theme: "light",
      },
      getters: {},
      mutations: {},
      actions: {},
    });

    i18n = createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      globalInjection: true,
      messages: {
        en: {
          function: {
            addEnrichmentTable: "Add Enrichment Table",
            updateEnrichmentTable: "Update Enrichment Table",
            enrichmentTables: "Enrichment Tables",
            name: "Name",
            uploadCSVFile: "Upload CSV File",
            appendData: "Append Data",
            cancel: "Cancel",
            save: "Save",
            dataSource: "Data Source",
            uploadFile: "Upload File",
            fromUrl: "From URL",
          },
        },
      },
    });

    return mount(AddEnrichmentTable, {
      props: {
        modelValue: {
          name: "",
          file: "",
          append: false,
        },
        isUpdating: false,
        ...propsData,
      },
      global: {
        plugins: [store, i18n],
        stubs: {
          OButton: OButtonStub,
          OIcon: OIconStub,
          OSeparator: OSeparatorStub,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockReturnValue(mockDismiss);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="add-enrichment-table-title"]').text()).toBe(
        "Add Enrichment Table",
      );
    });

    it("should initialize with correct default values", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).formData.name).toBe("");
      expect((wrapper.vm as any).formData.file).toBe("");
      expect((wrapper.vm as any).formData.append).toBe(false);
    });

    it("should render update mode when isUpdating is true", () => {
      wrapper = createWrapper({
        isUpdating: true,
        modelValue: { name: "existing-table", file: "", append: false },
      });
      expect(wrapper.find('[data-test="add-enrichment-table-title"]').text()).toBe(
        "Update Enrichment Table",
      );
    });

    it("should initialize with provided modelValue", async () => {
      wrapper = createWrapper({
        modelValue: { name: "test-table", file: "test.csv", append: true },
      });
      await flushPromises();
      expect((wrapper.vm as any).formData.name).toBe("test-table");
      expect((wrapper.vm as any).formData.append).toBe(true);
    });
  });

  describe("Form Fields", () => {
    it("should render name input field", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-enrichment-table-name"]').exists()).toBe(true);
    });

    it("should render file upload field by default (source=file)", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-enrichment-table-file"]').exists()).toBe(true);
    });

    it("should not show append toggle in add mode", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-enrichment-table-append-switch"]').exists()).toBe(false);
    });

    it("should show append toggle in update mode (file source)", () => {
      wrapper = createWrapper({
        isUpdating: true,
        modelValue: { name: "test-table", source: "file", file: "", append: false },
      });
      expect(wrapper.find('[data-test="add-enrichment-table-append-switch"]').exists()).toBe(true);
    });

    it("should set disable color in update mode", () => {
      wrapper = createWrapper({
        isUpdating: true,
        modelValue: { name: "existing-table", file: "", append: false },
      });
      expect((wrapper.vm as any).isUpdating).toBe(true);
      expect((wrapper.vm as any).disableColor).toBe("grey-5");
    });
  });

  // Rule ③ regression: the owner (AddEnrichmentTable) reads the ONE form via
  // form.useStore to drive its v-if conditionals. These would FAIL on the old
  // dead `form.store.subscribe` mirror (formData never updated → the URL/update
  // inputs never appeared); they pass now that the conditionals read the form.
  describe("Conditional rendering reacts to form state (owner pattern)", () => {
    it("reveals the URL input and hides the file upload when source → url", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // create mode defaults to source=file
      expect(wrapper.find('[data-test="add-enrichment-table-file"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-enrichment-table-url"]').exists()).toBe(false);

      const form = getForm(wrapper);
      form.setFieldValue("source", "url");
      await flushPromises();

      expect(wrapper.find('[data-test="add-enrichment-table-url"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-enrichment-table-file"]').exists()).toBe(false);
    });

    it("reveals the new-URL input when a url-based update leaves reload mode", async () => {
      wrapper = createWrapper({
        isUpdating: true,
        modelValue: {
          name: "existing",
          urlJobs: [{ id: "1", url: "https://x.com/a.csv", status: "completed" }],
        },
      });
      await flushPromises();
      // url-based update defaults to reload → the new-URL input is hidden
      expect(wrapper.find('[data-test="add-enrichment-table-new-url"]').exists()).toBe(false);

      const form = getForm(wrapper);
      form.setFieldValue("updateMode", "append");
      await flushPromises();

      expect(wrapper.find('[data-test="add-enrichment-table-new-url"]').exists()).toBe(true);
    });
  });

  describe("Validation (real OForm + schema)", () => {
    it("blocks submit when required fields are empty (service NOT called)", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create_enrichment_table");

      const form = getForm(wrapper);
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("requires a CSV file when source is file (service NOT called)", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create_enrichment_table");

      const form = getForm(wrapper);
      form.setFieldValue("name", "test-table"); // name ok, file still missing
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("requires a URL with http(s):// prefix when source is url (service NOT called)", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createUrlSpy = vi.spyOn(jsTransformService, "create_enrichment_table_from_url");

      const form = getForm(wrapper);
      form.setFieldValue("source", "url");
      form.setFieldValue("name", "test-table");
      form.setFieldValue("url", "not-a-url");
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(createUrlSpy).not.toHaveBeenCalled();
    });
  });

  describe("Submission (real OForm + schema)", () => {
    it("creates a file-based enrichment table when valid", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createSpy = vi.spyOn(jsTransformService, "create_enrichment_table");

      const form = getForm(wrapper);
      form.setFieldValue("name", "test-table");
      form.setFieldValue("file", new File(["test"], "test.csv", { type: "text/csv" }));
      await form.handleSubmit();
      await flushPromises();

      expect(createSpy).toHaveBeenCalledWith(
        "test-org-id",
        "test-table",
        expect.any(FormData),
        false,
      );
      expect(wrapper.emitted("update:list")).toBeTruthy();
    });

    it("creates a URL-based enrichment table when valid", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      const createUrlSpy = vi.spyOn(jsTransformService, "create_enrichment_table_from_url");

      const form = getForm(wrapper);
      form.setFieldValue("source", "url");
      form.setFieldValue("name", "test-table");
      form.setFieldValue("url", "https://example.com/data.csv");
      await form.handleSubmit();
      await flushPromises();

      expect(createUrlSpy).toHaveBeenCalledWith(
        "test-org-id",
        "test-table",
        "https://example.com/data.csv",
        false, // append
        false, // resume
        false, // retry
        false, // replaceFailed
      );
      expect(wrapper.emitted("update:list")).toBeTruthy();
    });

    it("shows the loading toast during submission", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("name", "test-table");
      form.setFieldValue("file", new File(["test"], "test.csv", { type: "text/csv" }));
      await form.handleSubmit();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
      });
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Enrichment table created successfully",
      });
    });
  });

  describe("Save button", () => {
    it("keeps the Save button enabled (no :disabled binding)", () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-enrichment-table-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });

    it("has save and cancel buttons", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-enrichment-table-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-enrichment-table-save-btn"]').exists()).toBe(true);
    });

    it("emits cancel:hideform when cancel is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="add-enrichment-table-cancel-btn"]').trigger("click");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("captures the API error message into compilationErr", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      vi.spyOn(jsTransformService, "create_enrichment_table").mockRejectedValueOnce({
        response: { status: 400, data: { message: "Invalid CSV format" } },
      });

      const form = getForm(wrapper);
      form.setFieldValue("name", "test-table");
      form.setFieldValue("file", new File(["test"], "test.csv", { type: "text/csv" }));
      await form.handleSubmit();
      await flushPromises();

      expect((wrapper.vm as any).compilationErr).toBe("Invalid CSV format");
    });

    it("does not show an error toast for 403 responses", async () => {
      wrapper = createWrapper();
      const jsTransformService = (await import("@/services/jstransform")).default;
      vi.spyOn(jsTransformService, "create_enrichment_table").mockRejectedValueOnce({
        response: { status: 403, data: { message: "Forbidden" } },
      });

      const form = getForm(wrapper);
      form.setFieldValue("name", "test-table");
      form.setFieldValue("file", new File(["test"], "test.csv", { type: "text/csv" }));
      await form.handleSubmit();
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });
  });

  describe("Compilation Error Display", () => {
    it("displays compilation errors", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).compilationErr = "Test error message";
      await wrapper.vm.$nextTick();
      expect(wrapper.find("pre").text()).toBe("Test error message");
    });
  });
});
