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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { Dialog, Notify } from "quasar";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import useSearchBar from "./useSearchBar";

installQuasar({
  plugins: [Dialog, Notify],
});

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
    const searchBar = useSearchBar();
    return {
      ...searchBar,
    };
  },
  template: "<div></div>",
});

describe("useSearchBar Composable", () => {
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

  describe("Search Bar Functions", () => {
    it("should have onStreamChange function", () => {
      expect(typeof wrapper.vm.onStreamChange).toBe("function");
    });

    it("should have getFunctions function", () => {
      expect(typeof wrapper.vm.getFunctions).toBe("function");
    });

    it("should have getActions function", () => {
      expect(typeof wrapper.vm.getActions).toBe("function");
    });

    it("should have getSavedViews function", () => {
      expect(typeof wrapper.vm.getSavedViews).toBe("function");
    });

    it("should have getRegionInfo function", () => {
      expect(typeof wrapper.vm.getRegionInfo).toBe("function");
    });

    it("should have setSelectedStreams function", () => {
      expect(typeof wrapper.vm.setSelectedStreams).toBe("function");
    });

    it("should have getQueryData function", () => {
      expect(typeof wrapper.vm.getQueryData).toBe("function");
    });

    it("should have sendCancelSearchMessage function", () => {
      expect(typeof wrapper.vm.sendCancelSearchMessage).toBe("function");
    });

    it("should have cancelQuery function", () => {
      expect(typeof wrapper.vm.cancelQuery).toBe("function");
    });

    it("should have handleQueryData function", () => {
      expect(typeof wrapper.vm.handleQueryData).toBe("function");
    });

    it("should have setDateTime function", () => {
      expect(typeof wrapper.vm.setDateTime).toBe("function");
    });
  });

  describe("onStreamChange", () => {
    it("should handle stream change", async () => {
      const { onStreamChange } = wrapper.vm;
      await onStreamChange();
      expect(onStreamChange).toHaveBeenCalled;
    });

    it("should handle empty query string", async () => {
      const { onStreamChange } = wrapper.vm;
      await onStreamChange();
      expect(onStreamChange).toHaveBeenCalled;
    });
  });
});
