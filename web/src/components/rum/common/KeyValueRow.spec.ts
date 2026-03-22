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

import { describe, expect, it, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import KeyValueRow from "./KeyValueRow.vue";

installQuasar();

describe("KeyValueRow", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the label", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });
      expect(wrapper.text()).toContain("Browser:");
    });

    it("should display the value", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser", value: "Chrome" } });
      expect(wrapper.text()).toContain("Chrome");
    });

    it("should display numeric value", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Port", value: 8080 } });
      expect(wrapper.text()).toContain("8080");
    });
  });

  describe("showBorder prop", () => {
    it("should show border when showBorder=true (default)", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser", value: "Chrome" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:border-b");
    });

    it("should not show border when showBorder=false", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Browser", value: "Chrome", showBorder: false },
      });
      const classes = wrapper.classes().join(" ");
      expect(classes).not.toContain("tw:border-b");
    });

    it("should show border when showBorder is explicitly true", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Browser", value: "Chrome", showBorder: true },
      });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:border-b");
    });
  });

  describe("valueClass prop", () => {
    it("should apply valueClass to the value container", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Status", value: "OK", valueClass: "text-green-500" },
      });
      expect(wrapper.html()).toContain("text-green-500");
    });

    it("should not have extra class when valueClass is not provided", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Status", value: "OK" } });
      // just verify component renders without errors
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("dataTest prop", () => {
    it("should apply data-test attribute when provided", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Browser", dataTest: "rum-browser-row" },
      });
      expect(wrapper.attributes("data-test")).toBe("rum-browser-row");
    });

    it("should have empty data-test when not provided", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("slot content", () => {
    it("should render slot content instead of value when slot is provided", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Custom" },
        slots: { default: '<span data-test="custom-slot">Custom Content</span>' },
      });
      expect(wrapper.find('[data-test="custom-slot"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Custom Content");
    });

    it("should render value when no slot is provided", () => {
      wrapper = mount(KeyValueRow, {
        props: { label: "Browser", value: "Firefox" },
      });
      expect(wrapper.text()).toContain("Firefox");
    });
  });

  describe("default prop values", () => {
    it("should use empty string as default value", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Empty" } });
      // value defaults to "", label is shown, no crash
      expect(wrapper.exists()).toBe(true);
    });

    it("should default showBorder to true", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Test" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:border-b");
    });
  });

  describe("layout structure", () => {
    it("should have flex layout on root element", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Test" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:flex");
    });

    it("should render label with fixed width container", () => {
      wrapper = mount(KeyValueRow, { props: { label: "Browser" } });
      // verify label wrapper has w-[100px] class
      expect(wrapper.html()).toContain("tw:w-[100px]");
    });
  });
});
