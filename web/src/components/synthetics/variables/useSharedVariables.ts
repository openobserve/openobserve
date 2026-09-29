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

import { ref } from "vue";
import { useStore } from "vuex";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

/** The org's environments and global variables, as the editor merges them locally. */
export function useSharedVariables() {
  const store = useStore();
  const environments = ref<SyntheticsEnvironment[]>([]);
  const globals = ref<SyntheticsVariable[]>([]);
  const loaded = ref(false);

  async function refresh() {
    const org = store.state.selectedOrganization.identifier;
    // Settled apart: a role that cannot list environments still reads the open global list.
    const [envs, vars] = await Promise.allSettled([
      syntheticsService.listEnvironments(org),
      syntheticsService.listGlobalVariables(org),
    ]);
    environments.value = envs.status === "fulfilled" ? (envs.value.data ?? []) : [];
    globals.value = vars.status === "fulfilled" ? (vars.value.data ?? []) : [];
    // Costs the editor a hint, never the author's work.
    loaded.value = envs.status === "fulfilled" || vars.status === "fulfilled";
  }

  return { environments, globals, loaded, refresh };
}
