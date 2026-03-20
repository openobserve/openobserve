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
import EventTypeBadge from "./EventTypeBadge.vue";

installQuasar();

describe("EventTypeBadge", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the type text", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });
      expect(wrapper.text()).toBe("error");
    });
  });

  describe("CSS classes for each event type", () => {
    it("should apply red classes for error type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-red-100");
      expect(classes).toContain("tw:text-red-700");
      expect(classes).toContain("tw:border-red-300");
    });

    it("should apply blue classes for action type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "action" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-blue-100");
      expect(classes).toContain("tw:text-blue-700");
      expect(classes).toContain("tw:border-blue-300");
    });

    it("should apply green classes for view type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "view" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-green-100");
      expect(classes).toContain("tw:text-green-700");
      expect(classes).toContain("tw:border-green-300");
    });

    it("should apply purple classes for resource type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "resource" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-purple-100");
      expect(classes).toContain("tw:text-purple-700");
      expect(classes).toContain("tw:border-purple-300");
    });

    it("should apply fallback grey classes for unknown type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "unknown-type" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-grey-100");
      expect(classes).toContain("tw:text-grey-700");
    });

    it("should apply fallback grey classes for empty type string", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:bg-grey-100");
    });
  });

  describe("base CSS classes always present", () => {
    it("should always have uppercase and font-semibold classes", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:uppercase");
      expect(classes).toContain("tw:font-semibold");
    });

    it("should always have rounded and px/py classes", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "view" } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:rounded");
      expect(classes).toContain("tw:px-1");
    });
  });

  describe("dataTest prop", () => {
    it("should apply data-test attribute when provided", () => {
      wrapper = mount(EventTypeBadge, {
        props: { type: "error", dataTest: "rum-event-type-badge" },
      });
      expect(wrapper.attributes("data-test")).toBe("rum-event-type-badge");
    });

    it("should use empty string as default for data-test", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "error" } });
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("type text content", () => {
    it("should display 'action' text for action type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "action" } });
      expect(wrapper.text()).toBe("action");
    });

    it("should display 'view' text for view type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "view" } });
      expect(wrapper.text()).toBe("view");
    });

    it("should display 'resource' text for resource type", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "resource" } });
      expect(wrapper.text()).toBe("resource");
    });

    it("should display custom type text for unknown types", () => {
      wrapper = mount(EventTypeBadge, { props: { type: "custom" } });
      expect(wrapper.text()).toBe("custom");
    });
  });
});
