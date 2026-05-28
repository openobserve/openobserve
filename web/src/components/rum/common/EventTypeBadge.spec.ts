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
import EventTypeBadge from "./EventTypeBadge.vue";

describe("EventTypeBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("text content", () => {
    it("displays the type text for error", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });

      // Assert
      expect(wrapper.text()).toBe("error");
    });

    it("displays the type text for action", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "action" } });

      // Assert
      expect(wrapper.text()).toBe("action");
    });

    it("displays the type text for view", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "view" } });

      // Assert
      expect(wrapper.text()).toBe("view");
    });

    it("displays the type text for resource", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "resource" } });

      // Assert
      expect(wrapper.text()).toBe("resource");
    });

    it("displays the raw type string for unknown types", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "custom" } });

      // Assert
      expect(wrapper.text()).toBe("custom");
    });
  });

  describe("data-test attribute", () => {
    it("applies the data-test attribute when provided", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, {
        props: { type: "error", dataTest: "rum-event-type-badge" },
      });

      // Assert
      expect(wrapper.attributes("data-test")).toBe("rum-event-type-badge");
    });

    it("leaves data-test empty or absent when not provided", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });

      // Assert
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("renders without errors for all known types", () => {
    it("mounts successfully for error type", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts successfully for unknown type", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "unknown-type" } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("mounts successfully for empty string type", () => {
      // Arrange
      wrapper = mount(EventTypeBadge, { props: { type: "" } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });
});
