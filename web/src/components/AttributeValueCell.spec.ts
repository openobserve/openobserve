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
import { mount, VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (path: string) => `https://cdn.example.com/${path}`,
}));

import AttributeValueCell from "./AttributeValueCell.vue";

installQuasar();

describe("AttributeValueCell", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("value rendering", () => {
    beforeEach(() => {
      wrapper = mount(AttributeValueCell, {
        props: { field: "status", value: "200" },
      });
    });

    it("should render the value text", () => {
      expect(wrapper.find("span").text()).toBe("200");
    });

    it("should render an empty string when value prop is omitted", () => {
      wrapper.unmount();
      wrapper = mount(AttributeValueCell, {
        props: { field: "status" },
      });
      expect(wrapper.find("span").text()).toBe("");
    });
  });

  describe("without a dropdown slot", () => {
    beforeEach(() => {
      wrapper = mount(AttributeValueCell, {
        props: { field: "status", value: "200" },
      });
    });

    it("should NOT render the dropdown button", () => {
      expect(
        wrapper.find('[data-test="attribute-value-cell-dropdown-btn"]').exists(),
      ).toBe(false);
    });
  });

  describe("with a dropdown slot", () => {
    beforeEach(() => {
      wrapper = mount(AttributeValueCell, {
        props: { field: "service", value: "frontend" },
        slots: {
          dropdown: `<li data-test="slot-item">Filter by service</li>`,
        },
      });
    });

    it("should render the dropdown button", () => {
      expect(
        wrapper.find('[data-test="attribute-value-cell-dropdown-btn"]').exists(),
      ).toBe(true);
    });

    it("should pass field and value as slot props to the dropdown slot", () => {
      wrapper.unmount();

      let capturedField: string | undefined;
      let capturedValue: string | undefined;

      // Stub ODropdown so its content slot renders immediately (not lazily in a teleport).
      // This lets us verify the scoped slot bindings without needing to open the dropdown.
      wrapper = mount(AttributeValueCell, {
        props: { field: "service", value: "frontend" },
        global: {
          stubs: {
            ODropdown: {
              template: `<div><slot name="trigger" /><slot /></div>`,
            },
          },
        },
        slots: {
          dropdown: (slotProps: { field: string; value: string }) => {
            capturedField = slotProps.field;
            capturedValue = slotProps.value;
            return h("li", `${slotProps.field}:${slotProps.value}`);
          },
        },
      });

      expect(capturedField).toBe("service");
      expect(capturedValue).toBe("frontend");
    });
  });
});
