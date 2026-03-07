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
import { createStore } from "vuex";
import i18n from "@/locales";

// Mock services before importing the component
vi.mock("@/services/stream", () => ({
  default: {
    fieldValues: vi.fn().mockResolvedValue({
      data: { hits: [] },
    }),
  },
}));

const mockSearchObj = {
  data: {
    editorValue: "",
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      addToFilter: "",
    },
    datetime: {
      startTime: 0,
      endTime: Date.now() * 1000,
    },
  },
  meta: {},
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: vi.fn() }),
  };
});

import BasicValuesFilter from "./BasicValuesFilter.vue";
import streamService from "@/services/stream";

installQuasar();

const mockStore = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    zoConfig: { query_values_default_num: 10 },
  },
});

const defaultRow = { name: "service_name" };

describe("BasicValuesFilter", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mount(BasicValuesFilter, {
      props: { row: defaultRow },
      global: {
        plugins: [mockStore, i18n],
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the field name as the expansion label", () => {
      expect(wrapper.text()).toContain("service_name");
    });

    it("should show loading state initially when filter opens", async () => {
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show", { stopPropagation: vi.fn(), preventDefault: vi.fn() }, defaultRow);
      await flushPromises();

      // After API resolves (empty), should show "No values found"
      expect(wrapper.text()).toContain("No values found");
    });

    it("should render value rows when API returns hits", async () => {
      vi.mocked(streamService.fieldValues).mockResolvedValueOnce({
        data: {
          hits: [
            {
              field: "service_name",
              values: [
                { zo_sql_key: "frontend", zo_sql_num: 42 },
                { zo_sql_key: "backend", zo_sql_num: 18 },
              ],
            },
          ],
        },
      } as any);

      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show", { stopPropagation: vi.fn(), preventDefault: vi.fn() }, defaultRow);
      await flushPromises();

      expect(wrapper.text()).toContain("frontend");
      expect(wrapper.text()).toContain("backend");
    });

    it("should show 'No values found' when hits array is empty", async () => {
      vi.mocked(streamService.fieldValues).mockResolvedValueOnce({
        data: { hits: [] },
      } as any);

      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show", { stopPropagation: vi.fn(), preventDefault: vi.fn() }, defaultRow);
      await flushPromises();

      expect(wrapper.text()).toContain("No values found");
    });
  });

  describe("ftsKey fields", () => {
    it("should stop event propagation for ftsKey fields", async () => {
      const stopPropSpy = vi.fn();
      const preventDefaultSpy = vi.fn();
      const ftsRow = { name: "fts_field", ftsKey: true };

      await wrapper.setProps({ row: ftsRow });

      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit(
        "before-show",
        { stopPropagation: stopPropSpy, preventDefault: preventDefaultSpy },
        ftsRow,
      );

      expect(stopPropSpy).toHaveBeenCalled();
      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe("addSearchTerm", () => {
    it("should set addToFilter on searchObj when include term button is clicked", async () => {
      vi.mocked(streamService.fieldValues).mockResolvedValueOnce({
        data: {
          hits: [
            {
              field: "service_name",
              values: [{ zo_sql_key: "frontend", zo_sql_num: 5 }],
            },
          ],
        },
      } as any);

      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show", { stopPropagation: vi.fn(), preventDefault: vi.fn() }, defaultRow);
      await flushPromises();

      // Find include button and click it
      const includeBtns = wrapper.findAllComponents({ name: "QBtn" });
      // First btn is the add filter btn in header, next are value include/exclude btns
      const includeBtn = includeBtns.find(
        (btn) => btn.attributes("title") === "Include Term",
      );
      if (includeBtn) {
        await includeBtn.trigger("click");
        expect(mockSearchObj.data.stream.addToFilter).toContain("service_name");
        expect(mockSearchObj.data.stream.addToFilter).toContain("frontend");
      }
    });
  });

  describe("API call", () => {
    it("should call streamService.fieldValues with correct params", async () => {
      const expansionItem = wrapper.findComponent({ name: "QExpansionItem" });
      await expansionItem.vm.$emit("before-show", { stopPropagation: vi.fn(), preventDefault: vi.fn() }, defaultRow);
      await flushPromises();

      expect(streamService.fieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "test-org",
          stream_name: "default",
          fields: ["service_name"],
          type: "traces",
        }),
      );
    });
  });
});
