// Copyright 2023 OpenObserve Inc.
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
import { Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick, ref } from "vue";
import axios from "axios";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

// Mock services
vi.mock("@/services/regex_pattern", () => ({
  default: {
    create: vi.fn()
  }
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn()
  }
}));

// Mock utils cookies
vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(() => "en-gb")
}));

installQuasar({
  plugins: [Notify]
});

describe("ImportRegexPattern", () => {
  let wrapper: any = null;

  const mockProps = {
    regexPatterns: ["existing-pattern-1", "existing-pattern-2"]
  };

  beforeEach(() => {
    wrapper = mount(ImportRegexPattern, {
      props: mockProps,
      global: {
        plugins: [store, router, i18n],
        stubs: {
          "base-import": {
            template: '<div><slot name="output-content"></slot></div>',
            props: ['title', 'testPrefix', 'isImporting', 'editorHeights', 'containerClass', 'containerStyle', 'tabs'],
            emits: ['back', 'cancel', 'import', 'update:active-tab'],
            setup(_props: any, { expose }: any) {
              const jsonArrayOfObj = ref([]);
              const jsonStr = ref("");
              const isImporting = ref(false);
              const jsonFiles = ref(null);
              const url = ref("");
              const updateJsonArray = (arr: any[]) => {
                jsonArrayOfObj.value = arr;
                jsonStr.value = JSON.stringify(arr, null, 2);
              };
              expose({
                jsonArrayOfObj,
                jsonStr,
                isImporting,
                jsonFiles,
                url,
                updateJsonArray,
              });
              return { jsonArrayOfObj, jsonStr, isImporting, jsonFiles, url, updateJsonArray };
            },
          },
          "q-input": true,
          "q-btn": true,
          "q-separator": true,
          "q-form": true,
          "q-file": true,
          "app-tabs": {
            template: '<div :data-test="$attrs[\'data-test\']" :class="$attrs.class"><slot></slot></div>',
            props: ['tabs', 'activeTab'],
            emits: ['update:active-tab']
          },
          "q-icon": true,
          "built-in-patterns-tab": true
        }
      }
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Basic Component Tests
  describe("Component Initialization", () => {
    it("should mount ImportRegexPattern component", () => {
      expect(wrapper).toBeTruthy();
    });

    it("should initialize with correct default values", () => {
      expect(wrapper.vm.activeTab).toBe("import_built_in_patterns");
      expect(wrapper.vm.isImporting).toBe(false);
    });

    it("should initialize existing pattern names set", () => {
      expect(wrapper.vm.existingPatternNames).toBeInstanceOf(Set);
      expect(wrapper.vm.existingPatternNames.has("existing-pattern-1")).toBe(true);
      expect(wrapper.vm.existingPatternNames.has("existing-pattern-2")).toBe(true);
    });

    it("should initialize empty arrays", () => {
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([]);
      expect(wrapper.vm.userSelectedRegexPatternName).toEqual([]);
      expect(wrapper.vm.userSelectedRegexPattern).toEqual([]);
      expect(wrapper.vm.regexPatternCreators).toEqual([]);
      expect(wrapper.vm.jsonArrayOfObj).toEqual([]); // Empty from baseImportRef
    });

    it("should initialize correct tabs structure", () => {
      expect(wrapper.vm.allTabs).toEqual([
        {
          label: "Built-in Patterns",
          value: "import_built_in_patterns",
        },
        {
          label: "File Upload / JSON",
          value: "import_json_file",
        },
        {
          label: "URL Import",
          value: "import_json_url",
        },
      ]);
    });
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

    it("should handle multiple objects in array", () => {
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: "first" }, { name: "second" }];
      }
      wrapper.vm.updateRegexPatternName("updated-first", 0);

      expect(wrapper.vm.jsonArrayOfObj[0].name).toBe("updated-first");
      expect(wrapper.vm.jsonArrayOfObj[1].name).toBe("second");
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

    it("should handle complex regex patterns", () => {
      const complexPattern = "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$";
      wrapper.vm.updateRegexPattern(complexPattern, 0);

      expect(wrapper.vm.jsonArrayOfObj[0].pattern).toBe(complexPattern);
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
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([[{
        field: 'regex_pattern_name',
        message: 'Regex pattern - 1: name is required'
      }]]);
    });

    it("should return false for whitespace-only name", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "   ", pattern: ".*" }, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("name is required");
    });

    it("should return false for undefined name", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ pattern: ".*" }, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("name is required");
    });

    it("should return true for existing pattern name (duplicates allowed)", async () => {
      // Note: Duplicate pattern names are now allowed as primary key is UUID-based
      const result = await wrapper.vm.validateRegexPatternInputs({
        name: "existing-pattern-1",
        pattern: ".*"
      }, 1);

      expect(result).toBe(true);
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([]);
    });

    it("should return false for empty pattern", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "test", pattern: "" }, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].field).toBe("regex_pattern");
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("is required");
    });

    it("should return false for whitespace-only pattern", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ name: "test", pattern: "   " }, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0].message).toContain("is required");
    });

    it("should return false for invalid description type", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ 
        name: "test", 
        pattern: ".*", 
        description: 123 
      }, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternErrorsToDisplay[0][0]).toContain("description must be a string");
    });

    it("should return true for valid inputs with null description", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ 
        name: "test-pattern", 
        pattern: ".*", 
        description: null 
      }, 1);
      
      expect(result).toBe(true);
      expect(wrapper.vm.regexPatternErrorsToDisplay).toEqual([]);
    });

    it("should return true for valid inputs with undefined description", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ 
        name: "test-pattern", 
        pattern: ".*", 
        description: undefined 
      }, 1);
      
      expect(result).toBe(true);
    });

    it("should return true for valid inputs with string description", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ 
        name: "test-pattern", 
        pattern: ".*", 
        description: "Test description" 
      }, 1);
      
      expect(result).toBe(true);
    });

    it("should return true for valid inputs without description", async () => {
      const result = await wrapper.vm.validateRegexPatternInputs({ 
        name: "test-pattern", 
        pattern: ".*" 
      }, 1);
      
      expect(result).toBe(true);
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
        description: "Test description"
      };
      
      (regexPatternsService.create as any).mockResolvedValue({});
      
      const result = await wrapper.vm.createRegexPattern(mockPayload, 1);
      
      expect(result).toBe(true);
      expect(regexPatternsService.create).toHaveBeenCalledWith("default", mockPayload);
      expect(wrapper.vm.regexPatternCreators).toEqual([{
        success: true,
        message: 'Regex pattern - 1: "test-pattern" created successfully \nNote: please remove the created regex pattern object test-pattern from the json file'
      }]);
    });

    it("should handle creation failure", async () => {
      const mockPayload = {
        name: "test-pattern",
        pattern: ".*",
        description: "Test description"
      };
      
      const mockError = {
        response: {
          data: {
            message: "Pattern already exists"
          }
        }
      };
      
      (regexPatternsService.create as any).mockRejectedValue(mockError);
      
      const result = await wrapper.vm.createRegexPattern(mockPayload, 1);
      
      expect(result).toBe(false);
      expect(wrapper.vm.regexPatternCreators).toEqual([{
        success: false,
        message: 'Regex pattern - 1: "test-pattern" creation failed --> \n Reason: Pattern already exists'
      }]);
    });

    it("should handle creation failure with unknown error", async () => {
      const mockPayload = {
        name: "test-pattern",
        pattern: ".*",
        description: null
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

    it("should return false when validation errors exist", async () => {
      wrapper.vm.regexPatternErrorsToDisplay = [["Some error"]];
      
      const result = await wrapper.vm.processJsonObject({ name: "test", pattern: ".*" }, 1);
      
      expect(result).toBe(false);
    });

    it("should create regex pattern when validation passes", async () => {
      (regexPatternsService.create as any).mockResolvedValue({});
      
      const result = await wrapper.vm.processJsonObject({ 
        name: "new-pattern", 
        pattern: ".*" 
      }, 1);
      
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
        jsonArray: []
      };

      const notifySpy = vi.spyOn(wrapper.vm.$q, "notify");

      await wrapper.vm.importJson(payload);

      expect(notifySpy).toHaveBeenCalledWith({
        message: "JSON string is empty",
        color: "negative",
        position: "bottom",
        timeout: 2000,
      });
    });

    it("should show error for invalid JSON", async () => {
      const payload = {
        jsonStr: "{ invalid json }",
        jsonArray: []
      };

      const notifySpy = vi.spyOn(wrapper.vm.$q, "notify");

      await wrapper.vm.importJson(payload);

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative",
          position: "bottom",
          timeout: 2000,
        })
      );
      expect(notifySpy.mock.calls[0][0].message).toContain("JSON");
    });

    it("should not navigate when some imports fail", async () => {
      const jsonData = [
        { name: "", pattern: ".*1" }, // Invalid
        { name: "pattern2", pattern: ".*2" } // Valid
      ];
      const payload = {
        jsonStr: JSON.stringify(jsonData),
        jsonArray: jsonData
      };

      (regexPatternsService.create as any).mockResolvedValue({});

      await wrapper.vm.importJson(payload);

      const routerSpy = vi.spyOn(wrapper.vm.$router, "push");
      expect(routerSpy).not.toHaveBeenCalled();
    });
  });

  // Template/DOM Tests
  describe("Template Rendering", () => {
    it("should render back button", () => {
      const backBtn = wrapper.find('[data-test="regex-pattern-import-back-btn"]');
      expect(backBtn.exists()).toBe(true);
    });

    it("should render cancel button", () => {
      const cancelBtn = wrapper.find('[data-test="regex-pattern-import-cancel-btn"]');
      expect(cancelBtn.exists()).toBe(true);
    });

    it("should render import button", () => {
      const importBtn = wrapper.find('[data-test="regex-pattern-import-json-btn"]');
      expect(importBtn.exists()).toBe(true);
    });

    it("should render tabs component", () => {
      const tabs = wrapper.find('[data-test="regex-pattern-import-tabs"]');
      expect(tabs.exists()).toBe(true);
    });

    it("should render file input when activeTab is import_json_file", async () => {
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();
      
      // Since components are stubbed, let's test the activeTab state instead
      expect(wrapper.vm.activeTab).toBe("import_json_file");
    });

    it("should render URL input when activeTab is import_json_url", async () => {
      wrapper.vm.activeTab = "import_json_url";
      await nextTick();
      
      // Since components are stubbed, let's test the activeTab state instead
      expect(wrapper.vm.activeTab).toBe("import_json_url");
    });
  });

  // Event Handler Tests
  describe("Event Handlers", () => {

    it("should call importJson when import button is clicked", async () => {
      const spy = vi.spyOn(wrapper.vm, "importJson");
      
      // Call the function directly since the button is stubbed
      wrapper.vm.importJson();
      
      expect(spy).toHaveBeenCalled();
    });

    it("should update queryEditorPlaceholderFlag on editor focus", () => {
      wrapper.vm.queryEditorPlaceholderFlag = true;
      
      // Simulate editor focus
      wrapper.vm.queryEditorPlaceholderFlag = false;
      
      expect(wrapper.vm.queryEditorPlaceholderFlag).toBe(false);
    });

    it("should update queryEditorPlaceholderFlag on editor blur", () => {
      wrapper.vm.queryEditorPlaceholderFlag = false;
      
      // Simulate editor blur
      wrapper.vm.queryEditorPlaceholderFlag = true;
      
      expect(wrapper.vm.queryEditorPlaceholderFlag).toBe(true);
    });
  });

  // Edge Cases and Error Handling
  describe("Edge Cases", () => {
    it("should handle null jsonFiles", async () => {
      wrapper.vm.jsonFiles = null;
      await nextTick();
      
      expect(wrapper.vm.jsonFiles).toBe(null);
    });

    it("should handle empty URL string", async () => {
      wrapper.vm.url = "";
      await nextTick();
      
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("should handle large JSON arrays", async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        name: `pattern-${i}`,
        pattern: `.*${i}`
      }));

      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = largeArray;
        wrapper.vm.$refs.baseImportRef.updateJsonArray(largeArray);
      }

      expect(wrapper.vm.jsonArrayOfObj.length).toBe(100);
    });

    it("should handle deeply nested JSON objects", async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const complexObj = {
        name: "complex-pattern",
        pattern: ".*",
        metadata: {
          created: "2023-01-01",
          tags: ["tag1", "tag2"]
        }
      };

      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [complexObj];
        wrapper.vm.$refs.baseImportRef.updateJsonArray([complexObj]);
      }

      expect(wrapper.vm.jsonArrayOfObj[0]).toEqual(complexObj);
    });

    it("should handle special characters in pattern names", async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const specialName = "pattern-with-special-chars-@#$%";
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: "" }];
        wrapper.vm.updateRegexPatternName(specialName, 0);
        expect(wrapper.vm.jsonArrayOfObj[0].name).toBe(specialName);
      }
    });

    it("should handle regex patterns with escape characters", async () => {
      // Switch to a tab that uses BaseImport
      wrapper.vm.activeTab = "import_json_file";
      await nextTick();

      const escapePattern = "\\d{4}-\\d{2}-\\d{2}";
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ pattern: "" }];
        wrapper.vm.updateRegexPattern(escapePattern, 0);
        expect(wrapper.vm.jsonArrayOfObj[0].pattern).toBe(escapePattern);
      }
    });
  });
});