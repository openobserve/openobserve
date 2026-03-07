// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AdvancedValuesFilter from "./AdvancedValuesFilter.vue";

installQuasar();

const defaultRow = { name: "service_name" };
const defaultFilter = {
  isLoading: false,
  isOpen: false,
  size: 10,
};
const defaultValues = [
  { key: "frontend", count: 42 },
  { key: "backend", count: 18 },
];

const makeWrapper = (propsOverrides = {}) =>
  mount(AdvancedValuesFilter, {
    props: {
      row: defaultRow,
      filter: defaultFilter,
      values: defaultValues,
      selectedValues: [],
      searchKeyword: "",
      ...propsOverrides,
    },
  });

describe("AdvancedValuesFilter", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = makeWrapper();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the field name as the expansion item label", () => {
      expect(wrapper.text()).toContain("service_name");
    });

    it("should render value items when values are provided", async () => {
      // Expand the panel by simulating open
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show");
      await flushPromises();

      const valueItems = wrapper.findAll(".q-item");
      expect(valueItems.length).toBeGreaterThan(0);
    });

    it("should show 'No values found' when values array is empty", () => {
      const emptyWrapper = makeWrapper({ values: [] });
      expect(emptyWrapper.text()).toContain("No values found");
      emptyWrapper.unmount();
    });

    it("should show loading indicator when filter.isLoading is true", () => {
      const loadingWrapper = makeWrapper({
        filter: { ...defaultFilter, isLoading: true },
      });
      const loader = loadingWrapper.findComponent({ name: "QInnerLoading" });
      expect(loader.exists()).toBe(true);
      loadingWrapper.unmount();
    });
  });

  describe("emits", () => {
    it("should emit update:isOpen with true when expanded (before-show)", async () => {
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show");
      const emitted = wrapper.emitted("update:isOpen");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toBe(true);
    });

    it("should emit update:isOpen with false when collapsed (before-hide)", async () => {
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-hide");
      const emitted = wrapper.emitted("update:isOpen");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toBe(false);
    });
  });

  describe("selectedValues sync", () => {
    it("should update internal _selectedValues when selectedValues prop changes", async () => {
      await wrapper.setProps({ selectedValues: ["frontend"] });
      // The internal ref should sync via the watcher
      expect(wrapper.vm._selectedValues).toEqual(["frontend"]);
    });

    it("should not update if selectedValues prop is already in sync", async () => {
      // Set initial selected values
      await wrapper.setProps({ selectedValues: ["backend"] });
      const prevInternal = wrapper.vm._selectedValues;
      // Set same values again
      await wrapper.setProps({ selectedValues: ["backend"] });
      expect(wrapper.vm._selectedValues).toEqual(prevInternal);
    });
  });

  describe("Show more", () => {
    it("should show 'Show more' button when values length equals filter.size", () => {
      const wrapperWithFullValues = makeWrapper({
        filter: { ...defaultFilter, size: 2 },
        values: [
          { key: "val1", count: 1 },
          { key: "val2", count: 2 },
        ],
      });
      expect(wrapperWithFullValues.text()).toContain("Show more");
      wrapperWithFullValues.unmount();
    });

    it("should not show 'Show more' when values length is less than filter.size", () => {
      // defaultFilter.size = 10, defaultValues.length = 2
      expect(wrapper.text()).not.toContain("Show more");
    });
  });
});
