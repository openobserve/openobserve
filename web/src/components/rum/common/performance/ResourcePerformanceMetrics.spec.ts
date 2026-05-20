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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ResourcePerformanceMetrics from "./ResourcePerformanceMetrics.vue";

function createMetrics(overrides: Record<string, any> = {}) {
  return {
    resource: {
      duration: 400000000, // 400ms — good
      dns: { duration: 10000000 }, // 10ms
      connect: { duration: 20000000 },
      ssl: { duration: 15000000 },
      first_byte: { duration: 50000000 },
      download: { duration: 100000000 },
      size: 102400, // 100KB
      redirect: { duration: 5000000 },
      ...overrides,
    },
  };
}

describe("ResourcePerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("initial render", () => {
    it("renders without errors when valid metrics are provided", () => {
      // Arrange + Act
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders root container with data-test=resource-performance-metrics", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="resource-performance-metrics"]').exists(),
      ).toBe(true);
    });

    it("renders root element as a div", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find("div").exists()).toBe(true);
    });
  });

  describe("conditional rendering — all cards present", () => {
    it("renders total duration card when resource.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("renders DNS lookup card when resource.dns.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(true);
    });

    it("renders connection time card when resource.connect.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-connect"]').exists()).toBe(true);
    });

    it("renders SSL handshake card when resource.ssl.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-ssl"]').exists()).toBe(true);
    });

    it("renders TTFB card when resource.first_byte.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-ttfb"]').exists()).toBe(true);
    });

    it("renders download time card when resource.download.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-download"]').exists()).toBe(true);
    });

    it("renders resource size card when resource.size is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(true);
    });

    it("renders redirect time card when resource.redirect.duration is present", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-redirect"]').exists()).toBe(true);
    });
  });

  describe("conditional rendering — missing metrics", () => {
    it("does not render duration card when resource.duration is missing", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: {} } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
    });

    it("does not render DNS card when resource.dns.duration is missing", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: { duration: 100 } } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(false);
    });

    it("does not render SSL card when resource.ssl.duration is missing", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: {
          metrics: {
            resource: { duration: 100, dns: { duration: 10 } },
          },
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-ssl"]').exists()).toBe(false);
    });

    it("does not render size card when resource.size is falsy (0)", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: { duration: 100, size: 0 } } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(false);
    });

    it("renders no cards when resource object is absent from metrics", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: {} },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(false);
    });
  });

  describe("duration status thresholds", () => {
    it("renders duration card for good status (<=500ms)", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 400000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("renders duration card for needs-improvement status (500ms–1s)", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 750000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("renders duration card for poor status (>1s)", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 2000000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });
  });

  describe("resource size formatting", () => {
    it("renders size card when resource.size is a positive byte value", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ size: 1024 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(true);
    });

    it("does not render size card when resource.size is undefined", () => {
      // Arrange
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ size: undefined }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(false);
    });
  });
});
