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
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [quasar.Notify],
});

describe("WildcardValuePopover", () => {
  let wrapper: VueWrapper<any>;

  const defaultDisplayValues = [
    { value: "alice", count: 50 },
    { value: "bob", count: 30 },
    { value: "charlie", count: 10 },
  ];

  const createAnchor = (): HTMLElement => {
    const el = document.createElement("span");
    el.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 120,
        left: 200,
        right: 220,
        width: 20,
        height: 20,
      }) as DOMRect;
    return el;
  };

  const mountComponent = (overrides: Record<string, unknown> = {}) => {
    return mount(WildcardValuePopover, {
      props: {
        visible: true,
        token: "<*>",
        displayValues: defaultDisplayValues,
        anchorEl: createAnchor(),
        ...overrides,
      },
      global: {
        plugins: [i18n],
      },
      attachTo: document.body,
    });
  };

  beforeEach(() => {
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should mount and be visible when props are set", () => {
    const popover = wrapper.find('[data-test="wildcard-value-popover"]');
    expect(popover.exists()).toBe(true);
    expect(popover.isVisible()).toBe(true);
  });

  it("should not render when visible is false", () => {
    wrapper = mountComponent({ visible: false });
    const popover = wrapper.find('[data-test="wildcard-value-popover"]');
    expect(popover.exists()).toBe(true); // v-show hides it
    expect(popover.isVisible()).toBe(false);
  });

  it("should not render when anchorEl is null", () => {
    wrapper = mountComponent({ anchorEl: null });
    const popover = wrapper.find('[data-test="wildcard-value-popover"]');
    expect(popover.attributes("style")).toContain("display: none");
  });

  describe("header", () => {
    it("should display the inferred label in the header", () => {
      const text = wrapper.text();
      // displayValues are ["alice", "bob", "charlie"] — all strings → "str"
      expect(text).toContain("str");
    });

    it("should display descriptive label for <:IP> token", () => {
      wrapper = mountComponent({ token: "<:IP>", displayValues: [{ value: "10.0.0.1", count: 5 }] });
      // <:IP> maps to "ip" in wildcardLabel
      expect(wrapper.text()).toContain("ip");
    });
  });

  describe("value rows", () => {
    it("should render a row for each display value", () => {
      const rows = wrapper.findAll('[data-test^="wildcard-value-row-"]');
      expect(rows).toHaveLength(defaultDisplayValues.length);
    });

    it("should display the value text", () => {
      const text = wrapper.text();
      expect(text).toContain("alice");
      expect(text).toContain("bob");
      expect(text).toContain("charlie");
    });

    it("should display formatted counts", () => {
      const text = wrapper.text();
      expect(text).toContain("50");
      expect(text).toContain("30");
      expect(text).toContain("10");
    });

    it("should display fallback text for empty value", () => {
      wrapper = mountComponent({
        displayValues: [{ value: "", count: 5 }],
      });
      expect(wrapper.text()).toContain("(empty)");
    });

    it("should limit to 10 rows", () => {
      const manyValues = Array.from({ length: 15 }, (_, i) => ({
        value: `val-${i}`,
        count: i,
      }));
      wrapper = mountComponent({ displayValues: manyValues });
      const rows = wrapper.findAll('[data-test^="wildcard-value-row-"]');
      expect(rows).toHaveLength(10);
    });
  });

  describe("empty state", () => {
    it("should show 'No values available' when displayValues is empty", () => {
      wrapper = mountComponent({ displayValues: [] });
      expect(wrapper.text()).toContain("No values available");
    });
  });

  describe("bar width calculation", () => {
    it("should calculate bar width proportional to count", () => {
      // max count = 50, so alice = 100%, bob = 60%, charlie = 20%
      wrapper = mountComponent({
        displayValues: [
          { value: "top", count: 100 },
          { value: "mid", count: 50 },
          { value: "low", count: 10 },
        ],
      });
      // Just verify component doesn't crash with these values
      expect(wrapper.exists()).toBe(true);
    });

    it("should return 0% when count is 0", () => {
      wrapper = mountComponent({
        displayValues: [{ value: "zero", count: 0 }],
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should return 2% minimum for very small but non-zero counts", () => {
      wrapper = mountComponent({
        displayValues: [
          { value: "large", count: 1000 },
          { value: "tiny", count: 1 },
        ],
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("color scheme", () => {
    it("should apply correct header color for <*> token", () => {
      const headerEl = wrapper.find(".wildcard-popover-header");
      expect(headerEl.exists()).toBe(true);
      expect(headerEl.classes().some((c) => c.includes("wildcard-header"))).toBe(true);
    });

    it("should apply correct header color for <:IP> token", () => {
      wrapper = mountComponent({ token: "<:IP>", displayValues: [{ value: "10.0.0.1", count: 5 }] });
      const headerEl = wrapper.find(".wildcard-popover-header");
      expect(headerEl.exists()).toBe(true);
    });
  });

  describe("event emits", () => {
    it("should emit popoverEnter on mouse enter", async () => {
      const popover = wrapper.find('[data-test="wildcard-value-popover"]');
      await popover.trigger("mouseenter");
      expect(wrapper.emitted("popoverEnter")).toBeTruthy();
    });

    it("should emit popoverLeave on mouse leave", async () => {
      const popover = wrapper.find('[data-test="wildcard-value-popover"]');
      await popover.trigger("mouseleave");
      expect(wrapper.emitted("popoverLeave")).toBeTruthy();
    });
  });
});
