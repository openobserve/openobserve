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
import ErrorStackTrace from "@/components/rum/errorTracking/view/ErrorStackTrace.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Mock PrettyStackTrace
vi.mock("@/components/rum/errorTracking/view/PrettyStackTrace.vue", () => ({
  default: {
    name: "PrettyStackTrace",
    template: '<div data-test="pretty-stack-trace"></div>',
    props: ["error_stack", "error"],
  },
}));

describe("ErrorStackTrace Component", () => {
  let wrapper: any;

  const mockErrorStack = [
    "TypeError: Cannot read property 'foo' of undefined",
    "    at Object.fn (/app/src/main.js:15:20)",
    "    at process.processImmediate (internal/timers.js:461:26)",
    "    at process.processTicksAndRejections (internal/process/task_queues.js:95:5)",
  ];

  const mockError = {
    error_id: "error-123",
    error_message: "Something went wrong",
    timestamp: "2024-01-01 10:00:00",
  };

  const stubs = {
    OTabs: {
      template:
        '<div data-test="o-tabs" :class="$attrs.class"><slot /></div>',
      props: ["modelValue", "dense", "align"],
      emits: ["update:modelValue"],
    },
    OTab: {
      template: '<div data-test="o-tab" :data-name="name">{{ label }}</div>',
      props: ["name", "label"],
    },
    OTabPanels: {
      template: '<div data-test="o-tab-panels"><slot /></div>',
      props: ["modelValue", "animated"],
    },
    OTabPanel: {
      template: '<div data-test="o-tab-panel" :data-name="name"><slot /></div>',
      props: ["name"],
    },
    OSeparator: {
      template: '<hr data-test="o-separator" />',
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorStackTrace, {
      attachTo: "#app",
      props: {
        error_stack: mockErrorStack,
        error: mockError,
      },
      global: {
        plugins: [i18n],
        stubs,
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

    it("should render main container", () => {
      expect(wrapper.find("div").exists()).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display 'Error Stack' title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Error Stack");
    });

    it("should have tags-title class", () => {
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");
    });
  });

  describe("First Stack Line Display", () => {
    it("should display the first stack line separately", () => {
      expect(wrapper.text()).toContain(
        "TypeError: Cannot read property 'foo' of undefined",
      );
    });
  });

  describe("Stack Trace Lines", () => {
    it("should render remaining stack lines", () => {
      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(3); // All lines except the first one
    });

    it("should display correct content for each stack line", () => {
      const stackLines = wrapper.findAll(".error_stack");

      expect(stackLines[0].text()).toBe(
        "at Object.fn (/app/src/main.js:15:20)",
      );
      expect(stackLines[1].text()).toBe(
        "at process.processImmediate (internal/timers.js:461:26)",
      );
      expect(stackLines[2].text()).toBe(
        "at process.processTicksAndRejections (internal/process/task_queues.js:95:5)",
      );
    });

    it("should apply error_stack class to stack lines", () => {
      const stackLines = wrapper.findAll(".error_stack");

      stackLines.forEach((line: any) => {
        expect(line.classes()).toContain("error_stack");
      });
    });
  });

  describe("Stack Lines Container", () => {
    it("should render error-stacks container", () => {
      const container = wrapper.find(".error-stacks");
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("error-stacks");
    });

    it("should contain all stack lines except the first", () => {
      const container = wrapper.find(".error-stacks");
      const stackLines = container.findAll(".error_stack");
      expect(stackLines).toHaveLength(mockErrorStack.length - 1);
    });
  });

  describe("Border Styling", () => {
    it("should apply top border to first stack line", () => {
      const stackLines = wrapper.findAll(".error_stack");
      const firstStackLine = stackLines[0];

      const style = firstStackLine.attributes("style");
      expect(style).toContain("border-top: 1px solid rgb(224, 224, 224)");
    });

    it("should apply correct border radius to first stack line", () => {
      const stackLines = wrapper.findAll(".error_stack");
      const firstStackLine = stackLines[0];

      const style = firstStackLine.attributes("style");
      expect(style).toContain("border-radius: 4px 4px 0 0");
    });

    it("should apply correct border radius to last stack line", () => {
      const stackLines = wrapper.findAll(".error_stack");
      const lastStackLine = stackLines[stackLines.length - 1];

      const style = lastStackLine.attributes("style");
      expect(style).toContain("border-radius: 0 0 4px 4px");
    });
  });

  describe("Props Validation", () => {
    it("should require error_stack prop", () => {
      expect(ErrorStackTrace.props?.error_stack?.required).toBe(true);
      expect(ErrorStackTrace.props?.error_stack?.type).toBe(Array);
    });

    it("should require error prop", () => {
      expect(ErrorStackTrace.props?.error?.required).toBe(true);
      expect(ErrorStackTrace.props?.error?.type).toBe(Object);
    });
  });

  describe("Empty Stack Handling", () => {
    it("should handle empty stack array", async () => {
      await wrapper.setProps({
        error_stack: [],
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(0);
    });

    it("should handle single line stack", async () => {
      await wrapper.setProps({
        error_stack: ["Single error line"],
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(0);
      expect(wrapper.text()).toContain("Single error line");
    });
  });

  describe("Dynamic Border Styling", () => {
    it("should handle dynamic stack size changes", async () => {
      const newStack = [
        "Error: New error",
        "    at line 1",
        "    at line 2",
        "    at line 3",
        "    at line 4",
        "    at line 5",
      ];

      await wrapper.setProps({
        error_stack: newStack,
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(5);

      // Check first line styling
      const firstStyle = stackLines[0].attributes("style");
      expect(firstStyle).toContain("border-top: 1px solid rgb(224, 224, 224)");
      expect(firstStyle).toContain("border-radius: 4px 4px 0 0");

      // Check last line styling
      const lastStyle = stackLines[4].attributes("style");
      expect(lastStyle).toContain("border-radius: 0 0 4px 4px");
    });

    it("should handle two-line stack correctly", async () => {
      await wrapper.setProps({
        error_stack: ["Error message", "    at single line"],
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(1);

      const style = stackLines[0].attributes("style");
      expect(style).toContain("border-top: 1px solid rgb(224, 224, 224)");
      expect(style).toContain("border-radius: 0 0 4px 4px");
    });
  });

  describe("Content Rendering", () => {
    it("should preserve text content in stack traces", () => {
      const stackLines = wrapper.findAll(".error_stack");

      stackLines.forEach((line: any) => {
        const text = line.text();
        if (text.includes("at")) {
          expect(text).toMatch(/^at/);
        }
      });
    });

    it("should handle special characters in stack traces", async () => {
      const specialStack = [
        "Error: Special chars <>&\"'",
        "    at file:///path/with/special-chars.js:10:5",
        "    at <anonymous>:1:1",
      ];

      await wrapper.setProps({
        error_stack: specialStack,
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(wrapper.text()).toContain("Error: Special chars");
      expect(stackLines[1].text()).toContain("<anonymous>");
    });
  });

  describe("Tabs", () => {
    it("should render tabs for Raw and Pretty views", () => {
      const tabs = wrapper.findAll('[data-test="o-tab"]');
      expect(tabs.length).toBe(2);
    });

    it("should render Raw tab", () => {
      const tabs = wrapper.findAll('[data-test="o-tab"]');
      const rawTab = tabs.find((tab: any) => tab.attributes("data-name") === "raw");
      expect(rawTab).toBeDefined();
    });

    it("should render Pretty tab", () => {
      const tabs = wrapper.findAll('[data-test="o-tab"]');
      const prettyTab = tabs.find((tab: any) => tab.attributes("data-name") === "pretty");
      expect(prettyTab).toBeDefined();
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle prop updates gracefully", async () => {
      const newStack = ["New error", "    at new location"];
      const newError = { error_id: "new-error" };

      await wrapper.setProps({
        error_stack: newStack,
        error: newError,
      });

      expect(wrapper.text()).toContain("New error");

      expect(wrapper.props("error_stack")).toEqual(newStack);
      expect(wrapper.props("error")).toEqual(newError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null values in stack array", async () => {
      await wrapper.setProps({
        error_stack: ["Error", null, "    at valid line"],
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(2);
      expect(stackLines[1].text()).toBe("at valid line");
    });

    it("should handle undefined values in stack array", async () => {
      await wrapper.setProps({
        error_stack: ["Error", undefined, "    at valid line"],
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(2);
      expect(stackLines[1].text()).toBe("at valid line");
    });

    it("should handle very long stack traces", async () => {
      const longStack = ["Long error"];
      for (let i = 0; i < 50; i++) {
        longStack.push(
          `    at function${i} (/very/long/path/file${i}.js:${i}:${i})`,
        );
      }

      await wrapper.setProps({
        error_stack: longStack,
      });

      const stackLines = wrapper.findAll(".error_stack");
      expect(stackLines).toHaveLength(50);
    });
  });
});
