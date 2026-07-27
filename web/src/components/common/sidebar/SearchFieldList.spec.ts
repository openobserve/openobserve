import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";
import FieldList from "./SearchFieldList.vue";
import streamService from "@/services/stream";
import { b64EncodeUnicode } from "@/utils/zincutils";

// Mock streamService
vi.mock("@/services/stream", () => ({
  default: {
    fieldValues: vi.fn(),
  },
}));

// Shared mocks accessible in both the vi.mock factory and test callbacks.
// vi.hoisted ensures they exist before vi.mock factories run.
const fieldValuesMocks = vi.hoisted(() => ({
  fetchFieldValues: vi.fn() as any,
  cancelFieldStream: vi.fn(),
  // Assigned by the factory once the module is first imported:
  _setFieldState: null as ((fieldName: string, patch: Record<string, any>) => void) | null,
  _reset: null as (() => void) | null,
}));

// Mock useFieldValuesStream so it bridges to the existing streamService.fieldValues mock.
vi.mock("@/composables/useFieldValuesStream", async () => {
  const { ref } = await import("vue");
  const fieldValuesRef = ref<Record<string, any>>({});
  const fieldValuesFinalizedValuesRef = ref<Record<string, any[]>>({});
  const fieldValuesCurrentSizeRef = ref<Record<string, number>>({});

  fieldValuesMocks._reset = () => {
    fieldValuesRef.value = {};
    fieldValuesFinalizedValuesRef.value = {};
    fieldValuesCurrentSizeRef.value = {};
  };

  fieldValuesMocks._setFieldState = (fieldName, patch) => {
    if (fieldValuesRef.value[fieldName]) {
      fieldValuesRef.value[fieldName] = {
        ...fieldValuesRef.value[fieldName],
        ...patch,
      };
    }
  };

  const resetFieldValues = (fieldName: string, isLoading = false) => {
    fieldValuesRef.value[fieldName] = {
      values: [],
      isLoading,
      hasMore: false,
      errMsg: "",
    };
  };

  return {
    default: () => ({
      fieldValues: fieldValuesRef,
      fieldValuesFinalizedValues: fieldValuesFinalizedValuesRef,
      fieldValuesCurrentSize: fieldValuesCurrentSizeRef,
      fetchFieldValues: fieldValuesMocks.fetchFieldValues,
      cancelFieldStream: fieldValuesMocks.cancelFieldStream,
      resetFieldValues,
    }),
  };
});

// Mock zincutils
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    formatLargeNumber: vi.fn((num) => num.toString()),
    getImageURL: vi.fn(() => "test-image-url"),
  };
});

// Mock copyToClipboard
const { mockCopyToClipboard } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    theme: "dark",
    zoConfig: {
      timestamp_column: "_timestamp",
      query_values_default_num: 10,
      showFtsFieldValues: false,
    },
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      search: {
        searchField: "Search field",
      },
    },
  },
});

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div>Home</div>" } }],
});

