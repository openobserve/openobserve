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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import type { TargetModule } from "@/services/downtimes";
import { useDowntimeItems } from "./useDowntimeItems";

const { listFn } = vi.hoisted(() => ({ listFn: vi.fn() }));
vi.mock("@/services/synthetics.queries", () => ({
  syntheticsMonitorsQuery: (org: string) => ({ queryKey: ["synthetics", org], queryFn: listFn }),
}));
vi.mock("@/services/slos.queries", () => ({
  slosQuery: (org: string) => ({ queryKey: ["slos", org], queryFn: listFn }),
}));
vi.mock("@/services/anomaly_detection.queries", () => ({
  anomalyConfigsQuery: (org: string) => ({ queryKey: ["anomaly", org], queryFn: listFn }),
}));

const run = async (module: TargetModule, features: Record<string, string> = {}) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: "acme" }, zoConfig: { features } },
  });
  mount(
    defineComponent({
      setup() {
        useDowntimeItems(module);
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store] } },
  );
  await flushPromises();
};

describe("useDowntimeItems", () => {
  beforeEach(() => {
    queryClient.clear();
    listFn.mockReset();
    listFn.mockResolvedValue([]);
  });

  it.each([
    ["synthetics", "synthetics"],
    ["anomaly_detections", "anomaly_detection"],
    ["slos", "anomaly_detection"],
  ] as const)("reads no %s list while %s is license-locked", async (module, feature) => {
    await run(module, { [feature]: "locked" });
    expect(listFn).not.toHaveBeenCalled();
  });

  it.each(["synthetics", "anomaly_detections", "slos"] as const)(
    "reads the %s list while its feature is enabled",
    async (module) => {
      await run(module);
      expect(listFn).toHaveBeenCalledTimes(1);
    },
  );
});
