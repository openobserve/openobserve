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
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { searchState } from "./searchState";

installQuasar();

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
});
