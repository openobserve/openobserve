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

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock Vue's defineAsyncComponent — must be hoisted before importing component
vi.mock("vue", async (importOriginal) => {
  const mod = await importOriginal<typeof import("vue")>();
  return {
    ...mod,
    defineAsyncComponent: vi.fn(() => ({
      name: "AsyncQueryEditor",
      template: '<div data-test="query-editor">Query Editor</div>',
      props: ["query", "keywords", "functions", "editor-id"],
      emits: ["update:query", "run-query"],
      methods: {
        setValue: vi.fn(),
        getCursorIndex: vi.fn().mockReturnValue(0),
        triggerAutoComplete: vi.fn(),
      },
    })),
  };
});

import SearchBar from "@/components/rum/SearchBar.vue";

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false" },
}));

const mockAutoCompleteKeywords = ["SELECT", "FROM", "WHERE"];
const mockAutoCompleteData = {
  value: {
    query: "",
    cursorIndex: 0,
    fieldValues: {},
    popup: { open: false },
  },
};

vi.doMock("@/composables/useSuggestions", () => ({
  default: () => ({
    autoCompleteData: mockAutoCompleteData,
    autoCompleteKeywords: mockAutoCompleteKeywords,
    effectiveKeywords: { value: [] },
    getSuggestions: vi.fn(),
    updateFieldKeywords: vi.fn(),
    updateStreamKeywords: vi.fn(),
  }),
}));

const mockParser = {
  astify: vi.fn().mockReturnValue({
    type: "select",
    from: [{ table: "test_stream" }],
    where: null,
  }),
  sqlify: vi.fn().mockReturnValue("SELECT * FROM test_stream"),
};

vi.doMock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => Promise.resolve(mockParser),
  }),
}));

const mockSearchObj = {
  data: {
    queryResults: {
      hits: [
        { field1: "value1", field2: "value2" },
        { field1: "value3", field2: "value4" },
      ],
    },
    stream: {
      selectedStream: { label: "test_stream", value: "test_stream" },
      selectedStreamFields: [{ name: "field1" }, { name: "field2" }],
      addToFilter: "",
      functions: [],
    },
    streamResults: {
      list: [
        {
          name: "test_stream",
          schema: [{ name: "field1" }, { name: "field2" }],
        },
      ],
    },
    editorValue: "",
    query: "",
    parsedQuery: null,
    datetime: {
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: Date.now() - 900000,
      endTime: Date.now(),
    },
  },
  meta: {
    sqlMode: false,
    showQuery: true,
  },
  loading: false,
  config: {
    refreshTimes: [
      { label: "5 sec", value: 5 },
      { label: "30 sec", value: 30 },
      { label: "1 min", value: 60 },
    ],
  },
};

vi.doMock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

// Use vi.hoisted so mockToast is available in the factory function
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    template: '<div data-test="date-time-picker">Date Time Picker</div>',
    props: ["auto-apply", "default-type", "default-absolute-time", "default-relative-time"],
    emits: ["on:date-change"],
  },
}));

vi.mock("@/plugins/traces/SyntaxGuide.vue", () => ({
  default: {
    name: "SyntaxGuide",
    template: '<div data-test="syntax-guide">Syntax Guide</div>',
    props: ["sqlmode"],
  },
}));

beforeAll(() => {
  (globalThis as any).File = vi.fn(function (
    bits: any[],
    filename: string,
    options?: any,
  ) {
    return {
      name: filename,
      type: options?.type || "",
      size: bits[0]?.length || 0,
    };
  });

  (globalThis as any).URL = {
    createObjectURL: vi.fn(() => "blob:mock-url"),
    revokeObjectURL: vi.fn(),
  };
});

