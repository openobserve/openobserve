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
import { mount, flushPromises } from "@vue/test-utils";
import SessionLocationColumn from "@/components/rum/sessionReplay/SessionLocationColumn.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Attach a mount target once for the whole file
const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Suppress the flag-icons CSS import which doesn't work in jsdom
vi.mock("flag-icons/css/flag-icons.min.css", () => ({}));

describe("SessionLocationColumn", () => {
  let wrapper: ReturnType<typeof mount>;

  const mockColumn = {
    country: "United States",
    country_iso_code: "us",
    city: "New York",
    browser: "Chrome",
    os: "Windows",
  };

  const mountComponent = (column = mockColumn) =>
    mount(SessionLocationColumn, {
      attachTo: "#app",
      props: { column },
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          OIcon: {
            template: '<i data-test="circle-icon" :class="name" :data-size="size"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("basic rendering", () => {
    it("mounts without errors", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("displays all location fields for a complete column", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain(mockColumn.country);
      expect(wrapper.text()).toContain(mockColumn.city);
      expect(wrapper.text()).toContain(mockColumn.browser);
      expect(wrapper.text()).toContain(mockColumn.os);
    });
  });

  describe("country and flag display", () => {
    it("shows the country name text", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("United States");
    });

    it("renders a span that carries the fi- ISO flag class", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find(`.fi-${mockColumn.country_iso_code}`).exists()).toBe(true);
    });

    it("updates the flag class when country_iso_code changes", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Act
      await wrapper.setProps({ column: { ...mockColumn, country_iso_code: "uk", country: "United Kingdom" } });

      // Assert
      expect(wrapper.find(".fi-uk").exists()).toBe(true);
      expect(wrapper.text()).toContain("United Kingdom");
    });
  });

  describe("city display", () => {
    it("shows the city name", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("New York");
    });

    it("shows Unknown when city is null", async () => {
      // Arrange
      wrapper = mountComponent({ ...mockColumn, city: null as any });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Unknown");
    });

    it("shows Unknown when city is undefined", async () => {
      // Arrange
      const col = { ...mockColumn };
      delete (col as any).city;
      wrapper = mountComponent(col as any);
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Unknown");
    });
  });

  describe("browser and OS display", () => {
    it("shows the browser name", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Chrome");
    });

    it("shows the OS name", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Windows");
    });
  });

  describe("separator icons", () => {
    it("renders separator circle icons between detail fields", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert — two OIcon separators between city | browser | os
      expect(wrapper.findAll('[data-test="circle-icon"]').length).toBeGreaterThanOrEqual(2);
    });

    it("uses xs size for separator icons", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      const icons = wrapper.findAll('[data-test="circle-icon"]');
      icons.forEach((icon) => {
        expect(icon.attributes("data-size")).toBe("xs");
      });
    });
  });

  describe("edge cases", () => {
    it("shows Unknown when column has no fields at all", async () => {
      // Arrange
      wrapper = mountComponent({} as any);
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Unknown");
    });

    it("shows only provided fields and Unknown for missing ones", async () => {
      // Arrange
      wrapper = mountComponent({ country: "Germany", browser: "Safari" } as any);
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Germany");
      expect(wrapper.text()).toContain("Safari");
      expect(wrapper.text()).toContain("Unknown");
    });

    it("renders without crash for very long location strings", async () => {
      // Arrange
      wrapper = mountComponent({
        country: "Very Long Country Name That Might Overflow",
        country_iso_code: "xx",
        city: "Very Long City Name That Might Cause Layout Issues",
        browser: "Very Long Browser Name",
        os: "Very Long Operating System Name",
      });
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("prop updates", () => {
    it("updates all displayed text when column prop is replaced", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      const newCol = {
        country: "Australia",
        country_iso_code: "au",
        city: "Sydney",
        browser: "Opera",
        os: "Linux",
      };

      // Act
      await wrapper.setProps({ column: newCol });

      // Assert
      expect(wrapper.text()).toContain("Australia");
      expect(wrapper.text()).toContain("Sydney");
      expect(wrapper.text()).toContain("Opera");
      expect(wrapper.text()).toContain("Linux");
      expect(wrapper.find(".fi-au").exists()).toBe(true);
    });

    it("handles sequential column updates without error", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      const testCases = [
        { country: "Japan", country_iso_code: "jp", city: "Tokyo", browser: "Chrome", os: "Android" },
        { country: "Brazil", country_iso_code: "br", city: "São Paulo", browser: "Firefox", os: "iOS" },
      ];

      // Act & Assert
      for (const col of testCases) {
        await wrapper.setProps({ column: col });
        expect(wrapper.text()).toContain(col.country);
        expect(wrapper.text()).toContain(col.city);
      }
    });
  });
});
