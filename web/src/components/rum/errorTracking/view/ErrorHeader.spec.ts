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
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Attach a mount target once for the whole file
const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Hoist mock helpers so vi.mock factories can reference them
const { mockRouterBack, mockCopyToClipboard } = vi.hoisted(() => ({
  mockRouterBack: vi.fn(),
  mockCopyToClipboard: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ fullPath: "/rum/errors/view/error-abc123?timestamp=1700000000" }),
  useRouter: () => ({ back: mockRouterBack, resolve: (to: string) => ({ href: to }) }),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

describe("ErrorHeader", () => {
  let wrapper: ReturnType<typeof mount>;

  const mockError = {
    error_id: "error-abc123",
    type: "error",
    error_type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    error_handling: "unhandled",
    source: "console",
    service: "checkout-web",
    version: "2.4.1",
    env: "production",
    view_url: "https://app.example.com/billings/plans?tab=1",
    timestamp: "2024-01-01 10:00:00 UTC",
  };

  const mountComponent = (error: Record<string, any> = mockError) =>
    mount(ErrorHeader, {
      attachTo: "#app",
      props: { error },
      global: { plugins: [i18n, store] },
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  describe("identity", () => {
    it("shows the error type as the title", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("TypeError");
    });

    it("falls back to a generic label when error_type is missing", async () => {
      wrapper = mountComponent({ ...mockError, error_type: undefined });
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("Error");
    });

    it("shows the error message in an alert region", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const banner = wrapper.find('[data-test="error-header-message"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain("Cannot read property 'foo' of undefined");
    });

    it("explains the absence when no message was captured", async () => {
      wrapper = mountComponent({ ...mockError, error_message: "" });
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-message"]').text()).toContain(
        "No error message was captured.",
      );
    });
  });

  describe("badges", () => {
    it("shows the handling badge with the raw handling value", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-handling-badge"]').text()).toBe("unhandled");
    });

    it("still shows the handling badge for a handled error", async () => {
      wrapper = mountComponent({ ...mockError, error_handling: "handled" });
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-handling-badge"]').text()).toBe("handled");
    });

    it("hides the handling badge when error_handling is absent", async () => {
      const errorWithoutHandling: Record<string, any> = { ...mockError };
      delete errorWithoutHandling.error_handling;
      wrapper = mountComponent(errorWithoutHandling);
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-handling-badge"]').exists()).toBe(false);
    });

    it("shows the source badge when the error carries a source", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-source-badge"]').text()).toBe("console");
    });
  });

  describe("context line", () => {
    it("shows the event id", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-id"]').text()).toBe("error-abc123");
    });

    it("shows the page route rather than the full url", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-route"]').text()).toBe("/billings/plans");
    });

    it("hides the route when no view url was captured", async () => {
      wrapper = mountComponent({ ...mockError, view_url: undefined });
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-route"]').exists()).toBe(false);
    });

    it("falls back to the formatted timestamp string when there is no _timestamp", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-timestamp"]').text()).toBe(
        "2024-01-01 10:00:00 UTC",
      );
    });

    it("shows the deployment identity chips", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain("checkout-web");
      expect(text).toContain("2.4.1");
      expect(text).toContain("production");
    });
  });

  describe("actions", () => {
    it("copies the event id when the copy-id button is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.find('[data-test="error-header-copy-id-btn"]').trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "error-abc123",
        expect.any(Function),
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });

    it("copies the updated event id after the error prop changes", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.setProps({ error: { ...mockError, error_id: "different-id" } });

      await wrapper.find('[data-test="error-header-copy-id-btn"]').trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "different-id",
        expect.any(Function),
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });

    it("disables the copy-id button when the error has no id", async () => {
      wrapper = mountComponent({ ...mockError, error_id: "" });
      await flushPromises();

      expect(
        wrapper.find('[data-test="error-header-copy-id-btn"]').attributes("disabled"),
      ).toBeDefined();
    });

    it("hands the current route to the share button so the link carries the error id", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.findComponent(ShareButton).props("url")).toBe(
        `${window.location.origin}/rum/errors/view/error-abc123?timestamp=1700000000`,
      );
    });
  });

  describe("back button", () => {
    it("renders the back button", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="back-button"]').exists()).toBe(true);
    });

    it("calls router.back() when the back button is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.find('[data-test="back-button"]').trigger("click");

      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("prop updates", () => {
    it("reflects new error data when the error prop is changed", async () => {
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.setProps({
        error: {
          error_id: "custom-error-456",
          error_type: "ReferenceError",
          error_message: "Variable is not defined",
          error_handling: "handled",
          timestamp: "2024-02-01 15:30:00 UTC",
        },
      });

      expect(wrapper.find('[data-test="error-id"]').text()).toBe("custom-error-456");
      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("ReferenceError");
      expect(wrapper.find('[data-test="error-header-message"]').text()).toContain(
        "Variable is not defined",
      );
      expect(wrapper.find('[data-test="error-header-timestamp"]').text()).toBe(
        "2024-02-01 15:30:00 UTC",
      );
    });
  });

  describe("edge cases", () => {
    it("renders without crashing when every error property is null", async () => {
      wrapper = mountComponent({
        error_id: null,
        error_type: null,
        error_message: null,
        error_handling: null,
        source: null,
        view_url: null,
        timestamp: null,
      });
      await flushPromises();

      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("Error");
      expect(wrapper.find('[data-test="error-header-message"]').text()).toContain(
        "No error message was captured.",
      );
    });

    it("keeps a very long event id reachable through its title attribute", async () => {
      const longId = "very-long-error-id-that-might-cause-layout-issues-12345678901234567890";
      wrapper = mountComponent({ ...mockError, error_id: longId });
      await flushPromises();

      expect(wrapper.find('[data-test="error-id"]').attributes("title")).toBe(longId);
    });
  });
});