describe("SearchBar", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockToast.mockClear();

    wrapper = mount(SearchBar, {
      props: {
        fieldValues: {
          field1: ["value1", "value2"],
          field2: ["value3", "value4"],
        },
        sqlMode: false,
        disabled: false,
        showQuery: true,
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("mounts successfully without errors", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the search-bar-component container element", () => {
      // Arrange & Assert
      expect(wrapper.find('[id="searchBarComponent"]').exists()).toBe(true);
    });

    it("renders refresh button with correct data-test attribute", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // PROPS HANDLING
  // ==========================================================================

  describe("Props Handling", () => {
    it("receives fieldValues prop with the provided object", () => {
      // Arrange & Assert
      expect(wrapper.props("fieldValues")).toEqual({
        field1: ["value1", "value2"],
        field2: ["value3", "value4"],
      });
    });
  });

  // ==========================================================================
  // COMPONENT DATA (public return API)
  // ==========================================================================

  describe("Component Data", () => {
    it("exposes searchObj with data sub-object via return API", () => {
      // Arrange & Assert
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data).toBeDefined();
    });

    it("exposes queryEditorRef via return API", () => {
      // Arrange & Assert
      expect(wrapper.vm.queryEditorRef).toBeDefined();
    });
  });

  // ==========================================================================
  // COMPONENT METHODS (public return API)
  // ==========================================================================

  describe("Component Methods", () => {
    it("exposes searchData as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.searchData).toBe("function");
    });

    it("exposes updateDateTime as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.updateDateTime).toBe("function");
    });

    it("exposes updateQueryValue as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.updateQueryValue).toBe("function");
    });

    it("exposes updateQuery as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.updateQuery).toBe("function");
    });

    it("exposes downloadLogs as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.downloadLogs).toBe("function");
    });

    it("exposes setEditorValue as a function via return API", () => {
      // Arrange & Assert
      expect(typeof wrapper.vm.setEditorValue).toBe("function");
    });

    it("does not expose jsonToCsv as part of the public API", () => {
      // Arrange & Assert
      expect(wrapper.vm.jsonToCsv).toBeUndefined();
    });

    it("does not expose updateAutoComplete as part of the public API", () => {
      // Arrange & Assert
      expect(wrapper.vm.updateAutoComplete).toBeUndefined();
    });
  });

  // ==========================================================================
  // SEARCH FUNCTIONALITY
  // ==========================================================================

  describe("Search Functionality", () => {
    it("emits searchdata event when searchData is called and loading is false", () => {
      // Arrange
      wrapper.vm.searchObj.loading = false;

      // Act
      wrapper.vm.searchData();

      // Assert
      expect(wrapper.emitted("searchdata")).toBeTruthy();
    });

    it("does not emit searchdata event when searchData is called while loading is true", () => {
      // Arrange
      wrapper.vm.searchObj.loading = true;

      // Act
      wrapper.vm.searchData();

      // Assert
      expect(wrapper.emitted("searchdata")).toBeFalsy();
    });
  });

  // ==========================================================================
  // DATE TIME HANDLING
  // ==========================================================================

  describe("Date Time Handling", () => {
    it("updates datetime in searchObj and emits date-change when updateDateTime is called with relative type", async () => {
      // Arrange
      const dateTimeData = {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        relativeTimePeriod: "1h",
        type: "relative",
      };

      // Act
      await wrapper.vm.updateDateTime(dateTimeData);

      // Assert
      expect(wrapper.vm.searchObj.data.datetime).toMatchObject({
        startTime: dateTimeData.startTime,
        endTime: dateTimeData.endTime,
        relativeTimePeriod: dateTimeData.relativeTimePeriod,
        type: "relative",
      });
      expect(wrapper.emitted("date-change")).toBeTruthy();
    });

    it("sets datetime type to absolute and emits date-change when updateDateTime is called with absolute type", async () => {
      // Arrange
      const dateTimeData = {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        type: "absolute",
      };

      // Act
      await wrapper.vm.updateDateTime(dateTimeData);

      // Assert
      expect(wrapper.vm.searchObj.data.datetime.type).toBe("absolute");
      expect(wrapper.emitted("date-change")).toBeTruthy();
    });
  });

  // ==========================================================================
  // QUERY EDITOR INTEGRATION
  // ==========================================================================

  describe("Query Editor Integration", () => {
    it("sets parsedQuery in searchObj when updateQueryValue is called with a valid query", async () => {
      // Arrange
      const queryValue = "SELECT * FROM test_stream";

      // Act
      await wrapper.vm.updateQueryValue(queryValue);

      // Assert
      expect(wrapper.vm.searchObj.data.parsedQuery).toBeDefined();
    });

    it("calls astify with query value when updateQueryValue is called in SQL mode", async () => {
      // Arrange
      wrapper.vm.searchObj.meta.sqlMode = true;
      wrapper.vm.searchObj.data.streamResults = {
        list: [
          {
            name: "test_stream",
            schema: [{ name: "field1" }, { name: "field2" }],
          },
        ],
      };

      // Act
      await wrapper.vm.updateQueryValue("SELECT * FROM test_stream");

      // Assert
      expect(mockParser.astify).toHaveBeenCalledWith("SELECT * FROM test_stream");
    });

    it("updates selectedStream to new_stream when query references new_stream in SQL mode", async () => {
      // Arrange
      wrapper.vm.searchObj.meta.sqlMode = true;
      mockParser.astify.mockReturnValue({
        type: "select",
        from: [{ table: "new_stream" }],
      });
      wrapper.vm.searchObj.data.streamResults.list = [
        {
          name: "new_stream",
          schema: [{ name: "field1" }, { name: "field2" }],
        },
      ];

      // Act
      await wrapper.vm.updateQueryValue("SELECT * FROM new_stream");

      // Assert
      expect(wrapper.vm.searchObj.data.stream.selectedStream.value).toBe("new_stream");
    });

    it("shows Stream not found toast when query references a non-existent stream in SQL mode", async () => {
      // Arrange
      wrapper.vm.searchObj.meta.sqlMode = true;
      mockParser.astify.mockReturnValue({
        type: "select",
        from: [{ table: "nonexistent_stream" }],
      });

      // Act
      await wrapper.vm.updateQueryValue("SELECT * FROM nonexistent_stream");

      // Assert
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Stream not found" }),
      );
    });

    it("calls setValue on queryEditorRef when updateQuery is called", () => {
      // Arrange
      wrapper.vm.searchObj.data.query = "new query value";
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };

      // Act
      wrapper.vm.updateQuery();

      // Assert
      expect(mockSetValue).toHaveBeenCalledWith("new query value");
    });

    it("calls setValue on queryEditorRef with provided value when setEditorValue is called", () => {
      // Arrange
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };

      // Act
      wrapper.vm.setEditorValue("test value");

      // Assert
      expect(mockSetValue).toHaveBeenCalledWith("test value");
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe("Error Handling", () => {
    it("does not throw when updateQueryValue is called with invalid SQL in SQL mode", async () => {
      // Arrange
      wrapper.vm.searchObj.meta.sqlMode = true;

      // Act & Assert
      expect(() => wrapper.vm.updateQueryValue("INVALID SQL")).not.toThrow();
      expect(wrapper.exists()).toBe(true);
    });

    it("does not throw when updateQuery is called with null queryEditorRef", () => {
      // Arrange
      wrapper.vm.queryEditorRef = null;

      // Assert
      expect(() => wrapper.vm.updateQuery()).not.toThrow();
    });

    it("does not throw when setEditorValue is called with null queryEditorRef", () => {
      // Arrange
      wrapper.vm.queryEditorRef = null;

      // Assert
      expect(() => wrapper.vm.setEditorValue("test")).not.toThrow();
    });
  });

  // ==========================================================================
  // INTEGRATION
  // ==========================================================================

  describe("Integration", () => {
    it("exposes t function for i18n translation via return API", () => {
      // Arrange & Assert
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("emits searchdata and date-change when calling searchData and updateDateTime sequentially", async () => {
      // Arrange
      wrapper.vm.searchObj.loading = false;

      // Act
      await wrapper.vm.searchData();

      const dateData = { startTime: Date.now(), endTime: Date.now(), type: "relative" };
      await wrapper.vm.updateDateTime(dateData);

      // Assert
      expect(wrapper.emitted("searchdata")).toBeTruthy();
      expect(wrapper.emitted("date-change")).toBeTruthy();
    });
  });

  // ==========================================================================
  // DOWNLOAD LOGS FUNCTIONALITY
  // ==========================================================================

  describe("Download Logs Functionality", () => {
    let originalCreateElement: any;
    let originalAppendChild: any;
    let originalRemoveChild: any;
    let originalURL: any;
    let originalFile: any;

    beforeEach(() => {
      originalCreateElement = document.createElement;
      originalAppendChild = document.body.appendChild;
      originalRemoveChild = document.body.removeChild;
      originalURL = globalThis.URL;
      originalFile = globalThis.File;

      globalThis.URL = {
        ...originalURL,
        createObjectURL: vi.fn(() => "mock-url"),
        revokeObjectURL: vi.fn(),
      };

      globalThis.File = class MockFile {
        data: any;
        name: string;
        type: string;
        constructor(data: any, filename: string, options?: any) {
          this.data = data;
          this.name = filename;
          this.type = options?.type || "";
        }
      } as any;

      const mockLink = {
        href: "",
        download: "",
        click: vi.fn(),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      };
      const mockCreateElement = vi.fn((tagName: string) => {
        if (tagName === "a") return mockLink;
        return originalCreateElement.call(document, tagName);
      });

      document.createElement = mockCreateElement;
      document.body.appendChild = vi.fn();
      document.body.removeChild = vi.fn();
    });

    afterEach(() => {
      document.createElement = originalCreateElement;
      document.body.appendChild = originalAppendChild;
      document.body.removeChild = originalRemoveChild;
      globalThis.URL = originalURL;
      globalThis.File = originalFile;
    });

    it("creates a CSV File with correct headers when downloadLogs is called with data", () => {
      // Arrange
      wrapper.vm.searchObj.data.queryResults.hits = [
        { field1: "value1", field2: "value2", timestamp: "2023-01-01" },
        { field1: "value3", field2: "value4", timestamp: "2023-01-02" },
      ];
      const fileSpy = vi.spyOn(globalThis, "File" as any);

      // Act
      wrapper.vm.downloadLogs();

      // Assert
      expect(fileSpy).toHaveBeenCalled();
      const csvData = fileSpy.mock.calls[0][0][0];
      expect(csvData).toContain("field1,field2,timestamp");
      expect(csvData).toContain('"value1","value2","2023-01-01"');
      expect(csvData).toContain('"value3","value4","2023-01-02"');
      expect(fileSpy).toHaveBeenCalledWith(
        expect.any(Array),
        "logs-data.csv",
        { type: "text/csv" },
      );
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith("a");
      expect(document.body.appendChild).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalled();
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("mock-url");

      fileSpy.mockRestore();
    });

    it("throws when downloadLogs is called with empty query results", () => {
      // Arrange
      wrapper.vm.searchObj.data.queryResults.hits = [];

      // Assert
      expect(() => wrapper.vm.downloadLogs()).toThrow();
    });

    it("generates correct CSV format when field values contain special characters", () => {
      // Arrange
      wrapper.vm.searchObj.data.queryResults.hits = [
        {
          field1: 'value with "quotes"',
          field2: "value,with,commas",
          field3: null,
        },
      ];
      const fileSpy = vi.spyOn(globalThis, "File" as any);

      // Act
      wrapper.vm.downloadLogs();

      // Assert
      const csvData = fileSpy.mock.calls[0][0][0];
      expect(csvData).toContain("field1,field2,field3");
      expect(csvData).toContain('"value with \\"quotes\\""');
      expect(csvData).toContain('"value,with,commas"');
      expect(csvData).toContain('""');

      fileSpy.mockRestore();
    });
  });

  // ==========================================================================
  // ADD SEARCH TERM WATCH FUNCTIONALITY
  // ==========================================================================

  describe("AddSearchTerm Watch Functionality", () => {
    beforeEach(() => {
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };
    });

    it("does not call setValue when addToFilter is empty string", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "";
      wrapper.vm.searchObj.data.editorValue = "existing query";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(mockSetValue).not.toHaveBeenCalled();
    });

    it("sets query to the filter value and calls setValue when addToFilter is set and editorValue is empty", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
      expect(mockSetValue).toHaveBeenCalledWith("field1='value1'");
    });

    it("appends filter with AND operator to existing simple query when addToFilter is set", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field2='value2'";
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1' and field2='value2'");
      expect(mockSetValue).toHaveBeenCalledWith("field1='value1' and field2='value2'");
    });

    it("appends filter after pipe separator when editorValue has an existing where clause", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field3='value3'";
      wrapper.vm.searchObj.data.editorValue = "SELECT * FROM table | field1='value1'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe(
        "SELECT * FROM table |  field1='value1' and field3='value3'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "SELECT * FROM table |  field1='value1' and field3='value3'",
      );
    });

    it("appends filter after pipe when editorValue has an empty where clause", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field2='value2'";
      wrapper.vm.searchObj.data.editorValue = "SELECT * FROM table | ";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("SELECT * FROM table | field2='value2'");
      expect(mockSetValue).toHaveBeenCalledWith("SELECT * FROM table | field2='value2'");
    });

    it("converts null value filter to IS NULL syntax when addToFilter contains null value", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='null'";
      wrapper.vm.searchObj.data.editorValue = "";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field1 is null");
      expect(mockSetValue).toHaveBeenCalledWith("field1 is null");
    });

    it("converts not-null value filter to IS NOT NULL syntax when addToFilter has !=null", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1!='null'";
      wrapper.vm.searchObj.data.editorValue = "";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field1 is not null");
      expect(mockSetValue).toHaveBeenCalledWith("field1 is not null");
    });

    it("does not throw when queryEditorRef is null and addToFilter is set", () => {
      // Arrange
      wrapper.vm.queryEditorRef = null;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      // Act & Assert
      expect(() => {
        wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);
      }).not.toThrow();
      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
    });

    it("does not throw when queryEditorRef has no setValue method and addToFilter is set", () => {
      // Arrange
      wrapper.vm.queryEditorRef = {};
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      // Act & Assert
      expect(() => {
        wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);
      }).not.toThrow();
      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
    });

    it("appends filter to complex piped query with multiple existing conditions", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "status='error'";
      wrapper.vm.searchObj.data.editorValue =
        "SELECT * FROM logs | level='info' and timestamp > '2023-01-01'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe(
        "SELECT * FROM logs |  level='info' and timestamp > '2023-01-01' and status='error'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "SELECT * FROM logs |  level='info' and timestamp > '2023-01-01' and status='error'",
      );
    });

    it("replaces existing filter when same field is added again to simple query", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value2'";
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field1='value2'");
      expect(mockSetValue).toHaveBeenCalledWith("field1='value2'");
    });

    it("replaces existing filter for same field in piped query", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value2'";
      wrapper.vm.searchObj.data.editorValue = "SELECT * FROM table | field1='value1'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("SELECT * FROM table |  field1='value2'");
      expect(mockSetValue).toHaveBeenCalledWith("SELECT * FROM table |  field1='value2'");
    });

    it("replaces multi-value group for same field when addToFilter has OR group", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "(field1='valueA' OR field1='valueB')";
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("(field1='valueA' OR field1='valueB')");
      expect(mockSetValue).toHaveBeenCalledWith("(field1='valueA' OR field1='valueB')");
    });
  });

  // ==========================================================================
  // COMPONENT STRUCTURE
  // ==========================================================================

  describe("Component Structure", () => {
    it("has the component name ComponentSearchSearchBar", () => {
      // Arrange & Assert
      expect(wrapper.vm.$options.name).toBe("ComponentSearchSearchBar");
    });
  });

  // ==========================================================================
  // REMOVE FIELD TERM WATCH FUNCTIONALITY
  // ==========================================================================

  describe("RemoveFieldTerm Watch Functionality", () => {
    beforeEach(() => {
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };
    });

    it("does nothing when fieldName is empty string", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.editorValue = "field1='value1' AND field2='value2'";

      // Act — call the watch handler directly with empty fieldName
      wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "");

      // Assert — query unchanged
      expect(mockSetValue).not.toHaveBeenCalled();
    });

    it("removes field condition from a simple query and updates query and editor", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act
      wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "field1");

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("");
      expect(wrapper.vm.searchObj.data.stream.removeFilterField).toBe("");
      expect(mockSetValue).toHaveBeenCalledWith("");
    });

    it("removes only the specified field from a multi-condition simple query", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.editorValue = "field1='value1' AND field2='value2'";

      // Act
      wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "field1");

      // Assert
      expect(wrapper.vm.searchObj.data.query).toBe("field2='value2'");
      expect(mockSetValue).toHaveBeenCalledWith("field2='value2'");
    });

    it("removes field condition from the WHERE part of a piped query", () => {
      // Arrange
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.editorValue = "SELECT * FROM logs | field1='value1' AND field2='value2'";

      // Act
      wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "field1");

      // Assert
      const result = wrapper.vm.searchObj.data.query;
      expect(result).toContain("SELECT * FROM logs");
      expect(result).toContain("field2='value2'");
      expect(result).not.toMatch(/field1/);
      expect(mockSetValue).toHaveBeenCalledWith(result);
    });

    it("does not throw when queryEditorRef is null and fieldName is set", () => {
      // Arrange
      wrapper.vm.queryEditorRef = null;
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act & Assert
      expect(() => {
        wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "field1");
      }).not.toThrow();
      expect(wrapper.vm.searchObj.data.query).toBe("");
    });

    it("clears removeFilterField after removing the field condition", () => {
      // Arrange
      wrapper.vm.searchObj.data.stream.removeFilterField = "field1";
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      // Act
      wrapper.vm.$options.watch.removeFieldTerm.call(wrapper.vm, "field1");

      // Assert
      expect(wrapper.vm.searchObj.data.stream.removeFilterField).toBe("");
    });
  });
});
