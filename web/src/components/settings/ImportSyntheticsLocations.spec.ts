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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockCreateLocation, mockToastFn } = vi.hoisted(() => ({
  mockCreateLocation: vi.fn(),
  mockToastFn: vi.fn(),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    createLocation: (...args: any[]) => mockCreateLocation(...args),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
    },
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true" },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((url: string) => url),
}));

// ── Imports (after mocks are hoisted) ───────────────────────────────────────

import ImportSyntheticsLocations from "./ImportSyntheticsLocations.vue";
import i18n from "@/locales";

// ── Helpers ─────────────────────────────────────────────────────────────────

const validLocation = {
  provider: "aws",
  region: "us-east-1",
  label: "AWS US East (N. Virginia)",
};

const validLocation2 = {
  provider: "gcp",
  region: "us-central1",
  label: "GCP US Central",
};

const validJsonArray = JSON.stringify([validLocation]);
const validJsonArrayMultiple = JSON.stringify([validLocation, validLocation2]);

const parsedLocationEntry = {
  kind: "public",
  id: "aws-us-east-1",
  provider: "aws",
  region: "us-east-1",
  label: "AWS US East",
  enabled: true,
};

function makeWrapper() {
  return mount(ImportSyntheticsLocations, {
    global: {
      plugins: [i18n],
      stubs: {
        OPageLayout: {
          template: `
            <div>
              <div
                v-if="back"
                :data-test="back.dataTest"
                class="back-btn"
                @click="back.onClick"
              />
              <div data-test="import-title">{{ title }}</div>
              <slot name="actions" />
              <slot />
            </div>
          `,
          props: ["title", "back", "bleed"],
        },
        OButton: {
          template: `
            <button
              :disabled="disabled || false"
              :data-test="$attrs['data-test']"
              @click="$emit('click', $event)"
            >
              <slot />
            </button>
          `,
          props: ["disabled", "loading", "variant", "size", "type"],
          emits: ["click"],
          inheritAttrs: false,
        },
        OSeparator: true,
      },
    },
  });
}

