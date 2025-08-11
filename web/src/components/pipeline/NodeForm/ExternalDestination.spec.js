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

describe("ExternalDestination Component", () => {
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
          QSeparator: true
        }
      }
    });

    wrapper.vm.$q.notify = notifyMock;

    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with default values", () => {
      expect(wrapper.vm.createNewDestination).toBe(false);
      expect(wrapper.vm.formData.method).toBe("post");
      expect(wrapper.vm.formData.output_format).toBe("json");
      expect(wrapper.vm.formData.skip_tls_verify).toBe(false);
    });

    it("loads destinations on mount", async () => {
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "test-org",
          module: "pipeline"
        })
      );
      expect(wrapper.vm.destinations).toHaveLength(2);
    });
  });

  describe("Destination Selection", () => {
    it("formats destinations correctly", () => {
      const formattedDests = wrapper.vm.getFormattedDestinations;
      expect(formattedDests).toEqual([
        { label: "dest1", value: "dest1", url: "http://dest1.com" },
        { label: "dest2", value: "dest2", url: "http://dest2.com" }
      ]);
    });

    it("prevents saving without selecting destination", async () => {
      wrapper.vm.selectedDestination = { value: "" };
      await wrapper.vm.saveDestination();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Please select External destination from the list",
          color: "negative"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });
  });

  describe("Create New Destination", () => {
    beforeEach(async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();
    });

    it("shows create destination form when toggled", async () => {
      const nameInput = wrapper.find('[data-test="add-destination-name-input"]');
      const urlInput = wrapper.find('[data-test="add-destination-url-input"]');
      expect(nameInput.exists()).toBe(true);
      expect(urlInput.exists()).toBe(true);
    });

    it("validates required fields", async () => {
      await wrapper.vm.createDestination();
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please fill required fields"
        })
      );
    });

    it("handles API headers correctly", async () => {
      // Add a header
      wrapper.vm.addApiHeader("Content-Type", "application/json");
      expect(wrapper.vm.apiHeaders).toHaveLength(2); // Default empty + new one

      // Delete a header
      const headerToDelete = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(headerToDelete);
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
    });

    it("creates destination successfully", async () => {
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
      
      // Check the loading notification
      expect(notifyMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
        spinner: true,
        message: "Please wait..."
      }));

      // Check the success notification
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "positive",
        message: "Destination saved successfully."
      }));
    });
  });

  describe("Header Management", () => {
    beforeEach(async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();
      // Clear existing headers
      wrapper.vm.apiHeaders = [];
    });

    it("adds new header with default values", async () => {
      const initialLength = wrapper.vm.apiHeaders.length;
      wrapper.vm.addApiHeader();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(initialLength + 1);
      const newHeader = wrapper.vm.apiHeaders[initialLength];
      expect(newHeader.key).toBe("");
      expect(newHeader.value).toBe("");
      expect(typeof newHeader.uuid).toBe("string");
    });

    it("deletes specific header", async () => {
      // Start with empty headers
      wrapper.vm.apiHeaders = [];
      
      // Add two headers to ensure we have one left after deletion
      wrapper.vm.addApiHeader("Content-Type", "application/json");
      wrapper.vm.addApiHeader("Authorization", "Bearer token");
      await wrapper.vm.$nextTick();

      const initialLength = wrapper.vm.apiHeaders.length;
      const headerToDelete = { ...wrapper.vm.apiHeaders[0] }; // Create a copy
      
      wrapper.vm.deleteApiHeader(headerToDelete);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(initialLength - 1);
      expect(wrapper.vm.apiHeaders.some(h => h.key === headerToDelete.key)).toBe(false);
      expect(wrapper.vm.apiHeaders.some(h => h.value === headerToDelete.value)).toBe(false);
    });

    it("maintains at least one empty header", async () => {
      // Start with empty headers
      wrapper.vm.apiHeaders = [];
      wrapper.vm.addApiHeader();
      await wrapper.vm.$nextTick();

      const header = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(header);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0]).toEqual(expect.objectContaining({
        key: "",
        value: ""
      }));
    });
  });

  describe("Save Destination", () => {
    it("saves destination with correct data", async () => {
      wrapper.vm.selectedDestination = { value: "dest1" };
      await wrapper.vm.saveDestination();
      
      expect(mockAddNode).toHaveBeenCalledWith({
        destination_name: "dest1",
        node_type: "remote_stream",
        io_type: "output",
        org_id: "test-org"
      });
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  describe("Form Validation", () => {
    it("validates destination name format", async () => {
      const invalidNames = ["test space", "test/name", "test:name"];
      const validNames = ["test-name", "test_name", "testname123"];

      invalidNames.forEach(name => {
        expect(mockIsValidResourceName(name)).toBe(false);
      });

      validNames.forEach(name => {
        expect(mockIsValidResourceName(name)).toBe(true);
      });
    });

    it("validates URL field", async () => {
      wrapper.vm.createNewDestination = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.url = "";
      await wrapper.vm.createDestination();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please fill required fields"
        })
      );
    });
  });

  describe("URL and Method Validation", () => {
    beforeEach(async () => {
      // Reset mocks
      destinationService.create.mockReset();
      destinationService.create.mockResolvedValue({});
      
      // Setup initial state
      wrapper.vm.createNewDestination = true;
      wrapper.vm.formData = {
        name: "test-dest",
        url: "",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json"
      };
      await wrapper.vm.$nextTick();
    });

    it("validates required URL field", async () => {
      // Empty URL
      await wrapper.vm.createDestination();
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please fill required fields"
        })
      );

      // With valid URL and required fields
      wrapper.vm.formData.url = "https://api.example.com";
      wrapper.vm.formData.name = "test-destination";
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            headers: {},
            method: "post",
            name: "test-destination",
            output_format: "json",
            skip_tls_verify: false,
            template: "",
            type: "http",
            url: "https://api.example.com"
          },
          destination_name: "test-destination",
          org_identifier: "test-org"
        })
      );
    });

    it("provides correct API methods", () => {
      const methods = wrapper.vm.apiMethods;
      expect(methods).toContain("get");
      expect(methods).toContain("post");
      expect(methods).toContain("put");
      expect(methods).toHaveLength(3);
    });

    it("defaults to POST method", () => {
      expect(wrapper.vm.formData.method).toBe("post");
    });

    it("allows changing HTTP method", async () => {
      wrapper.vm.formData.method = "get";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.formData.method).toBe("get");

      wrapper.vm.formData.method = "put";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.formData.method).toBe("put");
    });

    it("validates destination creation with different methods", async () => {
      // Setup required fields
      wrapper.vm.formData.url = "https://api.example.com";
      wrapper.vm.formData.name = "test-destination";
      
      // Test with GET
      wrapper.vm.formData.method = "get";
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            headers: {},
            method: "get",
            name: "test-destination",
            output_format: "json",
            skip_tls_verify: false,
            template: "",
            type: "http",
            url: "https://api.example.com"
          },
          destination_name: "test-destination",
          org_identifier: "test-org"
        })
      );

      // Reset mock for next test
      destinationService.create.mockClear();

      // Test with PUT
      wrapper.vm.formData.method = "put";
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            headers: {},
            method: "put",
            name: "test-destination",
            output_format: "json",
            skip_tls_verify: false,
            template: "",
            type: "http",
            url: "https://api.example.com"
          },
          destination_name: "test-destination",
          org_identifier: "test-org"
        })
      );
    });

    it("handles URL with query parameters", async () => {
      wrapper.vm.formData.url = "https://api.example.com/webhook?token=123&type=alert";
      wrapper.vm.formData.name = "test-destination";
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            headers: {},
            method: "post",
            name: "test-destination",
            output_format: "json",
            skip_tls_verify: false,
            template: "",
            type: "http",
            url: "https://api.example.com/webhook?token=123&type=alert"
          },
          destination_name: "test-destination",
          org_identifier: "test-org"
        })
      );
    });

    it("handles URL with path parameters", async () => {
      wrapper.vm.formData.url = "https://api.example.com/v1/webhooks/123/notify";
      wrapper.vm.formData.name = "test-destination";
      await wrapper.vm.createDestination();
      await flushPromises();
      
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            headers: {},
            method: "post",
            name: "test-destination",
            output_format: "json",
            skip_tls_verify: false,
            template: "",
            type: "http",
            url: "https://api.example.com/v1/webhooks/123/notify"
          },
          destination_name: "test-destination",
          org_identifier: "test-org"
        })
      );
    });
  });

  describe("Error Handling", () => {
    it("handles destination creation error", async () => {
      wrapper.vm.createNewDestination = true;
      wrapper.vm.formData = {
        name: "test-dest",
        url: "http://test.com",
        method: "post",
        output_format: "json"
      };

      const errorMessage = "Destination already exists";
      destinationService.create.mockRejectedValueOnce({
        response: { data: { message: errorMessage } }
      });

      await wrapper.vm.createDestination();
      await flushPromises();

      // Check the loading notification
      expect(notifyMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
        spinner: true,
        message: "Please wait..."
      }));

      // Check the error notification
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: errorMessage
      }));
    });

    it("handles destination list loading error", async () => {
      destinationService.list.mockRejectedValueOnce({
        response: { status: 500 }
      });

      await wrapper.vm.getDestinations();
      await flushPromises();

      // Check the loading notification
      expect(notifyMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
        spinner: true,
        message: "Please wait while loading destinations..."
      }));

      // Check the error notification
      expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: "Error while pulling destinations."
      }));
    });
  });
});
