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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

import TraceStatusCell from "./TraceStatusCell.vue";

installQuasar();

describe("TraceStatusCell", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  const mount_ = (item: Record<string, any>) =>
    mount(TraceStatusCell, {
      props: { item },
      global: { plugins: [i18n] },
    });

  describe("rendering", () => {
    it("mounts without errors", () => {
      wrapper = mount_({ errors: 0 });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the status pill container", () => {
      wrapper = mount_({ errors: 0 });
      expect(wrapper.find('[data-test="trace-row-status-pill"]').exists()).toBe(true);
    });
  });

  describe("success state (errors = 0)", () => {
    it("shows SUCCESS label when errors is 0", () => {
      wrapper = mount_({ errors: 0 });
      expect(wrapper.text().toUpperCase()).toContain("SUCCESS");
    });

    it("applies green background for success", () => {
      wrapper = mount_({ errors: 0 });
      const pill = wrapper.find('[data-test="trace-row-status-pill"]');
      expect(pill.attributes("style")).toContain("rgba(76, 175, 80, 0.12)");
    });

    it("applies green text colour for success", () => {
      wrapper = mount_({ errors: 0 });
      const pill = wrapper.find('[data-test="trace-row-status-pill"]');
      // pillColor uses var(--q-positive, #388e3c)
      expect(pill.attributes("style")).toContain("color:");
    });
  });

  describe("error state (errors > 0)", () => {
    it("shows error count in label for 1 error", () => {
      wrapper = mount_({ errors: 1 });
      const text = wrapper.text().toUpperCase();
      expect(text).toContain("1");
      expect(text).toContain("ERROR");
    });

    it("shows plural errors label for multiple errors", () => {
      wrapper = mount_({ errors: 3 });
      const text = wrapper.text().toUpperCase();
      expect(text).toContain("3");
      expect(text).toContain("ERRORS");
    });

    it("applies red background for errors", () => {
      wrapper = mount_({ errors: 2 });
      const pill = wrapper.find('[data-test="trace-row-status-pill"]');
      expect(pill.attributes("style")).toContain("rgba(244, 67, 54, 0.12)");
    });

    it("applies red text colour for errors", () => {
      wrapper = mount_({ errors: 2 });
      const pill = wrapper.find('[data-test="trace-row-status-pill"]');
      expect(pill.attributes("style")).toContain("color:");
    });
  });

  describe("edge cases", () => {
    it("treats undefined errors as 0 (success)", () => {
      wrapper = mount_({});
      expect(wrapper.text().toUpperCase()).toContain("SUCCESS");
    });

    it("treats null errors as 0 (success)", () => {
      wrapper = mount_({ errors: null });
      expect(wrapper.text().toUpperCase()).toContain("SUCCESS");
    });

    it("treats negative errors as 0 (success)", () => {
      wrapper = mount_({ errors: -1 });
      expect(wrapper.text().toUpperCase()).toContain("SUCCESS");
    });
  });
});
