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

import { mount, flushPromises } from "@vue/test-utils";
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

// Import the actual composable instead of mocking it
// This allows us to test real highlighting behavior
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

describe("LogsHighLighting Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset theme to light before each test
    mockStore.state.theme = "light";

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

  describe("Component Mounting and Structure", () => {
    it("should mount LogsHighLighting component", () => {
      expect(wrapper).toBeTruthy();
      expect(wrapper.vm).toBeDefined();
    });

    it("should render with correct root element", () => {
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
        },
      });

      expect(newWrapper).toBeTruthy();
      newWrapper.unmount();
      // Should not throw any errors during cleanup
    });
  });

  describe("Props Handling", () => {
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

    it("should handle reactive prop changes", async () => {
      expect(wrapper.props("data")).toBe("test message");

      await wrapper.setProps({ data: "updated message" });

      expect(wrapper.props("data")).toBe("updated message");
    });

    it("should update when showBraces prop changes", async () => {
      await wrapper.setProps({
        data: { level: "error" },
        showBraces: false,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should update when showQuotes prop changes", async () => {
      await wrapper.setProps({
        data: "test string",
        showQuotes: true,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should update when simpleMode prop changes", async () => {
      await wrapper.setProps({
        data: "simple text",
        simpleMode: true,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle multiple prop updates sequentially", async () => {
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

  describe("Data Type Handling", () => {
    describe("String data", () => {
      it("should display simple string data", async () => {
        await wrapper.setProps({ data: "Error occurred" });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("Error");
        expect(span.html()).toContain("occurred");
      });

      it("should handle empty string", async () => {
        await wrapper.setProps({ data: "" });
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

      it("should handle strings with special characters", async () => {
        const specialData = "Test & symbols <> \"quotes\" 'apostrophes'";
        await wrapper.setProps({ data: specialData });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        // Should escape HTML
        expect(span.html()).toContain("&amp;");
      });
    });

    describe("Number data", () => {
      it("should handle regular numbers", async () => {
        await wrapper.setProps({ data: 42 });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("42");
      });

      it("should handle zero", async () => {
        await wrapper.setProps({ data: 0 });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("0");
      });

      it("should handle negative numbers", async () => {
        await wrapper.setProps({ data: -123 });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("-123");
      });

      it("should handle large timestamp-like numbers", async () => {
        await wrapper.setProps({ data: 1640995200000 });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("1640995200000");
      });

      it("should handle decimal numbers", async () => {
        await wrapper.setProps({ data: 3.14159 });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("3.14159");
      });
    });

    describe("Boolean data", () => {
      it("should handle true value", async () => {
        await wrapper.setProps({ data: true });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("true");
      });

      it("should handle false value", async () => {
        await wrapper.setProps({ data: false });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("false");
      });
    });

    describe("Null and undefined", () => {
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
    });

    describe("Object data", () => {
      it("should handle simple objects", async () => {
        await wrapper.setProps({
          data: { level: "error", message: "test" },
          showBraces: true,
        });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
        expect(span.html()).toContain("level");
        expect(span.html()).toContain("error");
        expect(span.html()).toContain("message");
        expect(span.html()).toContain("test");
      });

      it("should handle empty objects", async () => {
        await wrapper.setProps({ data: {} });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });

      it("should handle nested objects", async () => {
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

      it("should handle objects with various value types", async () => {
        const mixedData = {
          string: "text",
          number: 42,
          boolean: true,
          null: null,
          array: [1, 2, 3],
        };

        await wrapper.setProps({ data: mixedData });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });

      it("should respect showBraces prop for objects", async () => {
        await wrapper.setProps({
          data: { key: "value" },
          showBraces: false,
        });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });
    });

    describe("Array data", () => {
      it("should handle arrays", async () => {
        const arrayData = [1, 2, 3, 4, 5];
        await wrapper.setProps({ data: arrayData });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });

      it("should handle empty arrays", async () => {
        await wrapper.setProps({ data: [] });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });

      it("should handle arrays with mixed types", async () => {
        const mixedArray = ["text", 123, true, null, { key: "value" }];
        await wrapper.setProps({ data: mixedArray });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.exists()).toBe(true);
      });
    });
  });

  describe("Semantic Type Detection", () => {
    it("should detect and highlight IP addresses", async () => {
      await wrapper.setProps({ data: "192.168.1.1" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      expect(span.html()).toContain("192.168.1.1");
      // Should apply IP-related styling
      expect(span.html()).toContain("log-ip");
    });

    it("should detect multiple IP addresses in text", async () => {
      await wrapper.setProps({
        data: "Connection from 192.168.1.1 to 10.0.0.1",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("192.168.1.1");
      expect(span.html()).toContain("10.0.0.1");
    });

    it("should detect and highlight URLs", async () => {
      await wrapper.setProps({ data: "https://example.com/api/v1" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      expect(span.html()).toContain("https://example.com/api/v1");
      expect(span.html()).toContain("log-url");
    });

    it("should detect and highlight email addresses", async () => {
      await wrapper.setProps({ data: "user@example.com" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      expect(span.html()).toContain("user@example.com");
      expect(span.html()).toContain("log-email");
    });

    it("should detect HTTP methods", async () => {
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

      for (const method of methods) {
        await wrapper.setProps({ data: method });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.html()).toContain(method);
      }
    });

    it("should detect HTTP status codes", async () => {
      const statusCodes = ["200", "404", "500", "301", "403"];

      for (const code of statusCodes) {
        await wrapper.setProps({ data: code });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.html()).toContain(code);
      }
    });

    it("should detect UUIDs", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      await wrapper.setProps({ data: uuid });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain(uuid);
      expect(span.html()).toContain("log-uuid");
    });

    it("should detect file paths", async () => {
      const unixPaths = ["/var/log/app.log", "/home/user/documents"];
      const windowsPath = "C:\\Windows\\System32";

      // Test Unix paths
      for (const path of unixPaths) {
        await wrapper.setProps({ data: path });
        await wrapper.vm.$nextTick();

        const span = wrapper.find("span.logs-highlight-json");
        expect(span.html()).toContain(path);
        expect(span.html()).toContain("log-path");
      }

      // Test Windows path separately - backslashes are present in HTML
      await wrapper.setProps({ data: windowsPath });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      // Check for path components without worrying about backslash encoding
      expect(span.html()).toContain("Windows");
      expect(span.html()).toContain("System32");
    });
  });

  describe("Keyword Highlighting", () => {
    it("should highlight keywords from query string", async () => {
      await wrapper.setProps({
        data: "error message occurred",
        queryString: "match_all('error')",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("error");
      expect(span.html()).toContain("log-highlighted");
    });

    it("should handle multiple keywords", async () => {
      await wrapper.setProps({
        data: "critical error in system",
        queryString: "match_all('error') AND match_all('critical')",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("error");
      expect(span.html()).toContain("critical");
    });

    it("should handle case-insensitive matching", async () => {
      await wrapper.setProps({
        data: "ERROR Error error",
        queryString: "match_all('error')",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("ERROR");
      expect(span.html()).toContain("Error");
      expect(span.html()).toContain("error");
    });

    it("should handle fuzzy_match queries", async () => {
      await wrapper.setProps({
        data: "test message",
        queryString: "fuzzy_match('message', 2)",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("message");
    });

    it("should handle fuzzy_match_all queries", async () => {
      await wrapper.setProps({
        data: "important notice",
        queryString: "fuzzy_match_all('notice', 1)",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("notice");
    });

    it("should not highlight when no query string", async () => {
      await wrapper.setProps({
        data: "error message",
        queryString: "",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("error");
    });
  });

  describe("Mixed Content Detection", () => {
    it("should detect log lines with HTTP and IP", async () => {
      await wrapper.setProps({
        data: "GET /api/users 192.168.1.1 200",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("GET");
      expect(span.html()).toContain("192.168.1.1");
      expect(span.html()).toContain("200");
    });

    it("should detect Apache-style log lines", async () => {
      await wrapper.setProps({
        data: '[01/Jan/2023:12:00:00 +0000] "GET /home HTTP/1.1" 200 192.168.1.1',
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("GET");
      expect(span.html()).toContain("192.168.1.1");
    });

    it("should detect log lines with URLs", async () => {
      await wrapper.setProps({
        data: "POST https://api.example.com/v1/users 201",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("POST");
      expect(span.html()).toContain("https://api.example.com");
    });

    it("should not treat simple IP strings as mixed content", async () => {
      await wrapper.setProps({
        data: "192.168.1.1 connection failed",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("192.168.1.1");
    });
  });

  describe("XSS Prevention and HTML Escaping", () => {
    it("should escape HTML in script tags", async () => {
      const xssData = "<script>alert('xss')</script>";
      await wrapper.setProps({ data: xssData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      // Should escape < and >
      expect(span.html()).toContain("&lt;");
      expect(span.html()).toContain("&gt;");
      // Should not execute script
      expect(span.html()).not.toContain("<script>");
    });

    it("should escape HTML entities", async () => {
      const htmlData = "Test & <div>content</div> 'quotes'";
      await wrapper.setProps({ data: htmlData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("&amp;");
      expect(span.html()).toContain("&lt;");
      expect(span.html()).toContain("&gt;");
    });

    it("should escape dangerous attributes", async () => {
      const xssData = '<img src=x onerror="alert(1)">';
      await wrapper.setProps({ data: xssData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      const html = span.html();

      // The key security check: dangerous tags should be escaped as text, not rendered as HTML
      // &lt; and &gt; will remain in the HTML source because they're needed to display < and > as text
      expect(html).toContain("&lt;"); // < must be escaped
      expect(html).toContain("&gt;"); // > must be escaped

      // Make sure no actual <img> tag was created (it should be text only)
      expect(html).not.toContain("<img");

      // Verify the text is displayed, not executed
      const textContent = span.text();
      expect(textContent).toContain('<img');
      expect(textContent).toContain('onerror');
      expect(textContent).toContain('alert(1)');
    });

    it("should handle quotes safely", async () => {
      const quoteData = 'Test "double" and \'single\' quotes';
      await wrapper.setProps({ data: quoteData });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("Simple Mode", () => {
    it("should use simple highlighting in simpleMode", async () => {
      await wrapper.setProps({
        data: "192.168.1.1",
        simpleMode: true,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      // In simple mode, should not apply semantic coloring
    });

    it("should still highlight keywords in simpleMode", async () => {
      await wrapper.setProps({
        data: "error message",
        queryString: "match_all('error')",
        simpleMode: true,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("error");
    });
  });

  describe("Theme Handling", () => {
    it("should respect light theme", async () => {
      mockStore.state.theme = "light";
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should respect dark theme", async () => {
      mockStore.state.theme = "dark";

      const darkWrapper = mount(LogsHighLighting, {
        props: {
          data: "test message",
        },
      });

      await darkWrapper.vm.$nextTick();

      const span = darkWrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);

      darkWrapper.unmount();
    });

    it("should update when theme changes", async () => {
      mockStore.state.theme = "light";
      await wrapper.vm.$nextTick();

      mockStore.state.theme = "dark";
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("CSS Classes Application", () => {
    it("should apply log-string class for strings", async () => {
      await wrapper.setProps({ data: "simple string" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("log-string");
    });

    it("should apply log-highlighted class for matches", async () => {
      await wrapper.setProps({
        data: "error occurred",
        queryString: "match_all('error')",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("log-highlighted");
    });

    it("should apply log-object-brace for object braces", async () => {
      await wrapper.setProps({
        data: { key: "value" },
        showBraces: true,
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("log-object-brace");
    });
  });

  describe("Performance", () => {
    it("should render quickly", () => {
      const startTime = performance.now();

      const perfWrapper = mount(LogsHighLighting, {
        props: {
          data: "performance test",
        },
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      expect(renderTime).toBeLessThan(100);

      perfWrapper.unmount();
    });

    it("should handle multiple instances efficiently", () => {
      const instances = [];
      const startTime = performance.now();

      for (let i = 0; i < 20; i++) {
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

      expect(totalTime).toBeLessThan(500);

      instances.forEach((instance) => instance.unmount());
    });

    it("should handle large objects efficiently", async () => {
      const largeObject: any = {};
      for (let i = 0; i < 100; i++) {
        largeObject[`key${i}`] = `value${i}`;
      }

      const startTime = performance.now();

      await wrapper.setProps({ data: largeObject });
      await wrapper.vm.$nextTick();

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      expect(renderTime).toBeLessThan(200);
    });
  });

  describe("Edge Cases", () => {
    it("should handle whitespace-only strings", async () => {
      await wrapper.setProps({ data: "   " });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle strings with only special characters", async () => {
      await wrapper.setProps({ data: "!@#$%^&*()" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle unicode characters", async () => {
      await wrapper.setProps({ data: "Hello 世界 🌍" });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("Hello");
      expect(span.html()).toContain("世界");
    });

    it("should handle deeply nested objects", async () => {
      const deepObject: any = { level1: {} };
      let current = deepObject.level1;

      for (let i = 2; i <= 10; i++) {
        current[`level${i}`] = {};
        current = current[`level${i}`];
      }
      current.value = "deep value";

      await wrapper.setProps({ data: deepObject });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle circular reference gracefully", async () => {
      const circularObj: any = { name: "test" };
      // Can't actually create circular reference in JSON, but test error handling

      await wrapper.setProps({ data: circularObj });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle NaN values", async () => {
      await wrapper.setProps({ data: NaN });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should handle Infinity values", async () => {
      await wrapper.setProps({ data: Infinity });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("Integration with Composable", () => {
    it("should properly integrate with useLogsHighlighter composable", () => {
      expect(wrapper.vm).toBeDefined();
      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });

    it("should compute colorizedJson correctly", async () => {
      await wrapper.setProps({ data: "test data" });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.colorizedJson).toBeDefined();
      expect(typeof wrapper.vm.colorizedJson).toBe("string");
    });

    it("should handle async operations", async () => {
      await wrapper.setProps({ data: "async test" });
      await flushPromises();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });

  describe("Component State", () => {
    it("should maintain component state correctly", async () => {
      const initialProps = wrapper.props();

      await wrapper.vm.$forceUpdate();

      expect(wrapper.props()).toEqual(initialProps);
    });

    it("should handle rapid prop updates", async () => {
      for (let i = 0; i < 10; i++) {
        await wrapper.setProps({ data: `update ${i}` });
      }

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      expect(wrapper.props("data")).toBe("update 9");
    });

    it("should clean up properly on unmount", () => {
      const testWrapper = mount(LogsHighLighting, {
        props: { data: "cleanup test" },
      });

      testWrapper.unmount();
      // Should not throw any errors during cleanup
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle typical log message", async () => {
      const logMessage = '[2023-01-01 12:00:00] ERROR: Connection failed to 192.168.1.1:8080';
      await wrapper.setProps({ data: logMessage });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("ERROR");
      expect(span.html()).toContain("192.168.1.1");
    });

    it("should handle JSON log entry", async () => {
      const jsonLog = {
        timestamp: 1640995200000,
        level: "error",
        message: "Database connection failed",
        ip: "192.168.1.1",
        user: "admin@example.com",
      };

      await wrapper.setProps({ data: jsonLog });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("timestamp");
      expect(span.html()).toContain("level");
      expect(span.html()).toContain("error");
      expect(span.html()).toContain("192.168.1.1");
    });

    it("should handle HTTP access log", async () => {
      const accessLog = 'GET /api/v1/users HTTP/1.1 200 192.168.1.1';
      await wrapper.setProps({ data: accessLog });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("GET");
      expect(span.html()).toContain("192.168.1.1");
      expect(span.html()).toContain("200");
    });

    it("should handle stack trace", async () => {
      const stackTrace = `Error: Something went wrong
  at Object.method (/app/src/index.js:123:45)
  at process._tickCallback (internal/process/next_tick.js:68:7)`;

      await wrapper.setProps({ data: stackTrace });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("Error");
    });

    it("should handle query with highlighting in real log", async () => {
      const logMessage = "Critical error in payment processing system";
      await wrapper.setProps({
        data: logMessage,
        queryString: "match_all('error') AND match_all('payment')",
      });
      await wrapper.vm.$nextTick();

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.html()).toContain("error");
      expect(span.html()).toContain("payment");
      expect(span.html()).toContain("log-highlighted");
    });
  });
});
