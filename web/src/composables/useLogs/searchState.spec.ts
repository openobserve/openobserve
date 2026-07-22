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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { searchState } from "./searchState";

// searchObj is module-level reactive state shared across all composable calls.
// We use a wrapper component so that useStore/useRouter composables have the
// correct Vue app context when searchState() is invoked.
const TestComponent = defineComponent({
  setup() {
    return searchState();
  },
  template: "<div></div>",
});

function mountTestComponent() {
  return mount(TestComponent, {
    global: {
      plugins: [store, router],
    },
  });
}

describe("searchState composable", () => {
  let wrapper: ReturnType<typeof mountTestComponent>;

  beforeEach(() => {
    wrapper = mountTestComponent();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // resetSearchError
  // ---------------------------------------------------------------------------
  describe("resetSearchError", () => {
    it("should clear errorMsg when it has a non-empty value", () => {
      wrapper.vm.searchObj.data.errorMsg = "Something went wrong";

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe("");
    });

    it("should clear errorDetail when it has a non-empty value", () => {
      wrapper.vm.searchObj.data.errorDetail = "Detailed failure info";

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.errorDetail).toBe("");
    });

    it("should clear countErrorMsg when it has a non-empty value", () => {
      wrapper.vm.searchObj.data.countErrorMsg = "Count query failed";

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.countErrorMsg).toBe("");
    });

    it("should reset errorCode to 0 when it has a non-zero value", () => {
      wrapper.vm.searchObj.data.errorCode = 500;

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.errorCode).toBe(0);
    });

    it("should clear all four error fields in a single call", () => {
      wrapper.vm.searchObj.data.errorMsg = "msg";
      wrapper.vm.searchObj.data.errorDetail = "detail";
      wrapper.vm.searchObj.data.countErrorMsg = "count msg";
      wrapper.vm.searchObj.data.errorCode = 404;

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorDetail).toBe("");
      expect(wrapper.vm.searchObj.data.countErrorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorCode).toBe(0);
    });

    it("should be a no-op when all error fields are already at their default values", () => {
      wrapper.vm.searchObj.data.errorMsg = "";
      wrapper.vm.searchObj.data.errorDetail = "";
      wrapper.vm.searchObj.data.countErrorMsg = "";
      wrapper.vm.searchObj.data.errorCode = 0;

      wrapper.vm.resetSearchError();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorDetail).toBe("");
      expect(wrapper.vm.searchObj.data.countErrorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // resetQueryData
  // ---------------------------------------------------------------------------
  describe("resetQueryData", () => {
    it("should clear sortedQueryResults when it contains items", () => {
      wrapper.vm.searchObj.data.sortedQueryResults = [
        { _timestamp: 1 },
        { _timestamp: 2 },
      ];

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.sortedQueryResults).toEqual([]);
    });

    it("should reset resultGrid.currentPage to 1 when on a later page", () => {
      wrapper.vm.searchObj.data.resultGrid.currentPage = 5;

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(1);
    });

    it("should set runQuery to false when it was true", () => {
      wrapper.vm.searchObj.runQuery = true;

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.runQuery).toBe(false);
    });

    it("should clear errorMsg via the delegated resetSearchError call", () => {
      wrapper.vm.searchObj.data.errorMsg = "Query timed out";

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe("");
    });

    it("should clear errorDetail via the delegated resetSearchError call", () => {
      wrapper.vm.searchObj.data.errorDetail = "Backend stack trace";

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.errorDetail).toBe("");
    });

    it("should clear countErrorMsg via the delegated resetSearchError call", () => {
      wrapper.vm.searchObj.data.countErrorMsg = "Count failed";

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.countErrorMsg).toBe("");
    });

    it("should reset errorCode to 0 via the delegated resetSearchError call", () => {
      wrapper.vm.searchObj.data.errorCode = 503;

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.errorCode).toBe(0);
    });

    it("should reset all query and error fields together in a single call", () => {
      wrapper.vm.searchObj.data.sortedQueryResults = [{ _timestamp: 1 }];
      wrapper.vm.searchObj.data.resultGrid.currentPage = 3;
      wrapper.vm.searchObj.runQuery = true;
      wrapper.vm.searchObj.data.errorMsg = "msg";
      wrapper.vm.searchObj.data.errorDetail = "detail";
      wrapper.vm.searchObj.data.countErrorMsg = "count msg";
      wrapper.vm.searchObj.data.errorCode = 400;

      wrapper.vm.resetQueryData();

      expect(wrapper.vm.searchObj.data.sortedQueryResults).toEqual([]);
      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(1);
      expect(wrapper.vm.searchObj.runQuery).toBe(false);
      expect(wrapper.vm.searchObj.data.errorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorDetail).toBe("");
      expect(wrapper.vm.searchObj.data.countErrorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.errorCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // resetHistogramError
  // ---------------------------------------------------------------------------
  describe("resetHistogramError", () => {
    it("should clear histogram.errorMsg when it has a non-empty value", () => {
      wrapper.vm.searchObj.data.histogram.errorMsg = "Histogram fetch failed";

      wrapper.vm.resetHistogramError();

      expect(wrapper.vm.searchObj.data.histogram.errorMsg).toBe("");
    });

    it("should reset histogram.errorCode to 0 when it has a non-zero value", () => {
      wrapper.vm.searchObj.data.histogram.errorCode = 429;

      wrapper.vm.resetHistogramError();

      expect(wrapper.vm.searchObj.data.histogram.errorCode).toBe(0);
    });

    it("should clear histogram.errorDetail when it has a non-empty value", () => {
      wrapper.vm.searchObj.data.histogram.errorDetail =
        "Rate limit exceeded on histogram endpoint";

      wrapper.vm.resetHistogramError();

      expect(wrapper.vm.searchObj.data.histogram.errorDetail).toBe("");
    });

    it("should clear all three histogram error fields in a single call", () => {
      wrapper.vm.searchObj.data.histogram.errorMsg = "err";
      wrapper.vm.searchObj.data.histogram.errorCode = 500;
      wrapper.vm.searchObj.data.histogram.errorDetail = "Server error";

      wrapper.vm.resetHistogramError();

      expect(wrapper.vm.searchObj.data.histogram.errorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.histogram.errorCode).toBe(0);
      expect(wrapper.vm.searchObj.data.histogram.errorDetail).toBe("");
    });

    it("should not affect the search-level error fields", () => {
      wrapper.vm.searchObj.data.errorMsg = "search error";
      wrapper.vm.searchObj.data.errorCode = 503;

      wrapper.vm.resetHistogramError();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe("search error");
      expect(wrapper.vm.searchObj.data.errorCode).toBe(503);
    });
  });

  // ---------------------------------------------------------------------------
  // resetSearchAroundData
  // ---------------------------------------------------------------------------
  describe("resetSearchAroundData", () => {
    it("should reset indexTimestamp to -1 when it has a positive value", () => {
      wrapper.vm.searchObj.data.searchAround.indexTimestamp = 1700000000000;

      wrapper.vm.resetSearchAroundData();

      expect(wrapper.vm.searchObj.data.searchAround.indexTimestamp).toBe(-1);
    });

    it("should reset size to 0 when it has a positive value", () => {
      wrapper.vm.searchObj.data.searchAround.size = 50;

      wrapper.vm.resetSearchAroundData();

      expect(wrapper.vm.searchObj.data.searchAround.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // resetSearchObj
  // ---------------------------------------------------------------------------
  describe("resetSearchObj", () => {
    it("should set errorMsg to the no-stream-found message", () => {
      wrapper.vm.searchObj.data.errorMsg = "";

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.errorMsg).toBe(
        "No stream found in selected organization!",
      );
    });

    it("should clear streamLists when it contains items", () => {
      wrapper.vm.searchObj.data.stream.streamLists = [
        { name: "stream-a" },
        { name: "stream-b" },
      ];

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.stream.streamLists).toEqual([]);
    });

    it("should clear selectedStream when it contains values", () => {
      wrapper.vm.searchObj.data.stream.selectedStream = ["stream-a"];

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
    });

    it("should clear selectedStreamFields when populated", () => {
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [
        { name: "field1" },
      ];

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.stream.selectedStreamFields).toEqual([]);
    });

    it("should clear queryResults when it contains data", () => {
      wrapper.vm.searchObj.data.queryResults = { hits: [{ id: 1 }] };

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.queryResults).toEqual({});
    });

    it("should clear sortedQueryResults when it contains items", () => {
      wrapper.vm.searchObj.data.sortedQueryResults = [{ _timestamp: 1 }];

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.sortedQueryResults).toEqual([]);
    });

    it("should reset histogram to an empty default structure", () => {
      wrapper.vm.searchObj.data.histogram.xData = [1, 2, 3];
      wrapper.vm.searchObj.data.histogram.yData = [10, 20, 30];
      wrapper.vm.searchObj.data.histogram.errorMsg = "old error";

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.histogram.xData).toEqual([]);
      expect(wrapper.vm.searchObj.data.histogram.yData).toEqual([]);
      expect(wrapper.vm.searchObj.data.histogram.errorMsg).toBe("");
      expect(wrapper.vm.searchObj.data.histogram.errorCode).toBe(0);
      expect(wrapper.vm.searchObj.data.histogram.errorDetail).toBe("");
      expect(wrapper.vm.searchObj.data.histogram.breakdownField).toBeNull();
      expect(wrapper.vm.searchObj.data.histogram.breakdownSeries).toBeNull();
    });

    it("should clear tempFunctionContent when it has a value", () => {
      wrapper.vm.searchObj.data.tempFunctionContent = "some function";

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.tempFunctionContent).toBe("");
    });

    it("should clear query when it has a value", () => {
      wrapper.vm.searchObj.data.query = "SELECT * FROM logs";

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.query).toBe("");
    });

    it("should clear editorValue when it has a value", () => {
      wrapper.vm.searchObj.data.editorValue = "editor content";

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.editorValue).toBe("");
    });

    it("should set meta.sqlMode to false when it was true", () => {
      wrapper.vm.searchObj.meta.sqlMode = true;

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
    });

    it("should set runQuery to false when it was true", () => {
      wrapper.vm.searchObj.runQuery = true;

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.runQuery).toBe(false);
    });

    it("should clear savedViews when they contain items", () => {
      wrapper.vm.searchObj.data.savedViews = [{ id: "view-1" }];

      wrapper.vm.resetSearchObj();

      expect(wrapper.vm.searchObj.data.savedViews).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // resetFunctions
  // ---------------------------------------------------------------------------
  describe("resetFunctions", () => {
    it("should clear data.transforms when it contains items", () => {
      wrapper.vm.searchObj.data.transforms = [{ name: "fn1" }];

      wrapper.vm.resetFunctions();

      expect(wrapper.vm.searchObj.data.transforms).toEqual([]);
    });

    it("should clear stream.functions when it contains items", () => {
      wrapper.vm.searchObj.data.stream.functions = [{ name: "streamFn" }];

      wrapper.vm.resetFunctions();

      expect(wrapper.vm.searchObj.data.stream.functions).toEqual([]);
    });

    it("should not affect other stream data when called", () => {
      wrapper.vm.searchObj.data.stream.selectedStream = ["stream-x"];
      wrapper.vm.searchObj.data.stream.functions = [{ name: "fn" }];

      wrapper.vm.resetFunctions();

      expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([
        "stream-x",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // resetStreamData
  // ---------------------------------------------------------------------------
  describe("resetStreamData", () => {
    it("should clear selectedStream when it contains values", () => {
      wrapper.vm.searchObj.data.stream.selectedStream = ["stream-a"];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
    });

    it("should clear selectedStreamFields when populated", () => {
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [
        { name: "field1" },
      ];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.selectedStreamFields).toEqual([]);
    });

    it("should clear selectedFields when populated", () => {
      wrapper.vm.searchObj.data.stream.selectedFields = ["ts", "level"];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.selectedFields).toEqual([]);
    });

    it("should reset filterField to empty string", () => {
      wrapper.vm.searchObj.data.stream.filterField = "level";

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.filterField).toBe("");
    });

    it("should reset addToFilter to empty string", () => {
      wrapper.vm.searchObj.data.stream.addToFilter = "level=info";

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
    });

    it("should clear stream functions when populated", () => {
      wrapper.vm.searchObj.data.stream.functions = [{ name: "fn" }];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.functions).toEqual([]);
    });

    it("should default streamType to logs when no query param is present", () => {
      // router has no stream_type query param by default
      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.streamType).toBe("logs");
    });

    it("should clear streamLists when it contains items", () => {
      wrapper.vm.searchObj.data.stream.streamLists = [{ name: "s1" }];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.stream.streamLists).toEqual([]);
    });

    it("should reset sortedQueryResults via delegated resetQueryData call", () => {
      wrapper.vm.searchObj.data.sortedQueryResults = [{ _timestamp: 1 }];

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.sortedQueryResults).toEqual([]);
    });

    it("should reset resultGrid.currentPage to 1 via delegated resetQueryData call", () => {
      wrapper.vm.searchObj.data.resultGrid.currentPage = 7;

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(1);
    });

    it("should reset indexTimestamp to -1 via delegated resetSearchAroundData call", () => {
      wrapper.vm.searchObj.data.searchAround.indexTimestamp = 1700000000000;

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.searchAround.indexTimestamp).toBe(-1);
    });

    it("should reset searchAround.size to 0 via delegated resetSearchAroundData call", () => {
      wrapper.vm.searchObj.data.searchAround.size = 100;

      wrapper.vm.resetStreamData();

      expect(wrapper.vm.searchObj.data.searchAround.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // initialLogsState
  // ---------------------------------------------------------------------------
  describe("initialLogsState", () => {
    it("should return undefined when store.state.logs.isInitialized is false", async () => {
      // The test store helper has no logs module, so store.state.logs is undefined.
      // The guard `!store.state.logs.isInitialized` would throw; patch it safely.
      // Access via the vm so we use the correct store instance.
      const originalLogs = (wrapper.vm.store.state as any).logs;
      (wrapper.vm.store.state as any).logs = { isInitialized: false };

      const result = await wrapper.vm.initialLogsState();

      expect(result).toBeUndefined();

      // Restore
      (wrapper.vm.store.state as any).logs = originalLogs;
    });

    it("should return true even when the store getter throws an error", async () => {
      // Simulate isInitialized = true but getLogs getter absent (throws),
      // so the catch branch executes and resolves to true via finally.
      (wrapper.vm.store.state as any).logs = { isInitialized: true };

      const result = await wrapper.vm.initialLogsState();

      expect(result).toBe(true);

      (wrapper.vm.store.state as any).logs = undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // Reactive state accessors
  // ---------------------------------------------------------------------------
  describe("schemaRequestToken", () => {
    it("should expose schemaRequestToken with an initial value of 0", () => {
      expect(wrapper.vm.schemaRequestToken).toBe(0);
    });

    it("should reflect updates to schemaRequestToken", async () => {
      wrapper.vm.schemaRequestToken++;
      await nextTick();

      expect(wrapper.vm.schemaRequestToken).toBeGreaterThanOrEqual(1);

      // restore
      wrapper.vm.schemaRequestToken = 0;
    });
  });

  describe("streamSchemaFieldsIndexMapping", () => {
    it("should expose streamSchemaFieldsIndexMapping as an empty object by default", () => {
      expect(wrapper.vm.streamSchemaFieldsIndexMapping).toEqual({});
    });
  });

  describe("histogramResults", () => {
    it("should expose histogramResults as an empty array by default", () => {
      expect(wrapper.vm.histogramResults).toEqual([]);
    });
  });

  describe("histogramMappedData", () => {
    it("should expose histogramMappedData as an array", () => {
      expect(Array.isArray(wrapper.vm.histogramMappedData)).toBe(true);
    });
  });

  describe("searchPartitionMap", () => {
    it("should expose searchPartitionMap as an empty object by default", () => {
      expect(wrapper.vm.searchPartitionMap).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // initialQueryPayload
  // ---------------------------------------------------------------------------
  describe("initialQueryPayload", () => {
    it("should expose initialQueryPayload as null by default", () => {
      expect(wrapper.vm.initialQueryPayload).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // fieldValues and notificationMsg
  // ---------------------------------------------------------------------------
  describe("fieldValues", () => {
    it("should expose fieldValues as undefined by default", () => {
      expect(wrapper.vm.fieldValues).toBeUndefined();
    });
  });

  describe("notificationMsg", () => {
    it("should expose notificationMsg as an empty string by default", () => {
      expect(wrapper.vm.notificationMsg).toBe("");
    });
  });

  describe("ftsFields", () => {
    it("should expose ftsFields as an empty array by default", () => {
      expect(wrapper.vm.ftsFields).toEqual([]);
    });
  });
});
