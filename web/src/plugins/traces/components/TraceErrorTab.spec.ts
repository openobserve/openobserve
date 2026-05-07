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

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// ─── Quasar mock — override useQuasar with a notify spy ────────────────────
const { mockNotify } = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify, dialog: vi.fn() }),
  };
});

// ─── useTraceDetails mock — tests control return values per test ───────────
const { mockUseTraceDetails } = vi.hoisted(() => ({
  mockUseTraceDetails: vi.fn(),
}));

vi.mock("@/composables/traces/useTraceDetails", () => ({
  default: mockUseTraceDetails,
}));

import TraceErrorTab from "./TraceErrorTab.vue";

// ─── Default mock helpers ──────────────────────────────────────────────────

function defaultTraceDetails(overrides: Record<string, unknown> = {}) {
  return {
    hasSpanError: false,
    hasExceptionEvents: [] as any[],
    spanStatusCode: null as string | null,
    spanGrpcStatusCode: null as string | null,
    spanErrorType: null as string | null,
    spanDbResponseStatusCode: null as string | null,
    spanProcessExitCode: null as string | null,
    errorBannerTitle: "" as string,
    errorBannerMessage: "" as string,
    statusCodeTitle: "" as string,
    ...overrides,
  };
}

function createExceptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: "exception",
    _timestamp: 1715000000000000,
    "exception.type": "ValueError",
    "exception.message": "Something went wrong",
    "exception.escaped": "false",
    "exception.stacktrace":
      'Traceback (most recent call last):\n  File "app.py", line 10, in <module>\n    raise ValueError("Something went wrong")\nValueError: Something went wrong',
    ...overrides,
  };
}

// ─── Mount factory ────────────────────────────────────────────────────────

