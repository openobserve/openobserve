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
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
import i18n from "@/locales";

const mockRouterPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockError = {
  session_id: "session-abc123",
  view_id: "view-def456",
  _timestamp: 1704110400000,
};

function mountComponent(error = mockError) {
  return mount(ErrorSessionReplay, {
    props: { error },
    global: {
      plugins: [i18n],
      stubs: {
        ErrorTag: {
          name: "ErrorTag",
          template: '<div data-test="error-tag">{{ tag.key }}: {{ tag.value }}</div>',
          props: ["tag"],
        },
        OButton: {
          name: "OButton",
          template: '<button data-test="play-button" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
          props: ["variant", "size", "iconLeft", "title"],
        },
      },
    },
  });
}

describe("ErrorSessionReplay Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("mounts successfully", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.exists()).toBe(true);
  });

  it("shows the Session Replay title", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Session Replay");
  });

  it("renders ErrorTag components for session details", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    expect(tags.length).toBeGreaterThan(0);
  });

  it("shows the session_id in a tag", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const sessionTag = tags.find((t: any) => t.text().includes("session_id"));
    expect(sessionTag).toBeDefined();
    expect(sessionTag!.text()).toContain("session-abc123");
  });

  it("shows the view_id in a tag", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const viewTag = tags.find((t: any) => t.text().includes("view_id"));
    expect(viewTag).toBeDefined();
    expect(viewTag!.text()).toContain("view-def456");
  });

  it("renders exactly two ErrorTag components", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const errorTagComponents = wrapper.findAllComponents({ name: "ErrorTag" });
    expect(errorTagComponents).toHaveLength(2);
  });

  it("passes correct props to the session_id ErrorTag", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const errorTagComponents = wrapper.findAllComponents({ name: "ErrorTag" });
    const sessionIdTag = errorTagComponents.find(
      (c: any) => c.props("tag").key === "session_id",
    );
    expect(sessionIdTag?.props("tag")).toEqual({
      key: "session_id",
      value: "session-abc123",
    });
  });

  it("passes correct props to the view_id ErrorTag", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const errorTagComponents = wrapper.findAllComponents({ name: "ErrorTag" });
    const viewIdTag = errorTagComponents.find(
      (c: any) => c.props("tag").key === "view_id",
    );
    expect(viewIdTag?.props("tag")).toEqual({
      key: "view_id",
      value: "view-def456",
    });
  });

  it("renders the play button", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.find('[data-test="play-button"]').exists()).toBe(true);
  });

  it("shows Play Session Replay text in the button", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.find('[data-test="play-button"]').text()).toContain(
      "Play Session Replay",
    );
  });

  it("navigates to SessionViewer with correct params when play button is clicked", async () => {
    // Arrange
    const button = wrapper.find('[data-test="play-button"]');

    // Act
    await button.trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "SessionViewer",
      params: { id: "session-abc123" },
      query: {
        start_time: 1704110400000,
        end_time: 1704110400000,
      },
    });
  });

  it("uses the correct timestamp for start_time and end_time", async () => {
    // Arrange
    await wrapper.setProps({
      error: { session_id: "test-session", view_id: "test-view", _timestamp: 9999999999 },
    });
    const button = wrapper.find('[data-test="play-button"]');

    // Act
    await button.trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "SessionViewer",
      params: { id: "test-session" },
      query: { start_time: 9999999999, end_time: 9999999999 },
    });
  });

  it("has a playSessionReplay method exposed", () => {
    // Assert
    expect(typeof wrapper.vm.playSessionReplay).toBe("function");
  });

  it("has a getSessionTags computed property that returns session and view ids", () => {
    // Assert
    expect(wrapper.vm.getSessionTags).toBeDefined();
    expect(wrapper.vm.getSessionTags.session_id).toBe("session-abc123");
    expect(wrapper.vm.getSessionTags.view_id).toBe("view-def456");
  });

  it("getSessionTags updates when error prop changes", async () => {
    // Arrange + Act
    await wrapper.setProps({
      error: { session_id: "new-session", view_id: "new-view", _timestamp: 1704196800000 },
    });

    // Assert
    expect(wrapper.vm.getSessionTags.session_id).toBe("new-session");
    expect(wrapper.vm.getSessionTags.view_id).toBe("new-view");
  });

  it("routes to SessionViewer with updated session id after prop change", async () => {
    // Arrange
    const customError = {
      session_id: "custom-session-789",
      view_id: "custom-view-101",
      _timestamp: 1704283200000,
    };
    await wrapper.setProps({ error: customError });

    // Act
    await wrapper.find('[data-test="play-button"]').trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "SessionViewer",
      params: { id: "custom-session-789" },
      query: { start_time: 1704283200000, end_time: 1704283200000 },
    });
  });

  it("passes undefined start/end times when _timestamp is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { session_id: "session-no-time", view_id: "view-no-time" },
    });

    // Act
    await wrapper.find('[data-test="play-button"]').trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "SessionViewer",
      params: { id: "session-no-time" },
      query: { start_time: undefined, end_time: undefined },
    });
  });

  it("passes null values through to router when session data is null", async () => {
    // Arrange
    await wrapper.setProps({
      error: { session_id: null, view_id: null, _timestamp: null },
    });

    // Act
    await wrapper.find('[data-test="play-button"]').trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "SessionViewer",
      params: { id: null },
      query: { start_time: null, end_time: null },
    });
  });

  it("session_id tag is undefined when session_id is missing from error", async () => {
    // Arrange
    await wrapper.setProps({
      error: { view_id: "view-only", _timestamp: 1704110400000 },
    });

    // Assert
    expect(wrapper.vm.getSessionTags.session_id).toBeUndefined();
    expect(wrapper.vm.getSessionTags.view_id).toBe("view-only");
  });

  it("calls router.push multiple times for multiple button clicks", async () => {
    // Arrange
    mockRouterPush.mockClear();
    const button = wrapper.find('[data-test="play-button"]');

    // Act
    await button.trigger("click");
    await button.trigger("click");
    await button.trigger("click");

    // Assert
    expect(mockRouterPush).toHaveBeenCalledTimes(3);
  });

  it("requires the error prop", () => {
    // Assert
    expect(ErrorSessionReplay.props?.error?.required).toBe(true);
    expect(ErrorSessionReplay.props?.error?.type).toBe(Object);
  });
});
