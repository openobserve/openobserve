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
import ResourcePerformanceMetrics from "./ResourcePerformanceMetrics.vue";

installQuasar();

function createMetrics(overrides: Record<string, any> = {}) {
  return {
    resource: {
      duration: 400000000,            // 400ms — good
      dns: { duration: 10000000 },    // 10ms
      connect: { duration: 20000000 },
      ssl: { duration: 15000000 },
      first_byte: { duration: 50000000 },
      download: { duration: 100000000 },
      size: 102400,                   // 100KB
      redirect: { duration: 5000000 },
      ...overrides,
    },
  };
}

describe("ResourcePerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have data-test=resource-performance-metrics on root", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(true);
    });

    it("should use grid layout", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.classes().join(" ")).toContain("tw:grid");
    });
  });

  describe("conditional rendering — all cards present", () => {
    it("should render total duration card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("should render DNS lookup card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(true);
    });

    it("should render connection time card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-connect"]').exists()).toBe(true);
    });

    it("should render SSL handshake card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-ssl"]').exists()).toBe(true);
    });

    it("should render TTFB card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-ttfb"]').exists()).toBe(true);
    });

    it("should render download time card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-download"]').exists()).toBe(true);
    });

    it("should render resource size card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(true);
    });

    it("should render redirect time card", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-redirect"]').exists()).toBe(true);
    });
  });

  describe("conditional rendering — missing metrics", () => {
    it("should not render duration card when missing", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: {} } },
      });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
    });

    it("should not render DNS card when dns.duration is missing", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: { duration: 100 } } },
      });
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(false);
    });

    it("should not render SSL card when ssl.duration is missing", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: { duration: 100, dns: { duration: 10 } } } },
      });
      expect(wrapper.find('[data-test="metric-ssl"]').exists()).toBe(false);
    });

    it("should not render size card when size is falsy", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: { resource: { duration: 100, size: 0 } } },
      });
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(false);
    });

    it("should show no cards when resource is null/empty", () => {
      wrapper = mount(ResourcePerformanceMetrics, { props: { metrics: {} } });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-dns"]').exists()).toBe(false);
    });
  });

  describe("duration status thresholds", () => {
    it("should show good status for duration <= 500ms", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 400000000 }) },
      });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("should show needs-improvement for duration 500ms–1s", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 750000000 }) },
      });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("should show poor status for duration > 1s", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ duration: 2000000000 }) },
      });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });
  });

  describe("formatBytes for size display", () => {
    it("should render size card with byte-formatted value", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ size: 1024 }) },
      });
      const sizeCard = wrapper.find('[data-test="metric-size"]');
      expect(sizeCard.exists()).toBe(true);
    });

    it("should not render size card when size is undefined", () => {
      wrapper = mount(ResourcePerformanceMetrics, {
        props: { metrics: createMetrics({ size: undefined }) },
      });
      expect(wrapper.find('[data-test="metric-size"]').exists()).toBe(false);
    });
  });
});
