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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

const mockSearchObj = {
  meta: {
    serviceColors: {
      "service-a": "#ff0000",
      "service-b": "#00ff00",
    } as Record<string, string>,
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

import TraceLatencyCell from "./TraceLatencyCell.vue";

installQuasar();

describe("TraceLatencyCell", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("mounts without errors", () => {
      wrapper = mount(TraceLatencyCell, {
        props: { item: { services: {} } },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the latency bar container", () => {
      wrapper = mount(TraceLatencyCell, {
        props: { item: { services: { "service-a": { duration: 100 } } } },
      });
      expect(wrapper.find('[data-test="trace-row-latency-bar"]').exists()).toBe(
        true,
      );
    });

    it("renders one segment per service", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: {
            services: {
              "service-a": { duration: 60 },
              "service-b": { duration: 40 },
            },
          },
        },
      });
      const segments = wrapper.findAll(
        '[data-test="trace-row-latency-segment"]',
      );
      expect(segments).toHaveLength(2);
    });

    it("renders no segments when services is empty", () => {
      wrapper = mount(TraceLatencyCell, {
        props: { item: { services: {} } },
      });
      const segments = wrapper.findAll(
        '[data-test="trace-row-latency-segment"]',
      );
      expect(segments).toHaveLength(0);
    });

    it("renders no segments when services is undefined", () => {
      wrapper = mount(TraceLatencyCell, {
        props: { item: {} },
      });
      const segments = wrapper.findAll(
        '[data-test="trace-row-latency-segment"]',
      );
      expect(segments).toHaveLength(0);
    });
  });

  describe("segment widths", () => {
    it("renders a single service at 100% width", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "service-a": { duration: 200 } } },
        },
      });
      const segment = wrapper.find('[data-test="trace-row-latency-segment"]');
      expect(segment.attributes("style")).toContain("width: 100%");
    });

    it("splits width proportionally between two services", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: {
            services: {
              "service-a": { duration: 300 },
              "service-b": { duration: 100 },
            },
          },
        },
      });
      const segments = wrapper.findAll(
        '[data-test="trace-row-latency-segment"]',
      );
      // service-a: 75%, service-b: 25%
      expect(segments[0].attributes("style")).toContain("width: 75%");
      expect(segments[1].attributes("style")).toContain("width: 25%");
    });

    it("falls back to 1 total duration to avoid division by zero when all durations are 0", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "service-a": { duration: 0 } } },
        },
      });
      const segment = wrapper.find('[data-test="trace-row-latency-segment"]');
      // 0 / 1 * 100 = 0%
      expect(segment.attributes("style")).toContain("width: 0%");
    });
  });

  describe("segment colors", () => {
    it("applies the service color from serviceColors", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "service-a": { duration: 100 } } },
        },
      });
      const segment = wrapper.find('[data-test="trace-row-latency-segment"]');
      expect(segment.attributes("style")).toContain(
        "background-color: rgb(255, 0, 0)",
      );
    });

    it("falls back to #9e9e9e for unknown service colors", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "unknown-svc": { duration: 100 } } },
        },
      });
      const segment = wrapper.find('[data-test="trace-row-latency-segment"]');
      expect(segment.attributes("style")).toContain(
        "background-color: rgb(158, 158, 158)",
      );
    });
  });

  describe("tooltip content", () => {
    // QTooltip is teleported in real Quasar; stub it as a plain div so the
    // slot content is accessible via wrapper.text() in jsdom.
    const tooltipStubs = { QTooltip: { template: "<div><slot /></div>" } };

    it("shows service name in tooltip", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "service-a": { duration: 100 } } },
        },
        global: { stubs: tooltipStubs },
      });
      expect(wrapper.text()).toContain("service-a");
    });

    it("shows percentage in tooltip", () => {
      wrapper = mount(TraceLatencyCell, {
        props: {
          item: { services: { "service-a": { duration: 100 } } },
        },
        global: { stubs: tooltipStubs },
      });
      expect(wrapper.text()).toContain("100.0%");
    });
  });
});
