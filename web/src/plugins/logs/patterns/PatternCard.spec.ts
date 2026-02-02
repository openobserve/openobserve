// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import PatternCard from "./PatternCard.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar({
  plugins: [quasar.Notify],
});

describe("PatternCard", () => {
  let wrapper: any;
  const mockPattern = {
    pattern_id: "pattern-1",
    template: "User * logged in from IP *",
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

    it("should display details icon with tooltip", () => {
      const detailsIcon = wrapper.find(
        '[data-test="pattern-card-0-details-icon"]',
      );
      expect(detailsIcon.exists()).toBe(true);
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
      expect(anomalyBadge.text()).toContain("ANOMALY");
    });

    it("should not display anomaly badge when pattern is not an anomaly", () => {
      const anomalyBadge = wrapper.find(
        '[data-test="pattern-card-0-anomaly-badge"]',
      );
      expect(anomalyBadge.exists()).toBe(false);
    });
  });

  describe("Pattern Actions", () => {
    it("should display include button", () => {
      const includeBtn = wrapper.find(
        '[data-test="pattern-card-0-include-btn"]',
      );
      expect(includeBtn.exists()).toBe(true);
    });

    it("should display exclude button", () => {
      const excludeBtn = wrapper.find(
        '[data-test="pattern-card-0-exclude-btn"]',
      );
      expect(excludeBtn.exists()).toBe(true);
    });

    it("should display details icon", () => {
      const detailsIcon = wrapper.find(
        '[data-test="pattern-card-0-details-icon"]',
      );
      expect(detailsIcon.exists()).toBe(true);
    });

    it("should emit click event when card is clicked", async () => {
      const card = wrapper.find('[data-test="pattern-card-0"]');
      await card.trigger("click");

      expect(wrapper.emitted("click")).toBeTruthy();
      expect(wrapper.emitted("click")![0]).toEqual([mockPattern, mockIndex]);
    });

    it("should emit include event when include button is clicked", async () => {
      const includeBtn = wrapper.find(
        '[data-test="pattern-card-0-include-btn"]',
      );
      await includeBtn.trigger("click");

      expect(wrapper.emitted("include")).toBeTruthy();
      expect(wrapper.emitted("include")![0]).toEqual([mockPattern]);
    });

    it("should emit exclude event when exclude button is clicked", async () => {
      const excludeBtn = wrapper.find(
        '[data-test="pattern-card-0-exclude-btn"]',
      );
      await excludeBtn.trigger("click");

      expect(wrapper.emitted("exclude")).toBeTruthy();
      expect(wrapper.emitted("exclude")![0]).toEqual([mockPattern]);
    });

    it("should not trigger card click when action buttons are clicked", async () => {
      const includeBtn = wrapper.find(
        '[data-test="pattern-card-0-include-btn"]',
      );
      await includeBtn.trigger("click");

      // Card click should not be emitted when button is clicked
      expect(wrapper.emitted("click")).toBeFalsy();
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
});
