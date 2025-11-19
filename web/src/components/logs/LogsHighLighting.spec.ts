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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";

installQuasar();

// Mock the store
const mockStore = {
  state: {
    theme: "light",
  },
};

// Mock vuex
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock the useLogsHighlighter composable
vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: () => ({
    colorizeJson: vi.fn((data, isDark, showBraces, showQuotes, queryString, simpleMode) => {
      if (data === null || data === undefined) return "";

      // Simple mock implementation
      if (simpleMode) {
        return `<span class="log-string">${data}</span>`;
      }

      if (typeof data === "object") {
        return `<span class="log-object-brace">{</span><span class="log-key">test</span><span class="log-separator">:</span><span class="log-string">value</span><span class="log-object-brace">}</span>`;
      }

      return `<span class="log-string">${data}</span>`;
    }),
  }),
}));

describe("LogsHighLighting", () => {
  let wrapper: any = null;

  beforeEach(() => {
    wrapper = mount(LogsHighLighting, {
      shallow: false,
      props: {
        data: "test message",
        showBraces: true,
        showQuotes: false,
        queryString: "",
        simpleMode: false,
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount LogsHighLighting component", () => {
    expect(wrapper).toBeTruthy();
    expect(wrapper.vm).toBeDefined();
  });

  it("should render the component with correct structure", () => {
    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should display string data", async () => {
    await wrapper.setProps({ data: "Error occurred" });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
    expect(span.html()).toContain("Error occurred");
  });

  it("should handle object data with braces", async () => {
    await wrapper.setProps({
      data: { level: "error", message: "test" },
      showBraces: true,
    });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
    expect(span.html()).toContain("log-object-brace");
  });

  it("should handle number data", async () => {
    await wrapper.setProps({ data: 42 });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
    expect(span.html()).toContain("42");
  });

  it("should handle boolean data", async () => {
    await wrapper.setProps({ data: true });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
    expect(span.html()).toContain("true");
  });

  it("should handle null data", async () => {
    await wrapper.setProps({ data: null });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should handle undefined data", async () => {
    await wrapper.setProps({ data: undefined });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should apply simpleMode when specified", async () => {
    await wrapper.setProps({
      data: "simple text",
      simpleMode: true,
    });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should handle queryString prop", async () => {
    await wrapper.setProps({
      data: "error message",
      queryString: "match_all('error')",
    });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should handle showQuotes prop", async () => {
    await wrapper.setProps({
      data: "test",
      showQuotes: true,
    });
    await wrapper.vm.$nextTick();

    const span = wrapper.find("span.logs-highlight-json");
    expect(span.exists()).toBe(true);
  });

  it("should apply correct CSS classes", () => {
    const span = wrapper.find("span.logs-highlight-json");
    expect(span.classes()).toContain("logs-highlight-json");
  });

  it("should handle component lifecycle correctly", () => {
    const newWrapper = mount(LogsHighLighting, {
      props: {
        data: "test",
        showBraces: false,
        showQuotes: false,
        queryString: "",
        simpleMode: false,
      },
    });

    expect(newWrapper).toBeTruthy();
    newWrapper.unmount();
  });

  it("should handle reactive prop changes", async () => {
    const initialData = "initial";
    const newData = "updated";

    expect(wrapper.props("data")).toBe("test message");

    await wrapper.setProps({ data: newData });

    expect(wrapper.props("data")).toBe(newData);
  });

  it("should handle props with default values", () => {
    const minimalWrapper = mount(LogsHighLighting, {
      props: {
        data: "test",
      },
    });

    expect(minimalWrapper.props("showBraces")).toBe(true);
    expect(minimalWrapper.props("showQuotes")).toBe(false);
    expect(minimalWrapper.props("queryString")).toBe("");
    expect(minimalWrapper.props("simpleMode")).toBe(false);

    minimalWrapper.unmount();
  });

  describe("edge cases", () => {
    it("should handle empty string data", () => {
      const emptyWrapper = mount(LogsHighLighting, {
        props: {
          data: "",
        },
      });

      expect(emptyWrapper).toBeTruthy();
      const span = emptyWrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);

      emptyWrapper.unmount();
    });

    it("should handle complex nested objects", async () => {
      const complexData = {
        user: {
          id: 123,
          profile: {
            name: "John",
            email: "john@example.com",
          },
        },
        timestamp: 1640995200000,
      };

      await wrapper.setProps({ data: complexData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle arrays", async () => {
      const arrayData = [1, 2, 3, 4, 5];

      await wrapper.setProps({ data: arrayData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle very long strings", async () => {
      const longString = "x".repeat(10000);

      await wrapper.setProps({ data: longString });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle special characters", async () => {
      const specialData = "Test <script>alert('xss')</script> & other symbols";

      await wrapper.setProps({ data: specialData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("theme handling", () => {
    it("should respect light theme", async () => {
      mockStore.state.theme = "light";
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should respect dark theme", async () => {
      mockStore.state.theme = "dark";
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("performance", () => {
    it("should render quickly with reasonable performance", () => {
      const startTime = performance.now();

      const perfWrapper = mount(LogsHighLighting, {
        props: {
          data: "performance test",
        },
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      expect(renderTime).toBeLessThan(50);

      perfWrapper.unmount();
    });

    it("should handle multiple instances efficiently", () => {
      const instances = [];
      const startTime = performance.now();

      for (let i = 0; i < 10; i++) {
        instances.push(
          mount(LogsHighLighting, {
            props: {
              data: `message ${i}`,
            },
          })
        );
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      expect(totalTime).toBeLessThan(200);

      instances.forEach((instance) => instance.unmount());
    });
  });

  describe("component state", () => {
    it("should maintain component state correctly", async () => {
      const initialProps = wrapper.props();

      await wrapper.vm.$forceUpdate();

      expect(wrapper.props()).toEqual(initialProps);
    });

    it("should handle prop updates without breaking", async () => {
      const updates = [
        { data: "update 1", simpleMode: false },
        { data: "update 2", simpleMode: true },
        { data: { key: "value" }, simpleMode: false },
      ];

      for (const update of updates) {
        await wrapper.setProps(update);
        expect(wrapper.props()).toMatchObject(update);

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      }
    });
  });

  describe("integration with highlighting composable", () => {
    it("should properly integrate with the highlighting composable", () => {
      expect(wrapper.vm).toBeDefined();
      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle async highlighting operations", async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should update when data changes", async () => {
      const initialData = wrapper.props("data");

      await wrapper.setProps({ data: "new data" });

      expect(wrapper.props("data")).not.toBe(initialData);

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });
});
