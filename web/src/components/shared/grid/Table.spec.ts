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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

import Table from "./Table.vue";

installQuasar();

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      ticket: {
        header: "Tickets",
        search: "Search tickets",
        add: "Add Ticket",
      },
    },
  },
});

// q-table stub that renders its top-right slot so we can assert on the slot contents
const qTableStub = {
  template: `
    <div data-test="q-table-stub">
      <slot name="top-right" />
    </div>
  `,
  props: ["title", "rows", "rowKey", "pagination", "filter", "filterMethod"],
};

function mountTable() {
  return mount(Table, {
    global: {
      plugins: [i18n],
      stubs: {
        "q-table": qTableStub,
        "q-input": {
          template:
            '<input :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ["modelValue", "placeholder", "filled", "borderless", "dense"],
          emits: ["update:modelValue"],
        },
        "OIcon": true,
        "q-btn": {
          template:
            "<button :data-test=\"$attrs['data-test']\" @click=\"$emit('click')\">{{ label }}</button>",
          props: ["label", "color", "icon", "class"],
          emits: ["click"],
        },
        "q-td": {
          template: "<td><slot /></td>",
          props: ["props", "width"],
        },
      },
    },
  });
}

describe("Table", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountTable();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the q-table stub", () => {
      expect(wrapper.find('[data-test="q-table-stub"]').exists()).toBe(true);
    });

    it("should render the Add Ticket button in the top-right slot", () => {
      expect(wrapper.text()).toContain("Add Ticket");
    });

    it("should render a search input in the top-right slot", () => {
      expect(wrapper.find("input").exists()).toBe(true);
    });
  });

  describe("initial state", () => {
    it("should initialise tickets as an empty array", () => {
      const vm = wrapper.vm as any;
      expect(vm.tickets).toEqual([]);
    });

    it("should initialise filterQuery as an empty string", () => {
      const vm = wrapper.vm as any;
      expect(vm.filterQuery).toBe("");
    });

    it("should initialise pagination as an empty object", () => {
      const vm = wrapper.vm as any;
      expect(vm.pagination).toEqual({});
    });
  });

  describe("filterData", () => {
    it("should return the rows array unchanged", () => {
      const vm = wrapper.vm as any;
      const rows = [{ id: 1 }, { id: 2 }];
      expect(vm.filterData(rows)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should return an empty array when given an empty array", () => {
      const vm = wrapper.vm as any;
      expect(vm.filterData([])).toEqual([]);
    });

    it("should return rows with the same reference (no transformation)", () => {
      const vm = wrapper.vm as any;
      const rows = [{ id: 3, name: "test" }];
      const result = vm.filterData(rows);
      expect(result).toBe(rows);
    });
  });

  describe("editTicket", () => {
    it("should not throw when called without arguments", () => {
      const vm = wrapper.vm as any;
      expect(() => vm.editTicket()).not.toThrow();
    });

    it("should not throw when called with a props argument", () => {
      const vm = wrapper.vm as any;
      expect(() => vm.editTicket({ row: { id: 1 } })).not.toThrow();
    });
  });

  describe("addTicket", () => {
    it("should not throw when called", () => {
      const vm = wrapper.vm as any;
      expect(() => vm.addTicket()).not.toThrow();
    });
  });

  describe("i18n", () => {
    it("should show the Add Ticket label from i18n", () => {
      expect(wrapper.text()).toContain("Add Ticket");
    });

    it("should set the search input placeholder from i18n", () => {
      const input = wrapper.find("input");
      expect(input.attributes("placeholder")).toBe("Search tickets");
    });
  });
});
