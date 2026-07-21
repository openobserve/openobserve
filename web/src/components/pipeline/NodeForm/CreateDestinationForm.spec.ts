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
import CreateDestinationForm from "./CreateDestinationForm.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { createStore } from "vuex";
import destinationService from "@/services/alert_destination";
import i18n from "@/locales";
import { nextTick } from "vue";

// Mock the destination service
vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// Mock zincutils with deterministic UUIDs
let uuidCounter = 0;
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: vi.fn((val: string) => {
    const invalidChars = /[:/?#\s]/;
    return !invalidChars.test(val);
  }),
  getImageURL: vi.fn((path: string) => `/mock/${path}`),
  getUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));


// CreateDestinationForm is migrated to the headless useOForm OWNER pattern
// (Rule ③): the TanStack form is the SINGLE source of truth for EVERY field.
// There is no `formData` mirror and no sync watches — the component reads form
// state via form.useStore (driving the card-grid selection + every conditional
// v-if) and writes it via form.setFieldValue. These tests drive every field
// through the real form (`form.state.values` to read, `form.setFieldValue` to
// write), and keep the multi-step / edit / headers / auto-prefill coverage.

// Read a form-owned field from the REAL OForm (single source of truth).
function getFormField(w: any, name: string) {
  return w.vm.form.state.values[name];
}

