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

import { useStore } from "vuex";
import config from "@/aws-exports";
import { computed } from "vue";
import { actionsQuery } from "@/services/action_scripts";

const useActions = () => {
  const store = useStore();

  const isActionsEnabled = computed(() => {
    return (
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store.state.zoConfig.actions_enabled
    );
  });

  const getAllActions = async (force = false): Promise<any[]> => {
    try {
      if (!isActionsEnabled.value) return [];

      // Cached: this runs on every Logs entry alongside the functions list.
      // `force` is for the Actions page's refresh and its post-write reloads.
      const org = store.state.selectedOrganization.identifier;
      const data = force ? await actionsQuery.refresh(org) : await actionsQuery.get(org);
      // Bridge for consumers still reading `organizationData.actions`.
      store.dispatch("setActions", data);
      return (data as any[]) ?? [];
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getAllActions, isActionsEnabled };
};

export default useActions;
