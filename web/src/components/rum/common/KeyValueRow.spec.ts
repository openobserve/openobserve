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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import KeyValueRow from "./KeyValueRow.vue";

describe("KeyValueRow", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("label rendering", () => {
    it("displays the label with a colon", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });

      // Assert
      expect(wrapper.text()).toContain("Browser:");
    });

    it("displays string value text", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Browser", value: "Chrome" } });

      // Assert
      expect(wrapper.text()).toContain("Chrome");
    });

    it("displays numeric value text", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Port", value: 8080 } });

      // Assert
      expect(wrapper.text()).toContain("8080");
    });
  });

  describe("data-test attribute", () => {
    it("applies data-test attribute when provided", () => {
      // Arrange
      wrapper = mount(KeyValueRow, {
        props: { label: "Browser", dataTest: "rum-browser-row" },
      });

      // Assert
      expect(wrapper.attributes("data-test")).toBe("rum-browser-row");
    });

    it("leaves data-test empty or absent when not provided", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });

      // Assert
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("slot content", () => {
    it("renders slot content when provided", () => {
      // Arrange
      wrapper = mount(KeyValueRow, {
        props: { label: "Custom" },
        slots: { default: '<span data-test="custom-slot">Custom Content</span>' },
      });

      // Assert
      expect(wrapper.find('[data-test="custom-slot"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Custom Content");
    });

    it("renders the value prop when no slot is provided", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Browser", value: "Firefox" } });

      // Assert
      expect(wrapper.text()).toContain("Firefox");
    });
  });

  describe("default prop values", () => {
    it("renders without crash when only label is provided (value defaults to empty string)", () => {
      // Arrange
      wrapper = mount(KeyValueRow, { props: { label: "Empty" } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("valueClass prop", () => {
    it("includes the valueClass string in the rendered html when provided", () => {
      // Arrange
      wrapper = mount(KeyValueRow, {
        props: { label: "Status", value: "OK", valueClass: "text-green-500" },
      });

      // Assert
      expect(wrapper.html()).toContain("text-green-500");
    });
  });
});