/** Parse JSON input via the debounced scheduleParse helper (requires fake timers). */
async function parseViaScheduleParse(wrapper: VueWrapper<any>, json: string) {
  (wrapper.vm as any).jsonString = json;
  (wrapper.vm as any).scheduleParse();
  vi.advanceTimersByTime(300);
  await nextTick();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ImportSyntheticsLocations", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Rendering ───────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the import title", () => {
      wrapper = makeWrapper();
      const title = wrapper.find('[data-test="import-title"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Import");
    });

    it("renders the back button with correct data-test attribute", () => {
      wrapper = makeWrapper();
      const backBtn = wrapper.find('[data-test="synthetics-locations-import-back-btn"]');
      expect(backBtn.exists()).toBe(true);
    });

    it("renders the cancel button", () => {
      wrapper = makeWrapper();
      const cancelBtn = wrapper.find('[data-test="synthetics-locations-import-cancel-btn"]');
      expect(cancelBtn.exists()).toBe(true);
    });

    it("renders the import button (disabled when no parsed locations)", () => {
      wrapper = makeWrapper();
      const importBtn = wrapper.find('[data-test="synthetics-locations-import-json-btn"]');
      expect(importBtn.exists()).toBe(true);
      expect((importBtn.element as HTMLButtonElement).disabled).toBe(true);
    });

    it("renders the JSON textarea input", () => {
      wrapper = makeWrapper();
      const textarea = wrapper.find('[data-test="synthetics-locations-import-json-input"]');
      expect(textarea.exists()).toBe(true);
    });

    it("renders the file upload button", () => {
      wrapper = makeWrapper();
      const fileBtn = wrapper.find('[data-test="synthetics-locations-import-file-btn"]');
      expect(fileBtn.exists()).toBe(true);
    });

    it("shows no-preview message when no JSON is entered", () => {
      wrapper = makeWrapper();
      const previewText = wrapper.text();
      expect(previewText).toContain("Enter valid JSON to preview locations");
    });
  });

  // ── JSON parsing ────────────────────────────────────────────────────────

  describe("JSON parsing and preview", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses a single valid location and shows preview", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, validJsonArray);

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations).toHaveLength(1);
      expect(locations[0].id).toBe("aws-us-east-1");
      expect(locations[0].provider).toBe("aws");
      expect(locations[0].region).toBe("us-east-1");
      expect(locations[0].label).toBe("AWS US East (N. Virginia)");
      expect(locations[0].kind).toBe("public");
      expect(locations[0].enabled).toBe(true);
    });

    it("parses multiple valid locations and shows preview count", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, validJsonArrayMultiple);

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations).toHaveLength(2);
      expect(locations[0].id).toBe("aws-us-east-1");
      expect(locations[1].id).toBe("gcp-us-central1");

      const previewText = wrapper.text();
      expect(previewText).toContain("(2)");
    });

    it("wraps a single object in an array when JSON is not an array", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, JSON.stringify(validLocation));

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations).toHaveLength(1);
      expect(locations[0].id).toBe("aws-us-east-1");
    });

    it("defaults enabled to true when not provided", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([{ provider: "aws", region: "us-east-1", label: "Test" }]);
      await parseViaScheduleParse(wrapper, json);

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations[0].enabled).toBe(true);
    });

    it("respects enabled: false when provided", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([
        { provider: "aws", region: "us-east-1", label: "Test", enabled: false },
      ]);
      await parseViaScheduleParse(wrapper, json);

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations[0].enabled).toBe(false);
    });

    it("generates id from provider and region", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([
        { provider: "azure", region: "west-us", label: "Azure West US" },
      ]);
      await parseViaScheduleParse(wrapper, json);

      const locations = wrapper.vm.parsedLocations as any[];
      expect(locations[0].id).toBe("azure-west-us");
    });

    it("renders preview items with label, id, and provider", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, validJsonArray);

      const previewText = wrapper.text();
      expect(previewText).toContain("AWS US East (N. Virginia)");
      expect(previewText).toContain("aws-us-east-1");
      expect(previewText).toContain("(aws)");
    });

    it("shows dash for missing label in preview", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [
        {
          id: "aws-us-east-1",
          provider: "aws",
          region: "us-east-1",
          label: "",
          kind: "public",
          enabled: true,
        },
      ];
      await nextTick();

      const previewText = wrapper.text();
      expect(previewText).toContain("-");
    });
  });

  // ── Validation errors ───────────────────────────────────────────────────

  describe("validation errors", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows validation error for missing provider", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([{ region: "us-east-1", label: "Test" }]);
      await parseViaScheduleParse(wrapper, json);

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Provider is required");
    });

    it("shows validation error for missing region", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([{ provider: "aws", label: "Test" }]);
      await parseViaScheduleParse(wrapper, json);

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Region is required");
    });

    it("shows validation error for missing label", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([{ provider: "aws", region: "us-east-1" }]);
      await parseViaScheduleParse(wrapper, json);

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Label is required");
    });

    it("shows validation error for invalid JSON", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, "not valid json {");

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("JSON");
    });

    it("reports validation errors with item index", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([
        { provider: "aws", region: "us-east-1", label: "Good" },
        { region: "us-west-1", label: "Missing Provider" },
      ]);
      await parseViaScheduleParse(wrapper, json);

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("Provider is required");
    });

    it("shows multiple validation errors for multiple invalid items", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([
        { provider: "aws", label: "No Region" },
        { region: "us-west-1", label: "No Provider" },
      ]);
      await parseViaScheduleParse(wrapper, json);

      const errors = wrapper.vm.validationErrors as string[];
      expect(errors.length).toBe(2);
    });

    it("renders validation errors in the template", async () => {
      wrapper = makeWrapper();
      const json = JSON.stringify([{ provider: "aws", region: "us-east-1" }]);
      await parseViaScheduleParse(wrapper, json);

      const errorEl = wrapper.find('[data-test="synthetics-locations-import-error-0"]');
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toContain("Label is required");
    });

    it("clears previous validation errors on re-parse", async () => {
      wrapper = makeWrapper();

      // First, trigger an error
      await parseViaScheduleParse(
        wrapper,
        JSON.stringify([{ provider: "aws", region: "us-east-1" }]),
      );
      expect((wrapper.vm.validationErrors as string[]).length).toBeGreaterThan(0);

      // Then, provide valid JSON
      await parseViaScheduleParse(wrapper, validJsonArray);
      expect(wrapper.vm.validationErrors as string[]).toHaveLength(0);
    });

    it("treats empty input as valid (no parse, no errors)", async () => {
      wrapper = makeWrapper();
      await parseViaScheduleParse(wrapper, "   ");

      expect(wrapper.vm.validationErrors as string[]).toHaveLength(0);
      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(0);
    });
  });

  // ── File upload ─────────────────────────────────────────────────────────

  describe("file upload", () => {
    it("triggers hidden file input click when upload button is clicked", async () => {
      wrapper = makeWrapper();
      const clickSpy = vi.fn();
      (wrapper.vm as any).fileInputRef = { click: clickSpy };

      const fileBtn = wrapper.find('[data-test="synthetics-locations-import-file-btn"]');
      await fileBtn.trigger("click");

      expect(clickSpy).toHaveBeenCalled();
    });

    it("processes file content when a JSON file is selected", async () => {
      wrapper = makeWrapper();

      const mockFileContent = validJsonArray;
      const mockFile = new File([mockFileContent], "locations.json", { type: "application/json" });

      // Replace FileReader with a stub constructor so we can control onload
      class StubFileReader {
        onload: ((e: any) => void) | null = null;
        readAsText(_file: File) {
          // Simulate async load
          setTimeout(() => {
            if (this.onload) {
              this.onload({ target: { result: mockFileContent } });
            }
          }, 0);
        }
      }
      vi.stubGlobal("FileReader", StubFileReader);

      const event = {
        target: { files: [mockFile], value: "C:\\fakepath\\locations.json" },
      } as unknown as Event;

      (wrapper.vm as any).handleFileChange(event);

      // Wait for the setTimeout in StubFileReader
      await new Promise((r) => setTimeout(r, 0));

      expect(wrapper.vm.jsonString as string).toBe(mockFileContent);
    });

    it("does nothing when no file is selected", async () => {
      wrapper = makeWrapper();
      const initialJson = wrapper.vm.jsonString as string;

      const event = {
        target: { files: [], value: "" },
      } as unknown as Event;

      (wrapper.vm as any).handleFileChange(event);
      await nextTick();

      expect(wrapper.vm.jsonString as string).toBe(initialJson);
    });
  });

  // ── Import (createLocation) ─────────────────────────────────────────────

  describe("import via createLocation", () => {
    it("calls parseAndValidate (via handleImport) when no parsed locations exist", async () => {
      wrapper = makeWrapper();

      // handleImport detects empty parsedLocations → calls parseAndValidate → returns
      await (wrapper.vm as any).handleImport();

      // No API call — parsedLocations is empty so handleImport returns early
      expect(mockCreateLocation).not.toHaveBeenCalled();
    });

    it("calls createLocation with correct org identifier and locations array", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({ data: { results: [] } });

      await (wrapper.vm as any).handleImport();
      await flushPromises();

      expect(mockCreateLocation).toHaveBeenCalledWith("test-org", {
        locations: [parsedLocationEntry],
      });
    });

    it("calls createLocation with multiple locations", async () => {
      wrapper = makeWrapper();
      const gcpEntry = {
        kind: "public",
        id: "gcp-us-central1",
        provider: "gcp",
        region: "us-central1",
        label: "GCP US Central",
        enabled: false,
      };
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry, gcpEntry];

      mockCreateLocation.mockResolvedValue({ data: { results: [] } });

      await (wrapper.vm as any).handleImport();
      await flushPromises();

      expect(mockCreateLocation).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          locations: expect.arrayContaining([
            expect.objectContaining({ id: "aws-us-east-1" }),
            expect.objectContaining({ id: "gcp-us-central1" }),
          ]),
        }),
      );
    });

    it("sets isImporting to true while the API call is pending", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      let resolvePromise: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockCreateLocation.mockReturnValue(pendingPromise);

      // Start the import but don't resolve yet
      const importPromise = (wrapper.vm as any).handleImport();
      await nextTick();

      expect(wrapper.vm.isImporting as boolean).toBe(true);

      // Resolve and clean up
      resolvePromise!({ data: { results: [] } });
      await importPromise;
    });

    it("sets isImporting to false after API call completes", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({ data: { results: [] } });

      await (wrapper.vm as any).handleImport();

      expect(wrapper.vm.isImporting as boolean).toBe(false);
    });
  });

  // ── Import results display ──────────────────────────────────────────────

  describe("import results", () => {
    it("shows import results when createLocation returns results", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({
        data: {
          results: [{ id: "aws-us-east-1", label: "AWS US East", ok: true }],
        },
      });

      await (wrapper.vm as any).handleImport();

      const results = wrapper.vm.importResults as any[];
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(true);
      expect(results[0].id).toBe("aws-us-east-1");
    });

    it("shows failed import result with error message", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({
        data: {
          results: [
            { id: "aws-us-east-1", label: "AWS US East", ok: false, error: "Duplicate location" },
          ],
        },
      });

      await (wrapper.vm as any).handleImport();

      const results = wrapper.vm.importResults as any[];
      expect(results[0].ok).toBe(false);
      expect(results[0].error).toBe("Duplicate location");
    });

    it("renders import result items in the template", async () => {
      wrapper = makeWrapper();
      const gcpEntry = {
        kind: "public",
        id: "gcp-us-central1",
        provider: "gcp",
        region: "us-central1",
        label: "GCP US Central",
        enabled: true,
      };
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry, gcpEntry];

      mockCreateLocation.mockResolvedValue({
        data: {
          results: [
            { id: "aws-us-east-1", label: "AWS US East", ok: true },
            { id: "gcp-us-central1", label: "GCP US Central", ok: false, error: "Already exists" },
          ],
        },
      });

      await (wrapper.vm as any).handleImport();
      await nextTick();

      const resultItem0 = wrapper.find('[data-test="synthetics-locations-import-result-0"]');
      expect(resultItem0.exists()).toBe(true);

      const resultItem1 = wrapper.find('[data-test="synthetics-locations-import-result-1"]');
      expect(resultItem1.exists()).toBe(true);
      expect(resultItem1.text()).toContain("Already exists");
    });
  });

  // ── Toast on import ─────────────────────────────────────────────────────

  describe("toast on import", () => {
    it("shows success toast when all items are imported successfully", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({
        data: {
          results: [{ id: "aws-us-east-1", label: "AWS US East", ok: true }],
        },
      });

      await (wrapper.vm as any).handleImport();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
        }),
      );
      expect(mockToastFn.mock.calls[0][0].message).toContain("1");
    });

    it("does not show success toast when some items fail", async () => {
      wrapper = makeWrapper();
      const gcpEntry = {
        kind: "public",
        id: "gcp-us-central1",
        provider: "gcp",
        region: "us-central1",
        label: "GCP US Central",
        enabled: true,
      };
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry, gcpEntry];

      mockCreateLocation.mockResolvedValue({
        data: {
          results: [
            { id: "aws-us-east-1", label: "AWS US East", ok: true },
            { id: "gcp-us-central1", label: "GCP US Central", ok: false, error: "Error" },
          ],
        },
      });

      await (wrapper.vm as any).handleImport();

      const successCalls = mockToastFn.mock.calls.filter((c: any[]) => c[0]?.variant === "success");
      expect(successCalls).toHaveLength(0);
    });

    it("shows error toast when API call fails", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockRejectedValue({ response: { data: { message: "Server error" } } });

      await (wrapper.vm as any).handleImport();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Server error",
        }),
      );
    });

    it("shows generic error toast when API fails with no error message", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockRejectedValue(new Error("Network error"));

      await (wrapper.vm as any).handleImport();

      const errorCalls = mockToastFn.mock.calls.filter((c: any[]) => c[0]?.variant === "error");
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0][0].message).toContain("Failed to import");
    });
  });

  // ── Back button and cancel:hideform ─────────────────────────────────────

  describe("back and cancel actions", () => {
    it('emits "cancel:hideform" when back button is clicked', async () => {
      wrapper = makeWrapper();
      const backBtn = wrapper.find('[data-test="synthetics-locations-import-back-btn"]');
      await backBtn.trigger("click");

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      expect(wrapper.emitted("cancel:hideform")).toHaveLength(1);
    });

    it('emits "cancel:hideform" when cancel button is clicked', async () => {
      wrapper = makeWrapper();
      const cancelBtn = wrapper.find('[data-test="synthetics-locations-import-cancel-btn"]');
      await cancelBtn.trigger("click");

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it('emits "cancel:hideform" when handleBack is called directly', () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).handleBack();

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // ── Debounced parsing ───────────────────────────────────────────────────

  describe("debounced parse on input", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls scheduleParse on textarea input and parses after 300ms debounce", async () => {
      wrapper = makeWrapper();

      const textarea = wrapper.find('[data-test="synthetics-locations-import-json-input"]');
      await textarea.setValue(validJsonArray);
      await textarea.trigger("input");

      // parse not called yet
      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(0);

      // Advance past debounce
      vi.advanceTimersByTime(300);
      await nextTick();

      // Now should have parsed
      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(1);
    });

    it("debounces multiple rapid inputs into a single parse call", async () => {
      wrapper = makeWrapper();

      const textarea = wrapper.find('[data-test="synthetics-locations-import-json-input"]');

      await textarea.setValue("[]");
      await textarea.trigger("input");
      vi.advanceTimersByTime(100);

      await textarea.setValue(validJsonArray);
      await textarea.trigger("input");
      vi.advanceTimersByTime(100);

      await textarea.setValue(validJsonArrayMultiple);
      await textarea.trigger("input");

      // Only 100ms since last input — not yet parsed
      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(0);

      // Advance past debounce period (300ms from last input)
      vi.advanceTimersByTime(300);
      await nextTick();

      // Should now have parsed the latest value (2 items)
      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(2);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("clears parsedLocations, validationErrors, and importResults on re-parse", async () => {
      vi.useFakeTimers();
      wrapper = makeWrapper();

      // Set stale state
      (wrapper.vm as any).parsedLocations = [{ id: "old" }];
      (wrapper.vm as any).validationErrors = ["old error"];
      (wrapper.vm as any).importResults = [{ id: "old", ok: true }];

      // Trigger a new parse
      await parseViaScheduleParse(wrapper, validJsonArray);

      expect(wrapper.vm.parsedLocations as any[]).toHaveLength(1);
      expect((wrapper.vm.parsedLocations as any[])[0].id).not.toBe("old");
      expect(wrapper.vm.validationErrors as string[]).toHaveLength(0);
      expect(wrapper.vm.importResults as any[]).toHaveLength(0);

      vi.useRealTimers();
    });

    it("import button is enabled when there are parsed locations and not importing", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];
      await nextTick();

      const importBtn = wrapper.find('[data-test="synthetics-locations-import-json-btn"]');
      expect((importBtn.element as HTMLButtonElement).disabled).toBe(false);
    });

    it("handles empty results array from API", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({ data: { results: [] } });

      await (wrapper.vm as any).handleImport();

      expect(wrapper.vm.importResults as any[]).toHaveLength(0);
    });

    it("handles response without data.results gracefully", async () => {
      wrapper = makeWrapper();
      (wrapper.vm as any).parsedLocations = [parsedLocationEntry];

      mockCreateLocation.mockResolvedValue({ data: {} });

      await (wrapper.vm as any).handleImport();

      expect(wrapper.vm.importResults as any[]).toHaveLength(0);
    });
  });
});