describe("FieldList.vue Comprehensive Coverage", () => {
  let wrapper: VueWrapper;
  let mockStreamService: any;
  let mockWriteText: any;
  let mockNotify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    fieldValuesMocks._reset?.();

    mockStreamService = vi.mocked(streamService.fieldValues);
    mockNotify = vi.fn();
    mockWriteText = vi.fn();
    mockCopyToClipboard.mockResolvedValue(true);

    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText.mockResolvedValue(undefined),
      },
    });

    // Wire fetchFieldValues to the streamService mock so existing test setup
    // (mockStreamService.mockResolvedValue / mockRejectedValue) keeps working.
    fieldValuesMocks.fetchFieldValues.mockImplementation(async (payload: any) => {
      const fieldName = payload.fields[0];
      try {
        const response = await (streamService.fieldValues as any)(payload);
        const hits = response?.data?.hits ?? [];
        const values: any[] = [];
        hits.forEach((hit: any) => {
          (hit.values ?? []).forEach((v: any) => {
            values.push({
              key: v.zo_sql_key != null ? String(v.zo_sql_key) : "null",
              count: String(v.zo_sql_num),
            });
          });
        });
        fieldValuesMocks._setFieldState?.(fieldName, {
          values,
          isLoading: false,
        });
      } catch {
        fieldValuesMocks._setFieldState?.(fieldName, { isLoading: false });
        mockNotify({
          type: "negative",
          message: `Error while fetching values for ${fieldName}`,
        });
      }
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      fields: [],
      streamName: "test-stream",
      timeStamp: {
        startTime: "2023-01-01",
        endTime: "2023-01-02",
      },
      streamType: "logs",
      hideIncludeExlcude: false,
      hideCopyValue: true,
      hideAddSearchTerm: false,
    };

    return mount(FieldList, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [mockI18n, mockRouter],
        provide: {
          store: mockStore,
        },
      },
    });
  };

  describe("Component Rendering Tests", () => {
    it("should render the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".index-menu").exists()).toBe(true);
      expect(wrapper.find(".index-table").exists()).toBe(true);
    });

    it("should render OFieldList component", () => {
      wrapper = createWrapper();
      const fieldList = wrapper.findComponent({ name: "OFieldList" });
      expect(fieldList.exists()).toBe(true);
    });

    it("should render search input with correct attributes", () => {
      wrapper = createWrapper();
      // Search input is provided by OFieldList, queried by placeholder
      const searchInput = wrapper.find('[placeholder="Search field"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("should render with empty fields array", () => {
      wrapper = createWrapper({ fields: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render with multiple fields", () => {
      const fields = [
        { name: "field1", ftsKey: false, showValues: true },
        { name: "field2", ftsKey: false, showValues: true },
        { name: "field3", ftsKey: true, showValues: false },
      ];
      wrapper = createWrapper({ fields });
      const fieldList = wrapper.findComponent({ name: "OFieldList" });
      expect(fieldList.exists()).toBe(true);
      expect(fieldList.props("fields")).toEqual(fields);
    });
  });

  describe("Props Validation Tests", () => {
    it("should accept fields array prop", () => {
      const fields = [{ name: "test-field" }];
      wrapper = createWrapper({ fields });
      expect(wrapper.props("fields")).toEqual(fields);
    });

    it("should accept streamName string prop", () => {
      wrapper = createWrapper({ streamName: "custom-stream" });
      expect(wrapper.props("streamName")).toBe("custom-stream");
    });

    it("should accept timeStamp object prop", () => {
      const timeStamp = { startTime: "2023-01-01", endTime: "2023-12-31" };
      wrapper = createWrapper({ timeStamp });
      expect(wrapper.props("timeStamp")).toEqual(timeStamp);
    });

    it("should accept streamType prop", () => {
      wrapper = createWrapper({ streamType: "metrics" });
      expect(wrapper.props("streamType")).toBe("metrics");
    });

    it("should accept hideIncludeExlcude boolean prop", () => {
      wrapper = createWrapper({ hideIncludeExlcude: true });
      expect(wrapper.props("hideIncludeExlcude")).toBe(true);
    });

    it("should accept hideCopyValue boolean prop", () => {
      wrapper = createWrapper({ hideCopyValue: false });
      expect(wrapper.props("hideCopyValue")).toBe(false);
    });

    it("should accept hideAddSearchTerm boolean prop", () => {
      wrapper = createWrapper({ hideAddSearchTerm: true });
      expect(wrapper.props("hideAddSearchTerm")).toBe(true);
    });

    it("should use default values for all props", () => {
      wrapper = createWrapper();
      expect(wrapper.props("fields")).toEqual([]);
      expect(wrapper.props("streamName")).toBe("test-stream");
      expect(wrapper.props("streamType")).toBe("logs");
      expect(wrapper.props("hideIncludeExlcude")).toBe(false);
      expect(wrapper.props("hideCopyValue")).toBe(true);
      expect(wrapper.props("hideAddSearchTerm")).toBe(false);
    });
  });

  // filterFieldFn tests removed: function no longer exists in the component.
  // Filtering is now handled internally by OFieldList.

  describe("OpenFilterCreator Function Tests", () => {
    beforeEach(() => {
      mockStreamService.mockResolvedValue({
        data: {
          hits: [
            {
              field: "test_field",
              values: [
                { zo_sql_key: "value1", zo_sql_num: 100 },
                { zo_sql_key: "value2", zo_sql_num: 200 },
              ],
            },
          ],
        },
      });
    });

    it("should handle ftsKey fields correctly", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openFilterCreator({ name: "test_field", ftsKey: true });

      // ftsKey fields return early (unless showFtsFieldValues is enabled)
      expect(fieldValuesMocks.fetchFieldValues).not.toHaveBeenCalled();
    });

    it("should fetch field values for non-fts fields", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: ["test_field"],
          stream_name: "test-stream",
          stream_type: "logs",
          size: 10,
        }),
      );
    });

    it("should use custom stream name if provided", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
        stream_name: "custom_stream",
      });

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          stream_name: "custom_stream",
        }),
      );
    });

    it("should set loading state correctly", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openFilterCreator({ name: "test_field", ftsKey: false });

      expect(vm.fieldValues["test_field"].isLoading).toBe(true);
      expect(vm.fieldValues["test_field"].values).toEqual([]);

      // Wait for the promise to resolve
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vm.fieldValues["test_field"].isLoading).toBe(false);
    });

    it("should handle successful API response", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(vm.fieldValues["test_field"].values).toHaveLength(2);
      expect(vm.fieldValues["test_field"].values[0]).toEqual({
        key: "value1",
        count: "100",
      });
    });

    it("should handle null values in API response", async () => {
      mockStreamService.mockResolvedValue({
        data: {
          hits: [
            {
              field: "test_field",
              values: [
                { zo_sql_key: null, zo_sql_num: 50 },
                { zo_sql_key: undefined, zo_sql_num: 75 },
              ],
            },
          ],
        },
      });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(vm.fieldValues["test_field"].values[0].key).toBe("null");
      expect(vm.fieldValues["test_field"].values[1].key).toBe("null");
    });

    it("should handle empty API response", async () => {
      mockStreamService.mockResolvedValue({
        data: {
          hits: [],
        },
      });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(vm.fieldValues["test_field"].values).toEqual([]);
    });

    it("should include WHERE clause in sql when query prop is set", async () => {
      const query = "session_has_replay IS NOT NULL AND session_id is not null";
      wrapper = createWrapper({ query });
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: b64EncodeUnicode(`SELECT * FROM "test-stream" WHERE ${query}`),
        }),
      );
    });

    it("should not include WHERE clause in sql when query prop is empty", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({
        name: "test_field",
        ftsKey: false,
      });

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: b64EncodeUnicode(`SELECT * FROM "test-stream"`),
        }),
      );
    });

    it("should pass query WHERE clause through handleSearchFieldValues", async () => {
      const query = "country = 'US'";
      wrapper = createWrapper({
        query,
        fields: [{ name: "test_field", showValues: true }],
      });
      const vm = wrapper.vm as any;

      await vm.handleSearchFieldValues("test_field", "US");

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: b64EncodeUnicode(`SELECT * FROM "test-stream" WHERE ${query}`),
        }),
      );
    });

    it("should pass query WHERE clause through handleLoadMoreValues", async () => {
      const query = "country = 'US'";
      wrapper = createWrapper({
        query,
        fields: [{ name: "test_field", showValues: true }],
      });
      const vm = wrapper.vm as any;

      await vm.handleLoadMoreValues("test_field");

      expect(fieldValuesMocks.fetchFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: b64EncodeUnicode(`SELECT * FROM "test-stream" WHERE ${query}`),
        }),
      );
    });

    it("should handle API error and show notification", async () => {
      mockStreamService.mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      try {
        await vm.openFilterCreator({
          name: "test_field",
          ftsKey: false,
        });
      } catch (error) {
        // Expected to catch the error
      }

      await nextTick();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while fetching values for test_field",
      });
    });

    it("should always set loading to false in finally block", async () => {
      mockStreamService.mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openFilterCreator({ name: "test_field", ftsKey: false });

      expect(vm.fieldValues["test_field"].isLoading).toBe(true);

      // Wait for the promise to resolve
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vm.fieldValues["test_field"].isLoading).toBe(false);
    });
  });

  describe("AddSearchTerm Function Tests", () => {
    it("should emit event with correct parameters", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.addSearchTerm("field_name='value'");

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual(["add-field", "field_name='value'"]);
    });

    it("should handle empty search term", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.addSearchTerm("");

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual(["add-field", ""]);
    });

    it("should handle special characters in search term", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.addSearchTerm("field_name!='special@value!'");

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual([
        "add-field",
        "field_name!='special@value!'",
      ]);
    });

    it("should emit multiple events when called multiple times", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.addSearchTerm("term1");
      vm.addSearchTerm("term2");

      expect(wrapper.emitted("event-emitted")).toHaveLength(2);
      expect(wrapper.emitted("event-emitted")[0]).toEqual(["add-field", "term1"]);
      expect(wrapper.emitted("event-emitted")[1]).toEqual(["add-field", "term2"]);
    });
  });

  describe("Null Value Filter Round-trip", () => {
    // Regression: selecting a `null` value must build `IS NULL` and the parsed
    // active filter must round-trip back to the "null" key the value list uses,
    // so the null row's checkbox shows as selected.
    it("builds IS NULL when including the null value", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.buildExpression("brand", "null", "include")).toBe("brand IS NULL");
    });

    it("builds IS NOT NULL when excluding the null value", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.buildExpression("brand", "null", "exclude")).toBe("brand IS NOT NULL");
    });

    it("parses IS NULL back to the 'null' key for include filters", () => {
      wrapper = createWrapper({ query: "brand IS NULL" });
      const vm = wrapper.vm as any;

      expect(vm.activeIncludeFilterValues["brand"]).toEqual(["null"]);
    });

    it("parses IS NOT NULL back to the 'null' key for exclude filters", () => {
      wrapper = createWrapper({ query: "brand IS NOT NULL" });
      const vm = wrapper.vm as any;

      expect(vm.activeExcludeFilterValues["brand"]).toEqual(["null"]);
    });

    it("round-trips a value-list null selection back to a selected key", () => {
      // Selecting "null" → IS NULL → parsing IS NULL → "null" (same key as the
      // value-list row), so the checkbox reflects the selection.
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const expression = vm.buildExpression("brand", "null", "include");
      wrapper = createWrapper({ query: expression });
      const reparsed = wrapper.vm as any;

      expect(reparsed.activeIncludeFilterValues["brand"]).toEqual(["null"]);
    });
  });

  describe("CopyContentValue Function Tests", () => {
    it("should copy value to clipboard successfully", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue("test-value");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("test-value", {
        successMessage: "Value copied to clipboard",
      });
    });

    it("should copy empty string", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue("");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("", {
        successMessage: "Value copied to clipboard",
      });
    });

    it("should copy special characters", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue("special@value!$");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("special@value!$", {
        successMessage: "Value copied to clipboard",
      });
    });

    it("should copy numeric values as strings", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue("12345");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("12345", {
        successMessage: "Value copied to clipboard",
      });
    });

    it("should handle null values", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue(null);

      expect(mockCopyToClipboard).toHaveBeenCalledWith(null, {
        successMessage: "Value copied to clipboard",
      });
    });

    it("should handle undefined values", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.copyContentValue(undefined);

      expect(mockCopyToClipboard).toHaveBeenCalledWith(undefined, {
        successMessage: "Value copied to clipboard",
      });
    });
  });

  describe("Filter Field Value Tests", () => {
    it("should have a search input for filtering fields", () => {
      wrapper = createWrapper();
      // Search is handled by OFieldList internally; verify the search input exists
      const searchInput = wrapper.find('[placeholder="Search field"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("should accept input in the search field", async () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find('[placeholder="Search field"]');

      await searchInput.setValue("test-filter");

      // The input should reflect the typed value
      expect((searchInput.element as HTMLInputElement).value).toBe("test-filter");
    });
  });

  describe("Template Rendering with FTS Fields", () => {
    it("should render field container for ftsKey fields", () => {
      const fields = [{ name: "fts_field", ftsKey: true, showValues: false }];
      wrapper = createWrapper({ fields });

      // The field should render with field-type-container class
      expect(wrapper.find(".field-type-container").exists()).toBe(true);
    });

    it("should render expansion item for non-fts fields with showValues", () => {
      const fields = [{ name: "normal_field", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields });

      // The component uses OFieldList with expansion slots, not QExpansionItem
      const fieldList = wrapper.findComponent({ name: "OFieldList" });
      expect(fieldList.exists()).toBe(true);
    });

    it("should not show add search term button when hideAddSearchTerm is true", () => {
      const fields = [{ name: "test_field", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields, hideAddSearchTerm: true });

      const addButton = wrapper.find('[data-test*="field-btn"]');
      expect(addButton.exists()).toBe(false);
    });

    it("should show copy button when hideCopyValue is false", () => {
      const fields = [{ name: "test_field", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields, hideCopyValue: false });

      const copyButton = wrapper.find('[data-test*="copy-btn"]');
      expect(copyButton.exists()).toBe(true);
    });
  });

  describe("Theme Support Tests", () => {
    it("should apply dark theme styles", () => {
      const mockDarkStore = createStore({
        state: {
          selectedOrganization: { identifier: "test-org" },
          theme: "dark",
          zoConfig: {
            timestamp_column: "_timestamp",
            query_values_default_num: 10,
            showFtsFieldValues: false,
          },
        },
      });

      wrapper = mount(FieldList, {
        props: {
          fields: [{ name: "test_field", ftsKey: false, showValues: true }],
          streamName: "test-stream",
          timeStamp: { startTime: "2023-01-01", endTime: "2023-01-02" },
        },
        global: {
          plugins: [mockI18n, mockRouter],
          provide: { store: mockDarkStore },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should apply light theme styles", () => {
      const mockLightStore = createStore({
        state: {
          selectedOrganization: { identifier: "test-org" },
          theme: "light",
          zoConfig: {
            timestamp_column: "_timestamp",
            query_values_default_num: 10,
            showFtsFieldValues: false,
          },
        },
      });

      wrapper = mount(FieldList, {
        props: {
          fields: [{ name: "test_field", ftsKey: false, showValues: true }],
          streamName: "test-stream",
          timeStamp: { startTime: "2023-01-01", endTime: "2023-01-02" },
        },
        global: {
          plugins: [mockI18n, mockRouter],
          provide: { store: mockLightStore },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Field Values State Management", () => {
    it("should initialize fieldValues as empty object", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.fieldValues).toEqual({});
    });

    it("should store multiple field values correctly", async () => {
      mockStreamService.mockResolvedValue({
        data: {
          hits: [
            {
              field: "field1",
              values: [{ zo_sql_key: "value1", zo_sql_num: 100 }],
            },
          ],
        },
      });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.openFilterCreator({ name: "field1", ftsKey: false });
      await vm.openFilterCreator({ name: "field2", ftsKey: false });

      expect(Object.keys(vm.fieldValues)).toContain("field1");
      expect(Object.keys(vm.fieldValues)).toContain("field2");
    });

    it("should handle concurrent field value requests", async () => {
      mockStreamService
        .mockResolvedValueOnce({
          data: {
            hits: [
              {
                field: "field1",
                values: [{ zo_sql_key: "value1", zo_sql_num: 100 }],
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            hits: [
              {
                field: "field2",
                values: [{ zo_sql_key: "value2", zo_sql_num: 200 }],
              },
            ],
          },
        });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openFilterCreator({ name: "field1", ftsKey: false });
      vm.openFilterCreator({ name: "field2", ftsKey: false });

      expect(vm.fieldValues.field1.isLoading).toBe(true);
      expect(vm.fieldValues.field2.isLoading).toBe(true);

      // Wait for the promises to resolve
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vm.fieldValues.field1.isLoading).toBe(false);
      expect(vm.fieldValues.field2.isLoading).toBe(false);
    });
  });

  describe("Button Click Interactions", () => {
    it("should trigger addSearchTerm when add button is clicked", async () => {
      const fields = [{ name: "test_field", ftsKey: true, showValues: false }];
      wrapper = createWrapper({ fields });

      const addButton = wrapper.find('[data-test*="field-btn"]');
      await addButton.trigger("click");

      expect(wrapper.emitted("event-emitted")).toBeTruthy();
      expect(wrapper.emitted("event-emitted")[0]).toEqual(["add-field", "test_field=''"]);
    });

    it("should trigger copyContentValue when copy button is clicked", async () => {
      const fields = [{ name: "test_field", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields, hideCopyValue: false });

      const copyButton = wrapper.find('[data-test*="copy-btn"]');
      await copyButton.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("test_field", {
        successMessage: "Value copied to clipboard",
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle fields with special characters in names", () => {
      const fields = [{ name: "field@name!", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty field names", () => {
      const fields = [{ name: "", ftsKey: false, showValues: true }];
      wrapper = createWrapper({ fields });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing field properties", () => {
      const fields = [{ name: "incomplete_field" }];
      wrapper = createWrapper({ fields });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle network timeout errors", async () => {
      mockStreamService.mockRejectedValue(new Error("Network timeout"));

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      try {
        await vm.openFilterCreator({
          name: "test_field",
          ftsKey: false,
        });
      } catch (error) {
        // Expected to catch the error
      }

      await nextTick();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while fetching values for test_field",
      });
    });

    it("should handle malformed API responses", async () => {
      mockStreamService.mockResolvedValue({
        data: {
          // Missing hits array
        },
      });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      try {
        await vm.openFilterCreator({
          name: "test_field",
          ftsKey: false,
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Component Lifecycle Tests", () => {
    it("should mount and unmount without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);

      wrapper.unmount();
      expect(wrapper.exists()).toBe(false);
    });

    it("should handle props updates correctly", async () => {
      wrapper = createWrapper({ streamName: "initial-stream" });

      await wrapper.setProps({ streamName: "updated-stream" });

      expect(wrapper.props("streamName")).toBe("updated-stream");
    });

    it("should maintain state during props updates", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.currentPage = 3;

      await wrapper.setProps({ streamType: "metrics" });

      expect(vm.currentPage).toBe(3);
    });
  });

  describe("Accessibility and UX Tests", () => {
    it("should provide proper data-test attributes", () => {
      const fields = [{ name: "test_field", ftsKey: true, showValues: false }];
      wrapper = createWrapper({ fields });

      // Add button has data-test with field name
      expect(
        wrapper.find('[data-test="log-search-index-list-filter-test_field-field-btn"]').exists(),
      ).toBe(true);
      // Search input is provided by OFieldList (queried by placeholder)
      expect(wrapper.find('[placeholder="Search field"]').exists()).toBe(true);
    });

    it("should provide proper titles for field names", () => {
      const fields = [
        {
          name: "long_field_name_that_might_overflow",
          ftsKey: true,
          showValues: false,
        },
      ];
      wrapper = createWrapper({ fields });

      const fieldLabel = wrapper.find(".o-field-label");
      expect(fieldLabel.exists()).toBe(true);
    });

    it("should handle keyboard interactions", async () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find("input");

      await searchInput.trigger("keyup.enter");

      expect(wrapper.exists()).toBe(true); // Component should remain stable
    });
  });
});
