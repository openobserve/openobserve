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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import ImportTemplate from "./ImportTemplate.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";

// ─── Service mocks ────────────────────────────────────────────────────────────
vi.mock("@/services/alert_templates", () => ({
  default: { create: vi.fn() },
}));

vi.mock("@/services/alerts", () => ({
  default: { create: vi.fn() },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { create: vi.fn() },
}));

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({ streams: { value: [] } })),
}));

vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));

// ─── Router mock ──────────────────────────────────────────────────────────────
const mockRouterPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: mockRouterPush,
    back: vi.fn(),
  })),
  useRoute: vi.fn(() => ({ params: {}, query: {} })),
}));

// ─── Toast mock ───────────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

// ─── Store & i18n ─────────────────────────────────────────────────────────────
const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: { en: {} },
});

// ─── BaseImport stub ──────────────────────────────────────────────────────────
const BaseImportStub = {
  template: '<div><slot name="output-content"></slot></div>',
  props: ["title", "testPrefix", "isImporting", "editorHeights", "containerClass", "containerStyle"],
  emits: ["back", "cancel", "import"],
  setup(_props: any, { expose }: any) {
    const jsonArrayOfObj = ref<any[]>([]);
    const jsonStr = ref("");
    const isImporting = ref(false);
    expose({ jsonArrayOfObj, jsonStr, isImporting });
    return { jsonArrayOfObj, jsonStr, isImporting };
  },
};

// ─── Default props ─────────────────────────────────────────────────────────────
const defaultProps = {
  destinations: [{ name: "dest1", type: "http" }],
  templates: [{ name: "existing-template", type: "http" }],
  alerts: [],
};

// ─── Factory ──────────────────────────────────────────────────────────────────
function createWrapper(props = defaultProps) {
  return shallowMount(ImportTemplate, {
    props,
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      mocks: { $store: mockStore },
      stubs: { BaseImport: BaseImportStub },
    },
  });
}

