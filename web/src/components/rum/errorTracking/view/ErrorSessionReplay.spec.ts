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

const mockRouterPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/components/rum/errorTracking/view/ErrorTag.vue", () => ({
  default: {
    name: "ErrorTag",
    template: '<div data-test="error-tag">{{ tag.key }}: {{ tag.value }}</div>',
    props: ["tag"],
  },
}));

vi.mock("@/lib/core/Button/OButton.vue", () => ({
  default: {
    name: "OButton",
    template:
      '<button :data-test="$attrs[\'data-test\']" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot /></button>',
    props: ["variant", "size", "iconLeft", "title", "disabled"],
    emits: ["click"],
    inheritAttrs: false,
  },
}));

import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// _timestamp is in µs; event_time = Math.floor(µs / 1000) = ms
const TIMESTAMP_US = 1_704_110_400_000_000;
const EVENT_TIME_MS = Math.floor(TIMESTAMP_US / 1000); // 1_704_110_400_000

const mockError = {
  session_id: "session-abc123",
  view_id: "view-def456",
  _timestamp: TIMESTAMP_US,
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

function mountComponent(error: Record<string, any> = mockError) {
  return mount(ErrorSessionReplay, {
    props: { error },
    global: { plugins: [i18n] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorSessionReplay", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Rendering
  // =========================================================================

  describe("rendering", () => {
    it("renders the card container", () => {
      // Assert
      expect(wrapper.find('[data-test="error-session-replay-card"]').exists()).toBe(true);
    });

    it("renders a heading with Session Replay text", () => {
      // Assert
      expect(wrapper.find("h4").text()).toContain("Session Replay");
    });

    it("renders the hint small element", () => {
      // Assert
      const hint = wrapper.find('[data-test="error-session-replay-hint"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text().length).toBeGreaterThan(0);
    });

    it("renders the play button", () => {
      // Assert
      expect(wrapper.find('[data-test="error-session-replay-play-btn"]').exists()).toBe(true);
    });

    it("renders exactly two ErrorTag components (session_id, view_id)", () => {
      // Assert
      const tags = wrapper.findAllComponents({ name: "ErrorTag" });
      expect(tags).toHaveLength(2);
    });

    it("passes correct tag prop for session_id ErrorTag", () => {
      // Assert
      const tags = wrapper.findAllComponents({ name: "ErrorTag" });
      const sessionTag = tags.find((t) => t.props("tag").key === "session_id");
      expect(sessionTag).toBeDefined();
      expect(sessionTag!.props("tag")).toEqual({ key: "session_id", value: "session-abc123" });
    });

    it("passes correct tag prop for view_id ErrorTag", () => {
      // Assert
      const tags = wrapper.findAllComponents({ name: "ErrorTag" });
      const viewTag = tags.find((t) => t.props("tag").key === "view_id");
      expect(viewTag).toBeDefined();
      expect(viewTag!.props("tag")).toEqual({ key: "view_id", value: "view-def456" });
    });
  });

  // =========================================================================
  // Play button state
  // =========================================================================

  describe("play button disabled state", () => {
    it("is NOT disabled when session_id is present", () => {
      // Assert
      const btn = wrapper.find('[data-test="error-session-replay-play-btn"]');
      expect(btn.attributes("disabled")).toBeUndefined();
    });

    it("is DISABLED when session_id is missing", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ view_id: "view-xyz", _timestamp: TIMESTAMP_US });
      await flushPromises();

      // Assert
      const btn = wrapper.find('[data-test="error-session-replay-play-btn"]');
      expect(btn.attributes("disabled")).toBeDefined();
    });

    it("is DISABLED when session_id is null", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ session_id: null, view_id: "view-xyz", _timestamp: TIMESTAMP_US });
      await flushPromises();

      // Assert
      const btn = wrapper.find('[data-test="error-session-replay-play-btn"]');
      expect(btn.attributes("disabled")).toBeDefined();
    });

    it("is DISABLED when session_id is empty string", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ session_id: "", view_id: "view-xyz", _timestamp: TIMESTAMP_US });
      await flushPromises();

      // Assert
      const btn = wrapper.find('[data-test="error-session-replay-play-btn"]');
      expect(btn.attributes("disabled")).toBeDefined();
    });
  });

  // =========================================================================
  // Play button — navigation
  // =========================================================================

  describe("play button click — router navigation", () => {
    it("pushes to SessionViewer with correct params and query on click", async () => {
      // Act
      await wrapper.find('[data-test="error-session-replay-play-btn"]').trigger("click");

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session-abc123" },
        query: {
          start_time: TIMESTAMP_US,
          end_time: TIMESTAMP_US,
          event_time: EVENT_TIME_MS,
        },
      });
    });

    it("includes event_time as Math.floor(_timestamp / 1000)", async () => {
      // Act
      await wrapper.find('[data-test="error-session-replay-play-btn"]').trigger("click");

      // Assert
      const call = mockRouterPush.mock.calls[0][0];
      expect(call.query.event_time).toBe(Math.floor(TIMESTAMP_US / 1000));
    });

    it("uses the updated session_id after prop change", async () => {
      // Arrange
      const newTs = 1_704_196_800_000_000;
      await wrapper.setProps({
        error: { session_id: "new-session", view_id: "new-view", _timestamp: newTs },
      });

      // Act
      await wrapper.find('[data-test="error-session-replay-play-btn"]').trigger("click");

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "new-session" },
        query: {
          start_time: newTs,
          end_time: newTs,
          event_time: Math.floor(newTs / 1000),
        },
      });
    });

    it("does NOT call router.push when session_id is missing (disabled)", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ view_id: "view-xyz", _timestamp: TIMESTAMP_US });
      await flushPromises();

      // Act
      await wrapper.find('[data-test="error-session-replay-play-btn"]').trigger("click");

      // Assert
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("calls router.push for each click", async () => {
      // Arrange
      const btn = wrapper.find('[data-test="error-session-replay-play-btn"]');

      // Act
      await btn.trigger("click");
      await btn.trigger("click");

      // Assert
      expect(mockRouterPush).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Props reactivity
  // =========================================================================

  describe("props reactivity", () => {
    it("updates ErrorTag values when error prop changes", async () => {
      // Act
      await wrapper.setProps({
        error: { session_id: "updated-sess", view_id: "updated-view", _timestamp: TIMESTAMP_US },
      });

      // Assert
      const tags = wrapper.findAllComponents({ name: "ErrorTag" });
      const sessionTag = tags.find((t) => t.props("tag").key === "session_id");
      expect(sessionTag!.props("tag").value).toBe("updated-sess");
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("handles missing _timestamp by passing undefined to query", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = mountComponent({ session_id: "sess-no-time", view_id: "v1" });
      await flushPromises();

      // Act
      await wrapper.find('[data-test="error-session-replay-play-btn"]').trigger("click");

      // Assert
      const call = mockRouterPush.mock.calls[0][0];
      expect(call.query.start_time).toBeUndefined();
      expect(call.query.end_time).toBeUndefined();
      // event_time = Math.floor(undefined / 1000) = NaN
      expect(Number.isNaN(call.query.event_time)).toBe(true);
    });
  });
});
