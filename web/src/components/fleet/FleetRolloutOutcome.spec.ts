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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FleetRolloutOutcome from "./FleetRolloutOutcome.vue";
import type { RolloutRow } from "./useFleetApi";

const row = (over: Partial<RolloutRow> = {}): RolloutRow =>
  ({
    id: "r1",
    config: "edge",
    fromVersion: 1,
    toVersion: 2,
    fleetId: "f1",
    fleetName: "edge",
    strategy: "immediate",
    status: "halted",
    total: 2,
    attempted: 2,
    accepted: 0,
    failed: 1,
    assigned: 2,
    startedAt: 1,
    autoRollback: false,
    scheduledFor: null,
    gates: [],
    startedBy: "ana@acme.io",
    phases: [],
    failure: {
      kind: "rejection",
      labelKey: "fleet.rollouts.gateRejected",
      observed: "1",
      threshold: "0",
      message: "unknown receiver",
    },
    events: [],
    members: ["c1", "c2"],
    stillOnPrevious: 5,
    ...over,
  }) as RolloutRow;

const STABLE = { config: "edge", version: 1 };

const mountOutcome = (rollout: RolloutRow, stable: typeof STABLE | null = STABLE) =>
  mount(FleetRolloutOutcome, { props: { rollout, stable }, global: { plugins: [i18n] } });

describe("FleetRolloutOutcome", () => {
  it("opens the rollout's fleet in the Fleets view, without a collector id", async () => {
    const wrapper = mountOutcome(row());
    const btn = wrapper.find('[data-test="fleet-rollout-outcome-collector"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe("View collectors");
    await btn.trigger("click");
    expect(wrapper.emitted("navigate")!.at(-1)).toEqual([
      { tab: "fleets", query: { folder: "f1" } },
    ]);
  });

  it("opens every fleet's collectors when the rollout's fleet was deleted", async () => {
    const wrapper = mountOutcome(row({ fleetId: "", fleetName: null }));
    await wrapper.find('[data-test="fleet-rollout-outcome-collector"]').trigger("click");
    expect(wrapper.emitted("navigate")!.at(-1)).toEqual([
      { tab: "fleets", query: { scope: "all" } },
    ]);
  });

  it("shows a halted rollout as an error banner naming the failure, with the counts", () => {
    const banner = mountOutcome(row()).findComponent({ name: "OBanner" });
    expect(banner.props("variant")).toBe("error");
    expect(banner.text()).toContain("1 collector rejected the configuration: unknown receiver");
    expect(banner.text()).toContain("2 of 2 attempted · 0 accepted · 1 failed");
    expect(banner.text()).toContain("v2 stays desired until the fleet's desired version changes");
  });

  it("names a failed health gate on a halted rollout", () => {
    const text = mountOutcome(
      row({
        failure: {
          kind: "gate_failed",
          labelKey: "fleet.rollouts.gateHeartbeat",
          observed: "86.7%",
          threshold: "≥ 99%",
          message: null,
        },
      }),
    ).text();
    expect(text).toContain("Health gate failed: Heartbeat success 86.7% (limit ≥ 99%)");
  });

  it("offers Revert to the fleet's stable version and Retry on a halted rollout", async () => {
    const wrapper = mountOutcome(row());
    const revert = wrapper.find('[data-test="fleet-rollout-outcome-revert"]');
    expect(revert.text()).toBe("Revert to v1");
    await revert.trigger("click");
    expect(wrapper.emitted("revert")).toEqual([[STABLE]]);
    await wrapper.find('[data-test="fleet-rollout-outcome-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toEqual([[]]);
  });

  it("offers no Revert without a stable version, or when stable is what halted", () => {
    expect(
      mountOutcome(row(), null).find('[data-test="fleet-rollout-outcome-revert"]').exists(),
    ).toBe(false);
    expect(
      mountOutcome(row(), { config: "edge", version: 2 })
        .find('[data-test="fleet-rollout-outcome-revert"]')
        .exists(),
    ).toBe(false);
  });

  it("keeps an auto-reverted rollout's failure and says it was reverted automatically, with no actions", () => {
    const wrapper = mountOutcome(
      row({ status: "superseded", events: [{ key: "autoReverted", at: 1 }] }),
    );
    const banner = wrapper.findComponent({ name: "OBanner" });
    expect(banner.props("variant")).toBe("warning");
    expect(banner.text()).toContain("1 collector rejected the configuration: unknown receiver");
    expect(banner.text()).toContain("Reverted automatically");
    expect(wrapper.find('[data-test="fleet-rollout-outcome-revert"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-rollout-outcome-retry"]').exists()).toBe(false);
  });

  it("says a superseded rollout was replaced by a newer desired version", () => {
    const text = mountOutcome(row({ status: "superseded", failure: null })).text();
    expect(text).toContain("A newer desired version replaced this rollout.");
  });

  it("shows no banner on an in-progress rollout", () => {
    expect(
      mountOutcome(row({ status: "in_progress", failure: null }))
        .find('[data-test="fleet-rollout-outcome"]')
        .exists(),
    ).toBe(false);
  });

  it("says 1 collector, not 1 collectors, when a rollout of one collector completes", () => {
    const text = mountOutcome(
      row({ status: "completed", accepted: 1, total: 1, failure: null }),
    ).text();
    expect(text).toContain("v2 is running on 1 collector.");
  });

  it("says a completed rollout of an empty fleet targeted no collectors, without a success tone", () => {
    const w = mountOutcome(
      row({ status: "completed", total: 0, attempted: 0, accepted: 0, failed: 0, failure: null }),
    );
    expect(w.findComponent({ name: "OBanner" }).props("variant")).toBe("info");
    expect(w.text()).toContain("No collectors targeted");
    expect(w.text()).toContain("The fleet had no collectors when v2 was set.");
    expect(w.text()).not.toContain("0 of 0");
    expect(w.text()).not.toContain("Completed");
  });

  it("says when a scheduled rollout starts", () => {
    const text = mountOutcome(
      row({ status: "scheduled", scheduledFor: Date.now() + 2 * 3600_000, failure: null }),
    ).text();
    expect(text).toContain("Starts in 2h");
  });

  it("counts a start under an hour away in minutes", () => {
    const text = mountOutcome(
      row({ status: "scheduled", scheduledFor: Date.now() + 12 * 60_000, failure: null }),
    ).text();
    expect(text).toContain("Starts in 12m");
    expect(text).not.toMatch(/Starts in \d+h/);
  });

  it("rounds a start more than an hour away up to whole hours", () => {
    const text = mountOutcome(
      row({ status: "scheduled", scheduledFor: Date.now() + 90 * 60_000, failure: null }),
    ).text();
    expect(text).toContain("Starts in 2h");
  });

  it("says a due scheduled rollout is starting shortly", () => {
    const text = mountOutcome(
      row({ status: "scheduled", scheduledFor: Date.now() - 60_000, failure: null }),
    ).text();
    expect(text).toContain("Starting shortly");
  });
});
