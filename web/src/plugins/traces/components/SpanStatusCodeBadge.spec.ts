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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import SpanStatusCodeBadge from "./SpanStatusCodeBadge.vue";

installQuasar();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BadgeProps = {
  code?: string | number | null;
  grpcCode?: string | number | null;
};

function mountBadge(props: BadgeProps = {}): VueWrapper {
  return mount(SpanStatusCodeBadge, { props });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpanStatusCodeBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  describe("empty state", () => {
    it("should show the empty indicator when no props are provided", () => {
      wrapper = mountBadge();

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });

    it("should show the empty indicator when code is null", () => {
      wrapper = mountBadge({ code: null });

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });

    it("should show the empty indicator when grpcCode is null", () => {
      wrapper = mountBadge({ grpcCode: null });

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });

    it("should show the empty indicator when both code and grpcCode are null", () => {
      wrapper = mountBadge({ code: null, grpcCode: null });

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });

    it("should show the empty indicator when code is 0", () => {
      // HTTP code 0 is not a valid positive status code; treated as empty
      wrapper = mountBadge({ code: 0 });

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });

    it("should show the empty indicator when code is a non-numeric string", () => {
      wrapper = mountBadge({ code: "NaN" });

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP tiers — CSS class assignment
  // -------------------------------------------------------------------------

  describe("HTTP tiers", () => {
    it("should apply success class when code is 200", () => {
      wrapper = mountBadge({ code: 200 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--success");
    });

    it("should apply success class when code is 201", () => {
      wrapper = mountBadge({ code: 201 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--success");
    });

    it("should apply success class when code is 299", () => {
      wrapper = mountBadge({ code: 299 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--success");
    });

    it("should apply info class when code is 301", () => {
      wrapper = mountBadge({ code: 301 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--info");
    });

    it("should apply info class when code is 304", () => {
      wrapper = mountBadge({ code: 304 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--info");
    });

    it("should apply warning class when code is 404", () => {
      wrapper = mountBadge({ code: 404 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--warning");
    });

    it("should apply warning class when code is 400", () => {
      wrapper = mountBadge({ code: 400 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--warning");
    });

    it("should apply warning class when code is 499", () => {
      wrapper = mountBadge({ code: 499 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--warning");
    });

    it("should apply error class when code is 500", () => {
      wrapper = mountBadge({ code: 500 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--error");
    });

    it("should apply error class when code is 503", () => {
      wrapper = mountBadge({ code: 503 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--error");
    });

    it("should apply neutral class when code is outside all known HTTP ranges", () => {
      wrapper = mountBadge({ code: 100 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--neutral");
    });
  });

  // -------------------------------------------------------------------------
  // HTTP preference over gRPC
  // -------------------------------------------------------------------------

  describe("HTTP preference", () => {
    it("should display the HTTP code value when both code and grpcCode are provided", () => {
      wrapper = mountBadge({ code: 200, grpcCode: 2 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("200");
    });

    it("should apply HTTP tier class when both code and grpcCode are provided", () => {
      wrapper = mountBadge({ code: 200, grpcCode: 2 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.classes()).toContain("o2-status-badge--success");
      expect(badge.classes()).not.toContain("o2-status-badge--error");
    });

    it("should use HTTP error class instead of grpc success when code is 500 and grpcCode is 0", () => {
      wrapper = mountBadge({ code: 500, grpcCode: 0 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.text()).toBe("500");
      expect(badge.classes()).toContain("o2-status-badge--error");
    });
  });

  // -------------------------------------------------------------------------
  // gRPC fallback
  // -------------------------------------------------------------------------

  describe("gRPC fallback", () => {
    it("should apply success class when grpcCode is 0 (OK) and no HTTP code is provided", () => {
      wrapper = mountBadge({ grpcCode: 0 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--success");
    });

    it("should apply error class when grpcCode is 2 and no HTTP code is provided", () => {
      wrapper = mountBadge({ grpcCode: 2 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--error");
    });

    it("should apply error class when grpcCode is 14 (UNAVAILABLE) and no HTTP code is provided", () => {
      wrapper = mountBadge({ grpcCode: 14 });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--error");
    });

    it("should show the badge and not the empty indicator when grpcCode is 0", () => {
      wrapper = mountBadge({ grpcCode: 0 });

      expect(
        wrapper.find('[data-test="span-status-code-badge"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Display value — rendered text
  // -------------------------------------------------------------------------

  describe("display value", () => {
    it("should render the exact HTTP code value as text", () => {
      wrapper = mountBadge({ code: 404 });

      expect(wrapper.find('[data-test="span-status-code-badge"]').text()).toBe(
        "404",
      );
    });

    it("should render the exact gRPC code value as text when no HTTP code is present", () => {
      wrapper = mountBadge({ grpcCode: 0 });

      expect(wrapper.find('[data-test="span-status-code-badge"]').text()).toBe(
        "0",
      );
    });

    it("should render gRPC error code value as text", () => {
      wrapper = mountBadge({ grpcCode: 13 });

      expect(wrapper.find('[data-test="span-status-code-badge"]').text()).toBe(
        "13",
      );
    });

    it("should render the em dash when neither code is present", () => {
      wrapper = mountBadge();

      expect(
        wrapper.find('[data-test="span-status-code-badge-empty"]').text(),
      ).toBe("—");
    });
  });

  // -------------------------------------------------------------------------
  // String vs number — both forms accepted
  // -------------------------------------------------------------------------

  describe("string vs number props", () => {
    it("should apply warning class when code is the string '404'", () => {
      wrapper = mountBadge({ code: "404" });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--warning");
    });

    it("should render '404' as text when code is the string '404'", () => {
      wrapper = mountBadge({ code: "404" });

      expect(wrapper.find('[data-test="span-status-code-badge"]').text()).toBe(
        "404",
      );
    });

    it("should produce the same tier class for string '404' and number 404", () => {
      const wrapperStr = mountBadge({ code: "404" });
      const wrapperNum = mountBadge({ code: 404 });

      const classesStr = wrapperStr
        .find('[data-test="span-status-code-badge"]')
        .classes();
      const classesNum = wrapperNum
        .find('[data-test="span-status-code-badge"]')
        .classes();

      expect(classesStr).toEqual(classesNum);

      wrapperStr.unmount();
      wrapperNum.unmount();
    });

    it("should apply success class when grpcCode is the string '0'", () => {
      wrapper = mountBadge({ grpcCode: "0" });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--success");
    });

    it("should apply error class when grpcCode is the string '2'", () => {
      wrapper = mountBadge({ grpcCode: "2" });
      const badge = wrapper.find('[data-test="span-status-code-badge"]');

      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain("o2-status-badge--error");
    });
  });
});
