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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import ErrorIssueCell from "./ErrorIssueCell.vue";

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------
// Props:  issue { error_type?, error_message?, error_handling?, error_stack?,
//                 service?, view_url? }
// Emits:  none
// Slots:  none
// Store:  none
// i18n:   rum.error ("Error") used as fallback type label
// Child components:  OTag — rendered to DOM; data-test forwarded via $attrs
// Conditional state:
//   - error_handling present → OTag chip shown
//   - topFrame (parsed stack) → <code> shown
//   - route (parsed view_url) → OTag chip shown
//   - service present → <small> shown
// ---------------------------------------------------------------------------

/** Minimal valid issue with all optional fields present */
const baseIssue = {
  error_type: "TypeError",
  error_message: "Cannot read property 'foo' of undefined",
  error_handling: "unhandled",
  error_stack:
    "TypeError: x\n    at fn (https://a.com/js/checkout.js:214:15)\n    at <anonymous>:1:1",
  service: "web-frontend",
  view_url: "https://a.com/checkout?step=2",
};

function mountCell(issue: Record<string, unknown> = baseIssue): VueWrapper {
  return mount(ErrorIssueCell, {
    props: { issue },
    global: { plugins: [i18n] },
  });
}

describe("ErrorIssueCell", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountCell();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // rendering — root element
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders the root cell element", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell"]').exists()).toBe(true);
    });

    it("renders error_type text", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-type"]').text()).toContain("TypeError");
    });

    it("renders error_message text", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-message"]').text()).toContain(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("renders with minimum required props (empty issue object)", () => {
      // Arrange
      const w = mountCell({});

      // Assert — cell must exist; message is empty
      expect(w.find('[data-test="rum-error-issue-cell"]').exists()).toBe(true);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // type label — present vs fallback
  // -------------------------------------------------------------------------

  describe("type label", () => {
    it("shows error_type when provided", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-type"]').text()).toContain("TypeError");
    });

    it("falls back to 'Error' translation when error_type is missing", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_type: undefined });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-type"]').text()).toContain("Error");

      w.unmount();
    });

    it("falls back to 'Error' translation when error_type is empty string", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_type: "" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-type"]').text()).toContain("Error");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // message — title attribute for truncation
  // -------------------------------------------------------------------------

  describe("message title attribute", () => {
    it("sets title attribute to the full error_message", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-message"]').attributes("title")).toBe(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("title attribute matches full message for very long strings", () => {
      // Arrange
      const longMsg = "A".repeat(300);
      const w = mountCell({ ...baseIssue, error_message: longMsg });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-message"]').attributes("title")).toBe(
        longMsg,
      );

      w.unmount();
    });

    it("renders special characters and unicode in message correctly", () => {
      // Arrange
      const unicodeMsg = "Unexpected token '日本語' at line 1: <script> & \"quotes\"";
      const w = mountCell({ ...baseIssue, error_message: unicodeMsg });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-message"]').text()).toContain(unicodeMsg);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // handling tag
  // -------------------------------------------------------------------------

  describe("handling tag", () => {
    it("shows handling tag when error_handling is 'unhandled'", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-handling-tag"]').exists()).toBe(true);
    });

    it("handling tag text contains 'unhandled'", () => {
      expect(
        wrapper.find('[data-test="rum-error-issue-cell-handling-tag"]').text().toLowerCase(),
      ).toContain("unhandled");
    });

    it("shows handling tag when error_handling is 'handled'", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_handling: "handled" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-handling-tag"]').exists()).toBe(true);

      w.unmount();
    });

    it("handling tag text contains 'handled' for handled issues", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_handling: "handled" });

      // Assert
      expect(
        w.find('[data-test="rum-error-issue-cell-handling-tag"]').text().toLowerCase(),
      ).toContain("handled");

      w.unmount();
    });

    it("does not show handling tag when error_handling is undefined", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_handling: undefined });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-handling-tag"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not show handling tag when error_handling is empty string", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_handling: "" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-handling-tag"]').exists()).toBe(false);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // frame chip — stack parsing
  // -------------------------------------------------------------------------

  describe("frame chip", () => {
    it("renders code element when stack is parseable", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-frame"]').exists()).toBe(true);
    });

    it("renders 'checkout.js:214' from the stack example", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-frame"]').text()).toBe(
        "checkout.js:214",
      );
    });

    it("uses <code> element for the frame chip", () => {
      // Assert — frame chip must be a <code> element (semantic HTML requirement)
      expect(wrapper.find("code[data-test='rum-error-issue-cell-frame']").exists()).toBe(true);
    });

    it("does not render frame chip when error_stack is missing", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_stack: undefined });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-frame"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not render frame chip when error_stack is empty string", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_stack: "" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-frame"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not render frame chip when stack has no parseable file frames", () => {
      // Arrange — stack with only anonymous frames (no dot-extension file)
      const w = mountCell({
        ...baseIssue,
        error_stack: "TypeError: x\n    at eval (<anonymous>:1:1)",
      });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-frame"]').exists()).toBe(false);

      w.unmount();
    });

    it("parses Firefox-style stack frame 'fn@https://a.com/app.js:42:8'", () => {
      // Arrange
      const w = mountCell({
        ...baseIssue,
        error_stack: "fn@https://a.com/app.js:42:8",
      });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-frame"]').text()).toBe("app.js:42");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // route chip — view_url parsing
  // -------------------------------------------------------------------------

  describe("route chip", () => {
    it("renders route chip with pathname from view_url", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-route-tag"]').exists()).toBe(true);
    });

    it("shows pathname '/checkout' from 'https://a.com/checkout?step=2'", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-route-tag"]').text()).toContain(
        "/checkout",
      );
    });

    it("strips query string from pathname", () => {
      // Assert — no '?step=2' in the tag
      expect(wrapper.find('[data-test="rum-error-issue-cell-route-tag"]').text()).not.toContain(
        "?step=2",
      );
    });

    it("does not render route chip when view_url is missing", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, view_url: undefined });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-route-tag"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not render route chip when view_url is empty string", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, view_url: "" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-route-tag"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not render route chip for a non-URL that does not start with '/'", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, view_url: "not-a-url" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-route-tag"]').exists()).toBe(false);

      w.unmount();
    });

    it("renders route chip for a relative path starting with '/'", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, view_url: "/dashboard?tab=1" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-route-tag"]').text()).toContain("/dashboard");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // service
  // -------------------------------------------------------------------------

  describe("service", () => {
    it("shows service text when service is present", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-service"]').exists()).toBe(true);
    });

    it("renders the service name text", () => {
      expect(wrapper.find('[data-test="rum-error-issue-cell-service"]').text()).toBe(
        "web-frontend",
      );
    });

    it("uses <small> element for the service", () => {
      expect(wrapper.find("small[data-test='rum-error-issue-cell-service']").exists()).toBe(true);
    });

    it("does not render service element when service is missing", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, service: undefined });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-service"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not render service element when service is empty string", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, service: "" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-service"]').exists()).toBe(false);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // props reactivity
  // -------------------------------------------------------------------------

  describe("props reactivity", () => {
    it("updates type label when error_type prop changes", async () => {
      // Arrange
      await wrapper.setProps({
        issue: { ...baseIssue, error_type: "ReferenceError" },
      });

      // Assert
      expect(wrapper.find('[data-test="rum-error-issue-cell-type"]').text()).toContain(
        "ReferenceError",
      );
    });

    it("updates message when error_message prop changes", async () => {
      // Arrange
      const newMsg = "Cannot set property 'x' of null";
      await wrapper.setProps({ issue: { ...baseIssue, error_message: newMsg } });

      // Assert
      expect(wrapper.find('[data-test="rum-error-issue-cell-message"]').text()).toContain(newMsg);
    });

    it("hides frame chip after stack is removed", async () => {
      // Act
      await wrapper.setProps({ issue: { ...baseIssue, error_stack: undefined } });

      // Assert
      expect(wrapper.find('[data-test="rum-error-issue-cell-frame"]').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("renders without crash when all fields are undefined", () => {
      // Arrange
      const w = mountCell({
        error_type: undefined,
        error_message: undefined,
        error_handling: undefined,
        error_stack: undefined,
        service: undefined,
        view_url: undefined,
      });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell"]').exists()).toBe(true);

      w.unmount();
    });

    it("renders emoji in error message correctly", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_message: "Error 🔥 occurred" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-message"]').text()).toContain("🔥");

      w.unmount();
    });

    it("renders service name with special characters", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, service: "web-app_v2.0" });

      // Assert
      expect(w.find('[data-test="rum-error-issue-cell-service"]').text()).toBe("web-app_v2.0");

      w.unmount();
    });

    it("single-word type label renders without colon ambiguity", () => {
      // Arrange
      const w = mountCell({ ...baseIssue, error_type: "Error" });

      // Assert — type label should contain 'Error'
      expect(w.find('[data-test="rum-error-issue-cell-type"]').text()).toContain("Error");

      w.unmount();
    });
  });
});
