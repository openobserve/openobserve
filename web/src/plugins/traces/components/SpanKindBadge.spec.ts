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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import SpanKindBadge from "./SpanKindBadge.vue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountBadge(kind: string): VueWrapper {
  return mount(SpanKindBadge, {
    props: { kind },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpanKindBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering for each known kind
  // -------------------------------------------------------------------------

  describe("known kinds", () => {
    it('should render the badge with text "C" when kind is "Client"', () => {
      wrapper = mountBadge("Client");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-client"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("C");
    });

    it('should render the badge with text "S" when kind is "Server"', () => {
      wrapper = mountBadge("Server");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-server"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("S");
    });

    it('should render the badge with text "P" when kind is "Producer"', () => {
      wrapper = mountBadge("Producer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-producer"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("P");
    });

    it('should render the badge with text "CO" when kind is "Consumer"', () => {
      wrapper = mountBadge("Consumer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-consumer"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("CO");
    });

    it('should render the badge with text "I" when kind is "Internal"', () => {
      wrapper = mountBadge("Internal");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-internal"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("I");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown / Unspecified kinds — badge must NOT render
  // -------------------------------------------------------------------------

  describe("unknown kinds", () => {
    it('should not render the badge when kind is "Unspecified"', () => {
      wrapper = mountBadge("Unspecified");

      expect(wrapper.find('[data-test="trace-tree-span-kind-badge-unspecified"]').exists()).toBe(
        false,
      );
    });

    it("should not render any badge element when kind is an empty string", () => {
      wrapper = mountBadge("");

      // The root element is a comment node when v-if is false; find any span
      expect(wrapper.find("span").exists()).toBe(false);
    });

    it('should not render the badge when kind is an unrecognised value like "External"', () => {
      wrapper = mountBadge("External");

      expect(wrapper.find('[data-test="trace-tree-span-kind-badge-external"]').exists()).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // CSS modifier class
  // -------------------------------------------------------------------------

  describe("CSS modifier class", () => {
    it('should apply "bg-badge-blue-soft-bg" class when kind is "Client"', () => {
      wrapper = mountBadge("Client");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-client"]');

      expect(badge.classes()).toContain("bg-badge-blue-soft-bg");
    });

    it('should apply "bg-badge-purple-soft-bg" class when kind is "Server"', () => {
      wrapper = mountBadge("Server");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-server"]');

      expect(badge.classes()).toContain("bg-badge-purple-soft-bg");
    });

    it('should apply "bg-badge-teal-soft-bg" class when kind is "Producer"', () => {
      wrapper = mountBadge("Producer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-producer"]');

      expect(badge.classes()).toContain("bg-badge-teal-soft-bg");
    });

    it('should apply "bg-badge-amber-soft-bg" class when kind is "Consumer"', () => {
      wrapper = mountBadge("Consumer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-consumer"]');

      expect(badge.classes()).toContain("bg-badge-amber-soft-bg");
    });

    it('should apply "bg-badge-default-soft-bg" class when kind is "Internal"', () => {
      wrapper = mountBadge("Internal");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-internal"]');

      expect(badge.classes()).toContain("bg-badge-default-soft-bg");
    });
  });

  // -------------------------------------------------------------------------
  // Tooltip — full kind label appears in the badge's rendered HTML
  // -------------------------------------------------------------------------

  describe("tooltip content", () => {
    it('should render a tooltip with content "Client" when kind is "Client"', () => {
      wrapper = mountBadge("Client");
      // OTooltip uses :content prop, not slot — find component and check prop
      const tooltipComp = wrapper.findComponent({ name: "OTooltip" });
      expect(tooltipComp.exists()).toBe(true);
      expect(tooltipComp.props("content")).toBe("Client");
    });

    it('should render a tooltip with content "Server" when kind is "Server"', () => {
      wrapper = mountBadge("Server");
      const tooltipComp = wrapper.findComponent({ name: "OTooltip" });
      expect(tooltipComp.exists()).toBe(true);
      expect(tooltipComp.props("content")).toBe("Server");
    });

    it('should render a tooltip with content "Consumer" when kind is "Consumer"', () => {
      wrapper = mountBadge("Consumer");
      const tooltipComp = wrapper.findComponent({ name: "OTooltip" });
      expect(tooltipComp.exists()).toBe(true);
      expect(tooltipComp.props("content")).toBe("Consumer");
    });
  });
});
