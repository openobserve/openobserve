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
import FrustrationBadge from "./FrustrationBadge.vue";

describe("FrustrationBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("count = 0 renders the none placeholder", () => {
    it("shows the em-dash placeholder when count is 0", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 0 } });

      // Act — nothing, static render

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-none"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-badge-none"]').text()).toBe("—");
    });

    it("does not render a severity badge when count is 0", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 0 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(false);
    });
  });

  describe("low severity (count 1–3)", () => {
    it("shows a low-severity badge for count 1", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 1 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("1");
    });

    it("shows a low-severity badge for count 3 (boundary)", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 3 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("3");
    });

    it("has singular tooltip text for count 1", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 1 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-low"]').attributes("title")).toBe(
        "1 frustration signal detected"
      );
    });
  });

  describe("medium severity (count 4–7)", () => {
    it("shows a medium-severity badge for count 5", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 5 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("5");
    });

    it("shows a medium-severity badge for count 4 (lower boundary)", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 4 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);
    });

    it("shows a medium-severity badge for count 7 (upper boundary)", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 7 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);
    });

    it("has correct plural tooltip with medium severity label", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 5 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-medium"]').attributes("title")).toBe(
        "5 frustration signals (Medium severity)"
      );
    });
  });

  describe("high severity (count 8+)", () => {
    it("shows a high-severity badge for count 8 (boundary)", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 8 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
    });

    it("shows a high-severity badge for count 12", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 12 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("12");
    });

    it("has correct tooltip with high severity warning for count 10", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 10 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-high"]').attributes("title")).toBe(
        "10 frustration signals (High severity - requires attention)"
      );
    });
  });

  describe("container data-test attribute", () => {
    it("always renders the container element", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 5 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-container"]').exists()).toBe(true);
    });
  });

  describe("tooltip attribute is present on severity badges", () => {
    it("has a title attribute containing frustration signals text", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 5 } });

      // Assert
      const title = wrapper.find('[data-test="frustration-badge-medium"]').attributes("title");
      expect(title).toBeDefined();
      expect(title).toContain("frustration signals");
    });
  });

  describe("reactivity", () => {
    it("updates from low to high severity when count prop changes", async () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 2 } });
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ count: 10 });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(false);
    });

    it("switches from badge to placeholder when count changes to 0", async () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 5 } });
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ count: 0 });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="frustration-badge-none"]').exists()).toBe(true);
    });
  });

  describe("large numbers", () => {
    it("handles count 999 as high severity and displays the number", () => {
      // Arrange
      wrapper = mount(FrustrationBadge, { props: { count: 999 } });

      // Assert
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("999");
    });
  });
});
