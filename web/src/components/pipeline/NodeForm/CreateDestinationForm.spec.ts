import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/helpers/install-quasar-plugin";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import { createStore } from "vuex";
import destinationService from "@/services/alert_destination";

// Mock the destination service
vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
  },
}));

// Mock the zincutils
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: vi.fn((val: string) => {
    const invalidChars = /[:\/?#\s]/;
    return !invalidChars.test(val);
  }),
  getImageURL: vi.fn((path: string) => `/mock/${path}`),
}));

installQuasar();

describe("CreateDestinationForm", () => {
  let wrapper: any;
  let store: any;

  beforeEach(() => {
    // Create a mock Vuex store
    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });

    wrapper = mount(CreateDestinationForm, {
      global: {
        plugins: [store],
        stubs: {
          "q-stepper": false,
          "q-step": false,
          "q-input": false,
          "q-select": false,
          "q-btn": false,
          "q-icon": false,
          "q-card": false,
          "q-card-section": false,
          "q-toggle": false,
        },
      },
    });
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should start at step 1", () => {
      expect(wrapper.vm.step).toBe(1);
    });

    it("should have OpenObserve as default destination type", () => {
      expect(wrapper.vm.formData.destination_type).toBe("openobserve");
    });

    it("should initialize with default OpenObserve headers", () => {
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });

    it("should have default values for org_identifier and stream_name", () => {
      expect(wrapper.vm.formData.org_identifier).toBe("default");
      expect(wrapper.vm.formData.stream_name).toBe("default");
    });

    it("should have POST as default method", () => {
      expect(wrapper.vm.formData.method).toBe("post");
    });

    it("should have json as default output format", () => {
      expect(wrapper.vm.formData.output_format).toBe("json");
    });
  });

  describe("Destination Type Selection", () => {
    it("should display all destination type cards", () => {
      const cards = wrapper.findAll('[class*="destination-type-card"]');
      expect(cards.length).toBeGreaterThanOrEqual(7); // 7 destination types
    });

    it("should show images for non-custom destination types", async () => {
      const openobserveCard = wrapper.find(
        '[data-test="destination-type-card-openobserve"]'
      );
      const img = openobserveCard.find("img");
      expect(img.exists()).toBe(true);
      expect(img.attributes("alt")).toBe("OpenObserve");
    });

    it("should show icon for custom destination type", async () => {
      const customCard = wrapper.find(
        '[data-test="destination-type-card-custom"]'
      );
      const icon = customCard.find(".card-icon");
      expect(icon.exists()).toBe(true);
    });

    it("should update destination_type when a card is clicked", async () => {
      const splunkCard = wrapper.find(
        '[data-test="destination-type-card-splunk"]'
      );
      await splunkCard.trigger("click");
      await flushPromises();

      expect(wrapper.vm.formData.destination_type).toBe("splunk");
    });

    it("should apply selected class to the active destination card", async () => {
      const openobserveCard = wrapper.find(
        '[data-test="destination-type-card-openobserve"]'
      );
      expect(openobserveCard.classes()).toContain("selected");
    });
  });

  describe("URL Suffix Generation", () => {
    it("should generate correct URL suffix for OpenObserve", () => {
      wrapper.vm.formData.org_identifier = "myorg";
      wrapper.vm.formData.stream_name = "mystream";
      expect(wrapper.vm.urlSuffix).toBe("/api/myorg/mystream/_json");
    });

    it("should use default values if org/stream are empty", () => {
      wrapper.vm.formData.org_identifier = "";
      wrapper.vm.formData.stream_name = "";
      expect(wrapper.vm.urlSuffix).toBe("/api/default/default/_json");
    });

    it("should generate correct URL suffix for Splunk", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("/services/collector/raw");
    });

    it("should generate correct URL suffix for Elasticsearch", async () => {
      wrapper.vm.formData.destination_type = "elasticsearch";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("/_bulk");
    });

    it("should generate correct URL suffix for Datadog", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("/v1/input");
    });

    it("should generate correct URL suffix for Dynatrace", async () => {
      wrapper.vm.formData.destination_type = "dynatrace";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("/api/v2/logs/ingest");
    });

    it("should generate correct URL suffix for Newrelic", async () => {
      wrapper.vm.formData.destination_type = "newrelic";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("/log/v1");
    });

    it("should generate empty URL suffix for Custom", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.urlSuffix).toBe("");
    });
  });

  describe("OpenObserve-Specific Fields", () => {
    it("should show org_identifier field when OpenObserve is selected", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      const orgField = wrapper.find(
        '[data-test="add-destination-org-identifier-input"]'
      );
      expect(orgField.exists()).toBe(true);
    });

    it("should show stream_name field when OpenObserve is selected", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      const streamField = wrapper.find(
        '[data-test="add-destination-stream-name-input"]'
      );
      expect(streamField.exists()).toBe(true);
    });

    it("should hide OpenObserve fields for other destination types", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await wrapper.vm.$nextTick();

      const openobserveFields = wrapper.find(".openobserve-fields");
      expect(openobserveFields.exists()).toBe(false);
    });
  });

  describe("Method Field Behavior", () => {
    it("should hide Method field for OpenObserve", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      const methodField = wrapper.find(
        '[data-test="add-destination-method-select"]'
      );
      expect(methodField.exists()).toBe(false);
    });

    it("should show Method field for Custom destination", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await wrapper.vm.$nextTick();

      const methodField = wrapper.find(
        '[data-test="add-destination-method-select"]'
      );
      expect(methodField.exists()).toBe(true);
    });

    it("should set method to POST when switching to non-custom destination", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.method = "get";
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.destination_type = "splunk";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.method).toBe("post");
    });
  });

  describe("Output Format Field Behavior", () => {
    it("should disable Output Format field for OpenObserve", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      const outputField = wrapper.find(
        '[data-test="add-destination-output-format-select"]'
      );
      expect(outputField.attributes("disable")).toBe("true");
    });

    it("should enable Output Format field for Custom", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await wrapper.vm.$nextTick();

      const outputField = wrapper.find(
        '[data-test="add-destination-output-format-select"]'
      );
      expect(outputField.attributes("disable")).toBe("false");
    });

    it("should set output_format to ndjson for Splunk", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.output_format).toBe("ndjson");
    });

    it("should set output_format to json for Datadog", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.output_format).toBe("json");
    });
  });

  describe("Default Headers Functionality", () => {
    it("should set correct headers for OpenObserve", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });

    it("should set correct headers for Splunk", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Splunk <splunk_token>");
    });

    it("should set correct headers for Elasticsearch", async () => {
      wrapper.vm.formData.destination_type = "elasticsearch";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(2);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("ApiKey <token>");
      expect(wrapper.vm.apiHeaders[1].key).toBe("Content-Type");
      expect(wrapper.vm.apiHeaders[1].value).toBe("application/json");
    });

    it("should set correct headers for Datadog", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(3);
      expect(wrapper.vm.apiHeaders[0].key).toBe("DD-API-KEY");
      expect(wrapper.vm.apiHeaders[0].value).toBe("<token>");
      expect(wrapper.vm.apiHeaders[1].key).toBe("Content-Encoding");
      expect(wrapper.vm.apiHeaders[1].value).toBe("gzip");
      expect(wrapper.vm.apiHeaders[2].key).toBe("Content-Type");
      expect(wrapper.vm.apiHeaders[2].value).toBe("application/json");
    });

    it("should set correct headers for Dynatrace", async () => {
      wrapper.vm.formData.destination_type = "dynatrace";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(2);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Api-Token <token>");
      expect(wrapper.vm.apiHeaders[1].key).toBe("Content-Type");
      expect(wrapper.vm.apiHeaders[1].value).toBe(
        "application/json; charset=utf-8"
      );
    });

    it("should set correct headers for Newrelic", async () => {
      wrapper.vm.formData.destination_type = "newrelic";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Api-Token <token>");
    });

    it("should set empty header for Custom", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("");
      expect(wrapper.vm.apiHeaders[0].value).toBe("");
    });
  });

  describe("Header Management", () => {
    it("should add a new header row", () => {
      const initialLength = wrapper.vm.apiHeaders.length;
      wrapper.vm.addApiHeader("X-Custom", "value");

      expect(wrapper.vm.apiHeaders.length).toBe(initialLength + 1);
      expect(wrapper.vm.apiHeaders[initialLength].key).toBe("X-Custom");
      expect(wrapper.vm.apiHeaders[initialLength].value).toBe("value");
    });

    it("should delete a header row", () => {
      wrapper.vm.addApiHeader("X-Test", "test");
      const headerToDelete = wrapper.vm.apiHeaders[1];
      const initialLength = wrapper.vm.apiHeaders.length;

      wrapper.vm.deleteApiHeader(headerToDelete);

      expect(wrapper.vm.apiHeaders.length).toBe(initialLength - 1);
      expect(
        wrapper.vm.apiHeaders.find((h: any) => h.uuid === headerToDelete.uuid)
      ).toBeUndefined();
    });

    it("should add empty header if all headers are deleted", () => {
      const headerToDelete = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(headerToDelete);

      expect(wrapper.vm.apiHeaders.length).toBe(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("");
      expect(wrapper.vm.apiHeaders[0].value).toBe("");
    });
  });

  describe("Step Navigation", () => {
    it("should have Continue button disabled on step 1 if no destination type selected", async () => {
      wrapper.vm.formData.destination_type = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canProceedStep1).toBe(false);
    });

    it("should enable Continue button on step 1 when destination type is selected", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canProceedStep1).toBe(true);
    });

    it("should move to step 2 when nextStep is called", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.step = 1;
      wrapper.vm.nextStep();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.step).toBe(2);
    });

    it("should move back to step 1 when prevStep is called", async () => {
      wrapper.vm.step = 2;
      wrapper.vm.prevStep();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.step).toBe(1);
    });

    it("should validate step 2 form fields", () => {
      wrapper.vm.formData.name = "Test Destination";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "json";

      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    it("should not validate step 2 if required fields are missing", () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "https://example.com";

      expect(wrapper.vm.canProceedStep2).toBe(false);
    });
  });

  describe("Form Validation", () => {
    it("should validate destination name", () => {
      wrapper.vm.formData.name = "valid-name";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";

      expect(wrapper.vm.isValidDestination).toBe(true);
    });

    it("should invalidate if name is empty", () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";

      expect(wrapper.vm.isValidDestination).toBe(false);
    });

    it("should invalidate if URL is empty", () => {
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "";
      wrapper.vm.formData.method = "post";

      expect(wrapper.vm.isValidDestination).toBe(false);
    });
  });

  describe("Form Submission", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should call destinationService.create with correct payload", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData = {
        name: "Test Destination",
        url: "https://example.com",
        method: "post",
        output_format: "json",
        destination_type: "openobserve",
        org_identifier: "myorg",
        stream_name: "mystream",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
      };

      wrapper.vm.apiHeaders = [
        { key: "Authorization", value: "Basic token123", uuid: "123" },
      ];

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "Test Destination",
        data: expect.objectContaining({
          name: "Test Destination",
          url: "https://example.com",
          method: "post",
          output_format: "json",
          type: "http",
          headers: {
            Authorization: "Basic token123",
          },
        }),
      });
    });

    it("should emit created event with destination name on success", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData.name = "Test Destination";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(wrapper.emitted("created")).toBeTruthy();
      expect(wrapper.emitted("created")[0]).toEqual(["Test Destination"]);
    });

    it("should not submit if validation fails", async () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "";

      await wrapper.vm.createDestination();

      expect(destinationService.create).not.toHaveBeenCalled();
    });
  });

  describe("Form Reset", () => {
    it("should reset form to default values", () => {
      wrapper.vm.formData.name = "Changed Name";
      wrapper.vm.formData.url = "https://changed.com";
      wrapper.vm.formData.destination_type = "splunk";
      wrapper.vm.step = 2;

      wrapper.vm.resetForm();

      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData.url).toBe("");
      expect(wrapper.vm.formData.destination_type).toBe("openobserve");
      expect(wrapper.vm.formData.org_identifier).toBe("default");
      expect(wrapper.vm.formData.stream_name).toBe("default");
      expect(wrapper.vm.step).toBe(1);
    });

    it("should reset headers to OpenObserve defaults", () => {
      wrapper.vm.apiHeaders = [{ key: "Custom", value: "Header", uuid: "123" }];

      wrapper.vm.resetForm();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });
  });

  describe("Cancel Action", () => {
    it("should emit cancel event", async () => {
      wrapper.vm.$emit("cancel");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("cancel")).toBeTruthy();
    });
  });

  describe("Connection Notes", () => {
    it("should display correct connection notes for OpenObserve", () => {
      wrapper.vm.formData.destination_type = "openobserve";

      const notes = wrapper.vm.connectionNotes;
      expect(notes.title).toContain("OpenObserve");
      expect(notes.example).toContain("openobserve");
    });

    it("should display correct connection notes for Splunk", () => {
      wrapper.vm.formData.destination_type = "splunk";

      const notes = wrapper.vm.connectionNotes;
      expect(notes.title).toContain("Splunk");
      expect(notes.example).toContain("splunk");
    });

    it("should display correct connection notes for each destination type", () => {
      const types = [
        "openobserve",
        "splunk",
        "elasticsearch",
        "datadog",
        "dynatrace",
        "newrelic",
        "custom",
      ];

      types.forEach((type) => {
        wrapper.vm.formData.destination_type = type;
        const notes = wrapper.vm.connectionNotes;

        expect(notes.title).toBeTruthy();
        expect(notes.steps).toBeInstanceOf(Array);
        expect(notes.steps.length).toBeGreaterThan(0);
      });
    });
  });
});
