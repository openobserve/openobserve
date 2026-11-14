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

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

const { list, follow } = vi.hoisted(() => ({ list: vi.fn(), follow: vi.fn() }));
vi.mock("@/services/incidents", () => ({ default: { list } }));
vi.mock("@/components/ai-assistant/shell/rcaFollow", () => ({ useRcaFollow: () => ({ follow }) }));

import { rcaSummary } from "@/test/unit/fixtures/rcaThread";
import { useAlertRcaFollow } from "./useAlertRcaFollow";

const host = (enabled: boolean) => {
  let api!: ReturnType<typeof useAlertRcaFollow>;
  mount(
    defineComponent({
      setup() {
        api = useAlertRcaFollow("default", enabled);
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } },
  );
  return () => api;
};

describe("useAlertRcaFollow", () => {
  it("follows the run of the open incident an alert fired into; other alerts have none", async () => {
    list.mockResolvedValue({
      data: {
        total: 1,
        incidents: [
          {
            id: "inc-1",
            created_at: 1,
            rca: rcaSummary({ run_id: "run-1" }),
            alert_groups: [{ alert_id: "a1", alert_name: "checkout 5xx", count: 3 }],
          },
        ],
      },
    });
    const api = host(true);
    await flushPromises();

    expect(list).toHaveBeenCalledWith("default", "open", 50, 0);
    expect(api().runFor("a1")).toEqual({ incidentId: "inc-1", runId: "run-1" });
    expect(api().runFor("a2")).toBeNull();
    api().followAlert("a1");
    expect(follow).toHaveBeenCalledWith(
      { org: "default", incidentId: "inc-1", runId: "run-1" },
      null,
    );
    api().followAlert("a2");
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when the assistant is off", async () => {
    list.mockClear();
    const api = host(false);
    await flushPromises();

    expect(list).not.toHaveBeenCalled();
    expect(api().runFor("a1")).toBeNull();
  });
});
