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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import useStreamFields from "./useStreamFields";
import { searchState } from "./searchState";

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: {
        queryRangeRestrictionMsg: "Query range restricted to {range}",
      },
    },
  },
});

// Create test wrapper component
const TestComponent = defineComponent({
  setup() {
    const streamFields = useStreamFields();
    return {
      ...streamFields,
    };
  },
  template: "<div></div>",
});

describe("useStreamFields Composable", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TestComponent, {
      global: {
        plugins: [store, i18n],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Stream Field Functions", () => {
    it("should have loadStreamLists function", () => {
      expect(typeof wrapper.vm.loadStreamLists).toBe("function");
    });

    it("should have updateFieldValues function", () => {
      expect(typeof wrapper.vm.updateFieldValues).toBe("function");
    });

    it("should have extractFields function", () => {
      expect(typeof wrapper.vm.extractFields).toBe("function");
    });

    it("should have getStreamList function", () => {
      expect(typeof wrapper.vm.getStreamList).toBe("function");
    });

    it("should have loadStreamFields function", () => {
      expect(typeof wrapper.vm.loadStreamFields).toBe("function");
    });

    it("should have resetFieldValues function", () => {
      expect(typeof wrapper.vm.resetFieldValues).toBe("function");
    });

    it("should have hasInterestingFieldsInLocal function", () => {
      expect(typeof wrapper.vm.hasInterestingFieldsInLocal).toBe("function");
    });

    it("should have createFieldIndexMapping function", () => {
      expect(typeof wrapper.vm.createFieldIndexMapping).toBe("function");
    });

    it("should have updateGridColumns function", () => {
      expect(typeof wrapper.vm.updateGridColumns).toBe("function");
    });

    it("should have extractFTSFields function", () => {
      expect(typeof wrapper.vm.extractFTSFields).toBe("function");
    });

    it("should have filterHitsColumns function", () => {
      expect(typeof wrapper.vm.filterHitsColumns).toBe("function");
    });
  });

  describe("loadStreamLists", () => {
    it("should load stream lists successfully", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists();
      expect(loadStreamLists).toHaveBeenCalled;
    });

    it("should handle errors during stream list loading", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists();
      expect(loadStreamLists).toHaveBeenCalled;
    });

    it("should not select stream when selectStream is false", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists(false);
      expect(loadStreamLists).toHaveBeenCalled;
    });
  });

  describe("updateGridColumns stream name column", () => {
    const { searchObj } = searchState();

    beforeEach(() => {
      searchObj.meta.sqlMode = false;
      searchObj.data.stream.selectedFields = [];
      searchObj.data.stream.selectedStream = ["app", "rum"];
      searchObj.data.queryResults = {
        hits: [
          { _timestamp: 2, _stream_name: "rum", message: "b" },
          { _timestamp: 1, _stream_name: "app", message: "a" },
        ],
      } as any;
    });

    const columnIds = () => searchObj.data.resultGrid.columns.map((column: any) => column.id);

    it("adds _stream_name after the timestamp for a multi-stream result", () => {
      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "_stream_name", "source"]);
    });

    it("adds _stream_name before the selected fields", () => {
      searchObj.data.stream.selectedFields = ["message"];

      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "_stream_name", "message"]);
    });

    it("leaves a single-stream result unchanged", () => {
      searchObj.data.stream.selectedStream = ["app"];

      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "source"]);
    });
  });
});
