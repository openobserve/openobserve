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

const mockServiceColors: Record<string, string> = {
  frontend: "#4caf50",
  backend: "#2196f3",
  database: "#ff9800",
};

const mockSearchObj = {
  meta: {
    serviceColors: mockServiceColors,
  },
};

const mockGetOrSetServiceColor = vi.fn(
  (serviceName: string) => mockServiceColors[serviceName] ?? "#9e9e9e",
);

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    getOrSetServiceColor: mockGetOrSetServiceColor,
  }),
}));

vi.mock("@/utils/traces/convertTraceData", () => ({
  getServiceIconDataUrl: vi
    .fn()
    .mockReturnValue("data:image/svg+xml;base64,TEST"),
}));

import TraceServiceCell from "./TraceServiceCell.vue";
import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";

installQuasar();

const makeItem = (overrides: Record<string, any> = {}) => ({
  service_name: "frontend",
  operation_name: "GET /api/v1/users",
  services: { frontend: { duration: 100 } },
  ...overrides,
});

describe("TraceServiceCell", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("mounts without errors", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the service row container", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      expect(wrapper.find('[data-test="trace-row-service"]').exists()).toBe(
        true,
      );
    });

    it("renders service name", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const name = wrapper.find('[data-test="trace-row-service-name"]');
      expect(name.exists()).toBe(true);
      expect(name.text()).toBe("frontend");
    });

    // TraceServiceCell only renders service name and icon.
    // Operation name is rendered by a separate column cell — not this component.
    it.skip("renders operation name", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const op = wrapper.find('[data-test="trace-row-operation-name"]');
      expect(op.exists()).toBe(true);
      expect(op.text()).toBe("GET /api/v1/users");
    });
  });

  describe("service icon", () => {
    it("should render the service icon img", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      expect(
        wrapper.find('[data-test="trace-row-service-icon"]').exists(),
      ).toBe(true);
    });

    it("should set the icon src from getServiceIconDataUrl", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const img = wrapper.find('[data-test="trace-row-service-icon"]');
      expect(img.attributes("src")).toBe("data:image/svg+xml;base64,TEST");
    });

    it("should call getServiceIconDataUrl with service name and color", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      expect(vi.mocked(getServiceIconDataUrl)).toHaveBeenCalledWith(
        "frontend",
        expect.any(Boolean),
        "#4caf50",
      );
    });

    it("should use fallback color #9e9e9e for unknown service", () => {
      wrapper = mount(TraceServiceCell, {
        props: { item: makeItem({ service_name: "unknown-svc" }) },
      });
      expect(vi.mocked(getServiceIconDataUrl)).toHaveBeenCalledWith(
        "unknown-svc",
        expect.any(Boolean),
        "#9e9e9e",
      );
    });
  });

  describe("extra services badge", () => {
    it("does not show the badge when there is only one service", () => {
      wrapper = mount(TraceServiceCell, {
        props: {
          item: makeItem({ services: { frontend: { duration: 100 } } }),
        },
      });
      expect(
        wrapper.find('[data-test="trace-row-extra-services"]').exists(),
      ).toBe(false);
    });

    it("does not count root service as an extra service", () => {
      wrapper = mount(TraceServiceCell, {
        props: {
          item: makeItem({
            service_name: "frontend",
            services: { frontend: { duration: 100 } },
          }),
        },
      });
      expect(
        wrapper.find('[data-test="trace-row-extra-services"]').exists(),
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles undefined services gracefully", () => {
      wrapper = mount(TraceServiceCell, {
        props: { item: { service_name: "frontend", operation_name: "op" } },
      });
      expect(wrapper.find('[data-test="trace-row-service-name"]').text()).toBe(
        "frontend",
      );
      expect(
        wrapper.find('[data-test="trace-row-extra-services"]').exists(),
      ).toBe(false);
    });

    it("handles empty services object", () => {
      wrapper = mount(TraceServiceCell, {
        props: { item: makeItem({ services: {} }) },
      });
      expect(
        wrapper.find('[data-test="trace-row-extra-services"]').exists(),
      ).toBe(false);
    });
  });
});
