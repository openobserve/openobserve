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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import SessionLocationColumn from "@/components/rum/sessionReplay/SessionLocationColumn.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock flag-icons CSS
vi.mock("flag-icons/css/flag-icons.min.css", () => ({}));

// Mock window methods
Object.defineProperty(window, "dispatchEvent", {
  value: vi.fn(),
  writable: true,
});

describe("SessionLocationColumn", () => {
  let wrapper: any;

  const mockColumn = {
    country: "United States",
    country_iso_code: "us",
    city: "New York",
    browser: "Chrome",
    os: "Windows",
  };

  beforeEach(async () => {
    wrapper = mount(SessionLocationColumn, {
      attachTo: "#app",
      props: {
        column: mockColumn,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
        stubs: {
          "q-icon": {
            template:
              '<i data-test="icon" :class="name" :style="`font-size: ${size}`"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find("div").exists()).toBe(true);
    });

    it("should render with provided column prop", () => {
      expect(wrapper.props("column")).toEqual(mockColumn);
    });

    it("should display all location information", () => {
      expect(wrapper.text()).toContain(mockColumn.country);
      expect(wrapper.text()).toContain(mockColumn.city);
      expect(wrapper.text()).toContain(mockColumn.browser);
      expect(wrapper.text()).toContain(mockColumn.os);
    });
  });

  describe("Country Flag Display", () => {
    it("should render country flag with correct ISO code", () => {
      const flagElement = wrapper.find(`.fi-${mockColumn.country_iso_code}`);
      expect(flagElement.exists()).toBe(true);
    });

    it("should display country name", () => {
      expect(wrapper.text()).toContain(mockColumn.country);
    });

    it("should handle different country codes", async () => {
      await wrapper.setProps({
        column: {
          ...mockColumn,
          country_iso_code: "uk",
          country: "United Kingdom",
        },
      });

      const flagElement = wrapper.find(".fi-uk");
      expect(flagElement.exists()).toBe(true);
      expect(wrapper.text()).toContain("United Kingdom");
    });
  });

  describe("Location Details Display", () => {
    it("should display city information", () => {
      expect(wrapper.text()).toContain(mockColumn.city);
    });

    it("should handle missing city gracefully", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, city: null },
      });

      expect(wrapper.text()).toContain("Unknown");
    });

    it("should display browser information", () => {
      expect(wrapper.text()).toContain(mockColumn.browser);
    });

    it("should display OS information", () => {
      expect(wrapper.text()).toContain(mockColumn.os);
    });
  });

  describe("Separator Icons", () => {
    it("should render separator icons between details", () => {
      const separatorIcons = wrapper.findAll('[data-test="circle-icon"]');
      // Filter for circle icons
      const circleIcons = separatorIcons.filter((icon) =>
        icon.attributes("class")?.includes("circle"),
      );
      expect(separatorIcons.length).toBeGreaterThanOrEqual(2);
    });

    it("should apply correct styling to separator icons", () => {
      const separatorIcons = wrapper.findAll('[data-test="circle-icon"]');
      separatorIcons.forEach((icon) => {
        expect(icon.attributes("style")).toContain("font-size: 4px");
      });
    });
  });

  describe("Layout Structure", () => {
    it("should have correct row structure for country info", () => {
      const countryRow = wrapper.find(".row.items-center.no-wrap");
      expect(countryRow.exists()).toBe(true);
    });

    it("should have correct row structure for details", () => {
      const detailsRow = wrapper.find(".row.q-mt-xs.items-center");
      expect(detailsRow.exists()).toBe(true);
    });

    it("should apply correct text styling for details", () => {
      const greyTextElements = wrapper.findAll(".text-grey-8");
      expect(greyTextElements.length).toBeGreaterThanOrEqual(3); // city, browser, os
    });
  });

  describe("Component Properties", () => {
    it("should require column prop", () => {
      const columnProp = wrapper.vm.$options.props.column;
      expect(columnProp.required).toBe(true);
      expect(columnProp.type).toBe(Object);
    });

    it("should handle complete column data", async () => {
      const completeColumn = {
        country: "Canada",
        country_iso_code: "ca",
        city: "Toronto",
        browser: "Firefox",
        os: "macOS",
      };

      await wrapper.setProps({ column: completeColumn });

      expect(wrapper.text()).toContain("Canada");
      expect(wrapper.text()).toContain("Toronto");
      expect(wrapper.text()).toContain("Firefox");
      expect(wrapper.text()).toContain("macOS");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty column object", async () => {
      await wrapper.setProps({
        column: {},
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Unknown");
    });

    it("should handle partial column data", async () => {
      await wrapper.setProps({
        column: {
          country: "Germany",
          browser: "Safari",
        },
      });

      expect(wrapper.text()).toContain("Germany");
      expect(wrapper.text()).toContain("Safari");
      expect(wrapper.text()).toContain("Unknown");
    });

    it("should handle undefined values gracefully", async () => {
      await wrapper.setProps({
        column: {
          country: "France",
          country_iso_code: "fr",
          city: undefined,
          browser: "Edge",
          os: undefined,
        },
      });

      expect(wrapper.text()).toContain("France");
      expect(wrapper.text()).toContain("Unknown");
      expect(wrapper.text()).toContain("Edge");
    });
  });

  describe("Styling", () => {
    it("should apply correct margin classes", () => {
      const flagElement = wrapper.find(".q-mr-sm");
      expect(flagElement.exists()).toBe(true);

      const topMarginElement = wrapper.find(".q-mt-xs");
      expect(topMarginElement.exists()).toBe(true);
    });

    it("should apply correct spacing for separators", () => {
      const separatorElements = wrapper.findAll(".q-mx-md");
      expect(separatorElements.length).toBeGreaterThan(0);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete session location workflow", async () => {
      // Verify component mounted
      expect(wrapper.exists()).toBe(true);

      // Test initial data display
      expect(wrapper.text()).toContain(mockColumn.country);
      expect(wrapper.text()).toContain(mockColumn.city);

      // Test data update
      const newColumnData = {
        country: "Australia",
        country_iso_code: "au",
        city: "Sydney",
        browser: "Opera",
        os: "Linux",
      };

      await wrapper.setProps({ column: newColumnData });

      expect(wrapper.text()).toContain("Australia");
      expect(wrapper.text()).toContain("Sydney");
      expect(wrapper.text()).toContain("Opera");
      expect(wrapper.text()).toContain("Linux");

      // Verify flag update
      const updatedFlag = wrapper.find(".fi-au");
      expect(updatedFlag.exists()).toBe(true);
    });

    it("should maintain layout integrity with different data", async () => {
      const testCases = [
        {
          country: "Japan",
          country_iso_code: "jp",
          city: "Tokyo",
          browser: "Chrome",
          os: "Android",
        },
        {
          country: "Brazil",
          country_iso_code: "br",
          city: "São Paulo",
          browser: "Firefox",
          os: "iOS",
        },
      ];

      for (const testCase of testCases) {
        await wrapper.setProps({ column: testCase });

        expect(wrapper.find(".row.items-center.no-wrap").exists()).toBe(true);
        expect(wrapper.find(".row.q-mt-xs.items-center").exists()).toBe(true);
        expect(wrapper.text()).toContain(testCase.country);
        expect(wrapper.text()).toContain(testCase.city);
      }
    });
  });

  describe("Accessibility", () => {
    it("should have proper semantic structure", () => {
      const mainDiv = wrapper.find("div");
      expect(mainDiv.exists()).toBe(true);

      const rows = wrapper.findAll(".row");
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle long location names", async () => {
      await wrapper.setProps({
        column: {
          country: "Very Long Country Name That Might Overflow",
          country_iso_code: "xx",
          city: "Very Long City Name That Might Cause Layout Issues",
          browser: "Very Long Browser Name",
          os: "Very Long Operating System Name",
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".row").exists()).toBe(true);
    });
  });
});
