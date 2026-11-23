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
import SpanStatusPill from "./SpanStatusPill.vue";

describe("SpanStatusPill", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    beforeEach(() => {
      wrapper = mount(SpanStatusPill);
    });

    it("should render the status pill container", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').exists()).toBe(true);
    });
  });

  describe("when status is ERROR (uppercase)", () => {
    beforeEach(() => {
      wrapper = mount(SpanStatusPill, { props: { status: "ERROR" } });
    });

    it("should apply the error class", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).toContain(
        "bg-badge-error-soft-bg",
      );
    });

    it("should not apply the success class", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).not.toContain(
        "bg-badge-success-soft-bg",
      );
    });

    it("should display the ERROR label", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("ERROR");
    });
  });

  describe("when status is error (lowercase)", () => {
    beforeEach(() => {
      wrapper = mount(SpanStatusPill, { props: { status: "error" } });
    });

    it("should apply the error class treating it case-insensitively", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).toContain(
        "bg-badge-error-soft-bg",
      );
    });

    it("should not apply the success class", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).not.toContain(
        "bg-badge-success-soft-bg",
      );
    });

    it("should display the original cased label", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("error");
    });
  });

  describe("when status is OK", () => {
    beforeEach(() => {
      wrapper = mount(SpanStatusPill, { props: { status: "OK" } });
    });

    it("should render a plain label with a status dot instead of a filled chip", () => {
      const pill = wrapper.find('[data-test="span-row-status-pill"]');
      expect(pill.classes()).toContain("text-text-body");
      expect(pill.classes()).not.toContain("bg-badge-success-soft-bg");
      expect(pill.find(".bg-status-positive").exists()).toBe(true);
    });

    it("should not apply the error class", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).not.toContain(
        "bg-badge-error-soft-bg",
      );
    });

    it("should display the OK label", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("Ok");
    });
  });

  describe("when status prop is omitted", () => {
    beforeEach(() => {
      wrapper = mount(SpanStatusPill);
    });

    it("should render a plain label with a status dot instead of a filled chip", () => {
      const pill = wrapper.find('[data-test="span-row-status-pill"]');
      expect(pill.classes()).toContain("text-text-body");
      expect(pill.classes()).not.toContain("bg-badge-default-soft-bg");
      expect(pill.find(".bg-status-positive").exists()).toBe(true);
    });

    it("should not apply the error class", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').classes()).not.toContain(
        "bg-badge-error-soft-bg",
      );
    });

    it("should display UNSET as the label", () => {
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("Unset");
    });
  });

  describe("label text", () => {
    it("should display the exact status string passed via prop", () => {
      wrapper = mount(SpanStatusPill, { props: { status: "CUSTOM_STATUS" } });
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("Custom_status");
    });

    it("should display UNSET when an empty string is passed", () => {
      wrapper = mount(SpanStatusPill, { props: { status: "" } });
      expect(wrapper.find('[data-test="span-row-status-pill"]').text()).toContain("Unset");
    });
  });
});