// Set a form-owned field on the REAL OForm (single source of truth — there is
// no `formData` mirror anymore).
function setFormField(w: any, name: string, value: unknown) {
  w.vm.form.setFieldValue(name, value);
}

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
          "OIcon": false,
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
      expect(getFormField(wrapper, "destination_type")).toBe("openobserve");
    });

    it("initializes with OpenObserve Authorization header", () => {
      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("Authorization");
      expect(wrapper.vm.apiHeaders[0].value).toBe("Basic <token>");
    });

    it("initializes url_endpoint to OpenObserve default endpoint", () => {
      expect(getFormField(wrapper, "url_endpoint")).toBe(
        "/api/default/default/_json"
      );
    });

    it("has 'post' as default method", () => {
      expect(getFormField(wrapper, "method")).toBe("post");
    });

    it("has 'json' as default output_format", () => {
      expect(getFormField(wrapper, "output_format")).toBe("json");
    });

    it("initializes formData.name as empty string", () => {
      expect(getFormField(wrapper, "name")).toBe("");
    });

    it("initializes formData.url as empty string", () => {
      expect(getFormField(wrapper, "url")).toBe("");
    });

    it("initializes skip_tls_verify as false", () => {
      expect(getFormField(wrapper, "skip_tls_verify")).toBe(false);
    });

    it("initializes separator as empty string", () => {
      expect(getFormField(wrapper, "separator")).toBe("");
    });

    it("initializes esbulk_index as empty string", () => {
      expect(getFormField(wrapper, "esbulk_index")).toBe("");
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
      expect(getFormField(wrapper, "destination_type")).toBe("splunk");
    });

    // Rule ③ proof: selecting a destination-type CARD drives the conditional
    // sections THROUGH THE FORM (form.setFieldValue → form.useStore), with NO
    // `formData` mirror. Clicking the 'custom' card (on step 1) must (a) set the
    // form value and (b) reveal the custom-only Method field on step 2 that is
    // v-if'd off it.
    it("clicking a card drives conditional sections through the form", async () => {
      // Cards live on step 1 — click the custom card there.
      const custom = wrapper.find('[data-test="destination-type-card-custom"]');
      await custom.trigger("click");
      await flushPromises();

      // The form is the single source of truth for the selection …
      expect(getFormField(wrapper, "destination_type")).toBe("custom");

      // … and on step 2 the custom-only Method field now renders (driven off the
      // form's destination_type via form.useStore, NOT a `formData` mirror).
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-destination-method-select"]').exists()
      ).toBe(true);
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
      setFormField(wrapper, "destination_type", type);
      await nextTick();
      expect(wrapper.vm.defaultUrlEndpoint).toBe(expected);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Auto-prefill on destination type change", () => {
    it("sets url_endpoint for Splunk on type change", async () => {
      setFormField(wrapper, "destination_type", "splunk");
      await nextTick();
      await flushPromises();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/services/collector");
    });

    it("sets url_endpoint for Elasticsearch on type change", async () => {
      setFormField(wrapper, "destination_type", "elasticsearch");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/_bulk");
    });

    it("sets url_endpoint for Datadog on type change", async () => {
      setFormField(wrapper, "destination_type", "datadog");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/v1/input");
    });

    it("sets url_endpoint for Dynatrace on type change", async () => {
      setFormField(wrapper, "destination_type", "dynatrace");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/api/v2/logs/ingest");
    });

    it("sets url_endpoint for Newrelic on type change", async () => {
      setFormField(wrapper, "destination_type", "newrelic");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/log/v1");
    });

    it("sets url_endpoint to empty for Custom on type change", async () => {
      setFormField(wrapper, "destination_type", "custom");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("");
    });

    it("sets output_format to nestedevent for Splunk", async () => {
      setFormField(wrapper, "destination_type", "splunk");
      await nextTick();
      await flushPromises();
      expect(getFormField(wrapper, "output_format")).toBe("nestedevent");
    });

    it("sets output_format to esbulk for Elasticsearch and provides default index", async () => {
      setFormField(wrapper, "destination_type", "elasticsearch");
      await nextTick();
      await flushPromises();
      expect(getFormField(wrapper, "output_format")).toBe("esbulk");
      expect(getFormField(wrapper, "esbulk_index")).toBe("default");
    });

    it("sets output_format to json for Datadog", async () => {
      setFormField(wrapper, "destination_type", "datadog");
      await nextTick();
      await flushPromises();
      expect(getFormField(wrapper, "output_format")).toBe("json");
    });

    it("sets method to 'post' when switching from custom to a non-custom type", async () => {
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "method", "get");
      await nextTick();

      setFormField(wrapper, "destination_type", "splunk");
      await nextTick();
      await flushPromises();
      expect(getFormField(wrapper, "method")).toBe("post");
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
        setFormField(wrapper, "destination_type", type);
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

    it("deleteApiHeader removes the header at the given index", () => {
      wrapper.vm.addApiHeader("X-Test", "test");
      const before = wrapper.vm.apiHeaders.length;

      // The template passes the row INDEX — delete the just-added last row.
      wrapper.vm.deleteApiHeader(before - 1);

      expect(wrapper.vm.apiHeaders).toHaveLength(before - 1);
      expect(
        wrapper.vm.apiHeaders.some((h: any) => h.key === "X-Test")
      ).toBe(false);
    });

    it("deleteApiHeader adds an empty header row when all headers are deleted", () => {
      // Delete each existing row by index 0; the handler backfills one blank row.
      const before = wrapper.vm.apiHeaders.length;
      for (let i = 0; i < before; i++) wrapper.vm.deleteApiHeader(0);

      expect(wrapper.vm.apiHeaders).toHaveLength(1);
      expect(wrapper.vm.apiHeaders[0].key).toBe("");
      expect(wrapper.vm.apiHeaders[0].value).toBe("");
    });

    // ── Field-array :key guard (playbook §2 / START-HERE Rule ①) ─────────────
    // Deleting a NON-LAST row must leave the RENDERED inputs — not just the form
    // data — aligned to the surviving rows in order. The header rows bind by
    // index-based name (`headers[i].key`) and TanStack resolves that name at
    // field CREATION, so the v-for :key MUST be the array index. A uuid/stable-id
    // :key would make Vue reuse+reorder the row components on a mid-list delete,
    // leaving each surviving input bound to its OLD index → inputs render
    // shifted/blank while `form.state.values` stays correct (a data-only
    // assertion passes while the UI is broken). So assert the rendered OInput
    // model-values, selected by field `name` (NOT by data-test, which is derived
    // from the row value and would itself mask a stale binding).
    it("keeps rendered header inputs aligned after deleting a NON-last row", async () => {
      const renderedByName = (suffix: "key" | "value") => {
        const re = new RegExp(`^headers\\[\\d+\\]\\.${suffix}$`);
        return wrapper
          .findAllComponents(OInput)
          .filter((c: any) => re.test(c.props("name")))
          .map((c: any) => c.props("modelValue"));
      };

      // Headers live on step 2 of the stepper — navigate there so the row inputs
      // actually render into the DOM.
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      // Seed a deterministic 3-row set through the real form.
      wrapper.vm.form.setFieldValue("headers", [
        { key: "H0", value: "V0" },
        { key: "H1", value: "V1" },
        { key: "H2", value: "V2" },
      ]);
      await nextTick();
      await flushPromises();

      expect(renderedByName("key")).toEqual(["H0", "H1", "H2"]);
      expect(renderedByName("value")).toEqual(["V0", "V1", "V2"]);

      // Delete the MIDDLE row (index 1) via the real handler (removeFieldValue).
      wrapper.vm.deleteApiHeader(1);
      await nextTick();
      await flushPromises();

      // The RENDERED inputs must show the two surviving rows in order …
      expect(renderedByName("key")).toEqual(["H0", "H2"]);
      expect(renderedByName("value")).toEqual(["V0", "V2"]);
      // … and the form data agrees (index-based names re-bound correctly).
      expect(wrapper.vm.apiHeaders.map((h: any) => h.key)).toEqual(["H0", "H2"]);
      expect(wrapper.vm.apiHeaders.map((h: any) => h.value)).toEqual([
        "V0",
        "V2",
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("OpenObserve Org/Stream Dynamic Endpoint", () => {
    // org/stream are form-owned now (name="org"/"stream") — set them on the real
    // form; the endpoint-sync watch rebuilds url_endpoint off the form values.
    it("updates url_endpoint when openobserveOrg changes", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "org", "my-org");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toContain("my-org");
    });

    it("updates url_endpoint when openobserveStream changes", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "stream", "my-stream");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toContain("my-stream");
    });

    it("builds correct endpoint from org and stream", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "org", "acme");
      setFormField(wrapper, "stream", "events");
      await nextTick();
      expect(getFormField(wrapper, "url_endpoint")).toBe("/api/acme/events/_json");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("showMetadataFields computed property", () => {
    it("returns true for splunk", async () => {
      setFormField(wrapper, "destination_type", "splunk");
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(true);
    });

    it("returns true for datadog", async () => {
      setFormField(wrapper, "destination_type", "datadog");
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(true);
    });

    it("returns false for openobserve", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(false);
    });

    it("returns false for custom", async () => {
      setFormField(wrapper, "destination_type", "custom");
      await nextTick();
      expect(wrapper.vm.showMetadataFields).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Step Navigation", () => {
    it("canProceedStep1 is falsy when destination_type is empty", async () => {
      setFormField(wrapper, "destination_type", "");
      await nextTick();
      expect(wrapper.vm.canProceedStep1).toBeFalsy();
    });

    it("canProceedStep1 is true when a destination type is selected", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      await nextTick();
      expect(wrapper.vm.canProceedStep1).toBe(true);
    });

    it("nextStep advances to step 2", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      wrapper.vm.step = 1;
      wrapper.vm.nextStep();
      await nextTick();
      expect(wrapper.vm.step).toBe(2);
    });

    it("nextStep does not advance if destination_type is not selected", async () => {
      setFormField(wrapper, "destination_type", "");
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
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "name", "valid-dest");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "url_endpoint", "/api/org/stream/_json");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeTruthy();
    });

    it("is false when name is missing", async () => {
      setFormField(wrapper, "name", "");
      setFormField(wrapper, "url", "https://example.com");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeFalsy();
    });

    it("is false when URL is missing", async () => {
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBeFalsy();
    });

    it("is false for non-custom when url_endpoint is empty", async () => {
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "url_endpoint", "");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });

    it("is false for stringseparated when separator is empty", async () => {
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "stringseparated");
      setFormField(wrapper, "separator", "");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });

    it("is true for stringseparated when separator is provided", async () => {
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "stringseparated");
      setFormField(wrapper, "separator", "|");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    it("allows single space as a valid separator", async () => {
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "stringseparated");
      setFormField(wrapper, "separator", " ");
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    // metadata is FORM-OWNED (name="metadata.*"), so canProceedStep2 must read it
    // from the form store, not from formData.metadata (which the inputs no longer
    // write to). Set metadata via the real form.
    it("is true for splunk when all metadata fields are provided", async () => {
      setFormField(wrapper, "destination_type", "splunk");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://splunk.example.com");
      setFormField(wrapper, "url_endpoint", "/services/collector");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "nestedevent");
      setFormField(wrapper, "metadata", {
        source: "my_source",
        sourcetype: "_json",
        hostname: "server01",
      });
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    it("is false for splunk when metadata is incomplete", async () => {
      setFormField(wrapper, "destination_type", "splunk");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://splunk.example.com");
      setFormField(wrapper, "url_endpoint", "/services/collector");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "nestedevent");
      // Only source provided — sourcetype + hostname missing.
      setFormField(wrapper, "metadata", { source: "my_source" });
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });

    it("is true for datadog when ddsource + ddtags are provided", async () => {
      setFormField(wrapper, "destination_type", "datadog");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://http-intake.logs.datadoghq.com");
      setFormField(wrapper, "url_endpoint", "/v1/input");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      setFormField(wrapper, "metadata", {
        ddsource: "nginx",
        ddtags: "env:prod",
      });
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(true);
    });

    it("is false for datadog when dd fields are missing", async () => {
      setFormField(wrapper, "destination_type", "datadog");
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "https://http-intake.logs.datadoghq.com");
      setFormField(wrapper, "url_endpoint", "/v1/input");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      setFormField(wrapper, "metadata", {});
      await nextTick();
      expect(wrapper.vm.canProceedStep2).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("isValidDestination computed property", () => {
    it("is truthy when name, url, and method are provided", () => {
      setFormField(wrapper, "name", "valid-name");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "method", "post");
      expect(wrapper.vm.isValidDestination).toBeTruthy();
    });

    it("is falsy when name is empty", () => {
      setFormField(wrapper, "name", "");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "method", "post");
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });

    it("is falsy when url is empty", () => {
      setFormField(wrapper, "name", "test");
      setFormField(wrapper, "url", "");
      setFormField(wrapper, "method", "post");
      expect(wrapper.vm.isValidDestination).toBeFalsy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Template Rendering at Step 2", () => {
    beforeEach(async () => {
      setFormField(wrapper, "destination_type", "openobserve");
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
      setFormField(wrapper, "destination_type", "custom");
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
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "output_format", "stringseparated");
      wrapper.vm.step = 2;
      await nextTick();
      await flushPromises();

      expect(
        wrapper.find('[data-test="add-destination-separator-input"]').exists()
      ).toBe(true);
    });

    it("hides separator field for other output formats", async () => {
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "output_format", "json");
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
      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "output_format", "esbulk");
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
      setFormField(wrapper, "output_format", "json");
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

      // Every field is form-owned now — set the whole record on the real form
      // (single source of truth, no `formData` mirror).
      setFormField(wrapper, "destination_type", "openobserve");
      setFormField(wrapper, "name", "Test Destination");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "url_endpoint", "/api/test");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      setFormField(wrapper, "headers", [
        { key: "Authorization", value: "Basic token123" },
      ]);

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

      setFormField(wrapper, "destination_type", "splunk");
      setFormField(wrapper, "name", "Splunk Dest");
      setFormField(wrapper, "url", "https://splunk.example.com");
      setFormField(wrapper, "url_endpoint", "/services/collector");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "nestedevent");
      setFormField(wrapper, "headers", [
        { key: "Authorization", value: "Splunk token" },
      ]);

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

      setFormField(wrapper, "destination_type", "custom");
      setFormField(wrapper, "name", "Custom Dest");
      setFormField(wrapper, "url", "https://custom.example.com");
      setFormField(wrapper, "url_endpoint", "");
      setFormField(wrapper, "method", "post");
      setFormField(wrapper, "output_format", "json");
      setFormField(wrapper, "headers", [{ key: "X-Custom", value: "value" }]);

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

      setFormField(wrapper, "name", "My Dest");
      setFormField(wrapper, "url", "https://example.com");
      setFormField(wrapper, "url_endpoint", "/api/test");
      setFormField(wrapper, "method", "post");

      await wrapper.vm.createDestination();
      await flushPromises();

      expect(wrapper.emitted("created")).toBeTruthy();
      expect(wrapper.emitted("created")![0]).toEqual(["My Dest"]);
    });

    it("does not call destinationService.create when name is empty", async () => {
      setFormField(wrapper, "name", "");
      setFormField(wrapper, "url", "");

      await wrapper.vm.createDestination();

      expect(destinationService.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Form Reset", () => {
    it("resetForm resets all formData fields to defaults", () => {
      setFormField(wrapper, "name", "Changed");
      setFormField(wrapper, "url", "https://changed.com");
      setFormField(wrapper, "url_endpoint", "/changed");
      setFormField(wrapper, "destination_type", "splunk");
      wrapper.vm.step = 2;

      wrapper.vm.resetForm();

      expect(getFormField(wrapper, "name")).toBe("");
      expect(getFormField(wrapper, "url")).toBe("");
      // Reset returns the form to its create-mode defaults (the OpenObserve
      // default endpoint) — the single source of truth, no mirror to diverge.
      expect(getFormField(wrapper, "url_endpoint")).toBe(
        "/api/default/default/_json"
      );
      expect(getFormField(wrapper, "destination_type")).toBe("openobserve");
      expect(wrapper.vm.step).toBe(1);
    });

    it("resetForm resets apiHeaders to OpenObserve defaults", () => {
      // headers are form-owned — set them on the real form, not a mirror.
      setFormField(wrapper, "headers", [{ key: "X-Custom", value: "Val" }]);

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

      expect(getFormField(wrapper, "url")).toBe("https://example.com");
      expect(getFormField(wrapper, "url_endpoint")).toBe("/api/test");
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

      expect(getFormField(wrapper, "url")).toBe("https://splunk.host.com");
      expect(getFormField(wrapper, "url_endpoint")).toBe(
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

      expect(getFormField(wrapper, "url")).toBe("https://example.com");
      expect(getFormField(wrapper, "url_endpoint")).toBe("");
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

      expect(getFormField(wrapper, "url")).toBe(
        "https://example.com/api/custom/endpoint"
      );
      expect(getFormField(wrapper, "url_endpoint")).toBe("");
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

      expect(getFormField(wrapper, "destination_type")).toBe("datadog");
    });

    it("falls back to 'openobserve' when destination_type_name is absent", () => {
      wrapper.vm.populateFormForEdit({
        name: "Unknown",
        url: "https://example.com/api",
        method: "post",
        output_format: "json",
        skip_tls_verify: false,
      });

      expect(getFormField(wrapper, "destination_type")).toBe("openobserve");
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

      expect(getFormField(wrapper, "url")).toBe("https://splunk.test.com");
      expect(getFormField(wrapper, "url_endpoint")).toBe("/services/collector");
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
      setFormField(wrapper, "destination_type", type);
      await nextTick();

      const notes = wrapper.vm.connectionNotes;
      expect(notes.title).toBeTruthy();
      expect(Array.isArray(notes.steps)).toBe(true);
      expect(notes.steps.length).toBeGreaterThan(0);
    });

    it("OpenObserve notes title contains 'OpenObserve'", () => {
      setFormField(wrapper, "destination_type", "openobserve");
      expect(wrapper.vm.connectionNotes.title).toContain("OpenObserve");
    });

    it("Splunk notes title contains 'Splunk'", async () => {
      setFormField(wrapper, "destination_type", "splunk");
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

      expect(getFormField(editWrapper, "name")).toBe("Prop Dest");
      expect(getFormField(editWrapper, "skip_tls_verify")).toBe(true);
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

    // Payload parity (Rule ④b): editing a destination that carries a `template`
    // must round-trip it unchanged — the pre-migration form sent
    // `destination.template || ""`, so a template must NOT be silently wiped to
    // "" on save. (The pipeline form has no template input; it's a pass-through.)
    it("round-trips the destination's template unchanged on update (no wipe)", async () => {
      (destinationService.update as any).mockResolvedValue({ data: {} });
      const editWrapper = createWrapper({
        destination: {
          name: "tmpl-dest",
          url: "https://prop.example.com/api/endpoint",
          method: "post",
          output_format: "json",
          destination_type_name: "splunk",
          skip_tls_verify: true,
          headers: {},
          template: "my_alert_template",
        },
      });
      await flushPromises();
      editWrapper.vm.step = 2;
      await nextTick();

      await editWrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(editWrapper.vm.form.state.isValid).toBe(true);
      expect(destinationService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_name: "tmpl-dest",
          module: "pipeline",
          data: expect.objectContaining({ template: "my_alert_template" }),
        }),
      );
      editWrapper.unmount();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Real-OForm validation wiring (per the playbook §5 — at least one test MUST
  // mount the real OForm and prove the schema actually gates an empty submit, so
  // an unwired `:schema` would be caught).
  describe("OForm schema validation (real form)", () => {
    const submitForm = async (w: any) => {
      // Drive the form's own submit so the schema runs + the handler is awaited
      // deterministically (a fire-and-forget native submit wouldn't be).
      await w.vm.form.handleSubmit();
      await flushPromises();
    };

    it("blocks submit and does NOT call the service when required fields are empty", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });
      // openobserve default; name/url left blank → schema must fail.
      wrapper.vm.step = 2;
      await nextTick();

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(destinationService.create).not.toHaveBeenCalled();
    });

    it("submits and calls the service when the schema passes", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });
      setFormField(wrapper, "destination_type", "openobserve");
      wrapper.vm.step = 2;
      // url_endpoint/org/stream are auto-prefilled for openobserve; provide the
      // user-typed name + url so the whole schema (incl. superRefine) passes.
      setFormField(wrapper, "name", "valid-dest");
      setFormField(wrapper, "url", "https://example.com");
      await nextTick();
      await flushPromises();

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(destinationService.create).toHaveBeenCalledTimes(1);
      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_name: "valid-dest",
          data: expect.objectContaining({
            name: "valid-dest",
            destination_type_name: "openobserve",
          }),
        }),
      );
    });

    it("rejects a name with invalid resource characters", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });
      setFormField(wrapper, "destination_type", "openobserve");
      wrapper.vm.step = 2;
      setFormField(wrapper, "name", "bad name?");
      setFormField(wrapper, "url", "https://example.com");
      await nextTick();
      await flushPromises();

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(destinationService.create).not.toHaveBeenCalled();
    });

    it("rejects a url that ends with a trailing slash", async () => {
      (destinationService.create as any).mockResolvedValue({ data: {} });
      setFormField(wrapper, "destination_type", "openobserve");
      wrapper.vm.step = 2;
      setFormField(wrapper, "name", "valid-dest");
      setFormField(wrapper, "url", "https://example.com/");
      await nextTick();
      await flushPromises();

      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(destinationService.create).not.toHaveBeenCalled();
    });
  });
});
