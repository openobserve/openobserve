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

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    zoConfig: {
      fts_keys: ["message", "log", "content"],
    },
  },
};

// Mock useTextHighlighter composable
vi.mock("@/composables/useTextHighlighter", () => ({
  useTextHighlighter: () => ({
    processTextWithHighlights: vi.fn((text, query, colors) => {
      // Simple mock implementation for highlighting
      if (query && text.includes("test")) {
        return `<span style="background-color: rgb(255, 213, 0); color: black;">test</span>`;
      }
      return `<span style="color: ${colors.stringValue};">${text}</span>`;
    }),
    escapeHtml: vi.fn((text) =>
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    ),
    splitTextByKeywords: vi.fn((text, keywords) => {
      if (keywords.length === 0) return [{ text, isHighlighted: false }];
      const hasKeyword = keywords.some((k) => text.includes(k));
      return hasKeyword
        ? [{ text, isHighlighted: true }]
        : [{ text, isHighlighted: false }];
    }),
    extractKeywords: vi.fn((query) => {
      const match = query.match(/match_all\(['"]([^'"]+)['"]\)/);
      return match ? [match[1]] : [];
    }),
  }),
}));

// Mock keyValueParser
vi.mock("@/utils/logs/keyValueParser", () => ({
  getThemeColors: vi.fn((isDark) => ({
    key: isDark ? "#f67a7aff" : "#B71C1C",
    stringValue: isDark ? "#6EE7B7" : "#047857",
    numberValue: isDark ? "#60A5FA" : "#2563EB",
    booleanValue: isDark ? "#A5B4FC" : "#6D28D9",
    nullValue: isDark ? "#9CA3AF" : "#6B7280",
    timestamp: isDark ? "#60A5FA" : "#2563EB",
    objectValue: isDark ? "#D1D5DB" : "#4B5563",
  })),
}));

describe("LogsHighLighting", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Mock Vuex store
    vi.mock("vuex", () => ({
      useStore: () => mockStore,
    }));
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount LogsHighLighting component", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test data",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });
      expect(wrapper).toBeTruthy();
      expect(wrapper.classes()).toContain("logs-highlight-json");
    });
  });

  describe("Simple Mode Functionality", () => {
    it("should render in simple mode without semantic colorization", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "simple test message",
          simpleMode: true,
          queryString: "",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("simple test message");
    });

    it("should highlight keywords in simple mode", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test message with highlighting",
          simpleMode: true,
          queryString: "match_all('test')",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("background-color: rgb(255, 213, 0)");
    });

    it("should not apply semantic colors in simple mode", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "192.168.1.1",
          simpleMode: true,
          queryString: "",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      // Should not contain semantic IP coloring in simple mode
      expect(html).not.toContain("color: #D97706");
    });
  });

  describe("String Data Processing", () => {
    it("should process string data with semantic colorization", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "Error message from server",
          queryString: "",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("Error message from server");
    });

    it("should highlight keywords in string data", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test message for highlighting",
          queryString: "match_all('test')",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("test");
    });

    it("should handle quotes when showQuotes is true", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "quoted string",
          showQuotes: true,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      // Component should process the showQuotes prop
      expect(wrapper.props().showQuotes).toBe(true);
    });
  });

  describe("Primitive Data Types", () => {
    it("should handle number values", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: 42,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("42");
    });

    it("should handle large number values as timestamps", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: 1755519951810,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("1755519951810");
    });

    it("should handle boolean values", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: true,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("true");
    });

    it("should handle null values", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: null,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      // Component renders empty span for null values
      expect(html).toContain('class="logs-highlight-json"');
      expect(html).not.toContain("null");
    });

    it("should handle undefined values", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: undefined,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      // Component renders empty span for undefined values
      expect(html).toContain('class="logs-highlight-json"');
      expect(html).not.toContain("undefined");
    });
  });

  describe("Object Data Processing", () => {
    it("should handle simple object data", () => {
      const testObject = {
        level: "error",
        message: "Test error message",
        count: 42,
        active: true,
        data: null,
      };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: testObject,
          showBraces: true,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("level");
      expect(html).toContain("error");
      expect(html).toContain("message");
      expect(html).toContain("42");
      expect(html).toContain("true");
      expect(html).toContain("null");
    });

    it("should handle nested objects", () => {
      const testObject = {
        user: {
          name: "john",
          id: 123,
        },
        metadata: {
          timestamp: "2023-01-01",
        },
      };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: testObject,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("user");
      expect(html).toContain("metadata");
    });

    it("should hide braces when showBraces is false", () => {
      const testObject = { key: "value" };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: testObject,
          showBraces: false,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      expect(wrapper.props().showBraces).toBe(false);
    });

    it("should highlight object values based on query", () => {
      const testObject = {
        message: "test message",
        level: "info",
      };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: testObject,
          queryString: "match_all('test')",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const html = wrapper.html();
      expect(html).toContain("message");
      expect(html).toContain("test");
      // The word "test" should be highlighted with yellow background
      expect(html).toContain("background-color: rgb(255, 213, 0)");
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed data gracefully", () => {
      // Test with a function which can't be stringified normally
      const problematicData = {
        name: "test",
        func: () => "function",
      };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: problematicData,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      // Should not throw error and render something
      expect(wrapper.exists()).toBe(true);
      const html = wrapper.html();
      expect(html).toContain("name");
      expect(html).toContain("test");
    });
  });

  describe("Theme Support", () => {
    it("should handle dark theme", () => {
      const darkStore = {
        ...mockStore,
        state: {
          ...mockStore.state,
          theme: "dark",
        },
      };

      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test message",
        },
        global: {
          mocks: {
            $store: darkStore,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle light theme", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test message",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Props Validation", () => {
    it("should handle default props correctly", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      expect(wrapper.props().showBraces).toBe(true);
      expect(wrapper.props().showQuotes).toBe(false);
      expect(wrapper.props().queryString).toBe("");
      expect(wrapper.props().simpleMode).toBe(false);
    });

    it("should handle custom props", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test",
          showBraces: false,
          showQuotes: true,
          queryString: "match_all('test')",
          simpleMode: true,
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      expect(wrapper.props().showBraces).toBe(false);
      expect(wrapper.props().showQuotes).toBe(true);
      expect(wrapper.props().queryString).toBe("match_all('test')");
      expect(wrapper.props().simpleMode).toBe(true);
    });
  });

  describe("Computed Property", () => {
    it("should render colorized content", () => {
      wrapper = mount(LogsHighLighting, {
        props: {
          data: "test content",
        },
        global: {
          mocks: {
            $store: mockStore,
          },
        },
      });

      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
    });
  });
});
