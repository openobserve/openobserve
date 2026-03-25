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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

const mockSearchObj = {
  meta: {
    serviceColors: {
      frontend: "#4caf50",
      backend: "#2196f3",
      database: "#ff9800",
    } as Record<string, string>,
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

import TraceServiceCell from "./TraceServiceCell.vue";

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

    it("renders the colour dot", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      expect(wrapper.find('[data-test="trace-row-service-dot"]').exists()).toBe(
        true,
      );
    });

    it("renders service name", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const name = wrapper.find('[data-test="trace-row-service-name"]');
      expect(name.exists()).toBe(true);
      expect(name.text()).toBe("frontend");
    });

    // TraceServiceCell only renders service name and colour dot.
    // Operation name is rendered by a separate column cell — not this component.
    it.skip("renders operation name", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const op = wrapper.find('[data-test="trace-row-operation-name"]');
      expect(op.exists()).toBe(true);
      expect(op.text()).toBe("GET /api/v1/users");
    });
  });

  describe("colour dot", () => {
    it("applies the correct service colour from serviceColors", () => {
      wrapper = mount(TraceServiceCell, { props: { item: makeItem() } });
      const dot = wrapper.find('[data-test="trace-row-service-dot"]');
      expect(dot.attributes("style")).toContain(
        "background-color: rgb(76, 175, 80)",
      );
    });

    it("falls back to #9e9e9e for an unknown service colour", () => {
      wrapper = mount(TraceServiceCell, {
        props: { item: makeItem({ service_name: "unknown-svc" }) },
      });
      const dot = wrapper.find('[data-test="trace-row-service-dot"]');
      expect(dot.attributes("style")).toContain(
        "background-color: rgb(158, 158, 158)",
      );
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
    });
  });
});
