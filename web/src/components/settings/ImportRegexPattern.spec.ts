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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ImportRegexPattern from "@/components/settings/ImportRegexPattern.vue";
import regexPatternsService from "@/services/regex_pattern";
import { nextTick, ref } from "vue";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

const { mockToastFn } = vi.hoisted(() => ({
  mockToastFn: vi.fn(),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

// Mock services
vi.mock("@/services/regex_pattern", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn(),
    },
  });
});

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock utils cookies
vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(() => "en-us"),
}));

describe("ImportRegexPattern", () => {
  let wrapper: any = null;

  const mockProps = {
    regexPatterns: ["existing-pattern-1", "existing-pattern-2"],
  };

  beforeEach(() => {
    wrapper = mount(ImportRegexPattern, {
      props: mockProps,
      global: {
        plugins: [store, router, i18n],
        stubs: {
          "base-import": {
            template: '<div><slot name="output-content"></slot></div>',
            props: [
              "title",
              "testPrefix",
              "isImporting",
              "editorHeights",
              "containerClass",
              "containerStyle",
              "tabs",
            ],
            emits: ["back", "cancel", "import", "update:active-tab"],
            setup(_props: any, { expose }: any) {
              const jsonArrayOfObj = ref([]);
              const jsonStr = ref("");
              const isImportingLocal = ref(false);
              const jsonFiles = ref(null);
              const url = ref("");
              const updateJsonArray = (arr: any[]) => {
                jsonArrayOfObj.value = arr;
                jsonStr.value = JSON.stringify(arr, null, 2);
              };
              expose({
                jsonArrayOfObj,
                jsonStr,
                isImportingLocal,
                jsonFiles,
                url,
                updateJsonArray,
              });
              return { jsonArrayOfObj, jsonStr, isImportingLocal, jsonFiles, url, updateJsonArray };
            },
          },
          "app-tabs": {
            template:
              '<div :data-test="$attrs[\'data-test\']" :class="$attrs.class"><slot></slot></div>',
            props: ["tabs", "activeTab"],
            emits: ["update:active-tab"],
          },
          OIcon: true,
          "built-in-patterns-tab": true,
        },
      },
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Function Tests
  describe("updateRegexPatternName function", () => {
    beforeEach(async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      // Set up baseImportRef with initial data
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: "old-name" }];
        wrapper.vm.$refs.baseImportRef.updateJsonArray([{ name: "old-name" }]);
      }
    });

    it("should update regex pattern name in jsonArrayOfObj", () => {
      wrapper.vm.updateRegexPatternName("new-name", 0);

      expect(wrapper.vm.jsonArrayOfObj[0].name).toBe("new-name");
    });
  });

  describe("updateRegexPattern function", () => {
    beforeEach(async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      // Set up baseImportRef with initial data
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ pattern: "old-pattern" }];
        wrapper.vm.$refs.baseImportRef.updateJsonArray([{ pattern: "old-pattern" }]);
      }
    });

    it("should update regex pattern in jsonArrayOfObj", () => {
      wrapper.vm.updateRegexPattern("new-pattern", 0);

      expect(wrapper.vm.jsonArrayOfObj[0].pattern).toBe("new-pattern");
    });
  });

  // updateActiveTab, onSubmit, URL watcher, and jsonFiles watcher moved to BaseImport

  // validateRegexPatternInputs Tests
  describe("validateRegexPatternInputs function", () => {
    beforeEach(() => {
      wrapper.vm.regexPatternErrorsToDisplay = [];
    });

    it("should return false for empty name", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "", pattern: ".*" }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([
        [
          {
            field: "regex_pattern_name",
            message: "Regex pattern - 1: name is required",
          },
        ],
      ]);
    });

    it("should return false for a whitespace-only name", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "   ", pattern: ".*" }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].field).toBe("regex_pattern_name");
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("name is required");
    });

    it("should return false for a whitespace-only pattern", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs(
        { name: "test", pattern: "   " },
        1,
      );

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].field).toBe("regex_pattern");
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("is required");
    });

    it("should return true for existing pattern name (duplicates allowed)", async () => {
      // Note: Duplicate pattern names are now allowed as primary key is UUID-based
      const result = await wrapper.vm.validateRegexPatternInputs(
        {
          name: "existing-pattern-1",
          pattern: ".*",
        },
        1,
      );

      expect(result).toBe(true);
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([]);
    });

    it("should return false for empty pattern", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "test", pattern: "" }, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].field).toBe("regex_pattern");
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("is required");
    });

    it("should return false for invalid description type", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs(
        {
          name: "test",
          pattern: ".*",
          description: 123,
        },
        1,
      );

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0]).toContain(
        "description must be a string",
      );
    });

    it("should return true for valid inputs with null description", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs(
        {
          name: "test-pattern",
          pattern: ".*",
          description: null,
        },
        1,
      );

      expect(result).toBe(true);
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([]);
    });
  });

  // createRegexPattern Tests
  describe("createRegexPattern function", () => {
    beforeEach(() => {
      wrapper.vm.regexPatternCreators = [];
      vi.clearAllMocks();
    });

    it("should create regex pattern successfully", async () => {
      const mockPayload = {
        name: "test-pattern",
        pattern: ".*",
        description: "Test description",
      };

      (regexPatternsService.create as any).mockResolvedValue({});

      const result = await wrapper.vm.createRegexPattern(mockPayload, 1);

      expect(result).toBe(true);
      expect(regexPatternsService.create).toHaveBeenCalledWith("default", mockPayload);
      expect(wrapper.vm.regexPatternCreators).toEqual([
        {
          success: true,
          message:
            'Regex pattern - 1: "test-pattern" created successfully \nNote: please remove the created regex pattern object test-pattern from the json file',
        },
      ]);
    });

    it("should handle creation failure", async () => {
      const mockPayload = {
        name: "test-pattern",
        pattern: ".*",
        description: "Test description",
      };

      const mockError = {
        response: {
          data: {
            message: "Pattern already exists",
          },
        },
      };

      (regexPatternsService.create as any).mockRejectedValue(mockError);

      const result = await wrapper.vm.createRegexPattern(mockPayload, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternCreators).toEqual([
        {
          success: false,
          message:
            'Regex pattern - 1: "test-pattern" creation failed --> \n Reason: Pattern already exists',
        },
      ]);
    });

    it("should handle creation failure with unknown error", async () => {
      const mockPayload = {
        name: "test-pattern",
        pattern: ".*",
        description: null,
      };

      (regexPatternsService.create as any).mockRejectedValue({});

      const result = await wrapper.vm.createRegexPattern(mockPayload, 1);

      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternCreators[0].message).toContain("Unknown Error");
    });
  });

  // processJsonObject Tests
  describe("processJsonObject function", () => {
    beforeEach(() => {
      wrapper.vm.regexPatternErrorsToDisplay = [];
      wrapper.vm.regexPatternCreators = [];
      vi.clearAllMocks();
    });

    it("should return false for invalid regex pattern inputs", async () => {
      const result = await wrapper.vm.processJsonObject({ name: "", pattern: ".*" }, 1);

      expect(result).toBe(false);
    });

    it("should create regex pattern when validation passes", async () => {
      (regexPatternsService.create as any).mockResolvedValue({});

      const result = await wrapper.vm.processJsonObject(
        {
          name: "new-pattern",
          pattern: ".*",
        },
        1,
      );

      expect(result).toBe(true);
    });

    it("should handle errors during processing", async () => {
      // Test error handling with invalid input that will cause an error
      const result = await wrapper.vm.processJsonObject(null, 1);

      expect(result).toBe(false);
    });
  });

  // importJson Tests
  describe("importJson function", () => {
    beforeEach(() => {
      wrapper.vm.regexPatternErrorsToDisplay = [];
      wrapper.vm.regexPatternCreators = [];
      vi.clearAllMocks();
    });

    it("should show error for empty JSON string", async () => {
      const payload = {
        jsonStr: "",
        jsonArray: [],
      };

      mockToastFn.mockClear();

      await wrapper.vm.importJson(payload);
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith({
        message: "JSON string is empty",
        variant: "error",
      });
    });

    it("should reset BaseImport isImporting flag when JSON string is empty", async () => {
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const baseImportRef = wrapper.vm.$refs.baseImportRef;
      if (baseImportRef) {
        baseImportRef.isImportingLocal = true;
      }

      await wrapper.vm.importJson({ jsonStr: "", jsonArray: [] });

      expect(baseImportRef.isImportingLocal).toBe(false);
    });

    it("should show error for invalid JSON", async () => {
      const payload = {
        jsonStr: "{ invalid json }",
        jsonArray: [],
      };

      mockToastFn.mockClear();

      await wrapper.vm.importJson(payload);
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
        }),
      );
      expect(mockToastFn.mock.calls[0][0].message).toContain("JSON");
    });

    it("should reset BaseImport isImporting flag when JSON is invalid", async () => {
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const baseImportRef = wrapper.vm.$refs.baseImportRef;
      if (baseImportRef) {
        baseImportRef.isImportingLocal = true;
      }

      await wrapper.vm.importJson({ jsonStr: "{ invalid json }", jsonArray: [] });

      expect(baseImportRef.isImportingLocal).toBe(false);
    });
  });
});
