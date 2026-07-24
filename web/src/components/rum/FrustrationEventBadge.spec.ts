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
import FrustrationEventBadge from "./FrustrationEventBadge.vue";

describe("FrustrationEventBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("wrapper element", () => {
    it("renders the wrapper element", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["rage_click"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-wrapper"]').exists()).toBe(true);
    });

    it("renders no badges for an empty array", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: [] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-wrapper"]').exists()).toBe(true);
      expect(
        wrapper
          .findAll('[data-test^="frustration-event-badge-"]')
          .filter((el) => el.attributes("data-test") !== "frustration-event-badge-wrapper"),
      ).toHaveLength(0);
    });
  });

  describe("known frustration type labels", () => {
    it("shows Rage Click text for rage_click type", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["rage_click"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Rage Click");
    });

    it("shows Dead Click text for dead_click type", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["dead_click"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Dead Click");
    });

    it("shows Error Click text for error_click type", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["error_click"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-error_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Error Click");
    });

    it("shows Rage Tap text for rage_tap type", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["rage_tap"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_tap"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Rage Tap");
    });

    it("shows Error Tap text for error_tap type", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["error_tap"] } });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-error_tap"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Error Tap");
    });
  });

  describe("tooltip title attributes", () => {
    it("has a title attribute on the rage_click badge", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["rage_click"] } });

      // Assert
      const badge = wrapper.find('[data-test="frustration-event-badge-rage_click"]');
      expect(badge.attributes("title")).toBeDefined();
    });

    it("has a title attribute on the dead_click badge", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["dead_click"] } });

      // Assert
      expect(
        wrapper.find('[data-test="frustration-event-badge-dead_click"]').attributes("title"),
      ).toBeDefined();
    });

    it("has a title attribute on the error_click badge", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["error_click"] } });

      // Assert
      expect(
        wrapper.find('[data-test="frustration-event-badge-error_click"]').attributes("title"),
      ).toBeDefined();
    });
  });

  describe("multiple frustration types", () => {
    it("renders two badges for two frustration types", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, {
        props: { frustrationTypes: ["rage_click", "dead_click"] },
      });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
    });

    it("renders three badges for three frustration types", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, {
        props: { frustrationTypes: ["rage_click", "dead_click", "error_click"] },
      });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-error_click"]').exists()).toBe(true);
    });
  });

  describe("unknown frustration type", () => {
    it("renders a badge for unknown types (label humanised by the badge registry)", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["unknown_type"] } });

      expect(wrapper.find('[data-test="frustration-event-badge-unknown_type"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).toContain("Unknown Type");
    });

    it("has a title attribute for unknown type using fallback text", () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["unknown_type"] } });

      // Assert
      const badge = wrapper.find('[data-test="frustration-event-badge-unknown_type"]');
      expect(badge.attributes("title")).toContain("unknown_type");
    });
  });

  describe("reactivity", () => {
    it("adds a badge when frustrationTypes prop grows", async () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, { props: { frustrationTypes: ["rage_click"] } });
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(false);

      // Act
      await wrapper.setProps({ frustrationTypes: ["rage_click", "dead_click"] });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
    });

    it("removes all badges when frustrationTypes becomes empty", async () => {
      // Arrange
      wrapper = mount(FrustrationEventBadge, {
        props: { frustrationTypes: ["rage_click", "dead_click"] },
      });
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ frustrationTypes: [] });

      // Assert
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(false);
    });
  });
});
