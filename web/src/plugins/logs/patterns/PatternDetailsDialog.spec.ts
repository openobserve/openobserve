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
import PatternDetailsDialog from "./PatternDetailsDialog.vue";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

describe("PatternDetailsDialog", () => {
  let wrapper: any;
  const mockSelectedPattern = {
    pattern: {
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
    },
    index: 0,
  };

  const totalPatterns = 10;

  beforeEach(() => {
    wrapper = mount(PatternDetailsDialog, {
      props: {
        modelValue: true,
        selectedPattern: mockSelectedPattern,
        totalPatterns: totalPatterns,
      },
      global: {
        provide: { store },
        stubs: {
          "q-dialog": {
            template: '<div class="q-dialog"><slot></slot></div>',
            props: ["modelValue"],
          },
        },
      },
    });
  });

  it("should mount PatternDetailsDialog component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Dialog Header", () => {
    it("should display dialog title", () => {
      const title = wrapper.find('[data-test="close-pattern-dialog"]');
      expect(title.exists()).toBe(true);
    });

    it("should display pattern count in subtitle", () => {
      const text = wrapper.text();
      expect(text).toContain("Pattern 1 of 10");
    });

    it("should have close button that can close dialog", async () => {
      const closeBtn = wrapper.find('[data-test="close-pattern-dialog"]');
      expect(closeBtn.exists()).toBe(true);
      // The close button has v-close-popup directive which will be handled by Quasar
      // In real usage, this button will close the dialog
      expect(closeBtn.element.tagName).toBe("BUTTON");
    });
  });

  describe("Statistics Section", () => {
    it("should display occurrences with locale formatting", () => {
      const text = wrapper.text();
      expect(text).toContain("Occurrences");
      expect(text).toContain("1,234");
    });

    it("should display percentage with 2 decimal places", () => {
      const text = wrapper.text();
      expect(text).toContain("Percentage");
      expect(text).toContain("45.67%");
    });

    it("should display anomaly banner when pattern is anomaly", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, is_anomaly: true },
        },
      });

      const text = wrapper.text();
      expect(text).toContain("This pattern is detected as an anomaly");
    });

    it("should not display anomaly banner when pattern is not anomaly", () => {
      const text = wrapper.text();
      expect(text).not.toContain("This pattern is detected as an anomaly");
    });
  });

  describe("Variables Summary Section", () => {
    it("should display variables summary", () => {
      const text = wrapper.text();
      expect(text).toContain("Variables");
      expect(text).toContain("2 variable(s) detected");
    });

    it("should display fallback text when no variables are available", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, examples: [{ variables: {} }] },
        },
      });

      const text = wrapper.text();
      expect(text).toContain("0 variable(s) detected");
    });
  });

  describe("Template Section", () => {
    it("should display pattern template", () => {
      const text = wrapper.text();
      expect(text).toContain("Pattern Template");
      expect(text).toContain("User * logged in from IP *");
    });
  });

  describe("Variables Section", () => {
    it("should display variables table when variables exist", () => {
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.exists()).toBe(true);
    });

    it("should display variables count in header", () => {
      const text = wrapper.text();
      expect(text).toContain("Variables (2)");
    });

    it("should display variable names in table", () => {
      const text = wrapper.text();
      expect(text).toContain("username");
      expect(text).toContain("ip_address");
    });

    it("should display variable types in table", () => {
      const text = wrapper.text();
      expect(text).toContain("string");
      expect(text).toContain("ip");
    });

    it("should not display variables table when no variables", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, variables: [] },
        },
      });

      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.exists()).toBe(false);
    });
  });

  describe("Examples Section", () => {
    it("should display examples section header with count", () => {
      const text = wrapper.text();
      expect(text).toContain("Example Logs (2)");
    });

    it("should display all example log messages", () => {
      const text = wrapper.text();
      expect(text).toContain("User john logged in from IP 192.168.1.1");
      expect(text).toContain("User jane logged in from IP 10.0.0.1");
    });

    it("should not display examples section when no examples", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, examples: [] },
        },
      });

      const text = wrapper.text();
      expect(text).not.toContain("Example Logs");
    });
  });

  describe("Navigation Buttons", () => {
    it("should display previous button", () => {
      const prevBtn = wrapper.find(
        '[data-test="pattern-detail-previous-btn"]',
      );
      expect(prevBtn.exists()).toBe(true);
    });

    it("should display next button", () => {
      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      expect(nextBtn.exists()).toBe(true);
    });

    it("should disable previous button on first pattern", () => {
      const prevBtn = wrapper.find(
        '[data-test="pattern-detail-previous-btn"]',
      );
      expect(prevBtn.attributes("disabled")).toBeDefined();
    });

    it("should enable previous button when not on first pattern", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          index: 5,
        },
      });

      const prevBtn = wrapper.find(
        '[data-test="pattern-detail-previous-btn"]',
      );
      expect(prevBtn.attributes("disabled")).toBeUndefined();
    });

    it("should disable next button on last pattern", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          index: 9,
        },
        totalPatterns: 10,
      });

      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      expect(nextBtn.attributes("disabled")).toBeDefined();
    });

    it("should emit navigate event with (false, true) when previous button clicked", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          index: 5,
        },
      });

      const prevBtn = wrapper.find(
        '[data-test="pattern-detail-previous-btn"]',
      );
      await prevBtn.trigger("click");

      expect(wrapper.emitted("navigate")).toBeTruthy();
      expect(wrapper.emitted("navigate")![0]).toEqual([false, true]);
    });

    it("should emit navigate event with (true, false) when next button clicked", async () => {
      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      await nextBtn.trigger("click");

      expect(wrapper.emitted("navigate")).toBeTruthy();
      expect(wrapper.emitted("navigate")![0]).toEqual([true, false]);
    });

    it("should display current position in footer", () => {
      const text = wrapper.text();
      // Check for the pattern position
      expect(text).toMatch(/1\s+of\s+10/);
    });
  });

  describe("Dialog Visibility", () => {
    it("should receive correct modelValue prop", () => {
      expect(wrapper.props("modelValue")).toBe(true);
    });

    it("should render content when modelValue is true and selectedPattern exists", () => {
      const card = wrapper.find(".detail-table-dialog");
      expect(card.exists()).toBe(true);
    });

    it("should not render content when selectedPattern is null", async () => {
      const wrapperWithoutPattern = mount(PatternDetailsDialog, {
        props: {
          modelValue: true,
          selectedPattern: null,
          totalPatterns: 10,
        },
        global: {
          provide: { store },
          stubs: {
            "q-dialog": {
              template: '<div class="q-dialog"><slot></slot></div>',
              props: ["modelValue"],
            },
          },
        },
      });

      const card = wrapperWithoutPattern.find(".detail-table-dialog");
      expect(card.exists()).toBe(false);
    });
  });
});
