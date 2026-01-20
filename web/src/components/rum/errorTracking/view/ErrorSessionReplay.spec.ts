// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock ErrorTag component
vi.mock("@/components/rum/errorTracking/view/ErrorTag.vue", () => ({
  default: {
    name: "ErrorTag",
    template: '<div data-test="error-tag">{{ tag.key }}: {{ tag.value }}</div>',
    props: ["tag"],
  },
}));

// Mock vue-router
const mockRouterPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

describe("ErrorSessionReplay Component", () => {
  let wrapper: any;

  const mockError = {
    session_id: "session-abc123",
    view_id: "view-def456",
    _timestamp: 1704110400000,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorSessionReplay, {
      attachTo: "#app",
      props: {
        error: mockError,
      },
      global: {
        plugins: [i18n],
        stubs: {
          "q-icon": {
            template: '<i data-test="q-icon" :class="name"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render main container with correct classes", () => {
      const container = wrapper.find(".q-mt-lg");
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("q-mt-lg");
    });
  });

  describe("Title Display", () => {
    it("should display 'Session Replay' title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Session Replay");
    });

    it("should have correct title styling", () => {
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");
      expect(title.classes()).toContain("text-bold");
      expect(title.classes()).toContain("q-mb-sm");
      expect(title.classes()).toContain("q-ml-xs");
    });
  });

  describe("Session Tags Display", () => {
    it("should render error tags for session details", () => {
      const errorTags = wrapper.findAll('[data-test="error-tag"]');
      expect(errorTags.length).toBeGreaterThan(0);
    });

    it("should display session_id tag", () => {
      const sessionIdTag = wrapper
        .findAll('[data-test="error-tag"]')
        .find((tag) => tag.text().includes("session_id"));
      expect(sessionIdTag).toBeDefined();
      expect(sessionIdTag?.text()).toContain("session-abc123");
    });

    it("should display view_id tag", () => {
      const viewIdTag = wrapper
        .findAll('[data-test="error-tag"]')
        .find((tag) => tag.text().includes("view_id"));
      expect(viewIdTag).toBeDefined();
      expect(viewIdTag?.text()).toContain("view-def456");
    });

    it("should render tags in row container", () => {
      const tagsContainer = wrapper.find(".row");
      expect(tagsContainer.exists()).toBe(true);
      expect(tagsContainer.classes()).toContain("row");
    });
  });

  describe("Play Button", () => {
    it("should render play button", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.exists()).toBe(true);
    });

    it("should have correct button styling", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.classes()).toContain("bg-primary");
      expect(playButton.classes()).toContain("rounded");
      expect(playButton.classes()).toContain("tw:mt-[0.625rem]");
      expect(playButton.classes()).toContain("text-white");
    });

    it("should have correct button inline styles", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.classes()).toContain("bg-primary");
      expect(playButton.classes()).toContain("rounded");
      expect(playButton.classes()).toContain("tw:mt-[0.625rem]");
    });

    it("should display play icon", () => {
      const playIcon = wrapper.find('[data-test="q-icon"].play_circle');
      expect(playIcon.exists()).toBe(true);
    });

    it("should display 'Play Session Replay' text", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.text()).toContain("Play Session Replay");
    });

    it("should have correct icon styling", () => {
      const playIcon = wrapper.find('[data-test="q-icon"].play_circle');
      expect(playIcon.classes()).toContain("q-mr-xs");
    });
  });

  describe("Computed Properties", () => {
    it("should have getSessionTags computed property", () => {
      expect(wrapper.vm.getSessionTags).toBeDefined();
      expect(typeof wrapper.vm.getSessionTags).toBe("object");
    });

    it("should return correct session tags", () => {
      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBe("session-abc123");
      expect(sessionTags.view_id).toBe("view-def456");
    });

    it("should react to prop changes", async () => {
      await wrapper.setProps({
        error: {
          session_id: "new-session",
          view_id: "new-view",
          _timestamp: 1704196800000,
        },
      });

      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBe("new-session");
      expect(sessionTags.view_id).toBe("new-view");
    });
  });

  describe("Navigation Functionality", () => {
    it("should have playSessionReplay method", () => {
      expect(typeof wrapper.vm.playSessionReplay).toBe("function");
    });

    it("should navigate to SessionViewer when play button is clicked", async () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: {
          id: "session-abc123",
        },
        query: {
          start_time: 1704110400000,
          end_time: 1704110400000,
        },
      });
    });

    it("should use correct timestamp for start and end time", async () => {
      await wrapper.setProps({
        error: {
          session_id: "test-session",
          view_id: "test-view",
          _timestamp: 9999999999,
        },
      });

      const playButton = wrapper.findComponent({ name: "QBtn" });
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: {
          id: "test-session",
        },
        query: {
          start_time: 9999999999,
          end_time: 9999999999,
        },
      });
    });
  });

  describe("Props Validation", () => {
    it("should require error prop", () => {
      expect(ErrorSessionReplay.props?.error?.required).toBe(true);
      expect(ErrorSessionReplay.props?.error?.type).toBe(Object);
    });

    it("should handle different error structures", async () => {
      const customError = {
        session_id: "custom-session-789",
        view_id: "custom-view-101",
        _timestamp: 1704283200000,
        other_field: "ignored",
      };

      await wrapper.setProps({ error: customError });

      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBe("custom-session-789");
      expect(sessionTags.view_id).toBe("custom-view-101");

      const playButton = wrapper.findComponent({ name: "QBtn" });
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "custom-session-789" },
        query: {
          start_time: 1704283200000,
          end_time: 1704283200000,
        },
      });
    });
  });

  describe("Component Structure", () => {
    it("should have proper layout hierarchy", () => {
      const container = wrapper.find(".q-mt-lg");
      const title = container.find(".tags-title");
      const tagsRow = container.find(".row");
      const playButton = container.findComponent({ name: "QBtn" });

      expect(container.exists()).toBe(true);
      expect(title.exists()).toBe(true);
      expect(tagsRow.exists()).toBe(true);
      expect(playButton.exists()).toBe(true);
    });

    it("should maintain correct element order", () => {
      const container = wrapper.find(".q-mt-lg");
      const children = Array.from(container.element.children);

      expect(children[0].classList.contains("tags-title")).toBe(true);
      expect(children[1].classList.contains("row")).toBe(true);
      expect(children[2].tagName.toLowerCase()).toBe("button");
    });
  });

  describe("Error Tags Integration", () => {
    it("should pass correct props to ErrorTag components", () => {
      const errorTagComponents = wrapper.findAllComponents({
        name: "ErrorTag",
      });
      expect(errorTagComponents.length).toBe(2);

      const sessionIdTag = errorTagComponents.find(
        (component) => component.props("tag").key === "session_id",
      );
      const viewIdTag = errorTagComponents.find(
        (component) => component.props("tag").key === "view_id",
      );

      expect(sessionIdTag).toBeDefined();
      expect(viewIdTag).toBeDefined();

      expect(sessionIdTag?.props("tag")).toEqual({
        key: "session_id",
        value: "session-abc123",
      });

      expect(viewIdTag?.props("tag")).toEqual({
        key: "view_id",
        value: "view-def456",
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing session_id", async () => {
      await wrapper.setProps({
        error: {
          view_id: "view-only",
          _timestamp: 1704110400000,
        },
      });

      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBeUndefined();
      expect(sessionTags.view_id).toBe("view-only");
    });

    it("should handle missing view_id", async () => {
      await wrapper.setProps({
        error: {
          session_id: "session-only",
          _timestamp: 1704110400000,
        },
      });

      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBe("session-only");
      expect(sessionTags.view_id).toBeUndefined();
    });

    it("should handle missing _timestamp", async () => {
      await wrapper.setProps({
        error: {
          session_id: "session-no-time",
          view_id: "view-no-time",
        },
      });

      const playButton = wrapper.findComponent({ name: "QBtn" });
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session-no-time" },
        query: {
          start_time: undefined,
          end_time: undefined,
        },
      });
    });

    it("should handle null values", async () => {
      await wrapper.setProps({
        error: {
          session_id: null,
          view_id: null,
          _timestamp: null,
        },
      });

      const sessionTags = wrapper.vm.getSessionTags;
      expect(sessionTags.session_id).toBeNull();
      expect(sessionTags.view_id).toBeNull();

      const playButton = wrapper.findComponent({ name: "QBtn" });
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: null },
        query: {
          start_time: null,
          end_time: null,
        },
      });
    });
  });

  describe("CSS Styling", () => {
    it("should apply correct title styling", () => {
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");
    });

    it("should apply correct button styling", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.classes()).toContain("bg-primary");
      expect(playButton.classes()).toContain("rounded");
      expect(playButton.classes()).toContain("text-white");
    });
  });

  describe("Accessibility", () => {
    it("should have clickable play button", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.exists()).toBe(true);
    });

    it("should provide clear button text", () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });
      expect(playButton.text()).toContain("Play Session Replay");
    });

    it("should have proper semantic structure", () => {
      const title = wrapper.find(".tags-title");
      expect(title.text()).toBe("Session Replay");
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle multiple navigation calls", async () => {
      const playButton = wrapper.findComponent({ name: "QBtn" });

      await playButton.trigger("click");
      await playButton.trigger("click");
      await playButton.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledTimes(3);
    });
  });

  describe("Performance", () => {
    it("should efficiently update computed properties", async () => {
      const initialTags = wrapper.vm.getSessionTags;

      // Change unrelated prop
      await wrapper.setProps({
        error: {
          ...mockError,
          unrelated_field: "changed",
        },
      });

      // Tags should remain the same
      expect(wrapper.vm.getSessionTags).toEqual(initialTags);
    });
  });
});
