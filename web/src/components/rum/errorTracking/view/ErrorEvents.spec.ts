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
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before component import
// ---------------------------------------------------------------------------

vi.mock("@/components/rum/errorTracking/view/ErrorEventDescription.vue", () => ({
  default: {
    name: "ErrorEventDescription",
    template: '<div data-test="error-event-description">{{ column.type }}</div>',
    props: ["column"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorTypeIcons.vue", () => ({
  default: {
    name: "ErrorTypeIcons",
    template: '<span data-test="error-type-icons">{{ column.type }}</span>',
    props: ["column"],
  },
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div data-test="no-data" />',
  },
}));

vi.mock("@/lib/core/Badge/OTag.vue", () => ({
  default: {
    name: "OTag",
    template: '<span data-test="o-tag">{{ label }}</span>',
    props: ["label", "variant", "size"],
  },
}));

vi.mock("@/utils/date", () => ({
  formatDate: vi.fn(() => "Jan 01, 2024 10:00:00 +0000"),
}));

import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// Anchor error event — the one that is highlighted in the timeline.
// _timestamp = 1_704_110_400_000_000 µs
const ANCHOR_TS = 1_704_110_400_000_000;

const makeError = (overrides: Record<string, any> = {}) => ({
  error_id: "err-001",
  _timestamp: ANCHOR_TS,
  events: [
    {
      type: "error",
      error_type: "TypeError",
      error_id: "err-001",
      _timestamp: ANCHOR_TS,
    },
    {
      type: "resource",
      resource_type: "xhr",
      _timestamp: ANCHOR_TS + 2_500_000, // +2.50s
    },
    {
      type: "view",
      view_loading_type: "route_change",
      _timestamp: ANCHOR_TS - 1_500_000, // −1.50ms (wait — 1_500_000 µs = 1.50s? let's check)
      // 1_500_000 µs → >= 1_000_000 (1s threshold) → "1.50s"
    },
    {
      type: "action",
      action_type: "click",
      _timestamp: ANCHOR_TS + 1_500, // +1.50ms
    },
  ],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

function mountComponent(error: Record<string, any> = makeError()) {
  return mount(ErrorEvents, {
    props: { error },
    global: { plugins: [i18n] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorEvents", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Rendering — empty state
  // =========================================================================

  describe("empty state", () => {
    it("renders NoData when events array is empty", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(makeError({ events: [] }));
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
    });

    it("does not render the timeline when events is empty", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(makeError({ events: [] }));
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline"]').exists()).toBe(false);
    });

    it("renders NoData when events prop is undefined", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ error_id: "e1", _timestamp: ANCHOR_TS });
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-empty"]').exists()).toBe(true);
    });

    it("renders the title even when events is empty", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(makeError({ events: [] }));
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-title"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Rendering — non-empty state
  // =========================================================================

  describe("non-empty timeline", () => {
    it("renders the timeline ol when events are present", () => {
      // Assert
      expect(wrapper.find('[data-test="error-events-timeline"]').exists()).toBe(true);
    });

    it("does not render empty state when events are present", () => {
      // Assert
      expect(wrapper.find('[data-test="error-events-empty"]').exists()).toBe(false);
    });

    it("renders exactly as many li items as events", () => {
      // Assert — default error has 4 events
      const items = wrapper.findAll('[data-test^="error-events-timeline-item-"]');
      expect(items).toHaveLength(4);
    });

    it("renders a single item when events has one element", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [{ type: "error", error_id: "err-001", error_type: "RangeError", _timestamp: ANCHOR_TS }],
        }),
      );
      await flushPromises();

      // Assert
      const items = wrapper.findAll('[data-test^="error-events-timeline-item-"]');
      expect(items).toHaveLength(1);
    });

    it("renders item-0 through item-3 with sequential data-test attrs", () => {
      // Assert
      for (let i = 0; i < 4; i++) {
        expect(wrapper.find(`[data-test="error-events-timeline-item-${i}"]`).exists()).toBe(true);
      }
    });
  });

  // =========================================================================
  // Category label per event type
  // =========================================================================

  describe("category per event type", () => {
    it("shows error_type for an error event", () => {
      // events[0] = error with error_type "TypeError"
      expect(wrapper.find('[data-test="error-events-timeline-category-0"]').text()).toBe("TypeError");
    });

    it("shows 'Error' for an error event with no error_type", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [{ type: "error", error_id: "err-001", _timestamp: ANCHOR_TS }],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-category-0"]').text()).toBe("Error");
    });

    it("shows resource_type for a resource event", () => {
      // events[1] = resource with resource_type "xhr"
      expect(wrapper.find('[data-test="error-events-timeline-category-1"]').text()).toBe("xhr");
    });

    it("shows 'Navigation' for a view event with view_loading_type=route_change", () => {
      // events[2] = view with view_loading_type "route_change"
      expect(wrapper.find('[data-test="error-events-timeline-category-2"]').text()).toBe("Navigation");
    });

    it("shows 'Reload' for a view event with other loading type", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [{ type: "view", view_loading_type: "initial_load", _timestamp: ANCHOR_TS }],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-category-0"]').text()).toBe("Reload");
    });

    it("shows action_type for an action event", () => {
      // events[3] = action with action_type "click"
      expect(wrapper.find('[data-test="error-events-timeline-category-3"]').text()).toBe("click");
    });

    it("shows the raw type for an unknown event type", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [{ type: "custom_event", _timestamp: ANCHOR_TS }],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-category-0"]').text()).toBe("custom_event");
    });
  });

  // =========================================================================
  // Error-anchor OTag highlight
  // =========================================================================

  describe("error anchor OTag", () => {
    it("renders the OTag only on the anchor error event (index 0)", () => {
      // Assert — only item 0 matches type=error && error_id=error.error_id
      expect(wrapper.find('[data-test="error-events-timeline-level-0"]').exists()).toBe(true);
    });

    it("does not render OTag on non-error events", () => {
      // items 1, 2, 3 are resource/view/action — no OTag
      expect(wrapper.find('[data-test="error-events-timeline-level-1"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-events-timeline-level-2"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-events-timeline-level-3"]').exists()).toBe(false);
    });

    it("does not render OTag on an error event whose error_id does not match", async () => {
      // Arrange — event has type=error but different error_id
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          error_id: "err-001",
          events: [
            { type: "error", error_id: "err-DIFFERENT", error_type: "TypeError", _timestamp: ANCHOR_TS },
          ],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-level-0"]').exists()).toBe(false);
    });
  });

  // =========================================================================
  // Offset labels
  // =========================================================================

  describe("offset labels", () => {
    it("shows '0ms' for the anchor event (delta = 0)", () => {
      // events[0] _timestamp === error._timestamp → delta 0
      expect(wrapper.find('[data-test="error-events-timeline-offset-0"]').text()).toBe("0ms");
    });

    it("shows '+2.50s' for an event 2_500_000µs after the anchor", () => {
      // events[1] is +2_500_000µs → formatTimeWithSuffix(2_500_000) = "2.50s"
      expect(wrapper.find('[data-test="error-events-timeline-offset-1"]').text()).toBe("+2.50s");
    });

    it("shows '−1.50s' for an event 1_500_000µs before the anchor", () => {
      // events[2] is −1_500_000µs → formatTimeWithSuffix(1_500_000) = "1.50s"
      expect(wrapper.find('[data-test="error-events-timeline-offset-2"]').text()).toBe("−1.50s");
    });

    it("shows '+1.50ms' for an event 1_500µs after the anchor", () => {
      // events[3] is +1_500µs → formatTimeWithSuffix(1_500) = "1.50ms"
      expect(wrapper.find('[data-test="error-events-timeline-offset-3"]').text()).toBe("+1.50ms");
    });

    it("shows '0ms' when base timestamp is 0 (no anchor)", async () => {
      // Arrange — error without _timestamp falls back to base=0
      wrapper.unmount();
      wrapper = mountComponent({
        error_id: "e1",
        events: [{ type: "error", error_id: "e1", _timestamp: 5_000_000 }],
      });
      await flushPromises();

      // Assert — base is 0, so !base → "0ms"
      expect(wrapper.find('[data-test="error-events-timeline-offset-0"]').text()).toBe("0ms");
    });

    it("shows '0ms' when delta is within the 1000µs dead zone", async () => {
      // Arrange — event is only 999µs away
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [{ type: "resource", resource_type: "img", _timestamp: ANCHOR_TS + 999 }],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-offset-0"]').text()).toBe("0ms");
    });
  });

  // =========================================================================
  // Title attribute (absolute date)
  // =========================================================================

  describe("offset title attribute", () => {
    it("sets a non-empty title attribute on each offset span", () => {
      for (let i = 0; i < 4; i++) {
        const span = wrapper.find(`[data-test="error-events-timeline-offset-${i}"]`);
        expect(span.attributes("title")).toBeTruthy();
      }
    });
  });

  // =========================================================================
  // Child component integration
  // =========================================================================

  describe("child components", () => {
    it("renders an ErrorTypeIcons stub per event", () => {
      const icons = wrapper.findAll('[data-test="error-type-icons"]');
      expect(icons).toHaveLength(4);
    });

    it("renders an ErrorEventDescription stub per event", () => {
      const descs = wrapper.findAll('[data-test="error-event-description"]');
      expect(descs).toHaveLength(4);
    });
  });

  // =========================================================================
  // Unicode message safety
  // =========================================================================

  describe("unicode message safety", () => {
    it("renders event with unicode characters in error_type without throwing", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent(
        makeError({
          events: [
            {
              type: "error",
              error_id: "err-001",
              error_type: "错误类型 🐛 <script>",
              _timestamp: ANCHOR_TS,
            },
          ],
        }),
      );
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-events-timeline-category-0"]').text()).toBe(
        "错误类型 🐛 <script>",
      );
    });
  });

  // =========================================================================
  // Props reactivity
  // =========================================================================

  describe("props reactivity", () => {
    it("updates item count when error prop changes to more events", async () => {
      // Arrange — currently 4 events
      const newError = makeError({
        events: [
          { type: "error", error_id: "err-001", _timestamp: ANCHOR_TS },
          { type: "action", action_type: "tap", _timestamp: ANCHOR_TS + 1_000_000 },
          { type: "resource", resource_type: "fetch", _timestamp: ANCHOR_TS + 2_000_000 },
          { type: "view", view_loading_type: "route_change", _timestamp: ANCHOR_TS - 500_000 },
          { type: "action", action_type: "scroll", _timestamp: ANCHOR_TS + 3_000_000 },
        ],
      });

      // Act
      await wrapper.setProps({ error: newError });

      // Assert
      expect(wrapper.findAll('[data-test^="error-events-timeline-item-"]')).toHaveLength(5);
    });

    it("switches to empty state when error.events is updated to []", async () => {
      // Act
      await wrapper.setProps({ error: makeError({ events: [] }) });

      // Assert
      expect(wrapper.find('[data-test="error-events-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-events-timeline"]').exists()).toBe(false);
    });
  });
});
