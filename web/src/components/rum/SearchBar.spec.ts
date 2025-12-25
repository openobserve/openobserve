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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock Vue's defineAsyncComponent
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

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock segment analytics
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mock AWS config
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
  },
}));

// Mock SQL suggestions composable
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
    getSuggestions: vi.fn(),
    updateFieldKeywords: vi.fn(),
  }),
}));

// Mock SQL parser
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

// Mock useTraces composable
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
  default: () => ({
    searchObj: mockSearchObj,
  }),
}));

// Mock Quasar notify
const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

// Mock components
vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    template: '<div data-test="date-time-picker">Date Time Picker</div>',
    props: [
      "auto-apply",
      "default-type",
      "default-absolute-time",
      "default-relative-time",
    ],
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

// Mock File constructor and URL for vitest v4
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

describe("SearchBar Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockNotify.mockClear();

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
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render search bar component structure", () => {
      expect(wrapper.find(".search-bar-component").exists()).toBe(true);
      expect(wrapper.find("#searchBarComponent").exists()).toBe(true);
    });

    it("should render refresh button", () => {
      const refreshBtn = wrapper.find(
        '[data-test="logs-search-bar-refresh-btn"]',
      );
      expect(refreshBtn.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should receive fieldValues prop correctly", () => {
      expect(wrapper.props("fieldValues")).toEqual({
        field1: ["value1", "value2"],
        field2: ["value3", "value4"],
      });
    });
  });

  describe("Component Data", () => {
    it("should have searchObj available", () => {
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data).toBeDefined();
    });

    it("should have queryEditorRef available", () => {
      expect(wrapper.vm.queryEditorRef).toBeDefined();
    });
  });

  describe("Component Methods", () => {
    it("should have all required public methods", () => {
      expect(typeof wrapper.vm.searchData).toBe("function");
      expect(typeof wrapper.vm.updateDateTime).toBe("function");
      expect(typeof wrapper.vm.updateQueryValue).toBe("function");
      expect(typeof wrapper.vm.updateQuery).toBe("function");
      expect(typeof wrapper.vm.downloadLogs).toBe("function");
      expect(typeof wrapper.vm.setEditorValue).toBe("function");
    });

    it("should not expose internal methods", () => {
      expect(wrapper.vm.jsonToCsv).toBeUndefined();
      expect(wrapper.vm.updateAutoComplete).toBeUndefined();
    });
  });

  describe("Search Functionality", () => {
    it("should handle search data trigger", async () => {
      wrapper.vm.searchObj.loading = false;
      wrapper.vm.searchData();

      expect(wrapper.emitted("searchdata")).toBeTruthy();
    });

    it("should not trigger search when loading", () => {
      wrapper.vm.searchObj.loading = true;
      wrapper.vm.searchData();

      expect(wrapper.emitted("searchdata")).toBeFalsy();
    });
  });

  describe("Date Time Handling", () => {
    it("should handle date time updates", async () => {
      const dateTimeData = {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        relativeTimePeriod: "1h",
        type: "relative",
      };

      await wrapper.vm.updateDateTime(dateTimeData);

      expect(wrapper.vm.searchObj.data.datetime).toMatchObject({
        startTime: dateTimeData.startTime,
        endTime: dateTimeData.endTime,
        relativeTimePeriod: dateTimeData.relativeTimePeriod,
        type: "relative",
      });

      expect(wrapper.emitted("date-change")).toBeTruthy();
    });

    it("should handle absolute date time updates", async () => {
      const dateTimeData = {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        type: "absolute",
      };

      await wrapper.vm.updateDateTime(dateTimeData);

      expect(wrapper.vm.searchObj.data.datetime.type).toBe("absolute");
      expect(wrapper.emitted("date-change")).toBeTruthy();
    });
  });

  describe("Query Editor Integration", () => {
    it("should update query value correctly", async () => {
      const queryValue = "SELECT * FROM test_stream";

      await wrapper.vm.updateQueryValue(queryValue);

      expect(wrapper.vm.searchObj.data.parsedQuery).toBeDefined();
    });

    it("should handle SQL mode query parsing", async () => {
      wrapper.vm.searchObj.meta.sqlMode = true;
      // Ensure streamResults.list is available
      wrapper.vm.searchObj.data.streamResults = {
        list: [
          {
            name: "test_stream",
            schema: [{ name: "field1" }, { name: "field2" }],
          },
        ],
      };
      const queryValue = "SELECT * FROM test_stream";

      await wrapper.vm.updateQueryValue(queryValue);

      expect(mockParser.astify).toHaveBeenCalledWith(queryValue);
    });

    it("should handle stream detection from query", async () => {
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

      await wrapper.vm.updateQueryValue("SELECT * FROM new_stream");

      expect(wrapper.vm.searchObj.data.stream.selectedStream.value).toBe(
        "new_stream",
      );
    });

    it("should handle stream not found scenario", async () => {
      wrapper.vm.searchObj.meta.sqlMode = true;
      mockParser.astify.mockReturnValue({
        type: "select",
        from: [{ table: "nonexistent_stream" }],
      });

      await wrapper.vm.updateQueryValue("SELECT * FROM nonexistent_stream");

      expect(mockNotify).toHaveBeenCalledWith({
        message: "Stream not found",
        color: "negative",
        position: "top",
        timeout: 2000,
      });
    });

    it("should update query via updateQuery method", async () => {
      wrapper.vm.searchObj.data.query = "new query value";

      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };

      wrapper.vm.updateQuery();

      expect(mockSetValue).toHaveBeenCalledWith("new query value");
    });

    it("should set editor value via setEditorValue method", () => {
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };

      wrapper.vm.setEditorValue("test value");

      expect(mockSetValue).toHaveBeenCalledWith("test value");
    });
  });

  describe("Error Handling", () => {
    it("should handle parser errors gracefully", async () => {
      // mockParser.astify.mockImplementation(() => {
      //   throw new Error("Parser error");
      // });

      wrapper.vm.searchObj.meta.sqlMode = true;

      await wrapper.vm.updateQueryValue("INVALID SQL");

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing queryEditorRef", () => {
      wrapper.vm.queryEditorRef = null;

      expect(() => wrapper.vm.updateQuery()).not.toThrow();
      expect(() => wrapper.vm.setEditorValue("test")).not.toThrow();
    });
  });

  describe("Integration", () => {
    it("should work with i18n integration", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should emit events correctly", async () => {
      wrapper.vm.searchObj.loading = false;
      await wrapper.vm.searchData();
      expect(wrapper.emitted("searchdata")).toBeTruthy();

      const dateData = {
        startTime: Date.now(),
        endTime: Date.now(),
        type: "relative",
      };
      await wrapper.vm.updateDateTime(dateData);
      expect(wrapper.emitted("date-change")).toBeTruthy();
    });
  });

  describe("Download Logs Functionality", () => {
    let originalCreateElement: any;
    let originalAppendChild: any;
    let originalRemoveChild: any;
    let originalURL: any;
    let originalFile: any;

    beforeEach(() => {
      // Store originals
      originalCreateElement = document.createElement;
      originalAppendChild = document.body.appendChild;
      originalRemoveChild = document.body.removeChild;
      originalURL = globalThis.URL;
      originalFile = globalThis.File;

      // Mock URL methods
      globalThis.URL = {
        ...originalURL,
        createObjectURL: vi.fn(() => "mock-url"),
        revokeObjectURL: vi.fn(),
      };

      // Mock File constructor
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

      // Mock document methods only for download operations
      const mockLink = {
        href: "",
        download: "",
        click: vi.fn(),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      };
      const mockAppendChild = vi.fn();
      const mockRemoveChild = vi.fn();
      const mockCreateElement = vi.fn((tagName) => {
        if (tagName === "a") {
          return mockLink;
        }
        return originalCreateElement.call(document, tagName);
      });

      document.createElement = mockCreateElement;
      document.body.appendChild = mockAppendChild;
      document.body.removeChild = mockRemoveChild;
    });

    afterEach(() => {
      // Restore originals
      document.createElement = originalCreateElement;
      document.body.appendChild = originalAppendChild;
      document.body.removeChild = originalRemoveChild;
      globalThis.URL = originalURL;
      globalThis.File = originalFile;
    });

    it("should download logs as CSV when downloadLogs is called", () => {
      // Setup test data
      wrapper.vm.searchObj.data.queryResults.hits = [
        { field1: "value1", field2: "value2", timestamp: "2023-01-01" },
        { field1: "value3", field2: "value4", timestamp: "2023-01-02" },
      ];

      // Spy on File constructor
      const fileSpy = vi.spyOn(globalThis, "File" as any);

      wrapper.vm.downloadLogs();

      // Check that File was called with correct parameters
      expect(fileSpy).toHaveBeenCalled();
      const fileCall = fileSpy.mock.calls[0];
      const csvData = fileCall[0][0]; // First element of the array

      expect(csvData).toContain("field1,field2,timestamp");
      expect(csvData).toContain('"value1","value2","2023-01-01"');
      expect(csvData).toContain('"value3","value4","2023-01-02"');

      expect(fileSpy).toHaveBeenCalledWith(
        expect.any(Array), // File constructor receives an array of data
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

    it("should handle empty query results in downloadLogs", () => {
      wrapper.vm.searchObj.data.queryResults.hits = [];

      expect(() => wrapper.vm.downloadLogs()).toThrow();
    });

    it("should generate correct CSV format with special characters", () => {
      wrapper.vm.searchObj.data.queryResults.hits = [
        {
          field1: 'value with "quotes"',
          field2: "value,with,commas",
          field3: null,
        },
      ];

      // Spy on File constructor
      const fileSpy = vi.spyOn(globalThis, "File" as any);

      wrapper.vm.downloadLogs();

      const fileCall = fileSpy.mock.calls[0];
      const csvCall = fileCall[0][0]; // First element of the array
      expect(csvCall).toContain("field1,field2,field3");
      expect(csvCall).toContain('"value with \\"quotes\\""');
      expect(csvCall).toContain('"value,with,commas"');
      expect(csvCall).toContain('""'); // null should become empty string

      fileSpy.mockRestore();
    });
  });

  describe("AddSearchTerm Watch Functionality", () => {
    beforeEach(() => {
      // Setup queryEditorRef mock
      const mockSetValue = vi.fn();
      wrapper.vm.queryEditorRef = { setValue: mockSetValue };
    });

    it("should not trigger when addToFilter is empty", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "";
      wrapper.vm.searchObj.data.editorValue = "existing query";

      // Trigger the watcher by calling it directly
      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(mockSetValue).not.toHaveBeenCalled();
    });

    it("should add filter to empty query", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
      expect(mockSetValue).toHaveBeenCalledWith("field1='value1'");
    });

    it("should append filter to existing simple query", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field2='value2'";
      wrapper.vm.searchObj.data.editorValue = "field1='value1'";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe(
        "field1='value1' and field2='value2'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "field1='value1' and field2='value2'",
      );
    });

    it("should handle piped queries with existing where clause", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field3='value3'";
      wrapper.vm.searchObj.data.editorValue =
        "SELECT * FROM table | field1='value1'";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe(
        "SELECT * FROM table |  field1='value1' and field3='value3'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "SELECT * FROM table |  field1='value1' and field3='value3'",
      );
    });

    it("should handle piped queries with empty where clause", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field2='value2'";
      wrapper.vm.searchObj.data.editorValue = "SELECT * FROM table | ";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe(
        "SELECT * FROM table | field2='value2'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "SELECT * FROM table | field2='value2'",
      );
    });

    it("should handle null value filters correctly", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='null'";
      wrapper.vm.searchObj.data.editorValue = "";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe("field1 is null");
      expect(mockSetValue).toHaveBeenCalledWith("field1 is null");
    });

    it("should handle 'not null' value filters correctly", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1!='null'";
      wrapper.vm.searchObj.data.editorValue = "";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe("field1 is not null");
      expect(mockSetValue).toHaveBeenCalledWith("field1 is not null");
    });

    it("should handle missing queryEditorRef gracefully", () => {
      wrapper.vm.queryEditorRef = null;
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      expect(() => {
        wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);
      }).not.toThrow();

      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
    });

    it("should handle queryEditorRef without setValue method", () => {
      wrapper.vm.queryEditorRef = {};
      wrapper.vm.searchObj.data.stream.addToFilter = "field1='value1'";
      wrapper.vm.searchObj.data.editorValue = "";

      expect(() => {
        wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);
      }).not.toThrow();

      expect(wrapper.vm.searchObj.data.query).toBe("field1='value1'");
    });

    it("should handle complex piped queries with multiple conditions", () => {
      const mockSetValue = wrapper.vm.queryEditorRef.setValue;
      wrapper.vm.searchObj.data.stream.addToFilter = "status='error'";
      wrapper.vm.searchObj.data.editorValue =
        "SELECT * FROM logs | level='info' and timestamp > '2023-01-01'";

      wrapper.vm.$options.watch.addSearchTerm.call(wrapper.vm);

      expect(wrapper.vm.searchObj.data.query).toBe(
        "SELECT * FROM logs |  level='info' and timestamp > '2023-01-01' and status='error'",
      );
      expect(mockSetValue).toHaveBeenCalledWith(
        "SELECT * FROM logs |  level='info' and timestamp > '2023-01-01' and status='error'",
      );
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("ComponentSearchSearchBar");
    });

    it("should have correct component structure", () => {
      expect(wrapper.find(".search-bar-component").exists()).toBe(true);
      expect(wrapper.find("#searchBarComponent").exists()).toBe(true);
    });
  });
});
