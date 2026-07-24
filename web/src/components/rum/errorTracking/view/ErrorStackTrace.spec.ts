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

// Stub tab components so the raw panel renders without full setup
const tabPanelStub = {
  template: "<div><slot /></div>",
  props: ["name", "animated"],
};

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

  function mountComponent(error_stack = mockErrorStack, error = mockError) {
    return mount(ErrorStackTrace, {
      props: { error_stack, error },
      global: {
        plugins: [i18n],
        stubs: {
          OTabs: { template: "<div><slot /></div>", props: ["modelValue", "dense", "align"] },
          OTab: { template: "<div />", props: ["name", "label"] },
          OTabPanels: {
            template: "<div><slot /></div>",
            props: ["modelValue", "animated"],
          },
          OTabPanel: tabPanelStub,
          OSeparator: { template: "<div />" },
          PrettyStackTrace: { template: "<div />", props: ["error_stack", "error"] },
        },
      },
    });
  }

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

  it("shows the Error Stack title", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Error Stack");
  });

  it("displays the first stack line as a standalone line", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("TypeError: Cannot read property 'foo' of undefined");
  });

  it("renders the remaining stack lines (excluding the first)", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    expect(stackLines).toHaveLength(3);
  });

  it("shows correct text for each stack line", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    expect(stackLines[0].text()).toBe("at Object.fn (/app/src/main.js:15:20)");
    expect(stackLines[1].text()).toBe("at process.processImmediate (internal/timers.js:461:26)");
    expect(stackLines[2].text()).toBe(
      "at process.processTicksAndRejections (internal/process/task_queues.js:95:5)",
    );
  });

  it("renders the error-stacks container", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.find(".error-stacks").exists()).toBe(true);
  });

  it("contains all stack lines except the first inside error-stacks", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const container = wrapper.find(".error-stacks");
    const lines = container.findAll('[data-test="error-stack-trace-line"]');
    expect(lines).toHaveLength(mockErrorStack.length - 1);
  });

  it("requires the error_stack prop", () => {
    // Assert
    expect(ErrorStackTrace.props?.error_stack?.required).toBe(true);
    expect(ErrorStackTrace.props?.error_stack?.type).toBe(Array);
  });

  it("requires the error prop", () => {
    // Assert
    expect(ErrorStackTrace.props?.error?.required).toBe(true);
    expect(ErrorStackTrace.props?.error?.type).toBe(Object);
  });

  it("renders no stack lines and blank first line for empty array", async () => {
    // Arrange
    await wrapper.setProps({ error_stack: [] });

    // Assert
    expect(wrapper.findAll('[data-test="error-stack-trace-line"]')).toHaveLength(0);
  });

  it("renders no stack lines for single-line stack", async () => {
    // Arrange
    await wrapper.setProps({ error_stack: ["Single error line"] });

    // Assert
    expect(wrapper.text()).toContain("Single error line");
    expect(wrapper.findAll('[data-test="error-stack-trace-line"]')).toHaveLength(0);
  });

  it("updates displayed stack lines when prop changes", async () => {
    // Arrange
    const newStack = ["New error", "    at line 1", "    at line 2"];

    // Act
    await wrapper.setProps({ error_stack: newStack });

    // Assert
    expect(wrapper.text()).toContain("New error");
    expect(wrapper.findAll('[data-test="error-stack-trace-line"]')).toHaveLength(2);
  });

  it("renders 50 stack lines for a long stack trace", async () => {
    // Arrange
    const longStack = ["Long error"];
    for (let i = 0; i < 50; i++) {
      longStack.push(`    at function${i} (/path/file${i}.js:${i}:${i})`);
    }

    // Act
    await wrapper.setProps({ error_stack: longStack });

    // Assert
    expect(wrapper.findAll('[data-test="error-stack-trace-line"]')).toHaveLength(50);
  });

  it("handles special characters in stack trace text", async () => {
    // Arrange
    const specialStack = [
      "Error: Special chars <>&\"'",
      "    at file:///path/special-chars.js:10:5",
      "    at <anonymous>:1:1",
    ];

    // Act
    await wrapper.setProps({ error_stack: specialStack });

    // Assert
    expect(wrapper.text()).toContain("Error: Special chars");
    const lines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    expect(lines[1].text()).toContain("<anonymous>");
  });

  it("reflects prop update: first line changes", async () => {
    // Arrange
    const newStack = ["New error message", "    at new location"];

    // Act
    await wrapper.setProps({ error_stack: newStack, error: { error_id: "new-error" } });

    // Assert
    expect(wrapper.text()).toContain("New error message");
    expect(wrapper.props("error_stack")).toEqual(newStack);
  });

  it("applies top border style only to the first rendered stack line", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    const firstStyle = stackLines[0].attributes("style");
    expect(firstStyle).toContain("border-top: 1px solid var(--color-border-default)");

    for (let i = 1; i < stackLines.length; i++) {
      const style = stackLines[i].attributes("style");
      if (style) {
        expect(style).not.toContain("border-top: 1px solid var(--color-border-default)");
      }
    }
  });

  it("applies top-rounded border radius to the first stack line", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    const style = stackLines[0].attributes("style");
    expect(style).toContain("border-radius: 4px 4px 0 0");
  });

  it("applies bottom-rounded border radius to the last stack line", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    const lastStyle = stackLines[stackLines.length - 1].attributes("style");
    expect(lastStyle).toContain("border-radius: 0 0 4px 4px");
  });

  it("applies both border-radius values when there is only one stack line", async () => {
    // Arrange
    await wrapper.setProps({
      error_stack: ["Error message", "    at single line"],
    });

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    expect(stackLines).toHaveLength(1);
    const style = stackLines[0].attributes("style");
    expect(style).toContain("border-top: 1px solid var(--color-border-default)");
    expect(style).toContain("border-radius: 0 0 4px 4px");
  });

  it("does not apply rounded border radius to middle stack lines", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const stackLines = wrapper.findAll('[data-test="error-stack-trace-line"]');
    if (stackLines.length > 2) {
      for (let i = 1; i < stackLines.length - 1; i++) {
        const style = stackLines[i].attributes("style");
        if (style) {
          expect(style).not.toContain("border-radius: 4px 4px 0 0");
          expect(style).not.toContain("border-radius: 0 0 4px 4px");
        }
      }
    }
  });
});
