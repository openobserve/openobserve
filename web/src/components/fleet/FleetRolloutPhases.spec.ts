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
import FleetRolloutPhases from "./FleetRolloutPhases.vue";
import type { RolloutPhaseRow, RolloutRow } from "./useFleetApi";

const phase = (id: string, status: string): RolloutPhaseRow => ({
  id,
  labelKey: "fleet.rollouts.phaseCanary",
  size: 1,
  attempted: 1,
  accepted: 1,
  failed: 0,
  status,
});

const rollout = (phases: RolloutPhaseRow[], gates: RolloutRow["gates"] = []): RolloutRow =>
  ({
    id: "r1",
    config: "edge",
    toVersion: 2,
    status: "in_progress",
    gates,
    phases,
    failure: null,
  }) as unknown as RolloutRow;

const mountPhases = (phases: RolloutPhaseRow[], gates: RolloutRow["gates"] = []) =>
  mount(FleetRolloutPhases, {
    props: { rollout: rollout(phases, gates) },
    global: { plugins: [i18n] },
  });

const gate = (status: string, observed: string) => ({
  id: "heartbeat",
  labelKey: "fleet.rollouts.gateHeartbeat" as const,
  threshold: "≥ 99%",
  observed,
  status,
});

describe("FleetRolloutPhases", () => {
  it("tags an observing phase with a short label and explains the wait in its detail", () => {
    const card = mountPhases([phase("p1", "observing")]).find(
      '[data-test="fleet-rollout-phases-phase-p1"]',
    );
    expect(card.findComponent({ name: "OTag" }).text()).toBe("Observing");
    expect(card.text()).toContain("Observing for 10 minutes, then checking heartbeats for 5");
  });

  it.each([
    ["pending", "Pending"],
    ["stopped", "Stopped"],
  ])("labels a %s phase %s", (status, label) => {
    const card = mountPhases([phase("p1", status)]).find(
      '[data-test="fleet-rollout-phases-phase-p1"]',
    );
    expect(card.findComponent({ name: "OTag" }).text()).toBe(label);
  });

  it("lists the health gates with their threshold and observed share", () => {
    const row = mountPhases([phase("p1", "done")], [gate("passing", "100.0%")]).find(
      '[data-test="fleet-rollout-phases-gate-heartbeat"]',
    );
    expect(row.text()).toContain("Heartbeat success");
    expect(row.text()).toContain("Threshold ≥ 99%");
    expect(row.text()).toContain("100.0%");
  });

  it("shows a dash for a gate not yet decided", () => {
    const row = mountPhases([phase("p1", "observing")], [gate("pending", "97.0%")]).find(
      '[data-test="fleet-rollout-phases-gate-heartbeat"]',
    );
    expect(row.text()).toContain("—");
    expect(row.text()).not.toContain("97.0%");
  });

  it("shows no gates list when the rollout has no gates", () => {
    const wrapper = mountPhases([phase("p1", "running")]);
    expect(wrapper.text()).not.toContain("Health gates");
    expect(wrapper.find('[data-test^="fleet-rollout-phases-gate-"]').exists()).toBe(false);
  });

  it("leaves the observation detail off a phase that is not observing", () => {
    expect(mountPhases([phase("p1", "running")]).text()).not.toContain("checking heartbeats");
  });
});
