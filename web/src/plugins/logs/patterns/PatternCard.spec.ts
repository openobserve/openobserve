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

import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import PatternCard from "./PatternCard.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

describe("PatternCard", () => {
  let wrapper: any;
  const mockPattern = {
    pattern_id: "pattern-1",
    template: "User <*> logged in from IP <*>",
    description: "User login pattern",
    frequency: 1234,
    percentage: 45.67,
    is_anomaly: false,
    variables: [
      { index: 0, name: "username", var_type: "string" },
      { index: 1, name: "ip_address", var_type: "ip" },
    ],
    examples: [
      {
        log_message: "User john logged in from IP 192.168.1.1",
        variables: { username: "john", ip_address: "192.168.1.1" },
      },
      {
        log_message: "User jane logged in from IP 10.0.0.1",
        variables: { username: "jane", ip_address: "10.0.0.1" },
      },
    ],
  };

  const mockIndex = 0;

  const OBadgeStub = {
    name: "OBadge",
    props: ["size"],
    template: '<span data-test-stub="o-badge"><slot /></span>',
  };
  const OTooltipStub = {
    name: "OTooltip",
    props: ["content", "maxWidth"],
    template: '<div data-test-stub="o-tooltip" />',
  };
  const OButtonStub = {
    name: "OButton",
    props: ["variant", "size", "iconLeft", "iconRight", "disabled", "title"],
    // Do NOT declare "click" in emits — VTU then treats the parent's @click.stop
    // as a native DOM listener on the root element, which fires on trigger("click").
    emits: [],
    template: '<button :data-test="$attrs[\'data-test\']" :title="title" :disabled="disabled || null"><slot /></button>',
  };
  const OIconStub = {
    name: "OIcon",
    props: ["name", "size"],
    template: '<span data-test-stub="o-icon"><slot /></span>',
  };

  beforeEach(() => {
    wrapper = mount(PatternCard, {
      props: {
        pattern: mockPattern,
        index: mockIndex,
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          EqualIcon: { template: '<div class="equal-icon"></div>' },
          NotEqualIcon: { template: '<div class="not-equal-icon"></div>' },
          OBadge: OBadgeStub,
          OTooltip: OTooltipStub,
          OButton: OButtonStub,
          OIcon: OIconStub,
        },
      },
    });
  });

  it("should mount PatternCard component", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('[data-test="pattern-card-0"]').exists()).toBe(true);
  });

  describe("Pattern Display", () => {
    it("should display pattern template", () => {
      const template = wrapper.find('[data-test="pattern-card-0-template"]');
      expect(template.exists()).toBe(true);
      expect(template.text()).toBe(mockPattern.template);
    });

    it("should display frequency with locale formatting", () => {
      const frequency = wrapper.find('[data-test="pattern-card-0-frequency"]');
      expect(frequency.exists()).toBe(true);
      expect(frequency.text()).toBe("1,234");
    });

    it("should display percentage with 2 decimal places", () => {
      const percentage = wrapper.find(
        '[data-test="pattern-card-0-percentage"]',
      );
      expect(percentage.exists()).toBe(true);
      expect(percentage.text()).toBe("45.67%");
    });

  });

  describe("Anomaly Detection", () => {
    it("should display anomaly badge when pattern is an anomaly", async () => {
      await wrapper.setProps({
        pattern: { ...mockPattern, is_anomaly: true },
        index: mockIndex,
      });

      const anomalyBadge = wrapper.find(
        '[data-test="pattern-card-0-anomaly-badge"]',
      );
      expect(anomalyBadge.exists()).toBe(true);
      expect(anomalyBadge.text()).toContain("Rare Pattern");
    });

    it("should not display anomaly badge when pattern is not an anomaly", () => {
      const anomalyBadge = wrapper.find(
        '[data-test="pattern-card-0-anomaly-badge"]',
      );
      expect(anomalyBadge.exists()).toBe(false);
    });

  });

  describe("Pattern Actions", () => {
    // Row-level include/exclude/create-alert buttons were moved into the details
    // side panel (PatternDetailsDialog); the row now only opens the panel.
    it("should emit click event when card is clicked", async () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      await card.trigger("click");

      expect(wrapper.emitted("click")).toBeTruthy();
      expect(wrapper.emitted("click")![0]).toEqual([mockPattern, mockIndex]);
    });

    it("should not render per-row action buttons", () => {
      expect(wrapper.find('[data-test="pattern-card-0-include-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="pattern-card-0-exclude-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="pattern-card-0-create-alert-btn"]').exists()).toBe(false);
    });
  });

  describe("Multiple Patterns", () => {
    it("should update data-test attribute for different indices", async () => {
      await wrapper.setProps({
        pattern: mockPattern,
        index: 5,
      });

      const card = wrapper.find('[data-test="pattern-card-5"]');
      expect(card.exists()).toBe(true);
    });
  });

  describe("Hover Effect", () => {
    it("should have hover transition class for hover effect", () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      expect(card.classes()).toContain("transition-colors");
    });

    it("should have cursor-pointer class", () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      expect(card.classes()).toContain("cursor-pointer");
    });

    it("should have hover background color class", () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      const classes = card.classes();
      // Check for Tailwind hover class
      expect(classes.some((cls) => cls.includes("hover"))).toBe(true);
    });

    it("should have transition styles defined", () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      // Check that the component has the hover styles applied
      expect(card.exists()).toBe(true);
      // The transition is defined via Tailwind utility classes.
      expect(card.classes()).toContain("transition-colors");
      expect(card.classes()).toContain("duration-150");
    });
  });

  describe("wrap prop", () => {
    it("should render a single truncated line when wrap is false (default)", () => {
      const template = wrapper.find('[data-test="pattern-card-0-template"]');
      // Continuous message line: whitespace preserved, ellipsis on overflow.
      expect(template.classes()).toContain("whitespace-pre");
      expect(template.classes()).toContain("overflow-hidden");
      expect(template.classes()).not.toContain("flex-wrap");
    });

    it("should apply break-all class on template when wrap is true", async () => {
      await wrapper.setProps({ wrap: true });
      const template = wrapper.find('[data-test="pattern-card-0-template"]');
      expect(template.classes()).toContain("break-all");
      expect(template.classes()).toContain("whitespace-pre-wrap");
    });

    it("should revert to single-line when wrap is toggled back to false", async () => {
      await wrapper.setProps({ wrap: true });
      await wrapper.setProps({ wrap: false });
      const template = wrapper.find('[data-test="pattern-card-0-template"]');
      expect(template.classes()).toContain("whitespace-pre");
    });
  });

  describe("Wildcard chip hover interactions", () => {
    it("should render wildcard chips for each wildcard in the template", () => {
      const chips = wrapper.findAll('[data-test="pattern-card-wildcard-chip"]');
      expect(chips.length).toBeGreaterThan(0);
    });

    it("should still render the full template text including wildcard tokens", () => {
      const template = wrapper.find('[data-test="pattern-card-0-template"]');
      expect(template.text()).toContain("User");
      expect(template.text()).toContain("logged in from IP");
    });
  });

});