// =============================================================================
describe("ImportTemplate", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createWrapper();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ─── Renders with minimum props ────────────────────────────────────────────
  describe("renders with minimum props", () => {
    it("mounts without throwing", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("accepts default empty-array props", () => {
      const w = shallowMount(ImportTemplate, {
        global: {
          plugins: [mockI18n],
          provide: { store: mockStore },
          mocks: { $store: mockStore },
          stubs: { BaseImport: BaseImportStub },
        },
      });
      expect(w.props("destinations")).toEqual([]);
      expect(w.props("templates")).toEqual([]);
      expect(w.props("alerts")).toEqual([]);
      w.unmount();
    });

    it("declares the expected emits", () => {
      expect(wrapper.vm.$options.emits).toContain("update:destinations");
      expect(wrapper.vm.$options.emits).toContain("update:templates");
      expect(wrapper.vm.$options.emits).toContain("update:alerts");
    });
  });

  // ─── Initial state ─────────────────────────────────────────────────────────
  describe("initial reactive state", () => {
    it("templateErrorsToDisplay starts empty", () => {
      expect(wrapper.vm.templateErrorsToDisplay).toEqual([]);
    });

    it("tempalteCreators starts empty", () => {
      expect(wrapper.vm.tempalteCreators).toEqual([]);
    });

    it("isTemplateImporting starts false", () => {
      expect(wrapper.vm.isTemplateImporting).toBe(false);
    });

    it("destinationTypes is ['http', 'email']", () => {
      expect(wrapper.vm.destinationTypes).toEqual(["http", "email"]);
    });
  });

  // ─── getFormattedTemplates computed ───────────────────────────────────────
  describe("getFormattedTemplates", () => {
    it("returns array of template names from props", () => {
      expect(wrapper.vm.getFormattedTemplates).toContain("existing-template");
      expect(wrapper.vm.getFormattedTemplates).toHaveLength(1);
    });

    it("returns empty array when templates prop is empty", () => {
      const w = createWrapper({ ...defaultProps, templates: [] });
      expect(w.vm.getFormattedTemplates).toEqual([]);
      w.unmount();
    });
  });

  // ─── Update functions ──────────────────────────────────────────────────────
  describe("update functions against BaseImport ref", () => {
    beforeEach(() => {
      wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: "tpl" }];
    });

    it("updateTemplateType sets type on item", () => {
      wrapper.vm.updateTemplateType("email", 0);
      expect(wrapper.vm.$refs.baseImportRef.jsonArrayOfObj[0].type).toBe("email");
    });

    it("updateTemplateName sets name on item", () => {
      wrapper.vm.updateTemplateName("new-tpl", 0);
      expect(wrapper.vm.$refs.baseImportRef.jsonArrayOfObj[0].name).toBe("new-tpl");
    });

    it("updateTemplateBody sets body on item", () => {
      const body = '{"msg": "hello"}';
      wrapper.vm.updateTemplateBody(body, 0);
      expect(wrapper.vm.$refs.baseImportRef.jsonArrayOfObj[0].body).toBe(body);
    });

    it("updateTemplateTitle sets title on item", () => {
      wrapper.vm.updateTemplateTitle("My Title", 0);
      expect(wrapper.vm.$refs.baseImportRef.jsonArrayOfObj[0].title).toBe("My Title");
    });

    it("jsonStr is updated after any update call", () => {
      wrapper.vm.updateTemplateName("alpha", 0);
      expect(wrapper.vm.$refs.baseImportRef.jsonStr).toContain("alpha");
    });
  });

  // ─── checkTemplatesInList ─────────────────────────────────────────────────
  describe("checkTemplatesInList", () => {
    const templates = [{ name: "t1" }, { name: "t2" }];

    it("returns true when name is in list", () => {
      expect(wrapper.vm.checkTemplatesInList(templates, "t1")).toBe(true);
    });

    it("returns false when name is not in list", () => {
      expect(wrapper.vm.checkTemplatesInList(templates, "none")).toBe(false);
    });

    it("returns false for empty list", () => {
      expect(wrapper.vm.checkTemplatesInList([], "t1")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(wrapper.vm.checkTemplatesInList(templates, "T1")).toBe(false);
    });
  });

  // ─── arrowBackFn ─────────────────────────────────────────────────────────
  describe("arrowBackFn", () => {
    it("pushes to alertTemplates route with org_identifier", () => {
      wrapper.vm.arrowBackFn();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "alertTemplates",
        query: { org_identifier: "test-org" },
      });
    });
  });

  // ─── validateTemplateInputs ───────────────────────────────────────────────
  describe("validateTemplateInputs", () => {
    beforeEach(() => {
      wrapper.vm.templateErrorsToDisplay = [];
    });

    it("returns true for a valid http template", async () => {
      const result = await wrapper.vm.validateTemplateInputs(
        { name: "new-tpl", type: "http", body: '{"message": "{{msg}}"}' },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns true for a valid email template", async () => {
      const result = await wrapper.vm.validateTemplateInputs(
        { name: "email-tpl", type: "email", body: '{"message": "{{msg}}"}', title: "Alert" },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns false and records error for missing name", async () => {
      const result = await wrapper.vm.validateTemplateInputs(
        { type: "http", body: '{"x":1}' },
        1,
      );
      expect(result).toBe(false);
      expect(wrapper.vm.templateErrorsToDisplay.length).toBeGreaterThan(0);
    });

    it("returns false for empty string name", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "", type: "http", body: '{"x":1}' }, 1)).toBe(false);
    });

    it("returns false for whitespace-only name", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "   ", type: "http", body: '{"x":1}' }, 1)).toBe(false);
    });

    it("returns false for non-string name", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: 42, type: "http", body: '{"x":1}' }, 1)).toBe(false);
    });

    it("returns false for a duplicate template name", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "existing-template", type: "http", body: '{"x":1}' }, 1),
      ).toBe(false);
    });

    it("returns false for invalid type", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "ftp", body: '{"x":1}' }, 1)).toBe(false);
    });

    it("returns false for missing type", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", body: '{"x":1}' }, 1)).toBe(false);
    });

    it("returns false for missing body", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "http" }, 1)).toBe(false);
    });

    it("returns false for empty body", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "http", body: "" }, 1)).toBe(false);
    });

    it("returns false for whitespace-only body", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "http", body: "   " }, 1)).toBe(false);
    });

    it("returns false for non-string body", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "http", body: 123 as any }, 1)).toBe(false);
    });

    it("returns false for invalid JSON in body", async () => {
      expect(await wrapper.vm.validateTemplateInputs({ name: "t", type: "http", body: "not json" }, 1)).toBe(false);
    });

    it("returns false for email type missing title", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "t", type: "email", body: '{"x":1}' }, 1),
      ).toBe(false);
    });

    it("returns false for email type with empty title", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "t", type: "email", body: '{"x":1}', title: "" }, 1),
      ).toBe(false);
    });

    it("returns false for email type with whitespace-only title", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "t", type: "email", body: '{"x":1}', title: "   " }, 1),
      ).toBe(false);
    });

    it("returns false for email type with non-string title", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "t", type: "email", body: '{"x":1}', title: 99 as any }, 1),
      ).toBe(false);
    });

    it("http type does not require a title", async () => {
      expect(
        await wrapper.vm.validateTemplateInputs({ name: "t", type: "http", body: '{"x":1}' }, 1),
      ).toBe(true);
    });
  });

  // ─── importJson — JSON parsing edge cases ─────────────────────────────────
  describe("importJson — JSON parsing edge cases", () => {
    beforeEach(() => {
      wrapper.vm.templateErrorsToDisplay = [];
      wrapper.vm.tempalteCreators = [];
    });

    it("resets isImporting when jsonStr is empty", async () => {
      wrapper.vm.$refs.baseImportRef.isImporting = true;
      await wrapper.vm.importJson({ jsonStr: "", jsonArray: [] });
      expect(wrapper.vm.$refs.baseImportRef.isImporting).toBe(false);
    });

    it("calls toast for invalid JSON", async () => {
      await wrapper.vm.importJson({ jsonStr: "{ bad json }", jsonArray: [] });
      expect(mockToast).toHaveBeenCalled();
    });

    it("resets isImporting on parse error", async () => {
      wrapper.vm.$refs.baseImportRef.isImporting = true;
      await wrapper.vm.importJson({ jsonStr: "{ bad json }", jsonArray: [] });
      expect(wrapper.vm.$refs.baseImportRef.isImporting).toBe(false);
    });

    it("resets templateErrorsToDisplay and tempalteCreators before processing", async () => {
      wrapper.vm.templateErrorsToDisplay = [["stale"]];
      wrapper.vm.tempalteCreators = [{ message: "stale", success: true }];
      // Parse fails, but reset happens before throw
      await wrapper.vm.importJson({ jsonStr: "bad json", jsonArray: [] });
      expect(Array.isArray(wrapper.vm.templateErrorsToDisplay)).toBe(true);
    });

    it("converts a single JSON object to array and processes it", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      await wrapper.vm.importJson({
        jsonStr: JSON.stringify({ name: "new-tpl", type: "http", body: '{"x":1}' }),
        jsonArray: [],
      });

      expect(templateService.default.create).toHaveBeenCalled();
    });
  });

  // ─── createTemplate ───────────────────────────────────────────────────────
  describe("createTemplate", () => {
    it("returns true, emits update:templates, and records success on API success", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.createTemplate(
        { name: "new-tpl", type: "http", body: '{"x":1}' },
        1,
      );

      expect(result).toBe(true);
      expect(templateService.default.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        template_name: "new-tpl",
        data: { name: "new-tpl", body: '{"x":1}', type: "http", title: undefined },
      });
      expect(wrapper.emitted("update:templates")).toBeTruthy();
      expect(wrapper.vm.tempalteCreators[0].success).toBe(true);
    });

    it("trims the name when calling the service", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      await wrapper.vm.createTemplate({ name: "  trimmed  ", type: "http", body: '{"x":1}' }, 1);

      expect(templateService.default.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: "trimmed" }) }),
      );
    });

    it("returns false and records failure message on API error", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockRejectedValueOnce({
        response: { data: { message: "Conflict" } },
      });

      const result = await wrapper.vm.createTemplate({ name: "t", type: "http", body: '{"x":1}' }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.tempalteCreators[0].success).toBe(false);
      expect(wrapper.vm.tempalteCreators[0].message).toContain("Conflict");
    });

    it("falls back to 'Unknown Error' when response has no message", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockRejectedValueOnce(new Error("net"));

      const result = await wrapper.vm.createTemplate({ name: "t", type: "http", body: '{"x":1}' }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.tempalteCreators[0].message).toContain("Unknown Error");
    });

    it("includes title in the service payload for email templates", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      await wrapper.vm.createTemplate(
        { name: "email-tpl", type: "email", body: '{"x":1}', title: "Alert Title" },
        1,
      );

      expect(templateService.default.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Alert Title" }),
        }),
      );
    });
  });

  // ─── processJsonObject ────────────────────────────────────────────────────
  describe("processJsonObject", () => {
    beforeEach(() => {
      wrapper.vm.templateErrorsToDisplay = [];
      wrapper.vm.tempalteCreators = [];
    });

    it("returns true for a fully valid http template", async () => {
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.processJsonObject(
        { name: "new-tpl", type: "http", body: '{"x":1}' },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns false for invalid object (validation fails)", async () => {
      const result = await wrapper.vm.processJsonObject({ name: "", type: "bad" }, 1);
      expect(result).toBe(false);
    });

    it("returns true even if prior error entries exist (each template is independent)", async () => {
      wrapper.vm.templateErrorsToDisplay = [["prior error from another template"]];
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.processJsonObject(
        { name: "valid-tpl", type: "http", body: '{"x":1}' },
        2,
      );
      expect(result).toBe(true);
    });
  });

  // ─── Output section conditional rendering via v-if ────────────────────────
  describe("output-content slot — conditional branches", () => {
    it("renders error group items when templateErrorsToDisplay is non-empty", async () => {
      wrapper.vm.templateErrorsToDisplay = [
        [{ field: "template_name", message: "name conflict" }],
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-error-0-0"]').exists()).toBe(true);
    });

    it("renders the name correction input for template_name field errors", async () => {
      wrapper.vm.templateErrorsToDisplay = [
        [{ field: "template_name", message: "name conflict" }],
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-name-input"]').exists()).toBe(true);
    });

    it("renders the body correction input for body field errors", async () => {
      wrapper.vm.templateErrorsToDisplay = [
        [{ field: "body", message: "invalid body" }],
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-body-input"]').exists()).toBe(true);
    });

    it("renders the type correction select for type field errors", async () => {
      wrapper.vm.templateErrorsToDisplay = [
        [{ field: "type", message: "invalid type" }],
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-type-input"]').exists()).toBe(true);
    });

    it("renders the title correction input for title field errors", async () => {
      wrapper.vm.templateErrorsToDisplay = [
        [{ field: "title", message: "title required" }],
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-title-input"]').exists()).toBe(true);
    });

    it("renders plain text for unknown-field string errors", async () => {
      wrapper.vm.templateErrorsToDisplay = [["plain error message"]];
      await wrapper.vm.$nextTick();
      const el = wrapper.find('[data-test="template-import-error-0-0"]');
      expect(el.exists()).toBe(true);
      expect(el.text()).toContain("plain error message");
    });

    it("renders creation title when tempalteCreators is non-empty", async () => {
      wrapper.vm.tempalteCreators = [{ message: "created", success: true }];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-creation-title"]').exists()).toBe(true);
    });

    it("renders individual creation result messages", async () => {
      wrapper.vm.tempalteCreators = [{ message: "done", success: true }];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-creation-0-message"]').exists()).toBe(true);
    });

    it("does not render error list when templateErrorsToDisplay is empty", async () => {
      wrapper.vm.templateErrorsToDisplay = [];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-error-0"]').exists()).toBe(false);
    });

    it("does not render creation section when tempalteCreators is empty", async () => {
      wrapper.vm.tempalteCreators = [];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="template-import-creation-title"]').exists()).toBe(false);
    });
  });

  // ─── importJson success / redirect flow ───────────────────────────────────
  describe("importJson — success flow", () => {
    it("calls toast on successful import", async () => {
      vi.useFakeTimers();
      const templateService = await import("@/services/alert_templates");
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true as any);

      await wrapper.vm.importJson({
        jsonStr: JSON.stringify([{ name: "t1", type: "http", body: '{"x":1}' }]),
        jsonArray: [],
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Successfully imported template(s)" }),
      );

      vi.runAllTimers();
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertTemplates" }),
      );
      vi.useRealTimers();
    });
  });
});
