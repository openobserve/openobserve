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

import { computed, ref, shallowRef } from "vue";

import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";

import type { PackUpdate } from "./types";
import type { StarterPackFlow } from "./useStarterPackFlow";
import { useStarterPacks } from "./useStarterPacks";

export type PackUpdateState = "idle" | "checking" | "ready" | "applying" | "error";

/** Library updates, Revert and the plan-loss dashboard for the pack page's install. */
export function usePackUpdates(org: string, flow: StarterPackFlow) {
  const { applyUpdates, appendToInstall, checkUpdates, revertUpdates } = useStarterPacks(org);
  const updates = shallowRef<PackUpdate[]>([]);
  const state = ref<PackUpdateState>("idle");

  const installId = computed(() => flow.record.value?.installId);
  const available = computed(() => updates.value.length > 0);
  const canRevert = computed(() => !!flow.record.value?.items.some(({ update }) => update));
  // Without the built-in view the pack has to bring its own dashboard.
  const needsDashboard = computed(
    () =>
      STARTER_PACKS_ENABLED &&
      !flow.licensed.value &&
      flow.pack.dashboards.length > 0 &&
      !!flow.record.value &&
      !flow.record.value.items.some(({ kind, id }) => kind === "dashboard" && id),
  );

  const run = async (work: () => Promise<unknown>, busy: PackUpdateState) => {
    if (!STARTER_PACKS_ENABLED || !installId.value) return false;
    state.value = busy;
    try {
      await work();
      state.value = "ready";
      return true;
    } catch {
      state.value = "error";
      return false;
    }
  };

  const check = () =>
    run(async () => {
      updates.value = await checkUpdates(flow.pack, installId.value!);
    }, "checking");

  const apply = async () => {
    const done = await run(
      () => applyUpdates(flow.pack, installId.value!, updates.value),
      "applying",
    );
    if (done) updates.value = [];
    await flow.load();
    return done;
  };

  const revert = async () => {
    const done = await run(() => revertUpdates(flow.pack, installId.value!), "applying");
    await flow.load();
    if (done) await check();
    return done;
  };

  const addDashboard = async () => {
    const ids = flow.pack.dashboards.map(({ id }) => id);
    const done = await run(() => appendToInstall(flow.pack, installId.value!, ids), "applying");
    await flow.load();
    return done;
  };

  return {
    addDashboard,
    apply,
    available,
    canRevert,
    check,
    needsDashboard,
    revert,
    state,
    updates,
  };
}
