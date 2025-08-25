import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import useDnD from '@/plugins/pipelines/useDnD';
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import ExternalDestination from "./ExternalDestination.vue";
import destinationService from "@/services/alert_destination";

// Mock zincutils with all required functions
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isValidResourceName: (name) => {
      const regex = /^[a-zA-Z0-9+=,.@_-]+$/;
      return regex.test(name);
    },
    getUUID: () => "test-uuid",
    mergeRoutes: (route1, route2) => {
      return [...(route1 || []), ...(route2 || [])];
    },
    getTimezoneOffset: () => 0,
    getTimezonesByOffset: () => [],
  };
});

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock destination service
vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
    list: vi.fn(),
  },
}));

const mockAddNode = vi.fn();
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: vi.fn(),
  useDnD: () => ({
    addNode: mockAddNode,
    pipelineObj: {
      isEditNode: false,
      currentSelectedNodeData: null,
      userClickedNode: {},
      userSelectedNode: {},
    },
    deletePipelineNode: vi.fn()
  })
}));

// Mock router
const mockRouterPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({
      push: mockRouterPush,
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    }),
  };
});

describe("ExternalDestination Component - Comprehensive Tests", () => {
  let wrapper;
  let mockPipelineObj;
  let mockStore;
  let notifyMock;
  let dismissMock;
  let mockIsValidResourceName;

  beforeEach(async () => {
    // Setup mock store
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        }
      }
    };

    // Get the mocked function
    const zincutils = await import("@/utils/zincutils");
    mockIsValidResourceName = zincutils.isValidResourceName;

    // Setup mock pipeline object
    mockPipelineObj = {
      currentSelectedNodeData: {
        data: {},
        type: 'destination'
      },
      userSelectedNode: {},
      isEditNode: false
    };

    // Mock destination service responses
    destinationService.list.mockResolvedValue({
      data: [
        { name: "dest1", url: "http://dest1.com" },
        { name: "dest2", url: "http://dest2.com" }
      ]
    });

    // Setup notify mock
    dismissMock = vi.fn();
    notifyMock = vi.fn(() => dismissMock);

    // Mock useDnD composable
    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      addNode: mockAddNode,
      deletePipelineNode: vi.fn()
    }));

    // Mount component
    wrapper = mount(ExternalDestination, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          QPage: false,
          QSelect: false,
          QForm: false,
          QInput: false,
          QBtn: false,
          QToggle: false,
          QSeparator: true,
          AppTabs: true
        }
      }
    });

    wrapper.vm.$q.notify = notifyMock;
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();
  });

  describe("1. Component Initialization", () => {
    it("1.1 should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("1.2 should initialize with default values", () => {
      expect(wrapper.vm.createNewDestination).toBe(false);
      expect(wrapper.vm.formData.method).toBe("post");
      expect(wrapper.vm.formData.output_format).toBe("json");
      expect(wrapper.vm.formData.skip_tls_verify).toBe(false);
      expect(wrapper.vm.formData.type).toBe("http");
    });

    it("1.3 should load destinations on mount", async () => {
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "test-org",
          module: "pipeline"
        })
      );
      expect(wrapper.vm.destinations).toHaveLength(2);
    });

    it("1.4 should initialize apiHeaders with one empty header", () => {
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0]).toEqual(expect.objectContaining({
        key: "",
        value: "",
        uuid: expect.any(String)
      }));
    });

    it("1.5 should initialize selectedDestination from pipeline data", async () => {
      const wrapperWithData = mount(ExternalDestination, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            AppTabs: true
          }
        }
      });

      // Mock useDnD with existing destination
      vi.mocked(useDnD).mockImplementation(() => ({
        pipelineObj: {
          currentSelectedNodeData: {
            data: { destination_name: "existing-dest" }
          }
        },
        addNode: mockAddNode,
        deletePipelineNode: vi.fn()
      }));

      expect(wrapperWithData.vm.selectedDestination).toEqual({
        label: "",
        value: ""
      });
    });

    it("1.6 should have correct default retries value", () => {
      expect(wrapper.vm.retries).toBe(0);
    });

    it("1.7 should have correct apiMethods array", () => {
      expect(wrapper.vm.apiMethods).toEqual(["get", "post", "put"]);
    });

    it("1.8 should have correct outputFormats array", () => {
      expect(wrapper.vm.outputFormats).toEqual(["json", "ndjson"]);
    });

    it("1.9 should initialize isUpdatingDestination as false", () => {
      expect(wrapper.vm.isUpdatingDestination).toBe(false);
    });
  });

  describe("2. getUUID Function", () => {
    it("2.1 should generate a UUID string", () => {
      const uuid1 = wrapper.vm.getUUID();
      const uuid2 = wrapper.vm.getUUID();
      
      expect(typeof uuid1).toBe("string");
      expect(uuid1.length).toBeGreaterThan(0);
      expect(uuid1).not.toBe(uuid2);
    });

    it("2.2 should generate numeric UUIDs", () => {
      const uuid = wrapper.vm.getUUID();
      expect(/^\d+$/.test(uuid)).toBe(true);
    });

    it("2.3 should generate UUIDs within expected range", () => {
      const uuid = parseInt(wrapper.vm.getUUID());
      expect(uuid).toBeGreaterThanOrEqual(100);
      expect(uuid).toBeLessThanOrEqual(9999999999);
    });
  });

  describe("3. Form Validation", () => {
    it("3.1 should validate required fields for destination", () => {
      wrapper.vm.formData = { name: "", url: "", method: "" };
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("3.2 should validate complete destination data", () => {
      wrapper.vm.formData = { 
        name: "test-dest", 
        url: "http://example.com", 
        method: "post" 
      };
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });

    it("3.3 should validate partial destination data (missing name)", () => {
      wrapper.vm.formData = { 
        name: "", 
        url: "http://example.com", 
        method: "post" 
      };
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("3.4 should validate partial destination data (missing url)", () => {
      wrapper.vm.formData = { 
        name: "test-dest", 
        url: "", 
        method: "post" 
      };
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("3.5 should validate partial destination data (missing method)", () => {
      wrapper.vm.formData = { 
        name: "test-dest", 
        url: "http://example.com", 
        method: "" 
      };
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("3.6 should validate destination name format", () => {
      const invalidNames = ["test space", "test/name", "test:name"];
      const validNames = ["test-name", "test_name", "testname123"];

      invalidNames.forEach(name => {
        expect(mockIsValidResourceName(name)).toBe(false);
      });

      validNames.forEach(name => {
        expect(mockIsValidResourceName(name)).toBe(true);
      });
    });
  });

  describe("4. Destination Creation", () => {
    beforeEach(async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();
    });

    it("4.1 should prevent creation with invalid data", async () => {
      await wrapper.vm.createDestination();
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please fill required fields"
        })
      );
    });

    it("4.2 should create destination successfully", async () => {
      wrapper.vm.formData = {
        name: "new-dest",
        url: "http://new-dest.com",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      };

      destinationService.create.mockResolvedValueOnce({});
      
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "positive",
        message: "Destination saved successfully."
      }));
    });

    it("4.3 should handle creation error", async () => {
      wrapper.vm.formData = {
        name: "test-dest",
        url: "http://test.com",
        method: "post"
      };

      destinationService.create.mockRejectedValueOnce({
        response: { data: { message: "Error creating destination" } }
      });

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: "Error creating destination"
      }));
    });

    it("4.4 should handle 403 error silently", async () => {
      wrapper.vm.formData = {
        name: "test-dest",
        url: "http://test.com",
        method: "post"
      };

      destinationService.create.mockRejectedValueOnce({
        response: { status: 403 }
      });

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "negative"
      }));
    });

    it("4.5 should create destination with headers", async () => {
      wrapper.vm.formData = {
        name: "dest-with-headers",
        url: "http://dest.com",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      };

      wrapper.vm.apiHeaders = [
        { key: "Content-Type", value: "application/json", uuid: "uuid1" },
        { key: "Authorization", value: "Bearer token", uuid: "uuid2" }
      ];

      destinationService.create.mockResolvedValueOnce({});
      
      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "dest-with-headers",
        data: expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer token"
          }
        })
      });
    });

    it("4.6 should ignore empty headers", async () => {
      wrapper.vm.formData = {
        name: "dest-empty-headers",
        url: "http://dest.com",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      };

      wrapper.vm.apiHeaders = [
        { key: "", value: "", uuid: "uuid1" },
        { key: "Content-Type", value: "", uuid: "uuid2" },
        { key: "", value: "some-value", uuid: "uuid3" }
      ];

      destinationService.create.mockResolvedValueOnce({});
      
      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "dest-empty-headers",
        data: expect.objectContaining({
          headers: {}
        })
      });
    });

    it("4.7 should create destination with ndjson format", async () => {
      wrapper.vm.formData = {
        name: "ndjson-dest",
        url: "http://dest.com",
        method: "post",
        output_format: "ndjson",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http"
      };

      destinationService.create.mockResolvedValueOnce({});
      
      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            output_format: "ndjson"
          })
        })
      );
    });
  });

  describe("5. API Headers Management", () => {
    it("5.1 should add new header with default values", () => {
      const initialLength = wrapper.vm.apiHeaders.length;
      wrapper.vm.addApiHeader();
      
      expect(wrapper.vm.apiHeaders).toHaveLength(initialLength + 1);
      const newHeader = wrapper.vm.apiHeaders[initialLength];
      expect(newHeader.key).toBe("");
      expect(newHeader.value).toBe("");
      expect(typeof newHeader.uuid).toBe("string");
    });

    it("5.2 should add header with custom values", () => {
      const initialLength = wrapper.vm.apiHeaders.length;
      wrapper.vm.addApiHeader("Custom-Header", "custom-value");
      
      expect(wrapper.vm.apiHeaders).toHaveLength(initialLength + 1);
      const newHeader = wrapper.vm.apiHeaders[initialLength];
      expect(newHeader.key).toBe("Custom-Header");
      expect(newHeader.value).toBe("custom-value");
    });

    it("5.3 should delete specific header", () => {
      wrapper.vm.apiHeaders = [
        { key: "Header1", value: "value1", uuid: "uuid1" },
        { key: "Header2", value: "value2", uuid: "uuid2" }
      ];

      const headerToDelete = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(headerToDelete);

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Header2");
    });

    it("5.4 should maintain at least one empty header", () => {
      wrapper.vm.apiHeaders = [{ key: "", value: "", uuid: "uuid1" }];
      
      const header = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(header);

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0]).toEqual(expect.objectContaining({
        key: "",
        value: ""
      }));
    });

    it("5.5 should delete header from formData.headers", () => {
      wrapper.vm.formData.headers = { "Test-Header": "test-value" };
      wrapper.vm.apiHeaders = [
        { key: "Test-Header", value: "test-value", uuid: "uuid1" }
      ];

      const headerToDelete = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(headerToDelete);

      expect(wrapper.vm.formData.headers["Test-Header"]).toBeUndefined();
    });

    it("5.6 should add multiple headers", () => {
      wrapper.vm.apiHeaders = [];
      
      wrapper.vm.addApiHeader("Header1", "value1");
      wrapper.vm.addApiHeader("Header2", "value2");
      wrapper.vm.addApiHeader("Header3", "value3");

      expect(wrapper.vm.apiHeaders).toHaveLength(3);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Header1");
      expect(wrapper.vm.apiHeaders[1].key).toBe("Header2");
      expect(wrapper.vm.apiHeaders[2].key).toBe("Header3");
    });

    it("5.7 should generate unique UUIDs for headers", () => {
      wrapper.vm.addApiHeader();
      wrapper.vm.addApiHeader();
      
      const uuids = wrapper.vm.apiHeaders.map(h => h.uuid);
      const uniqueUuids = [...new Set(uuids)];
      expect(uniqueUuids).toHaveLength(uuids.length);
    });
  });

  describe("6. Destination Formatting", () => {
    it("6.1 should format destinations correctly", () => {
      wrapper.vm.destinations = [
        { name: "dest1", url: "http://dest1.com" },
        { name: "dest2", url: "http://dest2.com" }
      ];

      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted).toEqual([
        { label: "dest1", value: "dest1", url: "http://dest1.com" },
        { label: "dest2", value: "dest2", url: "http://dest2.com" }
      ]);
    });

    it("6.2 should truncate long URLs", () => {
      wrapper.vm.destinations = [{
        name: "long-url-dest",
        url: "https://very-long-url-that-exceeds-seventy-characters-limit-for-display.com/api/v1/webhooks"
      }];

      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url.length).toBeLessThanOrEqual(73); // 70 + "..."
      expect(formatted[0].url.endsWith("...")).toBe(true);
    });

    it("6.3 should not truncate short URLs", () => {
      wrapper.vm.destinations = [{
        name: "short-url-dest",
        url: "http://short.com"
      }];

      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url).toBe("http://short.com");
      expect(formatted[0].url.endsWith("...")).toBe(false);
    });

    it("6.4 should handle empty destinations array", () => {
      wrapper.vm.destinations = [];
      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted).toEqual([]);
    });

    it("6.5 should handle destinations with exactly 70 characters", () => {
      const exactly70CharUrl = "a".repeat(70);
      wrapper.vm.destinations = [{
        name: "exact-length-dest",
        url: exactly70CharUrl
      }];

      const formatted = wrapper.vm.getFormattedDestinations;
      expect(formatted[0].url).toBe(exactly70CharUrl);
      expect(formatted[0].url.endsWith("...")).toBe(false);
    });
  });

  describe("7. Save Destination", () => {
    it("7.1 should save destination with valid selection", () => {
      wrapper.vm.selectedDestination = { value: "dest1" };
      wrapper.vm.saveDestination();
      
      expect(mockAddNode).toHaveBeenCalledWith({
        destination_name: "dest1",
        node_type: "remote_stream",
        io_type: "output",
        org_id: "test-org"
      });
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("7.2 should prevent saving without selection", () => {
      wrapper.vm.selectedDestination = { value: "" };
      wrapper.vm.saveDestination();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Please select External destination from the list",
          color: "negative"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("7.3 should handle null selectedDestination", () => {
      wrapper.vm.selectedDestination = { hasOwnProperty: () => false };
      wrapper.vm.saveDestination();
      
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("7.4 should emit cancel event after successful save", () => {
      wrapper.vm.selectedDestination = { value: "dest1" };
      wrapper.vm.saveDestination();
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(1);
    });
  });

  describe("8. Get Destinations", () => {
    it("8.1 should fetch destinations successfully", async () => {
      const mockDestinations = [
        { name: "dest1", url: "http://dest1.com" },
        { name: "dest2", url: "http://dest2.com" }
      ];

      destinationService.list.mockResolvedValueOnce({ data: mockDestinations });
      
      await wrapper.vm.getDestinations();
      await flushPromises();

      expect(wrapper.vm.destinations).toEqual(mockDestinations);
    });

    it("8.2 should handle fetch error", async () => {
      destinationService.list.mockRejectedValueOnce({
        response: { status: 500 }
      });

      await wrapper.vm.getDestinations();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: "Error while pulling destinations."
      }));
    });

    it("8.3 should handle 403 error silently", async () => {
      destinationService.list.mockRejectedValueOnce({
        response: { status: 403 }
      });

      await wrapper.vm.getDestinations();
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "negative"
      }));
    });

    it("8.4 should call with correct parameters", async () => {
      await wrapper.vm.getDestinations();
      
      expect(destinationService.list).toHaveBeenCalledWith({
        page_num: 1,
        page_size: 100000,
        sort_by: "name",
        desc: false,
        org_identifier: "test-org",
        module: "pipeline"
      });
    });

    it("8.5 should show loading notification", async () => {
      const promise = wrapper.vm.getDestinations();
      
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        spinner: true,
        message: "Please wait while loading destinations..."
      }));
      
      await promise;
      await flushPromises();
    });
  });

  describe("9. Create Email Template", () => {
    it("9.1 should navigate to email template creation", () => {
      wrapper.vm.createEmailTemplate();
      
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "alertTemplates",
        query: {
          action: "add",
          type: "email",
          org_identifier: "test-org"
        }
      });
    });

    it("9.2 should use correct organization identifier", () => {
      mockStore.state.selectedOrganization.identifier = "different-org";
      
      wrapper.vm.createEmailTemplate();
      
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            org_identifier: "different-org"
          })
        })
      );
    });
  });

  describe("10. Watchers and Lifecycle", () => {
    it("10.1 should reset form when createNewDestination changes to true", async () => {
      wrapper.vm.formData.name = "existing-name";
      wrapper.vm.formData.url = "existing-url";
      wrapper.vm.apiHeaders = [
        { key: "existing", value: "header", uuid: "uuid1" }
      ];

      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData).toEqual({
        name: "",
        url: "",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      });
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0]).toEqual(expect.objectContaining({
        key: "",
        value: ""
      }));
    });

    it("10.2 should not reset form when createNewDestination is false", async () => {
      const originalFormData = { ...wrapper.vm.formData };
      
      wrapper.vm.createNewDestination = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData).toEqual(originalFormData);
    });
  });

  describe("11. HTTP Methods", () => {
    it("11.1 should support GET method", () => {
      wrapper.vm.formData.method = "get";
      expect(wrapper.vm.apiMethods).toContain("get");
    });

    it("11.2 should support POST method", () => {
      wrapper.vm.formData.method = "post";
      expect(wrapper.vm.apiMethods).toContain("post");
    });

    it("11.3 should support PUT method", () => {
      wrapper.vm.formData.method = "put";
      expect(wrapper.vm.apiMethods).toContain("put");
    });

    it("11.4 should default to POST method", () => {
      expect(wrapper.vm.formData.method).toBe("post");
    });
  });

  describe("12. Output Formats", () => {
    it("12.1 should support JSON format", () => {
      expect(wrapper.vm.outputFormats).toContain("json");
    });

    it("12.2 should support NDJSON format", () => {
      expect(wrapper.vm.outputFormats).toContain("ndjson");
    });

    it("12.3 should default to JSON format", () => {
      expect(wrapper.vm.formData.output_format).toBe("json");
    });
  });

  describe("13. Template Handling", () => {
    it("13.1 should handle empty template", () => {
      wrapper.vm.formData.template = "";
      expect(wrapper.vm.formData.template).toBe("");
    });

    it("13.2 should handle custom template", () => {
      const customTemplate = "Custom alert template: {{message}}";
      wrapper.vm.formData.template = customTemplate;
      expect(wrapper.vm.formData.template).toBe(customTemplate);
    });
  });

  describe("14. TLS Settings", () => {
    it("14.1 should default skip_tls_verify to false", () => {
      expect(wrapper.vm.formData.skip_tls_verify).toBe(false);
    });

    it("14.2 should allow enabling skip_tls_verify", () => {
      wrapper.vm.formData.skip_tls_verify = true;
      expect(wrapper.vm.formData.skip_tls_verify).toBe(true);
    });
  });

  describe("15. Error Scenarios", () => {
    it("15.1 should handle malformed destination response", async () => {
      destinationService.create.mockRejectedValueOnce({
        response: { data: { error: "Malformed request" } }
      });

      wrapper.vm.formData = {
        name: "test-dest",
        url: "http://test.com",
        method: "post"
      };

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: "Malformed request"
      }));
    });

    it("15.2 should handle network timeout", async () => {
      destinationService.create.mockRejectedValueOnce({
        response: { data: { message: "Network timeout" } }
      });

      wrapper.vm.formData = {
        name: "test-dest",
        url: "http://test.com",
        method: "post"
      };

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: "Network timeout"
      }));
    });
  });

  describe("16. Edge Cases", () => {
    it("16.1 should handle very long destination names", () => {
      const longName = "a".repeat(1000);
      wrapper.vm.formData.name = longName;
      wrapper.vm.formData.url = "http://test.com";
      wrapper.vm.formData.method = "post";
      
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });

    it("16.2 should handle Unicode characters in names", () => {
      wrapper.vm.formData.name = "测试-destination";
      wrapper.vm.formData.url = "http://test.com";
      wrapper.vm.formData.method = "post";
      
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });

    it("16.3 should handle URLs with special characters", () => {
      wrapper.vm.formData.name = "special-dest";
      wrapper.vm.formData.url = "https://api.example.com/webhook?key=value&special=%20chars";
      wrapper.vm.formData.method = "post";
      
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });
  });

  describe("17. Component Cleanup", () => {
    it("17.1 should emit cancel event", async () => {
      wrapper.vm.selectedDestination = { value: "test-dest" };
      wrapper.vm.saveDestination();
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("17.2 should handle multiple cancel events", async () => {
      wrapper.vm.selectedDestination = { value: "test-dest1" };
      wrapper.vm.saveDestination();
      
      wrapper.vm.selectedDestination = { value: "test-dest2" };
      wrapper.vm.saveDestination();
      
      expect(wrapper.emitted()["cancel:hideform"]).toHaveLength(2);
    });
  });

  describe("18. Complex Integration Tests", () => {
    it("18.1 should handle full workflow: create destination then save", async () => {
      // Step 1: Create new destination
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.formData = {
        name: "workflow-dest",
        url: "http://workflow.com",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      };

      destinationService.create.mockResolvedValueOnce({});
      await wrapper.vm.createDestination();
      await flushPromises();

      // Step 2: Save the destination
      expect(wrapper.vm.selectedDestination.value).toBe("workflow-dest");
      wrapper.vm.saveDestination();

      expect(mockAddNode).toHaveBeenCalledWith({
        destination_name: "workflow-dest",
        node_type: "remote_stream",
        io_type: "output",
        org_id: "test-org"
      });
    });

    it("18.2 should handle creating destination with complex headers", async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();

      // Add multiple headers
      wrapper.vm.addApiHeader("Authorization", "Bearer token123");
      wrapper.vm.addApiHeader("Content-Type", "application/json");
      wrapper.vm.addApiHeader("X-Custom-Header", "custom-value");

      wrapper.vm.formData = {
        name: "complex-dest",
        url: "http://complex.com",
        method: "put",
        skip_tls_verify: true,
        template: "Alert: {{message}}",
        headers: {},
        emails: "",
        type: "http",
        output_format: "ndjson"
      };

      destinationService.create.mockResolvedValueOnce({});
      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "complex-dest",
        data: {
          url: "http://complex.com",
          method: "put",
          skip_tls_verify: true,
          template: "Alert: {{message}}",
          headers: {
            "Authorization": "Bearer token123",
            "Content-Type": "application/json",
            "X-Custom-Header": "custom-value"
          },
          name: "complex-dest",
          type: "http",
          output_format: "ndjson"
        }
      });
    });
  });
});