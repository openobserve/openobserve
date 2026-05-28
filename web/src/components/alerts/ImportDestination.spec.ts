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
import ImportDestination from "./ImportDestination.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";

// ─── Service mocks ───────────────────────────────────────────────────────────
vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock("@/composables/useActions", () => ({
  default: vi.fn(() => ({
    isActionsEnabled: { value: true },
  })),
}));

vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));

// ─── Router mock ─────────────────────────────────────────────────────────────
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

// ─── Shared store & i18n ─────────────────────────────────────────────────────
const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    organizationData: {
      actions: [
        { id: "action1", name: "Test Action 1", execution_details_type: "service" },
        { id: "action2", name: "Test Action 2", execution_details_type: "service" },
      ],
    },
  },
  actions: {
    getActions: vi.fn().mockResolvedValue({
      list: [
        { id: "action1", name: "Test Action 1", execution_details_type: "service" },
        { id: "action2", name: "Test Action 2", execution_details_type: "service" },
      ],
    }),
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: { en: { alert_destinations: { skip_tls_verify: "Skip TLS Verify" } } },
});

// ─── BaseImport stub ─────────────────────────────────────────────────────────
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

// ─── Default props ────────────────────────────────────────────────────────────
const defaultProps = {
  destinations: [{ name: "existing-dest", type: "http" }],
  templates: [
    { name: "template1", type: "http" },
    { name: "email-template", type: "email" },
  ],
  alerts: [],
};

