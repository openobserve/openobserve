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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetRolloutPhases from "./FleetRolloutPhases.vue";
import { apiCollector, apiRollout } from "./fleet.fixtures";
import { toRolloutRow } from "./useFleetApi";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({ default: { listCollectors: vi.fn() } }));

const rollout = toRolloutRow(
  apiRollout({
    status: "in_progress",
    verify: true,
    total: 3,
    running: 1,
    phases: [
      {
        index: 0,
        size: 1,
        status: "done",
        targeted: 1,
        sent: 1,
        confirmed: 1,
        rejected: 0,
        gate: { passed: true, observed: "100% healthy" },
      },
      {
        index: 1,
        size: 2,
        status: "converging",
        targeted: 2,
        sent: 2,
        confirmed: 0,
        rejected: 1,
        gate: null,
      },
    ],
    members: [
      {
        collector_id: "c1",
        phase: 0,
        state: "running",
        excluded: false,
        evidence: {
          remote_status: "APPLIED",
          remote_hash: "9f2c",
          remote_at: 1,
          marker: { config: "edge", version: 2 },
          last_heartbeat_at: Date.now(),
        },
      },
      { collector_id: "c2", phase: 1, state: "rejected", excluded: true },
    ],
  }),
);

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountPhases() {
  vi.mocked(fleet.listCollectors).mockResolvedValue({
    data: { total: 1, items: [apiCollector({ id: "c1", name: "web-01" })] },
  } as any);
  const w = mount(FleetRolloutPhases, {
    props: { rollout },
    global: { plugins: [i18n, store] },
  });
  await settle();
  return w;
}

describe("FleetRolloutPhases", () => {
  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("lists each phase with its counts, status and gate", async () => {
    const w = await mountPhases();
    const table = w.find('[data-test="fleet-rollout-phases-table"]').text();
    expect(table).toContain("Phase 1");
    expect(table).toContain("Phase 2");
    expect(w.find('[data-test="fleet-rollout-phases-status-1"]').text()).toBe("Converging");
    expect(w.find('[data-test="fleet-rollout-phases-gate-0"]').text()).toBe("100% healthy");
    expect(w.text()).toContain("1 of 3 running the new version");
  });

  it("traces each member to its evidence, by name where the collector is known", async () => {
    const w = await mountPhases();
    const members = w.find('[data-test="fleet-rollout-members-table"]').text();
    expect(members).toContain("web-01");
    expect(members).toContain("APPLIED");
    expect(members).toContain("9f2c");
    expect(members).toContain("edge v2");
    expect(members).toContain("c2");
  });

  it("marks an excluded member", async () => {
    const w = await mountPhases();
    expect(w.find('[data-test="fleet-rollout-members-excluded-c2"]').exists()).toBe(true);
    expect(w.find('[data-test="fleet-rollout-members-excluded-c1"]').exists()).toBe(false);
  });
});
