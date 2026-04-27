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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import SpanKindBadge from "./SpanKindBadge.vue";

installQuasar();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tooltipStub = {
  template: '<span data-test="tooltip-stub"><slot /></span>',
};

function mountBadge(kind: string): VueWrapper {
  return mount(SpanKindBadge, {
    props: { kind },
    global: { stubs: { "q-tooltip": tooltipStub } },
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
    it('should apply "span-kind-badge--client" class when kind is "Client"', () => {
      wrapper = mountBadge("Client");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-client"]');

      expect(badge.classes()).toContain("span-kind-badge--client");
    });

    it('should apply "span-kind-badge--server" class when kind is "Server"', () => {
      wrapper = mountBadge("Server");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-server"]');

      expect(badge.classes()).toContain("span-kind-badge--server");
    });

    it('should apply "span-kind-badge--producer" class when kind is "Producer"', () => {
      wrapper = mountBadge("Producer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-producer"]');

      expect(badge.classes()).toContain("span-kind-badge--producer");
    });

    it('should apply "span-kind-badge--consumer" class when kind is "Consumer"', () => {
      wrapper = mountBadge("Consumer");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-consumer"]');

      expect(badge.classes()).toContain("span-kind-badge--consumer");
    });

    it('should apply "span-kind-badge--internal" class when kind is "Internal"', () => {
      wrapper = mountBadge("Internal");
      const badge = wrapper.find('[data-test="trace-tree-span-kind-badge-internal"]');

      expect(badge.classes()).toContain("span-kind-badge--internal");
    });
  });

  // -------------------------------------------------------------------------
  // Tooltip — full kind label appears in the badge's rendered HTML
  // -------------------------------------------------------------------------

  describe("tooltip content", () => {
    it('should render a tooltip with text "Client" when kind is "Client"', () => {
      wrapper = mountBadge("Client");
      const tooltip = wrapper.find('[data-test="tooltip-stub"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toBe("Client");
    });

    it('should render a tooltip with text "Server" when kind is "Server"', () => {
      wrapper = mountBadge("Server");
      const tooltip = wrapper.find('[data-test="tooltip-stub"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toBe("Server");
    });

    it('should render a tooltip with text "Consumer" when kind is "Consumer"', () => {
      wrapper = mountBadge("Consumer");
      const tooltip = wrapper.find('[data-test="tooltip-stub"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toBe("Consumer");
    });
  });
});