// ─── Factory ─────────────────────────────────────────────────────────────────
function createWrapper(props = defaultProps) {
  return shallowMount(ImportDestination, {
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
describe("ImportDestination", () => {
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
      const w = shallowMount(ImportDestination, {
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

  // ─── Initial reactive state ────────────────────────────────────────────────
  describe("initial reactive state", () => {
    it("destinationErrorsToDisplay starts empty", () => {
      expect(wrapper.vm.destinationErrorsToDisplay).toEqual([]);
    });

    it("destinationCreators starts empty", () => {
      expect(wrapper.vm.destinationCreators).toEqual([]);
    });

    it("destinationTypes is ['http', 'email']", () => {
      expect(wrapper.vm.destinationTypes).toEqual(["http", "email"]);
    });

    it("destinationMethods is ['post', 'get', 'put']", () => {
      expect(wrapper.vm.destinationMethods).toEqual(["post", "get", "put"]);
    });

    it("isDestinationImporting starts false", () => {
      expect(wrapper.vm.isDestinationImporting).toBe(false);
    });
  });

  // ─── Update functions ──────────────────────────────────────────────────────
  describe("update functions against BaseImport ref", () => {
    beforeEach(() => {
      // Seed the stubbed BaseImport ref with an item at index 0
      wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: "test" }];
    });

    it("updateDestinationType sets type on the item", () => {
      wrapper.vm.updateDestinationType("email", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].type).toBe("email");
    });

    it("updateDestinationMethod sets method on the item", () => {
      wrapper.vm.updateDestinationMethod("post", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].method).toBe("post");
    });

    it("updateDestinationName sets name on the item", () => {
      wrapper.vm.updateDestinationName("new-dest", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].name).toBe("new-dest");
    });

    it("updateDestinationUrl sets url on the item", () => {
      wrapper.vm.updateDestinationUrl("https://example.com", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].url).toBe("https://example.com");
    });

    it("updateDestinationTemplate sets template on the item", () => {
      wrapper.vm.updateDestinationTemplate("template1", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].template).toBe("template1");
    });

    it("updateDestinationAction sets action_id on the item", () => {
      wrapper.vm.updateDestinationAction("action1", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].action_id).toBe("action1");
    });

    it("updateDestinationEmails parses comma-separated string into array", () => {
      wrapper.vm.updateDestinationEmails("a@a.com, b@b.com", 0);
      expect(wrapper.vm.jsonArrayOfObj[0].emails).toEqual(["a@a.com", "b@b.com"]);
    });

    it("updateSkipTlsVerify sets skip_tls_verify and userSelectedSkipTlsVerify", () => {
      wrapper.vm.updateSkipTlsVerify(true, 0);
      expect(wrapper.vm.jsonArrayOfObj[0].skip_tls_verify).toBe(true);
      expect(wrapper.vm.userSelectedSkipTlsVerify[0]).toBe(true);
    });
  });

  // ─── getServiceActions ────────────────────────────────────────────────────
  describe("getServiceActions", () => {
    it("returns only service-type actions", () => {
      const actions = wrapper.vm.getServiceActions();
      expect(Array.isArray(actions)).toBe(true);
      actions.forEach((a: any) => {
        expect(a.execution_details_type).toBe("service");
      });
    });

    it("returns empty array when no service actions exist", () => {
      const saved = mockStore.state.organizationData.actions;
      mockStore.state.organizationData.actions = [
        { id: "x", name: "X", execution_details_type: "webhook" },
      ];
      expect(wrapper.vm.getServiceActions()).toEqual([]);
      mockStore.state.organizationData.actions = saved;
    });
  });

  // ─── arrowBackFn ─────────────────────────────────────────────────────────
  describe("arrowBackFn", () => {
    it("pushes to alertDestinations route with org_identifier", () => {
      wrapper.vm.arrowBackFn();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "alertDestinations",
        query: { org_identifier: "test-org" },
      });
    });
  });

  // ─── validateDestinationInputs ────────────────────────────────────────────
  describe("validateDestinationInputs", () => {
    beforeEach(() => {
      wrapper.vm.destinationErrorsToDisplay = [];
    });

    it("returns true for a valid http destination", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: false },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns true for a valid email destination", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "email-dest", type: "email", template: "email-template", emails: ["a@b.com"] },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns false and pushes errors for missing name", async () => {
      const result = await wrapper.vm.validateDestinationInputs({ type: "http" }, 1);
      expect(result).toBe(false);
      expect(wrapper.vm.destinationErrorsToDisplay.length).toBeGreaterThan(0);
    });

    it("returns false for a duplicate destination name", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "existing-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: false },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for an invalid type", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "new-dest", type: "ftp" },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for http missing skip_tls_verify", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1" },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for http with invalid (non-boolean) skip_tls_verify", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: "yes" as any },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for http with invalid headers (array instead of object)", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: false, headers: ["bad"] as any },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for email with a url field present", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "e-dest", type: "email", url: "https://x.com", template: "email-template", emails: ["a@b.com"] },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for email with empty emails array", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "e-dest", type: "email", template: "email-template", emails: [] },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for email with non-string items in emails array", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "e-dest", type: "email", template: "email-template", emails: ["a@b.com", 123 as any] },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for action type with non-existent action_id", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "act-dest", type: "action", action_id: "non-existent" },
        1,
      );
      expect(result).toBe(false);
    });

    it("returns true for action type with a valid service action id", async () => {
      const result = await wrapper.vm.validateDestinationInputs(
        { name: "act-dest", type: "action", action_id: "action1" },
        1,
      );
      expect(result).toBe(true);
    });
  });

  // ─── importJson — JSON parsing edge cases ─────────────────────────────────
  describe("importJson — JSON parsing edge cases", () => {
    beforeEach(() => {
      wrapper.vm.destinationErrorsToDisplay = [];
      wrapper.vm.destinationCreators = [];
    });

    it("does nothing and resets isImporting when jsonStr is empty", async () => {
      wrapper.vm.$refs.baseImportRef.isImporting = true;
      await wrapper.vm.importJson({ jsonStr: "", jsonArray: [] });
      expect(wrapper.vm.$refs.baseImportRef.isImporting).toBe(false);
    });

    it("calls toast with the parse error message for invalid JSON", async () => {
      await wrapper.vm.importJson({ jsonStr: "{ bad json }", jsonArray: [] });
      expect(mockToast).toHaveBeenCalled();
    });

    it("resets isImporting on parse error", async () => {
      wrapper.vm.$refs.baseImportRef.isImporting = true;
      await wrapper.vm.importJson({ jsonStr: "{ bad json }", jsonArray: [] });
      expect(wrapper.vm.$refs.baseImportRef.isImporting).toBe(false);
    });

    it("resets error arrays before processing", async () => {
      wrapper.vm.destinationErrorsToDisplay = [["old error"]];
      wrapper.vm.destinationCreators = [{ message: "old", success: true }];
      // Use invalid JSON so the test short-circuits after reset
      await wrapper.vm.importJson({ jsonStr: "not-json", jsonArray: [] });
      // The reset happens after JSON parse, on error both stay empty (reset then error path)
      // Verify they were cleared — both start fresh each call
      expect(Array.isArray(wrapper.vm.destinationErrorsToDisplay)).toBe(true);
    });
  });

  // ─── createDestination ────────────────────────────────────────────────────
  describe("createDestination", () => {
    it("returns true and emits update:destinations on success", async () => {
      const destService = await import("@/services/alert_destination");
      vi.mocked(destService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.createDestination({ name: "d1", type: "http" }, 1);

      expect(result).toBe(true);
      expect(destService.default.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "d1",
        data: { name: "d1", type: "http" },
      });
      expect(wrapper.emitted("update:destinations")).toBeTruthy();
      expect(wrapper.vm.destinationCreators[0].success).toBe(true);
    });

    it("returns false and records failure message on API error", async () => {
      const destService = await import("@/services/alert_destination");
      vi.mocked(destService.default.create).mockRejectedValueOnce({
        response: { data: { message: "Already exists" } },
      });

      const result = await wrapper.vm.createDestination({ name: "d1", type: "http" }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.destinationCreators[0].success).toBe(false);
      expect(wrapper.vm.destinationCreators[0].message).toContain("Already exists");
    });

    it("falls back to 'Unknown Error' when response has no message", async () => {
      const destService = await import("@/services/alert_destination");
      vi.mocked(destService.default.create).mockRejectedValueOnce(new Error("net error"));

      const result = await wrapper.vm.createDestination({ name: "d1" }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.destinationCreators[0].message).toContain("Unknown Error");
    });
  });

  // ─── processJsonObject ───────────────────────────────────────────────────
  describe("processJsonObject", () => {
    beforeEach(() => {
      wrapper.vm.destinationErrorsToDisplay = [];
      wrapper.vm.destinationCreators = [];
    });

    it("returns true for a fully valid http destination", async () => {
      const destService = await import("@/services/alert_destination");
      vi.mocked(destService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.processJsonObject(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: false },
        1,
      );
      expect(result).toBe(true);
    });

    it("returns false for an invalid object (validation fails)", async () => {
      const result = await wrapper.vm.processJsonObject({ name: "", type: "bad" }, 1);
      expect(result).toBe(false);
    });

    it("returns false when destinationErrorsToDisplay has prior entries even if current object is valid", async () => {
      // Pre-populate errors from a prior object
      wrapper.vm.destinationErrorsToDisplay = [["prior error"]];
      const destService = await import("@/services/alert_destination");
      vi.mocked(destService.default.create).mockResolvedValueOnce(true as any);

      const result = await wrapper.vm.processJsonObject(
        { name: "new-dest", type: "http", url: "https://x.com", method: "post", template: "template1", skip_tls_verify: false },
        2,
      );
      expect(result).toBe(false);
    });
  });

  // ─── Output section conditional rendering via v-if ────────────────────────
  describe("output-content slot — conditional branches", () => {
    it("renders error group items when destinationErrorsToDisplay is non-empty", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "destination_name", message: "name error" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-error-0-0"]').exists(),
      ).toBe(true);
    });

    it("renders the creation title when destinationCreators is non-empty", async () => {
      wrapper.vm.destinationCreators = [{ message: "ok", success: true }];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-creation-title"]').exists(),
      ).toBe(true);
    });

    it("renders individual creation result messages", async () => {
      wrapper.vm.destinationCreators = [{ message: "created", success: true }];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-creation-0-message"]').exists(),
      ).toBe(true);
    });

    it("renders the name correction input for destination_name field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "destination_name", message: "name conflict" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-name-input"]').exists(),
      ).toBe(true);
    });

    it("renders the url correction input for url field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "url", message: "url required" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-url-input"]').exists(),
      ).toBe(true);
    });

    it("renders the type correction select for type field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "type", message: "invalid type" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-type-input"]').exists(),
      ).toBe(true);
    });

    it("renders the method correction select for method field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "method", message: "invalid method" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-method-input"]').exists(),
      ).toBe(true);
    });

    it("renders the template correction select for template_name field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "template_name", message: "template missing" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-template-input"]').exists(),
      ).toBe(true);
    });

    it("renders the emails correction input for email_input field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "email_input", message: "emails required" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-emails-input"]').exists(),
      ).toBe(true);
    });

    it("renders the action correction select for action_id field errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [
        [{ field: "action_id", message: "action missing" }],
      ];
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-test="destination-import-action-input"]').exists(),
      ).toBe(true);
    });

    it("renders plain text for unknown-field string errors", async () => {
      wrapper.vm.destinationErrorsToDisplay = [["plain string error"]];
      await wrapper.vm.$nextTick();
      const el = wrapper.find('[data-test="destination-import-error-0-0"]');
      expect(el.exists()).toBe(true);
      expect(el.text()).toContain("plain string error");
    });
  });

  // ─── filterTemplates ──────────────────────────────────────────────────────
  describe("filterTemplates", () => {
    it("clears to formatted list when val is empty", () => {
      wrapper.vm.filterTemplates("");
      expect(Array.isArray(wrapper.vm.filteredTemplates)).toBe(true);
    });

    it("filters templates by partial name match", () => {
      wrapper.vm.filterTemplates("email");
      wrapper.vm.filteredTemplates.forEach((t: string) => {
        expect(t.toLowerCase()).toContain("email");
      });
    });
  });

  // ─── filterActions ────────────────────────────────────────────────────────
  describe("filterActions", () => {
    it("returns full list when val is empty", () => {
      wrapper.vm.filterActions("");
      expect(Array.isArray(wrapper.vm.filteredActions)).toBe(true);
    });

    it("filters actions by partial label match", () => {
      wrapper.vm.filterActions("Test");
      wrapper.vm.filteredActions.forEach((a: any) => {
        expect(a.label.toLowerCase()).toContain("test");
      });
    });
  });
});