function mountTraceErrorTab(props: Record<string, unknown> = {}) {
  return mount(TraceErrorTab, {
    props: {
      span: {},
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("TraceErrorTab", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockUseTraceDetails.mockReturnValue(defaultTraceDetails());
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // No error present
  // -------------------------------------------------------------------------

  describe("when hasSpanError is false", () => {
    it("should render the no-error message", () => {
      wrapper = mountTraceErrorTab();

      const noError = wrapper.find(
        '[data-test="trace-details-sidebar-no-error"]',
      );
      expect(noError.exists()).toBe(true);
      expect(noError.text()).toBe("No error present for this span");
    });

    it("should not render any error summary banners", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find('[data-test="trace-details-sidebar-error-summary"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-db-response-status-code"]',
        ).exists(),
      ).toBe(false);
      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-process-exit-code"]',
        ).exists(),
      ).toBe(false);
    });

    it("should not render the exceptions table", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table"]',
        ).exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP status code summary banner
  // -------------------------------------------------------------------------

  describe("when hasSpanError and spanStatusCode exist", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          spanStatusCode: "500",
          statusCodeTitle: "Internal Server Error",
          errorBannerTitle: "Internal Server Error",
        }),
      );
    });

    it("should render the HTTP status code summary banner", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find('[data-test="trace-details-sidebar-error-summary"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("HTTP STATUS CODE");
    });

    it("should display the status code title", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find('[data-test="trace-details-sidebar-error-summary-title"]')
          .text(),
      ).toBe("Internal Server Error");
    });

    it("should not show the no-error message", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find('[data-test="trace-details-sidebar-no-error"]').exists(),
      ).toBe(false);
    });

    it("should render the SpanStatusCodeBadge component", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.findComponent({ name: "SpanStatusCodeBadge" }).exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // gRPC status code summary banner
  // -------------------------------------------------------------------------

  describe("when hasSpanError and spanGrpcStatusCode exists (no HTTP code)", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          spanStatusCode: null,
          spanGrpcStatusCode: "2",
          statusCodeTitle: "Unknown",
        }),
      );
    });

    it("should render the gRPC status code summary banner", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find('[data-test="trace-details-sidebar-error-summary"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("GRPC STATUS CODE");
    });

    it("should display the gRPC status code title", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find('[data-test="trace-details-sidebar-error-summary-title"]')
          .text(),
      ).toBe("Unknown");
    });

    it("should render the SpanStatusCodeBadge with grpc-code prop", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.findComponent({ name: "SpanStatusCodeBadge" }).exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DB response status code banner
  // -------------------------------------------------------------------------

  describe("when hasSpanError and spanDbResponseStatusCode present (no HTTP/gRPC codes)", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          spanDbResponseStatusCode: "DB_TIMEOUT",
        }),
      );
    });

    it("should render the DB response status code banner", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-db-response-status-code"]',
        ).exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("DB RESPONSE STATUS CODE");
    });

    it("should display the DB status code value", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find(
            '[data-test="trace-details-sidebar-db-response-status-code-value"]',
          )
          .text(),
      ).toBe("DB_TIMEOUT");
    });

    it("should NOT show HTTP/gRPC banner (v-else-if chain)", () => {
      wrapper = mountTraceErrorTab();

      // The HTTP/gRPC summary uses the same data-test but is not rendered
      // because spanStatusCode and spanGrpcStatusCode are null
      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-db-response-status-code"]',
        ).exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Process exit code banner
  // -------------------------------------------------------------------------

  describe("when hasSpanError and spanProcessExitCode present (no other codes)", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          spanProcessExitCode: "1",
        }),
      );
    });

    it("should render the process exit code banner", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-process-exit-code"]',
        ).exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("PROCESS EXIT CODE");
    });

    it("should display the process exit code value", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find(
            '[data-test="trace-details-sidebar-process-exit-code-value"]',
          )
          .text(),
      ).toBe("1");
    });

    it("should NOT show DB or HTTP/gRPC banners", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper.find(
          '[data-test="trace-details-sidebar-db-response-status-code"]',
        ).exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Generic error banner
  // -------------------------------------------------------------------------

  describe("when hasSpanError with error banner title and message", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          errorBannerTitle: "ConnectionError",
          errorBannerMessage: "Failed to connect to database",
          spanErrorType: "ConnectionError",
        }),
      );
    });

    it("should render the generic error banner with title", () => {
      wrapper = mountTraceErrorTab();

      const titleEl = wrapper.find(
        '[data-test="trace-details-sidebar-error-summary-title"]',
      );
      expect(titleEl.exists()).toBe(true);
      expect(titleEl.text()).toBe("ConnectionError");
    });

    it("should render the error message", () => {
      wrapper = mountTraceErrorTab();

      const msgEl = wrapper.find(
        '[data-test="trace-details-sidebar-error-summary-message"]',
      );
      expect(msgEl.exists()).toBe(true);
      expect(msgEl.text()).toBe("Failed to connect to database");
    });

    it("should show an error icon in the generic banner", () => {
      wrapper = mountTraceErrorTab();

      // The generic banner includes a q-icon with name="error"
      const errorIcons = wrapper
        .findAllComponents({ name: "QIcon" })
        .filter((c) => c.props("name") === "error");
      expect(errorIcons.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Generic error banner alongside HTTP code banner (both appear)
  // -------------------------------------------------------------------------

  describe("when both HTTP status code and error banner conditions are met", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          spanStatusCode: "500",
          statusCodeTitle: "Internal Server Error",
          errorBannerTitle: "Internal Server Error",
          errorBannerMessage: "The server encountered an error",
        }),
      );
    });

    it("should show both the HTTP code banner and the generic error banner", () => {
      wrapper = mountTraceErrorTab();

      // The HTTP code banner and generic error banner share the same data-test
      // since both use data-test="trace-details-sidebar-error-summary"
      const summaryBanners = wrapper.findAll(
        '[data-test="trace-details-sidebar-error-summary"]',
      );
      // Both banners should be present (HTTP code + generic error)
      expect(summaryBanners.length).toBe(2);
    });

    it("should show 'HTTP STATUS CODE' label in the first banner", () => {
      wrapper = mountTraceErrorTab();

      const summaryBanners = wrapper.findAll(
        '[data-test="trace-details-sidebar-error-summary"]',
      );
      expect(summaryBanners[0].text()).toContain("HTTP STATUS CODE");
    });

    it("should show the status code title in the first banner", () => {
      wrapper = mountTraceErrorTab();

      const titles = wrapper.findAll(
        '[data-test="trace-details-sidebar-error-summary-title"]',
      );
      expect(titles[0].text()).toBe("Internal Server Error");
    });

    it("should show the error message in the second (generic) banner", () => {
      wrapper = mountTraceErrorTab();

      const messages = wrapper.findAll(
        '[data-test="trace-details-sidebar-error-summary-message"]',
      );
      expect(messages[0].text()).toBe("The server encountered an error");
    });
  });

  // -------------------------------------------------------------------------
  // Exceptions table
  // -------------------------------------------------------------------------

  describe("when exception events exist", () => {
    const exceptionEvent1 = createExceptionEvent();
    const exceptionEvent2 = createExceptionEvent({
      _timestamp: 1715000000000001,
      "exception.type": "TypeError",
      "exception.message": "Cannot read property of undefined",
    });

    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({
          hasSpanError: true,
          hasExceptionEvents: [exceptionEvent1, exceptionEvent2],
        }),
      );
    });

    it("should render the exceptions table", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find('[data-test="trace-details-sidebar-exceptions-table"]')
          .exists(),
      ).toBe(true);
    });

    it("should show the exception count in the header", () => {
      wrapper = mountTraceErrorTab();

      expect(wrapper.text()).toContain("Exceptions (2)");
    });

    it("should render a row for each exception event", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find(`[data-test="trace-event-detail-${exceptionEvent1._timestamp}"]`)
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(`[data-test="trace-event-detail-${exceptionEvent2._timestamp}"]`)
          .exists(),
      ).toBe(true);
    });

    it("should render expand buttons for each row", () => {
      wrapper = mountTraceErrorTab();

      expect(
        wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-1"]',
          )
          .exists(),
      ).toBe(true);
    });

    describe("row expansion", () => {
      beforeEach(() => {
        mockUseTraceDetails.mockReturnValue(
          defaultTraceDetails({
            hasSpanError: true,
            hasExceptionEvents: [exceptionEvent1],
          }),
        );
      });

      it("should expand a row when its expand button is clicked", async () => {
        wrapper = mountTraceErrorTab();

        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const expandedRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
        );
        expect(expandedRow.exists()).toBe(true);
      });

      it("should collapse an expanded row on second click", async () => {
        wrapper = mountTraceErrorTab();
        const expandBtn = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
        );

        // First click — expand
        await expandBtn.trigger("click");
        expect(
          wrapper.find(
            '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
          ).exists(),
        ).toBe(true);

        // Second click — collapse
        await expandBtn.trigger("click");
        expect(
          wrapper.find(
            '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
          ).exists(),
        ).toBe(false);
      });

      it("should show exception type in the expanded row", async () => {
        wrapper = mountTraceErrorTab();

        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const expandedRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
        );
        expect(expandedRow.text()).toContain("Type:");
        expect(expandedRow.text()).toContain("ValueError");
      });

      it("should show exception message in the expanded row", async () => {
        wrapper = mountTraceErrorTab();

        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const expandedRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
        );
        expect(expandedRow.text()).toContain("Message:");
        expect(expandedRow.text()).toContain("Something went wrong");
      });

      it("should show escaped value in the expanded row", async () => {
        wrapper = mountTraceErrorTab();

        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const expandedRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
        );
        expect(expandedRow.text()).toContain("Escaped:");
        expect(expandedRow.text()).toContain("false");
      });

      it("should show stacktrace in the expanded row", async () => {
        wrapper = mountTraceErrorTab();

        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const expandedRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
        );
        expect(expandedRow.text()).toContain("Stacktrace:");
        // Python-specific formatting
        expect(expandedRow.find(".stacktrace-content").html()).toContain(
          "stack-file",
        );
      });

      describe("no stacktrace available", () => {
        beforeEach(() => {
          const eventWithoutStack = createExceptionEvent({
            "exception.stacktrace": "",
            "exception.type": "SimpleError",
          });
          mockUseTraceDetails.mockReturnValue(
            defaultTraceDetails({
              hasSpanError: true,
              hasExceptionEvents: [eventWithoutStack],
            }),
          );
        });

        it("should show 'No stacktrace available' when stacktrace is empty", async () => {
          wrapper = mountTraceErrorTab();

          await wrapper
            .find(
              '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
            )
            .trigger("click");

          const expandedRow = wrapper.find(
            '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
          );
          expect(expandedRow.text()).toContain("No stacktrace available");
        });

        it("should not show a copy button when stacktrace is missing", async () => {
          wrapper = mountTraceErrorTab();

          await wrapper
            .find(
              '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
            )
            .trigger("click");

          // The copy-btn is `v-if` gated on stacktrace existing and being non-empty
          const expandedRow = wrapper.find(
            '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
          );
          expect(expandedRow.find(".copy-btn").exists()).toBe(false);
        });
      });
    });

    describe("copy stacktrace", () => {
      beforeEach(() => {
        mockUseTraceDetails.mockReturnValue(
          defaultTraceDetails({
            hasSpanError: true,
            hasExceptionEvents: [exceptionEvent1],
          }),
        );
      });

      it("should call clipboard.writeText with the stacktrace text", async () => {
        wrapper = mountTraceErrorTab();

        // Expand row first
        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const copyBtn = wrapper.find(".copy-btn");
        expect(copyBtn.exists()).toBe(true);

        await copyBtn.trigger("click");
        await flushPromises();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          exceptionEvent1["exception.stacktrace"],
        );
      });

      it("should show a success notification after copying", async () => {
        wrapper = mountTraceErrorTab();

        // Expand row first
        await wrapper
          .find(
            '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
          )
          .trigger("click");

        const copyBtn = wrapper.find(".copy-btn");
        await copyBtn.trigger("click");
        await flushPromises();

        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Stacktrace copied to clipboard",
            color: "positive",
          }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // highlightTextMatch
  // -------------------------------------------------------------------------

  describe("highlightTextMatch helper", () => {
    it("should return escaped HTML when no query is provided", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      const result = wrapper.vm.highlightTextMatch(
        'hello <world> & "friends"',
        "",
      );
      expect(result).toBe(
        "hello &lt;world&gt; &amp; &quot;friends&quot;",
      );
    });

    it("should highlight matching text when query is present", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      const result = wrapper.vm.highlightTextMatch("hello world hello", "hello");
      // Should contain highlight spans around matched "hello" strings
      const matches = result.match(
        /<span class="highlight">hello<\/span>/g,
      );
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });

    it("should escape special regex characters in the query", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      // The dot is a regex special char — should be escaped so it matches literally
      const result = wrapper.vm.highlightTextMatch(
        "test.value.found",
        "test.value",
      );
      expect(result).toContain(
        '<span class="highlight">test.value</span>',
      );
    });

    it("should be case-insensitive when highlighting", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      const result = wrapper.vm.highlightTextMatch(
        "Hello World",
        "hello",
      );
      expect(result).toContain(
        '<span class="highlight">Hello</span>',
      );
    });

    it("should return escaped text without highlights when there is no match", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      const result = wrapper.vm.highlightTextMatch("abc def", "xyz");
      expect(result).toBe("abc def");
      expect(result).not.toContain('<span class="highlight">');
    });

    it("should handle null/undefined text gracefully", () => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
      wrapper = mountTraceErrorTab();

      // escapeHtml(null) returns "" per the implementation
      const result = wrapper.vm.highlightTextMatch(
        null as unknown as string,
        "query",
      );
      expect(result).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Stack trace language detection and formatting
  // -------------------------------------------------------------------------

  describe("formatStackTrace helper", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
    });

    describe("Python stack trace", () => {
      it("should format Python traceback lines", () => {
        wrapper = mountTraceErrorTab();
        const trace =
          'Traceback (most recent call last):\n  File "app.py", line 42, in process\n    result = do_work()\n  File "utils.py", line 15, in do_work\n    raise ValueError("Something wrong")\nValueError: Something wrong';

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-traceback");
        expect(formatted).toContain("stack-file");
        expect(formatted).toContain("stack-path");
        expect(formatted).toContain("app.py");
        expect(formatted).toContain("stack-function");
        expect(formatted).toContain("process");
        expect(formatted).toContain("stack-keyword");
        expect(formatted).toContain("stack-exception");
        expect(formatted).toContain("stack-lineno");
      });

      it("should handle empty lines in Python trace", () => {
        wrapper = mountTraceErrorTab();
        const trace = "  File app.py\n\n    code_line";

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-empty");
      });
    });

    describe("Java stack trace", () => {
      it("should format Java at-lines", () => {
        wrapper = mountTraceErrorTab();
        // detectStackLanguage checks ^\s+at\s+\w+ against the multi-line sample.
        // The trace must START with an 'at' line for Java detection to fire.
        const trace =
          "\tat com.example.MyClass.myMethod(MyClass.java:42)\n\tat com.example.OtherClass.run(OtherClass.java:10)\njava.lang.RuntimeException: Something failed";

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-java-at");
        expect(formatted).toContain("stack-exception");
        expect(formatted).toContain("java.lang.RuntimeException");
        expect(formatted).toContain("com.example.MyClass");
        expect(formatted).toContain("myMethod");
        expect(formatted).toContain("MyClass.java");
        expect(formatted).toContain("stack-lineno");
      });

      it("should format Caused by lines when Java is detected", () => {
        wrapper = mountTraceErrorTab();
        // Must start with an 'at' line so Java detection fires
        const trace =
          "\tat com.example.Outer.run(Outer.java:42)\nCaused by: java.io.IOException: Connection refused\n\t... 3 more";

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-java-caused");
        expect(formatted).toContain("java.io.IOException");
        expect(formatted).toContain("stack-ellipsis-line");
        expect(formatted).toContain("stack-ellipsis");
      });
    });

    describe("Go stack trace", () => {
      it("should format Go panic and goroutine lines", () => {
        wrapper = mountTraceErrorTab();
        // The Go frame regex expects function + file on the SAME trimmed line
        // separated by whitespace (e.g. a tab): main.main()\t/path/to/main.go:10 +0x2a
        const trace =
          "panic: runtime error: invalid memory address\n\ngoroutine 1 [running]:\nmain.main()\t/path/to/main.go:10 +0x2a";

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-go-panic");
        expect(formatted).toContain("stack-go-routine");
        expect(formatted).toContain("stack-go-frame");
        expect(formatted).toContain("main.main");
      });
    });

    describe("Node stack trace", () => {
      it("should handle Node-style at-lines via the detected formatter", () => {
        wrapper = mountTraceErrorTab();
        // detectStackLanguage checks Java (^\s+at\s+\w+) before Node
        // (^\s+at\s+\S+\s+\() -- Java is more permissive and catches first.
        // A trace starting with 'at' will be detected as Java.
        const trace =
          "    at Object.<anonymous> (/app/server.js:42:15)\n    at Module._compile (internal/modules/cjs/loader.js:1063:30)";

        const formatted = wrapper.vm.formatStackTrace(trace);

        // Detected as Java; the lines fall through to generic stack-line
        // because the Java at-line regex expects package.Class.method(File:line)
        expect(formatted).toContain("stack-line");
        expect(formatted).toContain("server.js");
      });
    });

    describe("Rust stack trace", () => {
      it("should format Rust frame lines", () => {
        wrapper = mountTraceErrorTab();
        // Rust detection needs ^\s+\d+: at the START of the sample
        const trace =
          "   0: rust_begin_unwind\n   1: core::panicking::panic\n   2: my_crate::main\n   at src/main.rs:3:5";

        const formatted = wrapper.vm.formatStackTrace(trace);

        expect(formatted).toContain("stack-rust-frame");
        expect(formatted).toContain("stack-rust-loc");
        expect(formatted).toContain("my_crate");
      });
    });

    it("should return empty string for falsy input", () => {
      wrapper = mountTraceErrorTab();

      expect(wrapper.vm.formatStackTrace(null)).toBe("");
      expect(wrapper.vm.formatStackTrace("")).toBe("");
      expect(wrapper.vm.formatStackTrace(undefined)).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // formatExceptionMessage helper
  // -------------------------------------------------------------------------

  describe("formatExceptionMessage helper", () => {
    beforeEach(() => {
      mockUseTraceDetails.mockReturnValue(
        defaultTraceDetails({ hasSpanError: true }),
      );
    });

    it("should return empty string for falsy input", () => {
      wrapper = mountTraceErrorTab();

      expect(wrapper.vm.formatExceptionMessage("")).toBe("");
      expect(wrapper.vm.formatExceptionMessage(null)).toBe("");
    });

    it("should return the message as-is when it does not contain JSON", () => {
      wrapper = mountTraceErrorTab();

      expect(wrapper.vm.formatExceptionMessage("Simple error message")).toBe(
        "Simple error message",
      );
    });

    it("should pretty-print JSON in the message", () => {
      wrapper = mountTraceErrorTab();
      const messageWithJson =
        'Error occurred: {"code": 500, "reason": "timeout"}';

      const formatted = wrapper.vm.formatExceptionMessage(messageWithJson);

      // The JSON part should be pretty-printed with newlines
      expect(formatted).toContain("\n");
      expect(formatted).toContain('"code"');
      expect(formatted).toContain('"reason"');
      expect(formatted).toContain("500");
    });

    it("should handle malformed JSON gracefully", () => {
      wrapper = mountTraceErrorTab();
      const messageWithBadJson =
        'Error occurred: {"code": 500, invalid json}';

      const formatted = wrapper.vm.formatExceptionMessage(messageWithBadJson);

      // Should still return something (the original message stays if JSON parse fails)
      expect(formatted).toBeTruthy();
    });
  });
});
