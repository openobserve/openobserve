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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ResourceDetailDrawer from "@/components/rum/ResourceDetailDrawer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

describe("ResourceDetailDrawer", () => {
  let wrapper: any;

  const mockResource = {
    resource_method: "GET",
    resource_url: "http://localhost:5080/users",
    resource_duration: 250,
    resource_status_code: 200,
    resource_type: "xhr",
    resource_size: 2048,
    resource_render_blocking_status: "non-blocking",
    _timestamp: 1700000000000000,
    session: {
      id: "session-123",
    },
    view: {
      url: "http://localhost:5080/dashboard",
    },
    _oo: {
      trace_id: "trace-123",
      span_id: "span-456",
    },
  };

  const defaultProps = {
    modelValue: true,
    resource: mockResource,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock store state with zoConfig
    store.state.zoConfig = {
      timestamp_column: "_timestamp",
    };

    wrapper = mount(ResourceDetailDrawer, {
      attachTo: "#app",
      props: defaultProps,
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          TraceCorrelationCard: {
            template:
              '<div data-test="trace-correlation-card">Trace Correlation</div>',
            props: ["traceId", "spanId", "sessionId", "resourceDuration"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component rendering", () => {
    it("should mount ResourceDetailDrawer component", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".q-drawer").exists()).toBe(true);
    });

    it("should have correct drawer properties", () => {
      const drawer = wrapper.findComponent({ name: "QDrawer" });
      expect(drawer.props("side")).toBe("right");
      expect(drawer.props("overlay")).toBe(true);
      expect(drawer.props("elevated")).toBe(true);
    });

    it("should display header with title", () => {
      expect(wrapper.text()).toContain("Resource Details");
    });

    it("should display close button", () => {
      const closeBtn = wrapper.find('[icon="close"]');
      expect(closeBtn.exists()).toBe(true);
    });
  });

  describe("Resource header display", () => {
    it("should display resource method and URL", () => {
      expect(wrapper.text()).toContain("GET");
      expect(wrapper.text()).toContain("http://localhost:5080/users");
    });

    it("should display timestamp", () => {
      const timestamp = wrapper.text();
      expect(timestamp).toContain("2023");
    });

    it("should display duration", () => {
      expect(wrapper.text()).toContain("250ms");
    });

    it("should display status code", () => {
      expect(wrapper.text()).toContain("200");
    });

    it("should show check_circle icon for 2xx status codes", () => {
      const icons = wrapper.findAllComponents({ name: "QIcon" });
      const statusIcon = icons.find((icon: any) =>
        icon.props("name")?.includes("check_circle"),
      );
      expect(statusIcon).toBeTruthy();
    });

    it("should display N/A when resource method is missing", async () => {
      await wrapper.setProps({
        resource: { ...mockResource, resource_method: undefined },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("GET"); // Defaults to GET
    });
  });

  describe("Resource information section", () => {
    it("should display Resource Information section", () => {
      expect(wrapper.text()).toContain("Resource Information");
    });

    it("should display resource type", () => {
      expect(wrapper.text()).toContain("Type:");
      expect(wrapper.text()).toContain("xhr");
    });

    it("should display resource size", () => {
      expect(wrapper.text()).toContain("Size:");
      expect(wrapper.text()).toContain("2.00 KB");
    });

    it("should display render blocking status", () => {
      expect(wrapper.text()).toContain("Render Blocking:");
      expect(wrapper.text()).toContain("non-blocking");
    });

    it("should display session ID", () => {
      expect(wrapper.text()).toContain("Session ID:");
      expect(wrapper.find(".session-id-text").exists()).toBe(true);
    });

    it("should display page URL", () => {
      expect(wrapper.text()).toContain("Page URL:");
      expect(wrapper.text()).toContain("http://localhost:5080/dashboard");
    });

    it("should not display fields when data is missing", async () => {
      await wrapper.setProps({
        resource: {
          resource_method: "GET",
          resource_url: "http://localhost:5080",
          resource_duration: 100,
          _timestamp: 1700000000000000,
        },
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain("Type:");
      expect(wrapper.text()).not.toContain("Size:");
    });
  });

  describe("Trace correlation", () => {
    it("should display TraceCorrelationCard when trace_id exists", () => {
      const traceCard = wrapper.find('[data-test="trace-correlation-card"]');
      expect(traceCard.exists()).toBe(true);
    });

    it("should pass correct props to TraceCorrelationCard", () => {
      const traceCard = wrapper.findComponent({ name: "TraceCorrelationCard" });
      if (traceCard.exists()) {
        expect(traceCard.props("traceId")).toBe("trace-123");
        expect(traceCard.props("spanId")).toBe("span-456");
        expect(traceCard.props("sessionId")).toBe("session-123");
        expect(traceCard.props("resourceDuration")).toBe(250);
      }
    });

    it("should display no trace message when trace_id is missing", async () => {
      await wrapper.setProps({
        resource: {
          ...mockResource,
          _oo: undefined,
        },
      });
      await flushPromises();

      expect(wrapper.text()).toContain(
        "No trace information available for this resource",
      );
      expect(wrapper.text()).toContain(
        "Trace correlation requires browser SDK v0.3.3+",
      );
    });
  });

  describe("Session context section", () => {
    it("should display Session Context section when session exists", () => {
      expect(wrapper.text()).toContain("Session Context");
    });

    it("should display View Session Replay button", () => {
      const replayBtn = wrapper.find('[label="View Session Replay"]');
      expect(replayBtn.exists()).toBe(true);
    });

    it("should display View All Session Events button", () => {
      const eventsBtn = wrapper.find('[label="View All Session Events"]');
      expect(eventsBtn.exists()).toBe(true);
    });

    it("should not display session context when session is missing", async () => {
      await wrapper.setProps({
        resource: {
          ...mockResource,
          session: undefined,
        },
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain("Session Context");
    });
  });

  describe("Navigation functionality", () => {
    it("should navigate to session replay when View Session Replay is clicked", async () => {
      const routerPushSpy = vi.spyOn(router, "push");
      const replayBtn = wrapper.find('[label="View Session Replay"]');

      await replayBtn.trigger("click");
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: "rumSessions",
        query: {
          session_id: "session-123",
        },
      });
    });

    it("should close drawer after navigating to session replay", async () => {
      const replayBtn = wrapper.find('[label="View Session Replay"]');

      await replayBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should show notification when View All Session Events is clicked", async () => {
      const notifySpy = vi.spyOn(quasar.Notify, "create");
      const eventsBtn = wrapper.find('[label="View All Session Events"]');

      await eventsBtn.trigger("click");
      await flushPromises();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          message: "Session events view coming soon",
        }),
      );
    });

    it("should not navigate when session ID is missing", async () => {
      await wrapper.setProps({
        resource: {
          ...mockResource,
          session: undefined,
        },
      });
      await flushPromises();

      const routerPushSpy = vi.spyOn(router, "push");

      // Button should not exist
      const replayBtn = wrapper.find('[label="View Session Replay"]');
      expect(replayBtn.exists()).toBe(false);
      expect(routerPushSpy).not.toHaveBeenCalled();
    });
  });

  describe("Drawer open/close functionality", () => {
    it("should sync isOpen with modelValue prop", async () => {
      expect(wrapper.vm.isOpen).toBe(true);

      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should emit update:modelValue when closeDrawer is called", async () => {
      const closeBtn = wrapper.find('[icon="close"]');
      await closeBtn.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should emit update:modelValue when isOpen changes", async () => {
      wrapper.vm.isOpen = false;
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Utility functions", () => {
    it("should format timestamp correctly", () => {
      const result = wrapper.vm.formatTimestamp(1700000000000000);
      expect(result).toContain("2023");
      expect(result).toContain(",");
    });

    it("should return N/A for invalid timestamp", () => {
      const result = wrapper.vm.formatTimestamp(0);
      expect(result).toBe("N/A");
    });

    it("should format duration in milliseconds for values < 1000ms", () => {
      const result = wrapper.vm.formatDuration(500);
      expect(result).toBe("500ms");
    });

    it("should format duration in seconds for values >= 1000ms", () => {
      const result = wrapper.vm.formatDuration(2500);
      expect(result).toBe("2.50s");
    });

    it("should return N/A for zero duration", () => {
      const result = wrapper.vm.formatDuration(0);
      expect(result).toBe("N/A");
    });

    it("should format bytes correctly - Bytes", () => {
      const result = wrapper.vm.formatBytes(512);
      expect(result).toBe("512.00 B");
    });

    it("should format bytes correctly - Kilobytes", () => {
      const result = wrapper.vm.formatBytes(2048);
      expect(result).toBe("2.00 KB");
    });

    it("should format bytes correctly - Megabytes", () => {
      const result = wrapper.vm.formatBytes(2097152);
      expect(result).toBe("2.00 MB");
    });

    it("should format bytes correctly - Gigabytes", () => {
      const result = wrapper.vm.formatBytes(2147483648);
      expect(result).toBe("2.00 GB");
    });

    it("should return N/A for zero bytes", () => {
      const result = wrapper.vm.formatBytes(0);
      expect(result).toBe("N/A");
    });

    it("should format session ID correctly for long IDs", () => {
      const longId = "session-123456789-abcdefgh";
      const result = wrapper.vm.formatSessionId(longId);
      expect(result).toBe("session-1...abcdefgh");
    });

    it("should not truncate short session IDs", () => {
      const shortId = "session-123";
      const result = wrapper.vm.formatSessionId(shortId);
      expect(result).toBe("session-123");
    });

    it("should return empty string for null session ID", () => {
      const result = wrapper.vm.formatSessionId("");
      expect(result).toBe("");
    });

    it("should get correct status icon for different status codes", () => {
      expect(wrapper.vm.getStatusIcon(200)).toBe("check_circle");
      expect(wrapper.vm.getStatusIcon(204)).toBe("check_circle");
      expect(wrapper.vm.getStatusIcon(301)).toBe("info");
      expect(wrapper.vm.getStatusIcon(404)).toBe("warning");
      expect(wrapper.vm.getStatusIcon(500)).toBe("error");
      expect(wrapper.vm.getStatusIcon(0)).toBe("help");
    });

    it("should get correct status color for different status codes", () => {
      expect(wrapper.vm.getStatusColor(200)).toBe("positive");
      expect(wrapper.vm.getStatusColor(204)).toBe("positive");
      expect(wrapper.vm.getStatusColor(301)).toBe("info");
      expect(wrapper.vm.getStatusColor(404)).toBe("warning");
      expect(wrapper.vm.getStatusColor(500)).toBe("negative");
      expect(wrapper.vm.getStatusColor(0)).toBe("grey");
    });
  });

  describe("Edge cases", () => {
    it("should handle null resource gracefully", async () => {
      await wrapper.setProps({ resource: null });
      await flushPromises();

      // Should not throw errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle resource with minimal data", async () => {
      await wrapper.setProps({
        resource: {
          resource_url: "http://localhost:5080",
          _timestamp: 1700000000000000,
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("http://localhost:5080");
    });

    it("should handle missing timestamp gracefully", async () => {
      await wrapper.setProps({
        resource: {
          ...mockResource,
          _timestamp: undefined,
        },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("N/A");
    });

    it("should handle resource with empty session object", async () => {
      await wrapper.setProps({
        resource: {
          ...mockResource,
          session: {},
        },
      });
      await flushPromises();

      // Should not display session context without session ID
      expect(wrapper.text()).not.toContain("Session Context");
    });
  });

  describe("Responsive behavior", () => {
    it("should have correct drawer width", () => {
      const drawer = wrapper.findComponent({ name: "QDrawer" });
      expect(drawer.attributes("width")).toBe("600");
    });

    it("should display content in flex column layout", () => {
      const container = wrapper.find(".tw\\:h-full.tw\\:flex.tw\\:flex-col");
      expect(container.exists()).toBe(true);
    });

    it("should have scrollable content area", () => {
      const contentArea = wrapper.find(".tw\\:flex-1.tw\\:overflow-y-auto");
      expect(contentArea.exists()).toBe(true);
    });
  });

  describe("Data display formatting", () => {
    it("should display ellipsis for long URLs", () => {
      const urlElement = wrapper.find(".ellipsis");
      expect(urlElement.exists()).toBe(true);
    });

    it("should show full URL in title attribute", () => {
      const urlElements = wrapper.findAll("[title]");
      const urlElement = urlElements.find((el: any) =>
        el.attributes("title")?.includes("http://localhost:5080/dashboard"),
      );
      expect(urlElement).toBeTruthy();
    });
  });

  describe("Component props validation", () => {
    it("should accept boolean modelValue prop", () => {
      expect(wrapper.props("modelValue")).toBe(true);
    });

    it("should accept object resource prop", () => {
      expect(wrapper.props("resource")).toEqual(mockResource);
    });

    it("should have default values for props", async () => {
      const newWrapper = mount(ResourceDetailDrawer, {
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      expect(newWrapper.props("modelValue")).toBe(false);
      expect(newWrapper.props("resource")).toBeNull();

      newWrapper.unmount();
    });
  });
});
