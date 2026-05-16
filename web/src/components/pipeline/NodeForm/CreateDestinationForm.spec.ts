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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import { createStore } from "vuex";
import destinationService from "@/services/alert_destination";
import i18n from "@/locales";
import { nextTick } from "vue";

// Mock the destination service
vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
  },
}));

// Mock zincutils with deterministic UUIDs
let uuidCounter = 0;
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: vi.fn((val: string) => {
    const invalidChars = /[:\/?#\s]/;
    return !invalidChars.test(val);
  }),
  getImageURL: vi.fn((path: string) => `/mock/${path}`),
  getUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

installQuasar({ plugins: [Dialog, Notify] });

describe("CreateDestinationForm", () => {
  let wrapper: any;
  let store: any;

  function createWrapper(props: Record<string, any> = {}) {
    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: { identifier: "test-org" },
      },
    });

    return mount(CreateDestinationForm, {
      props,
      global: {
        plugins: [store, i18n],
        stubs: {
          "q-stepper": false,
          "q-step": false,
          "q-input": false,
          "q-select": false,
          "q-btn": false,
          "OIcon": false,
          "q-card": false,
          "q-card-section": false,
          "q-toggle": false,
        },
      },
    });
  }

  beforeEach(() => {
    uuidCounter = 0;
    vi.clearAllMocks();
    wrapper = createWrapper();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Component Initialization", () => {
    it("renders the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("starts at step 1", () => {
      expect(wrapper.vm.step).toBe(1);
    });

    it("has 'openobserve' as default destination type", () => {
      expect(wrapper.vm.formData.destination_type).toBe("openobserve");
    });

    it("initializes with OpenObserve Authorization header", () => {
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });

    it("initializes url_endpoint to OpenObserve default endpoint", () => {
      expect(wrapper.vm.formData.url_endpoint).toBe(
        "/api/default/default/_json"
      );
    });

    it("has 'post' as default method", () => {
      expect(wrapper.vm.formData.method).toBe("post");
    });

    it("has 'json' as default output_format", () => {
      expect(wrapper.vm.formData.output_format).toBe("json");
    });

    it("initializes formData.name as empty string", () => {
      expect(wrapper.vm.formData.name).toBe("");
    });

    it("initializes formData.url as empty string", () => {
      expect(wrapper.vm.formData.url).toBe("");
    });

    it("initializes skip_tls_verify as false", () => {
      expect(wrapper.vm.formData.skip_tls_verify).toBe(false);
    });

    it("initializes separator as empty string", () => {
      expect(wrapper.vm.formData.separator).toBe("");
    });

    it("initializes esbulk_index as empty string", () => {
      expect(wrapper.vm.formData.esbulk_index).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Destination Type Cards", () => {
    it("renders all 7 destination type cards", () => {
      const cards = wrapper.findAll('[class*="destination-type-card"]');
      expect(cards.length).toBeGreaterThanOrEqual(7);
    });

    it("renders destination card for openobserve", () => {
      expect(
        wrapper.find('[data-test="destination-type-card-openobserve"]').exists()
      ).toBe(true);
    });

    it("renders destination card for splunk", () => {
      expect(
        wrapper.find('[data-test="destination-type-card-splunk"]').exists()
      ).toBe(true);
    });

    it("renders destination card for elasticsearch", () => {
      expect(
        wrapper
          .find('[data-test="destination-type-card-elasticsearch"]')
          .exists()
      ).toBe(true);
    });

    it("renders destination card for datadog", () => {
      expect(
        wrapper.find('[data-test="destination-type-card-datadog"]').exists()
      ).toBe(true);
    });

    it("renders destination card for custom", () => {
      expect(
        wrapper.find('[data-test="destination-type-card-custom"]').exists()
      ).toBe(true);
    });

    it("openobserve card shows an image", () => {
      const card = wrapper.find(
        '[data-test="destination-type-card-openobserve"]'
      );
      expect(card.find("img").exists()).toBe(true);
    });

    it("applies 'selected' class to the active destination card", () => {
      const card = wrapper.find(
        '[data-test="destination-type-card-openobserve"]'
      );
      expect(card.classes()).toContain("selected");
    });

    it("updates destination_type when a card is clicked", async () => {
      const splunk = wrapper.find('[data-test="destination-type-card-splunk"]');
      await splunk.trigger("click");
      await flushPromises();
      expect(wrapper.vm.formData.destination_type).toBe("splunk");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("defaultUrlEndpoint computed property", () => {
    it.each([
      ["openobserve", "/api/{org}/{stream}/_json"],
      ["splunk", "/services/collector"],
      ["elasticsearch", "/_bulk"],
      ["datadog", "/v1/input"],
      ["dynatrace", "/api/v2/logs/ingest"],
      ["newrelic", "/log/v1"],
      ["custom", ""],
    ])("returns correct endpoint for %s", async (type, expected) => {
      wrapper.vm.formData.destination_type = type;
      await nextTick();
      expect(wrapper.vm.defaultUrlEndpoint).toBe(expected);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Auto-prefill on destination type change", () => {
    it("sets url_endpoint for Splunk on type change", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.formData.url_endpoint).toBe("/services/collector");
    });

    it("sets url_endpoint for Elasticsearch on type change", async () => {
      wrapper.vm.formData.destination_type = "elasticsearch";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("/_bulk");
    });

    it("sets url_endpoint for Datadog on type change", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("/v1/input");
    });

    it("sets url_endpoint for Dynatrace on type change", async () => {
      wrapper.vm.formData.destination_type = "dynatrace";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("/api/v2/logs/ingest");
    });

    it("sets url_endpoint for Newrelic on type change", async () => {
      wrapper.vm.formData.destination_type = "newrelic";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("/log/v1");
    });

    it("sets url_endpoint to empty for Custom on type change", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("");
    });

    it("sets output_format to nestedevent for Splunk", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.formData.output_format).toBe("nestedevent");
    });

    it("sets output_format to esbulk for Elasticsearch and provides default index", async () => {
      wrapper.vm.formData.destination_type = "elasticsearch";
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.formData.output_format).toBe("esbulk");
      expect(wrapper.vm.formData.esbulk_index).toBe("default");
    });

    it("sets output_format to json for Datadog", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.formData.output_format).toBe("json");
    });

    it("sets method to 'post' when switching from custom to a non-custom type", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.method = "get";
      await nextTick();

      wrapper.vm.formData.destination_type = "splunk";
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.formData.method).toBe("post");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Default Headers per Destination Type", () => {
    it.each([
      [
        "openobserve",
        1,
        [{ key: "Authorization", value: "Basic <token>" }],
      ],
      [
        "splunk",
        1,
        [{ key: "Authorization", value: "Splunk <splunk_token>" }],
      ],
      [
        "elasticsearch",
        2,
        [
          { key: "Authorization", value: "ApiKey <token>" },
          { key: "Content-Type", value: "application/json" },
        ],
      ],
      [
        "datadog",
        3,
        [
          { key: "DD-API-KEY", value: "<token>" },
          { key: "Content-Encoding", value: "gzip" },
          { key: "Content-Type", value: "application/json" },
        ],
      ],
      [
        "dynatrace",
        2,
        [
          { key: "Authorization", value: "Api-Token <token>" },
          { key: "Content-Type", value: "application/json; charset=utf-8" },
        ],
      ],
      [
        "newrelic",
        2,
        [
          { key: "Api-Key", value: "<token>" },
          { key: "Content-Type", value: "application/json" },
        ],
      ],
      ["custom", 1, [{ key: "", value: "" }]],
    ])(
      "sets correct default headers for %s (%i header(s))",
      async (type, count, expectedHeaders) => {
        wrapper.vm.formData.destination_type = type;
        await nextTick();

        expect(wrapper.vm.apiHeaders).toHaveLength(count);
        expectedHeaders.forEach(({ key, value }: { key: string; value: string }, i: number) => {
          expect(wrapper.vm.apiHeaders[i].key).toBe(key);
          expect(wrapper.vm.apiHeaders[i].value).toBe(value);
        });
      }
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Header Management", () => {
    it("addApiHeader appends a new entry to apiHeaders", () => {
      const initial = wrapper.vm.apiHeaders.length;
      wrapper.vm.addApiHeader("X-Custom", "my-value");
      expect(wrapper.vm.apiHeaders).toHaveLength(initial + 1);
      expect(wrapper.vm.apiHeaders[initial].key).toBe("X-Custom");
      expect(wrapper.vm.apiHeaders[initial].value).toBe("my-value");
    });

    it("deleteApiHeader removes the specified header", () => {
      wrapper.vm.addApiHeader("X-Test", "test");
      const toDelete = wrapper.vm.apiHeaders[1];
      const before = wrapper.vm.apiHeaders.length;

      wrapper.vm.deleteApiHeader(toDelete);

      expect(wrapper.vm.apiHeaders).toHaveLength(before - 1);
      expect(
        wrapper.vm.apiHeaders.find((h: any) => h.uuid === toDelete.uuid)
      ).toBeUndefined();
    });

    it("deleteApiHeader adds an empty header row when all headers are deleted", () => {
      const toDelete = wrapper.vm.apiHeaders[0];
      wrapper.vm.deleteApiHeader(toDelete);

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("");
      expect(wrapper.vm.apiHeaders[0].value).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("OpenObserve Org/Stream Dynamic Endpoint", () => {
    it("updates url_endpoint when openobserveOrg changes", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.openobserveOrg = "my-org";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toContain("my-org");
    });

    it("updates url_endpoint when openobserveStream changes", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.openobserveStream = "my-stream";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toContain("my-stream");
    });

    it("builds correct endpoint from org and stream", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.openobserveOrg = "acme";
      wrapper.vm.openobserveStream = "events";
      await nextTick();
      expect(wrapper.vm.formData.url_endpoint).toBe("/api/acme/events/_json");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("showMetadataFields computed property", () => {
    it("returns true for splunk", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(true);
    });

    it("returns true for datadog", async () => {
      wrapper.vm.formData.destination_type = "datadog";
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(true);
    });

    it("returns false for openobserve", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(false);
    });

    it("returns false for custom", async () => {
      wrapper.vm.formData.destination_type = "custom";
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Step Navigation", () => {
    it("canProceedStep1 is falsy when destination_type is empty", async () => {
      wrapper.vm.formData.destination_type = "";
      await nextTick();
      expect(wrapper.vm.canProceedStep1).toBeFalsy();
    });

    it("canProceedStep1 is true when a destination type is selected", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      await nextTick();
      expect(wrapper.vm.canProceedStep1).toBe(true);
    });

    it("nextStep advances to step 2", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.step = 1;
      wrapper.vm.nextStep();
      await nextTick();
      expect(wrapper.vm.step).toBe(2);
    });

    it("nextStep does not advance if destination_type is not selected", async () => {
      wrapper.vm.formData.destination_type = "";
      wrapper.vm.step = 1;
      wrapper.vm.nextStep();
      await nextTick();
      expect(wrapper.vm.step).toBe(1);
    });

    it("prevStep decrements step", async () => {
      wrapper.vm.step = 2;
      wrapper.vm.prevStep();
      await nextTick();
      expect(wrapper.vm.step).toBe(1);
    });

    it("prevStep does not go below 1", async () => {
      wrapper.vm.step = 1;
      wrapper.vm.prevStep();
      await nextTick();
      expect(wrapper.vm.step).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("canProceedStep2 Validation", () => {
    it("is true for valid openobserve form data", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.formData.name = "valid-dest";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.url_endpoint = "/api/org/stream/_json";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "json";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeTruthy();
    });

    it("is false when name is missing", async () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "https://example.com";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeFalsy();
    });

    it("is false when URL is missing", async () => {
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeFalsy();
    });

    it("is false for non-custom when url_endpoint is empty", async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.url_endpoint = "";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "json";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });

    it("is false for stringseparated when separator is empty", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "stringseparated";
      wrapper.vm.formData.separator = "";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });

    it("is true for stringseparated when separator is provided", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "stringseparated";
      wrapper.vm.formData.separator = "|";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    it("allows single space as a valid separator", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      wrapper.vm.formData.output_format = "stringseparated";
      wrapper.vm.formData.separator = " ";
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("isValidDestination computed property", () => {
    it("is truthy when name, url, and method are provided", () => {
      wrapper.vm.formData.name = "valid-name";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });

    it("is falsy when name is empty", () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.method = "post";
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("is falsy when url is empty", () => {
      wrapper.vm.formData.name = "test";
      wrapper.vm.formData.url = "";
      wrapper.vm.formData.method = "post";
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Template Rendering at Step 2", () => {
    beforeEach(async () => {
      wrapper.vm.formData.destination_type = "openobserve";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();
    });

    it("renders name input field", () => {
      expect(
        wrapper.find('[data-test="add-destination-name-input"]').exists()
      ).toBe(true);
    });

    it("renders URL input field", () => {
      expect(
        wrapper.find('[data-test="add-destination-url-input"]').exists()
      ).toBe(true);
    });

    it("renders url_endpoint input field", () => {
      expect(
        wrapper.find('[data-test="add-destination-url-endpoint-input"]').exists()
      ).toBe(true);
    });

    it("renders output format select field", () => {
      expect(
        wrapper
          .find('[data-test="add-destination-output-format-select"]')
          .exists()
      ).toBe(true);
    });

    it("renders skip TLS verify toggle", () => {
      expect(
        wrapper
          .find('[data-test="add-destination-skip-tls-verify-toggle"]')
          .exists()
      ).toBe(true);
    });

    it("does NOT render Method field for openobserve type", () => {
      expect(
        wrapper.find('[data-test="add-destination-method-select"]').exists()
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Custom Type Specific Fields", () => {
    beforeEach(async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();
    });

    it("renders Method select for custom destination type", () => {
      expect(
        wrapper.find('[data-test="add-destination-method-select"]').exists()
      ).toBe(true);
    });

    it("url_endpoint field is not disabled for custom type", () => {
      const endpointField = wrapper.find(
        '[data-test="add-destination-url-endpoint-input"]'
      );
      expect(endpointField.exists()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("StringSeparated Output Format", () => {
    it("shows separator field when stringseparated format is selected", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.output_format = "stringseparated";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      expect(
        wrapper.find('[data-test="add-destination-separator-input"]').exists()
      ).toBe(true);
    });

    it("hides separator field for other output formats", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.output_format = "json";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      expect(
        wrapper.find('[data-test="add-destination-separator-input"]').exists()
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("ESBulk Index Field", () => {
    it("shows esbulk index field when output format is esbulk", async () => {
      wrapper.vm.formData.destination_type = "custom";
      wrapper.vm.formData.output_format = "esbulk";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="add-destination-esbulk-index-input"]')
          .exists()
      ).toBe(true);
    });

    it("hides esbulk index field for non-esbulk formats", async () => {
      wrapper.vm.formData.output_format = "json";
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="add-destination-esbulk-index-input"]')
          .exists()
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Form Submission", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("merges URL and endpoint and calls destinationService.create", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData = {
        name: "Test Destination",
        url: "https://example.com",
        url_endpoint: "/api/test",
        method: "post",
        output_format: "json",
        destination_type: "openobserve",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        esbulk_index: "",
        separator: "",
      };
      wrapper.vm.apiHeaders = [
        { key: "Authorization", value: "Basic token123", uuid: "h1" },
      ];

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "Test Destination",
        module: "pipeline",
        data: expect.objectContaining({
          name: "Test Destination",
          url: "https://example.com/api/test",
          method: "post",
          output_format: "json",
          type: "http",
          destination_type_name: "openobserve",
          headers: { Authorization: "Basic token123" },
        }),
      });
    });

    it("includes destination_type_name in payload", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData = {
        name: "Splunk Dest",
        url: "https://splunk.example.com",
        url_endpoint: "/services/collector",
        method: "post",
        output_format: "nestedevent",
        destination_type: "splunk",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        esbulk_index: "",
        separator: "",
      };
      wrapper.vm.apiHeaders = [
        { key: "Authorization", value: "Splunk token", uuid: "h2" },
      ];

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          module: "pipeline",
          data: expect.objectContaining({
            destination_type_name: "splunk",
          }),
        })
      );
    });

    it("does not append empty endpoint to base URL for custom type", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData = {
        name: "Custom Dest",
        url: "https://custom.example.com",
        url_endpoint: "",
        method: "post",
        output_format: "json",
        destination_type: "custom",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        esbulk_index: "",
        separator: "",
      };
      wrapper.vm.apiHeaders = [
        { key: "X-Custom", value: "value", uuid: "h3" },
      ];

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith({
        org_identifier: "test-org",
        destination_name: "Custom Dest",
        module: "pipeline",
        data: expect.objectContaining({
          url: "https://custom.example.com",
        }),
      });
    });

    it("emits 'created' event with destination name on success", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });

      wrapper.vm.formData.name = "My Dest";
      wrapper.vm.formData.url = "https://example.com";
      wrapper.vm.formData.url_endpoint = "/api/test";
      wrapper.vm.formData.method = "post";

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(wrapper.emitted("created")).toBeTruthy();
      expect(wrapper.emitted("created")![0]).toEqual(["My Dest"]);
    });

    it("does not call destinationService.create when name is empty", async () => {
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.url = "";

      await wrapper.vm.createDestination();

      expect(destinationService.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Form Reset", () => {
    it("resetForm resets all formData fields to defaults", () => {
      wrapper.vm.formData.name = "Changed";
      wrapper.vm.formData.url = "https://changed.com";
      wrapper.vm.formData.url_endpoint = "/changed";
      wrapper.vm.formData.destination_type = "splunk";
      wrapper.vm.step = 2;

      wrapper.vm.resetForm();

      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData.url).toBe("");
      expect(wrapper.vm.formData.url_endpoint).toBe("");
      expect(wrapper.vm.formData.destination_type).toBe("openobserve");
      expect(wrapper.vm.step).toBe(1);
    });

    it("resetForm resets apiHeaders to OpenObserve defaults", () => {
      wrapper.vm.apiHeaders = [{ key: "X-Custom", value: "Val", uuid: "x1" }];

      wrapper.vm.resetForm();

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Edit Mode – populateFormForEdit", () => {
    it("splits URL into base and endpoint for non-custom types", () => {
      wrapper.vm.populateFormForEdit({
        name: "Edit Dest",
        url: "https://example.com/api/test",
        method: "post",
        output_format: "json",
        destination_type_name: "openobserve",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.url).toBe("https://example.com");
      expect(wrapper.vm.formData.url_endpoint).toBe("/api/test");
    });

    it("handles URL with query parameters during split", () => {
      wrapper.vm.populateFormForEdit({
        name: "Splunk Dest",
        url: "https://splunk.host.com/services/collector?key=val",
        method: "post",
        output_format: "nestedevent",
        destination_type_name: "splunk",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.url).toBe("https://splunk.host.com");
      expect(wrapper.vm.formData.url_endpoint).toBe(
        "/services/collector?key=val"
      );
    });

    it("handles URL without path (sets url_endpoint to empty)", () => {
      wrapper.vm.populateFormForEdit({
        name: "No Path",
        url: "https://example.com",
        method: "post",
        output_format: "json",
        destination_type_name: "openobserve",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.url).toBe("https://example.com");
      expect(wrapper.vm.formData.url_endpoint).toBe("");
    });

    it("does not split URL for custom type", () => {
      wrapper.vm.populateFormForEdit({
        name: "Custom Dest",
        url: "https://example.com/api/custom/endpoint",
        method: "post",
        output_format: "json",
        destination_type_name: "custom",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.url).toBe(
        "https://example.com/api/custom/endpoint"
      );
      expect(wrapper.vm.formData.url_endpoint).toBe("");
    });

    it("uses destination_type_name to set destination_type", () => {
      wrapper.vm.populateFormForEdit({
        name: "Datadog Dest",
        url: "https://http-intake.logs.datadoghq.com/v1/input",
        method: "post",
        output_format: "json",
        destination_type_name: "datadog",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.destination_type).toBe("datadog");
    });

    it("falls back to 'openobserve' when destination_type_name is absent", () => {
      wrapper.vm.populateFormForEdit({
        name: "Unknown",
        url: "https://example.com/api",
        method: "post",
        output_format: "json",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.destination_type).toBe("openobserve");
    });

    it("populates headers from existing destination headers", () => {
      wrapper.vm.populateFormForEdit({
        name: "Dest with headers",
        url: "https://example.com/api",
        method: "post",
        output_format: "json",
        destination_type_name: "custom",
        skip_tls_verify: false,
        headers: {
          "X-Custom-Header": "value1",
          Authorization: "Bearer token",
        },
      });

      expect(wrapper.vm.apiHeaders).toHaveLength(2);
      expect(
        wrapper.vm.apiHeaders.some(
          (h: any) => h.key === "X-Custom-Header" && h.value === "value1"
        )
      ).toBe(true);
      expect(
        wrapper.vm.apiHeaders.some(
          (h: any) => h.key === "Authorization" && h.value === "Bearer token"
        )
      ).toBe(true);
    });

    it("parses openobserveOrg and openobserveStream from openobserve endpoint", () => {
      wrapper.vm.populateFormForEdit({
        name: "OO Dest",
        url: "https://cloud.openobserve.ai/api/my-org/my-stream/_json",
        method: "post",
        output_format: "json",
        destination_type_name: "openobserve",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.openobserveOrg).toBe("my-org");
      expect(wrapper.vm.openobserveStream).toBe("my-stream");
    });

    it("handles URL without protocol for non-custom types", () => {
      wrapper.vm.populateFormForEdit({
        name: "No Protocol",
        url: "splunk.test.com/services/collector",
        method: "post",
        output_format: "nestedevent",
        destination_type_name: "splunk",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.formData.url).toBe("https://splunk.test.com");
      expect(wrapper.vm.formData.url_endpoint).toBe("/services/collector");
    });

    it("advances to step 2 when populating edit form", () => {
      wrapper.vm.populateFormForEdit({
        name: "Edit Dest",
        url: "https://example.com/api",
        method: "post",
        output_format: "json",
        destination_type_name: "openobserve",
        skip_tls_verify: false,
      });

      expect(wrapper.vm.step).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("connectionNotes computed property", () => {
    it.each([
      "openobserve",
      "splunk",
      "elasticsearch",
      "datadog",
      "dynatrace",
      "newrelic",
      "custom",
    ])("returns notes with a title and steps array for %s", async (type) => {
      wrapper.vm.formData.destination_type = type;
      await nextTick();

      const notes = wrapper.vm.connectionNotes;
      expect(notes.title).toBeTruthy();
      expect(Array.isArray(notes.steps)).toBe(true);
      expect(notes.steps.length).toBeGreaterThan(0);
    });

    it("OpenObserve notes title contains 'OpenObserve'", () => {
      wrapper.vm.formData.destination_type = "openobserve";
      expect(wrapper.vm.connectionNotes.title).toContain("OpenObserve");
    });

    it("Splunk notes title contains 'Splunk'", async () => {
      wrapper.vm.formData.destination_type = "splunk";
      await nextTick();
      expect(wrapper.vm.connectionNotes.title).toContain("Splunk");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Cancel Emit", () => {
    it("emits 'cancel' event when $emit('cancel') is called", async () => {
      wrapper.vm.$emit("cancel");
      await nextTick();
      expect(wrapper.emitted("cancel")).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Edit Mode via Prop", () => {
    it("populates form when destination prop is provided", async () => {
      const editWrapper = createWrapper({
        destination: {
          name: "Prop Dest",
          url: "https://prop.example.com/api/endpoint",
          method: "post",
          output_format: "json",
          destination_type_name: "splunk",
          skip_tls_verify: true,
          headers: {},
        },
      });
      await flushPromises();

      expect(editWrapper.vm.formData.name).toBe("Prop Dest");
      expect(editWrapper.vm.formData.skip_tls_verify).toBe(true);
      editWrapper.unmount();
    });

    it("isEditMode is false when no destination prop is provided", () => {
      expect(wrapper.vm.isEditMode).toBe(false);
    });

    it("isEditMode is true when destination prop is provided", async () => {
      const editWrapper = createWrapper({
        destination: {
          name: "Edit",
          url: "https://example.com",
          method: "post",
          output_format: "json",
          skip_tls_verify: false,
        },
      });
      await flushPromises();
      expect(editWrapper.vm.isEditMode).toBe(true);
      editWrapper.unmount();
    });
  });
});
