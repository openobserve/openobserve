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
import type { FleetHaltClass, FleetHaltExit } from "@/services/fleet";
import FleetRolloutOutcome from "./FleetRolloutOutcome.vue";
import { apiRollout } from "./fleet.fixtures";
import { toRolloutRow, type RolloutRow } from "./useFleetApi";

const halted = (cls: FleetHaltClass, exits: FleetHaltExit[], failing = true) =>
  toRolloutRow(
    apiRollout({
      status: "halted",
      total: 2,
      running: 1,
      halt: { class: cls, reason: "why it halted", at: Date.now(), exits },
      members: [
        { collector_id: "c1", phase: 0, state: "running", excluded: false },
        { collector_id: "c2", phase: 0, state: failing ? "rejected" : "sent", excluded: false },
      ],
    }),
  );

const mountOutcome = (rollout: RolloutRow) =>
  mount(FleetRolloutOutcome, { props: { rollout }, global: { plugins: [i18n] } });

const exitButton = (w: ReturnType<typeof mountOutcome>, exit: string) =>
  w.find(`[data-test="fleet-rollout-outcome-${exit}"]`);

describe("FleetRolloutOutcome", () => {
  it("names the halt class and shows the server's reason", () => {
    const w = mountOutcome(halted("looks_worse", ["rollback", "resume", "fix_forward"]));
    expect(w.find('[data-test="fleet-rollout-outcome-title"]').text()).toBe("Halted: Looks worse");
    expect(w.find('[data-test="fleet-rollout-outcome-body"]').text()).toBe("why it halted");
  });

  it("always shows all four exits and enables only the offered ones", () => {
    const w = mountOutcome(halted("looks_worse", ["rollback", "resume", "fix_forward"]));
    for (const exit of ["rollback", "resume", "fix_forward"])
      expect(exitButton(w, exit).attributes("disabled"), exit).toBeUndefined();
    expect(exitButton(w, "skip").attributes("disabled")).toBeDefined();
  });

  it("disables resume for a proven-bad halt the server does not resume", () => {
    const w = mountOutcome(halted("proven_bad", ["rollback", "fix_forward", "skip"]));
    expect(exitButton(w, "resume").attributes("disabled")).toBeDefined();
    expect(exitButton(w, "skip").attributes("disabled")).toBeUndefined();
  });

  it("disables skip when no member is failing, even when it is offered", () => {
    const w = mountOutcome(
      halted("cannot_see", ["rollback", "resume", "fix_forward", "skip"], false),
    );
    expect(exitButton(w, "skip").attributes("disabled")).toBeDefined();
  });

  it("emits the chosen exit", async () => {
    const w = mountOutcome(halted("proven_bad", ["rollback", "fix_forward", "skip"]));
    await exitButton(w, "rollback").trigger("click");
    await exitButton(w, "skip").trigger("click");
    expect(w.emitted("exit")).toEqual([["rollback"], ["skip"]]);
  });

  it("offers no exits outside a halt", () => {
    const w = mountOutcome(toRolloutRow(apiRollout({ status: "completed", total: 2, running: 2 })));
    expect(w.find('[data-test="fleet-rollout-outcome-rollback"]').exists()).toBe(false);
    expect(w.find('[data-test="fleet-rollout-outcome-title"]').text()).toBe("Completed");
  });

  it("says an automatic rollback happened", () => {
    const w = mountOutcome(
      toRolloutRow(apiRollout({ status: "rolled_back", auto_rollback: true })),
    );
    expect(w.find('[data-test="fleet-rollout-outcome-title"]').text()).toBe(
      "Automatically rolled back",
    );
  });

  it("counts progress in collectors while in progress", () => {
    const w = mountOutcome(
      toRolloutRow(apiRollout({ status: "in_progress", total: 40, running: 28 })),
    );
    expect(w.find('[data-test="fleet-rollout-outcome-body"]').text()).toBe(
      "28 of 40 running the new version",
    );
  });
});
