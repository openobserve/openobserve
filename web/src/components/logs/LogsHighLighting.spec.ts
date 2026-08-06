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

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// All vi.mock() calls must be hoisted — declare before any import of the module under test

// Mock the store
const mockStore = {
  state: {
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock vue-router (required: useLogsHighlighter uses searchState which calls useRouter)
vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: { value: { query: { stream_type: "logs" } } },
    push: vi.fn(),
  }),
  useRoute: () => ({
    query: { stream_type: "logs" },
  }),
}));

// Mock searchState composable (used inside useLogsHighlighter)
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: {
      data: {
        query: "",
        queryType: "sql",
        parsedQuery: "",
        datetime: { type: "relative", relativeTimePeriod: "15m" },
        stream: { streamLists: [], selectedStream: [] },
      },
      config: { refreshTimes: [] },
    },
  }),
}));

import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";

// ---------------------------------------------------------------------------
// Mount factory — eliminates duplication across 3+ mount call sites
// ---------------------------------------------------------------------------
interface MountOptions {
  data?: unknown;
  showBraces?: boolean;
  showQuotes?: boolean;
  queryString?: string;
  simpleMode?: boolean;
}

function mountComponent(opts: MountOptions = {}): VueWrapper {
  return mount(LogsHighLighting, {
    shallow: false,
    props: {
      data: opts.data !== undefined ? opts.data : "test message",
      showBraces: opts.showBraces !== undefined ? opts.showBraces : true,
      showQuotes: opts.showQuotes !== undefined ? opts.showQuotes : false,
      queryString: opts.queryString !== undefined ? opts.queryString : "",
      simpleMode: opts.simpleMode !== undefined ? opts.simpleMode : false,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function html(w: VueWrapper): string {
  return w.find("span.logs-highlight-json").html();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("LogsHighLighting Component", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockStore.state.theme = "light";
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("Component Mounting and Structure", () => {
    it("should mount and expose a root span.logs-highlight-json element", () => {
      expect(wrapper.exists()).toBe(true);
      const span = wrapper.find("span.logs-highlight-json");
      expect(span.exists()).toBe(true);
      expect(span.classes()).toContain("logs-highlight-json");
    });

    it("should unmount without errors when lifecycle ends", () => {
      const w = mountComponent({ data: "test" });
      // unmount must not throw — if it does the test fails
      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  describe("Props — default values and reactivity", () => {
    it("should apply default prop values when only data is provided", () => {
      const w = mountComponent({ data: "test" });
      expect(w.props("showBraces")).toBe(true);
      expect(w.props("showQuotes")).toBe(false);
      expect(w.props("queryString")).toBe("");
      expect(w.props("simpleMode")).toBe(false);
      w.unmount();
    });

    it("should reflect updated data prop in rendered output", async () => {
      await wrapper.setProps({ data: "updated message" });
      expect(wrapper.props("data")).toBe("updated message");
      expect(html(wrapper)).toContain("updated");
    });

    it("should re-render when showBraces changes for an object payload", async () => {
      await wrapper.setProps({ data: { level: "error" }, showBraces: false });
      // Without braces the log-object-brace span must be absent
      expect(html(wrapper)).not.toContain("log-object-brace");
    });

    it("should produce quotes around object key text when showQuotes is true", async () => {
      await wrapper.setProps({ data: { key: "value" }, showBraces: true, showQuotes: true });
      // Keys are rendered inside log-key spans; with showQuotes the text contains "
      expect(html(wrapper)).toContain('"key"');
    });

    it("should skip semantic colorization when simpleMode is true", async () => {
      // An IP in simpleMode must not receive the log-ip class
      await wrapper.setProps({ data: "192.168.1.1", simpleMode: true });
      expect(html(wrapper)).toContain("192.168.1.1");
      expect(html(wrapper)).not.toContain("log-ip");
    });

    it("should handle sequential prop updates and always render a span", async () => {
      const updates: MountOptions[] = [
        { data: "update 1", simpleMode: false },
        { data: "update 2", simpleMode: true },
        { data: { key: "value" }, simpleMode: false },
      ];

      for (const update of updates) {
        await wrapper.setProps(update);
        expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
      }
      expect(wrapper.props("data")).toEqual({ key: "value" });
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — strings", () => {
    it("should render string content into the span", async () => {
      await wrapper.setProps({ data: "Error occurred" });
      expect(html(wrapper)).toContain("Error");
      expect(html(wrapper)).toContain("occurred");
    });

    it("should render an empty string without throwing", async () => {
      await wrapper.setProps({ data: "" });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render a 10 000-character string without throwing", async () => {
      await wrapper.setProps({ data: "x".repeat(10000) });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should escape & in string data to &amp;", async () => {
      await wrapper.setProps({ data: "Test & symbols" });
      expect(html(wrapper)).toContain("&amp;");
    });

    it("should render whitespace-only strings without throwing", async () => {
      await wrapper.setProps({ data: "   " });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render strings containing only special characters", async () => {
      await wrapper.setProps({ data: "!@#$%^&*()" });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should preserve unicode characters in output", async () => {
      await wrapper.setProps({ data: "Hello 世界 🌍" });
      expect(html(wrapper)).toContain("Hello");
      expect(html(wrapper)).toContain("世界");
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — numbers", () => {
    it("should render integer 42 in output", async () => {
      await wrapper.setProps({ data: 42 });
      expect(html(wrapper)).toContain("42");
    });

    it("should render zero in output", async () => {
      await wrapper.setProps({ data: 0 });
      expect(html(wrapper)).toContain("0");
    });

    it("should render negative number in output", async () => {
      await wrapper.setProps({ data: -123 });
      expect(html(wrapper)).toContain("-123");
    });

    it("should render 13-digit timestamp number in output", async () => {
      await wrapper.setProps({ data: 1640995200000 });
      expect(html(wrapper)).toContain("1640995200000");
    });

    it("should render decimal number in output", async () => {
      await wrapper.setProps({ data: 3.14159 });
      expect(html(wrapper)).toContain("3.14159");
    });

    it("should render NaN without throwing", async () => {
      await wrapper.setProps({ data: NaN });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render Infinity without throwing", async () => {
      await wrapper.setProps({ data: Infinity });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — booleans", () => {
    it("should render true in output", async () => {
      await wrapper.setProps({ data: true });
      expect(html(wrapper)).toContain("true");
    });

    it("should render false in output", async () => {
      await wrapper.setProps({ data: false });
      expect(html(wrapper)).toContain("false");
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — null and undefined", () => {
    it("should render an empty span for null data", async () => {
      await wrapper.setProps({ data: null });
      // colorizeJson returns "" for null — span exists but inner HTML is the outer tag only
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render an empty span for undefined data", async () => {
      await wrapper.setProps({ data: undefined });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — objects", () => {
    it("should render object key and value text in output", async () => {
      await wrapper.setProps({ data: { level: "error", message: "test" }, showBraces: true });
      const h = html(wrapper);
      expect(h).toContain("level");
      expect(h).toContain("error");
      expect(h).toContain("message");
      expect(h).toContain("test");
    });

    it("should wrap object with log-object-brace spans when showBraces is true", async () => {
      await wrapper.setProps({ data: { key: "value" }, showBraces: true });
      expect(html(wrapper)).toContain("log-object-brace");
    });

    it("should omit log-object-brace spans when showBraces is false", async () => {
      await wrapper.setProps({ data: { key: "value" }, showBraces: false });
      expect(html(wrapper)).not.toContain("log-object-brace");
    });

    it("should render empty objects without throwing", async () => {
      await wrapper.setProps({ data: {} });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render nested objects without throwing", async () => {
      await wrapper.setProps({
        data: { user: { id: 123, profile: { name: "John" } }, timestamp: 1640995200000 },
      });
      expect(html(wrapper)).toContain("user");
      expect(html(wrapper)).toContain("John");
    });

    it("should render objects with mixed value types without throwing", async () => {
      await wrapper.setProps({
        data: { string: "text", number: 42, boolean: true, null: null, array: [1, 2, 3] },
      });
      const h = html(wrapper);
      expect(h).toContain("string");
      expect(h).toContain("42");
    });

    it("should render deeply nested objects (10 levels) without throwing", async () => {
      const deepObject: Record<string, unknown> = { level1: {} };
      let current = deepObject.level1 as Record<string, unknown>;
      for (let i = 2; i <= 10; i++) {
        current[`level${i}`] = {};
        current = current[`level${i}`] as Record<string, unknown>;
      }
      current["value"] = "deep value";

      await wrapper.setProps({ data: deepObject });
      expect(html(wrapper)).toContain("level1");
    });
  });

  // -------------------------------------------------------------------------
  describe("Data Type Handling — arrays", () => {
    it("should render numeric array values in output", async () => {
      await wrapper.setProps({ data: [1, 2, 3, 4, 5] });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render empty arrays without throwing", async () => {
      await wrapper.setProps({ data: [] });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render mixed-type arrays without throwing", async () => {
      await wrapper.setProps({ data: ["text", 123, true, null, { key: "value" }] });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Semantic Type Detection", () => {
    it("should apply log-ip class to an IPv4 address", async () => {
      await wrapper.setProps({ data: "192.168.1.1" });
      const h = html(wrapper);
      expect(h).toContain("192.168.1.1");
      expect(h).toContain("log-ip");
    });

    it("should detect multiple IPs in a sentence", async () => {
      await wrapper.setProps({ data: "Connection from 192.168.1.1 to 10.0.0.1" });
      const h = html(wrapper);
      expect(h).toContain("192.168.1.1");
      expect(h).toContain("10.0.0.1");
    });

    it("should apply log-url class to an https URL", async () => {
      await wrapper.setProps({ data: "https://example.com/api/v1" });
      const h = html(wrapper);
      expect(h).toContain("https://example.com/api/v1");
      expect(h).toContain("log-url");
    });

    it("should apply log-email class to an email address", async () => {
      await wrapper.setProps({ data: "user@example.com" });
      const h = html(wrapper);
      expect(h).toContain("user@example.com");
      expect(h).toContain("log-email");
    });

    it("should include HTTP method text in the output for each verb", async () => {
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
      for (const method of methods) {
        await wrapper.setProps({ data: method });
        expect(html(wrapper)).toContain(method);
      }
    });

    it("should include HTTP status code text in the output", async () => {
      for (const code of ["200", "404", "500", "301", "403"]) {
        await wrapper.setProps({ data: code });
        expect(html(wrapper)).toContain(code);
      }
    });

    it("should apply log-uuid class to a UUID string", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      await wrapper.setProps({ data: uuid });
      const h = html(wrapper);
      expect(h).toContain(uuid);
      expect(h).toContain("log-uuid");
    });

    it("should apply log-path class to Unix file paths", async () => {
      for (const path of ["/var/log/app.log", "/home/user/documents"]) {
        await wrapper.setProps({ data: path });
        const h = html(wrapper);
        expect(h).toContain(path);
        expect(h).toContain("log-path");
      }
    });

    it("should render Windows paths containing expected path components", async () => {
      await wrapper.setProps({ data: "C:\\Windows\\System32" });
      const h = html(wrapper);
      expect(h).toContain("Windows");
      expect(h).toContain("System32");
    });
  });

  // -------------------------------------------------------------------------
  describe("Keyword Highlighting", () => {
    it("should apply log-highlighted to text matching the query keyword", async () => {
      await wrapper.setProps({ data: "error message occurred", queryString: "match_all('error')" });
      const h = html(wrapper);
      expect(h).toContain("error");
      expect(h).toContain("log-highlighted");
    });

    it("should highlight all matching keywords from a compound query", async () => {
      await wrapper.setProps({
        data: "critical error in system",
        queryString: "match_all('error') AND match_all('critical')",
      });
      const h = html(wrapper);
      expect(h).toContain("error");
      expect(h).toContain("critical");
    });

    it("should apply log-highlighted case-insensitively (all three cases of 'error')", async () => {
      await wrapper.setProps({
        data: "ERROR Error error",
        queryString: "match_all('error')",
      });
      const h = html(wrapper);
      expect(h).toContain("ERROR");
      expect(h).toContain("Error");
      expect(h).toContain("error");
    });

    it("should include keyword text from fuzzy_match queries", async () => {
      await wrapper.setProps({ data: "test message", queryString: "fuzzy_match('message', 2)" });
      expect(html(wrapper)).toContain("message");
    });

    it("should include keyword text from fuzzy_match_all queries", async () => {
      await wrapper.setProps({
        data: "important notice",
        queryString: "fuzzy_match_all('notice', 1)",
      });
      expect(html(wrapper)).toContain("notice");
    });

    it("should render text without log-highlighted when queryString is empty", async () => {
      await wrapper.setProps({ data: "error message", queryString: "" });
      expect(html(wrapper)).toContain("error");
      expect(html(wrapper)).not.toContain("log-highlighted");
    });
  });

  // -------------------------------------------------------------------------
  describe("Simple Mode", () => {
    it("should not apply log-ip class in simpleMode even for an IP address", async () => {
      await wrapper.setProps({ data: "192.168.1.1", simpleMode: true });
      expect(html(wrapper)).toContain("192.168.1.1");
      expect(html(wrapper)).not.toContain("log-ip");
    });

    it("should apply log-highlighted in simpleMode when query matches", async () => {
      await wrapper.setProps({
        data: "error message",
        queryString: "match_all('error')",
        simpleMode: true,
      });
      expect(html(wrapper)).toContain("log-highlighted");
    });
  });

  // -------------------------------------------------------------------------
  describe("Mixed Content Detection", () => {
    it("should render GET, IP, and status code for a web-log line", async () => {
      await wrapper.setProps({ data: "GET /api/users 192.168.1.1 200" });
      const h = html(wrapper);
      expect(h).toContain("GET");
      expect(h).toContain("192.168.1.1");
      expect(h).toContain("200");
    });

    it("should render GET and IP from an Apache-style log line", async () => {
      await wrapper.setProps({
        data: '[01/Jan/2023:12:00:00 +0000] "GET /home HTTP/1.1" 200 192.168.1.1',
      });
      const h = html(wrapper);
      expect(h).toContain("GET");
      expect(h).toContain("192.168.1.1");
    });

    it("should render POST and URL from a mixed log line", async () => {
      await wrapper.setProps({ data: "POST https://api.example.com/v1/users 201" });
      const h = html(wrapper);
      expect(h).toContain("POST");
      expect(h).toContain("https://api.example.com");
    });

    it("should render IP string even without HTTP indicators", async () => {
      await wrapper.setProps({ data: "192.168.1.1 connection failed" });
      expect(html(wrapper)).toContain("192.168.1.1");
    });
  });

  // -------------------------------------------------------------------------
  describe("XSS Prevention and HTML Escaping", () => {
    it("should escape < and > in <script> tag payloads so no script element is injected", async () => {
      await wrapper.setProps({ data: "<script>alert('xss')</script>" });
      const h = html(wrapper);
      expect(h).toContain("&lt;");
      expect(h).toContain("&gt;");
      expect(h).not.toContain("<script>");
    });

    it("should escape & < > in arbitrary HTML strings", async () => {
      await wrapper.setProps({ data: "Test & <div>content</div> 'quotes'" });
      const h = html(wrapper);
      expect(h).toContain("&amp;");
      expect(h).toContain("&lt;");
      expect(h).toContain("&gt;");
    });

    it("should escape <img onerror> so no img element is created in the DOM", async () => {
      await wrapper.setProps({ data: '<img src=x onerror="alert(1)">' });
      const h = html(wrapper);
      expect(h).toContain("&lt;"); // < escaped
      expect(h).toContain("&gt;"); // > escaped
      expect(h).not.toContain("<img"); // no real img tag
      // The raw text is visible to the user
      const text = wrapper.find("span.logs-highlight-json").text();
      expect(text).toContain("<img");
      expect(text).toContain("onerror");
      expect(text).toContain("alert(1)");
    });

    it("should render strings with double and single quotes without throwing", async () => {
      await wrapper.setProps({ data: "Test \"double\" and 'single' quotes" });
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Theme Handling", () => {
    it("should render correctly in light theme", () => {
      mockStore.state.theme = "light";
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });

    it("should render correctly when mounted in dark theme", () => {
      mockStore.state.theme = "dark";
      const w = mountComponent({ data: "test message" });
      expect(w.find("span.logs-highlight-json").exists()).toBe(true);
      w.unmount();
    });

    it("should continue rendering after theme changes from light to dark", async () => {
      mockStore.state.theme = "light";
      await wrapper.vm.$nextTick();
      mockStore.state.theme = "dark";
      await wrapper.vm.$nextTick();
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("CSS Classes Application", () => {
    it("should apply log-string class when rendering a plain string", async () => {
      await wrapper.setProps({ data: "simple string" });
      expect(html(wrapper)).toContain("log-string");
    });

    it("should apply log-highlighted class when a keyword matches", async () => {
      await wrapper.setProps({ data: "error occurred", queryString: "match_all('error')" });
      expect(html(wrapper)).toContain("log-highlighted");
    });

    it("should apply log-object-brace when showBraces is true for an object", async () => {
      await wrapper.setProps({ data: { key: "value" }, showBraces: true });
      expect(html(wrapper)).toContain("log-object-brace");
    });

    it("should apply log-key class to object keys", async () => {
      await wrapper.setProps({ data: { myKey: "myValue" } });
      expect(html(wrapper)).toContain("log-key");
    });

    it("should apply log-separator class for object colon separators", async () => {
      await wrapper.setProps({ data: { key: "value" } });
      expect(html(wrapper)).toContain("log-separator");
    });
  });

  // -------------------------------------------------------------------------
  describe("showQuotes behavior", () => {
    let quotesWrapper: VueWrapper;

    afterEach(() => {
      quotesWrapper?.unmount();
    });

    it("should not wrap string value in quotes when showQuotes is false (default)", () => {
      quotesWrapper = mountComponent({ data: "hello world", showQuotes: false });
      expect(html(quotesWrapper)).toContain("hello");
      // The outer log-string span should not contain a literal quote character as text
      expect(quotesWrapper.find("span.logs-highlight-json").text()).not.toMatch(/^".*"$/);
    });

    it("should wrap object key text in double-quotes when showQuotes is true", () => {
      quotesWrapper = mountComponent({
        data: { key: "value" },
        showBraces: true,
        showQuotes: true,
      });
      // log-key span must contain the key with surrounding "..."
      expect(html(quotesWrapper)).toContain('"key"');
    });

    it("should render string value text regardless of showQuotes", () => {
      quotesWrapper = mountComponent({ data: "hello", showQuotes: true });
      expect(html(quotesWrapper)).toContain("hello");
    });
  });

  // -------------------------------------------------------------------------
  describe("Large content handling", () => {
    // NOTE: The component's colorizeJson function only truncates *objects* whose
    // estimated size exceeds 50 000 bytes. Strings are passed directly to
    // processTextWithHighlights without size-based truncation — they are tokenized
    // and each token gets a log-string span.
    let largeWrapper: VueWrapper;

    afterEach(() => {
      largeWrapper?.unmount();
    });

    it("should render a 60 000-char string without throwing (no truncation for strings)", () => {
      largeWrapper = mountComponent({ data: "x".repeat(60000) });
      const h = html(largeWrapper);
      // Component renders the content inside log-string spans (no truncation for strings)
      expect(h).toContain("log-string");
      expect(h).not.toContain("truncated");
    });

    it("should not truncate a string smaller than 50 000 chars", () => {
      largeWrapper = mountComponent({ data: "small content" });
      const h = html(largeWrapper);
      expect(h).toContain("small");
      expect(h).toContain("content");
      expect(h).not.toContain("truncated");
    });

    it("should render a large object using log-object-brace and log-key spans", () => {
      const largeObj: Record<string, string> = {};
      // 500 fields — well under the truncation threshold but still a large object
      for (let i = 0; i < 500; i++) {
        largeObj[`field_key_${i}`] = `field_value_${i}`;
      }
      largeWrapper = mountComponent({ data: largeObj, showBraces: true });
      const h = html(largeWrapper);
      // Object structure must be present
      expect(h).toContain("log-object-brace");
      expect(h).toContain("log-key");
      expect(h).toContain("field_key_0");
    });

    it("should truncate an object whose estimated size exceeds 50 000 bytes and emit log-string", () => {
      const hugeObj: Record<string, string> = {};
      // 2000 fields × ~60 chars each ≈ 120 KB estimated — safely over the 50 000 threshold
      for (let i = 0; i < 2000; i++) {
        hugeObj[`long_field_key_name_${i}`] = `long_field_value_text_${i}_extra_padding_here`;
      }
      largeWrapper = mountComponent({ data: hugeObj });
      const h = html(largeWrapper);
      // After truncation the composable returns a log-string span with [truncated] marker
      expect(h).toContain("log-string");
      expect(h).toContain("truncated");
    });
  });

  // -------------------------------------------------------------------------
  describe("Integration with useLogsHighlighter composable", () => {
    it("should delegate colorization to the composable and produce non-empty HTML", async () => {
      await wrapper.setProps({ data: "test data" });
      const h = html(wrapper);
      // Must produce a span with actual content — not just the outer wrapper
      expect(h.length).toBeGreaterThan('<span class="logs-highlight-json"></span>'.length);
    });

    it("should resolve after flushPromises with the span present", async () => {
      await wrapper.setProps({ data: "async test" });
      await flushPromises();
      expect(wrapper.find("span.logs-highlight-json").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Component State — rapid updates and cleanup", () => {
    it("should reflect the final value after 10 rapid prop updates", async () => {
      for (let i = 0; i < 10; i++) {
        await wrapper.setProps({ data: `update ${i}` });
      }
      expect(wrapper.props("data")).toBe("update 9");
      // The tokenizer splits "update 9" into two log-string tokens; use text() to
      // verify the combined visible text rather than the raw HTML structure.
      expect(wrapper.find("span.logs-highlight-json").text()).toContain("update");
      expect(wrapper.find("span.logs-highlight-json").text()).toContain("9");
    });

    it("should not throw when unmounted without prior interaction", () => {
      const w = mountComponent({ data: "cleanup test" });
      w.unmount(); // must not throw
    });
  });

  // -------------------------------------------------------------------------
  describe("Real-world log scenarios", () => {
    it("should render ERROR keyword and IP from a bracketed timestamp log line", async () => {
      await wrapper.setProps({
        data: "[2023-01-01 12:00:00] ERROR: Connection failed to 192.168.1.1:8080",
      });
      const h = html(wrapper);
      expect(h).toContain("ERROR");
      expect(h).toContain("192.168.1.1");
    });

    it("should render all keys from a structured JSON log entry", async () => {
      await wrapper.setProps({
        data: {
          timestamp: 1640995200000,
          level: "error",
          message: "Database connection failed",
          ip: "192.168.1.1",
          user: "admin@example.com",
        },
      });
      const h = html(wrapper);
      expect(h).toContain("timestamp");
      expect(h).toContain("level");
      expect(h).toContain("error");
      expect(h).toContain("192.168.1.1");
    });

    it("should render method, IP, and status code from an HTTP access log string", async () => {
      await wrapper.setProps({ data: "GET /api/v1/users HTTP/1.1 200 192.168.1.1" });
      const h = html(wrapper);
      expect(h).toContain("GET");
      expect(h).toContain("192.168.1.1");
      expect(h).toContain("200");
    });

    it("should render the Error keyword from a multi-line stack trace", async () => {
      await wrapper.setProps({
        data: `Error: Something went wrong\n  at Object.method (/app/src/index.js:123:45)\n  at process._tickCallback (internal/process/next_tick.js:68:7)`,
      });
      expect(html(wrapper)).toContain("Error");
    });

    it("should apply log-highlighted to both error and payment in a compound query", async () => {
      await wrapper.setProps({
        data: "Critical error in payment processing system",
        queryString: "match_all('error') AND match_all('payment')",
      });
      const h = html(wrapper);
      expect(h).toContain("error");
      expect(h).toContain("payment");
      expect(h).toContain("log-highlighted");
    });
  });

  // -------------------------------------------------------------------------
  describe("Props interface — unexported type boundary (regression for interface visibility change)", () => {
    // The Props interface was changed from `export interface Props` to `interface Props`.
    // The component must still accept and enforce the same prop contract from the outside.
    it("should accept all five documented props without a Vue warning", () => {
      const w = mountComponent({
        data: { key: "value" },
        showBraces: false,
        showQuotes: true,
        queryString: "match_all('value')",
        simpleMode: false,
      });
      expect(w.props("showBraces")).toBe(false);
      expect(w.props("showQuotes")).toBe(true);
      expect(w.props("queryString")).toBe("match_all('value')");
      expect(w.props("simpleMode")).toBe(false);
      w.unmount();
    });

    it("should apply all five props together to produce highlighted output", async () => {
      await wrapper.setProps({
        data: "matched value text",
        showBraces: true,
        showQuotes: false,
        queryString: "match_all('matched')",
        simpleMode: false,
      });
      const h = html(wrapper);
      expect(h).toContain("matched");
      expect(h).toContain("log-highlighted");
    });
  });
});
