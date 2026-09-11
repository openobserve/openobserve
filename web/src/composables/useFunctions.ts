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

import { functionsQuery } from "@/services/jstransform.queries";
import { queryClient } from "@/composables/query/queryClient";
import { useStore } from "vuex";

const useFunctions = () => {
  const store = useStore();

  /**
   * Called on every Logs entry, alert form open and panel editor open. Outside a
   * component scope, so the same options object is read imperatively — no
   * request while the entry is fresh, and concurrent callers share the promise.
   */
  const getAllFunctions = async () => {
    try {
      const list = await queryClient.fetchQuery(
        functionsQuery(store.state.selectedOrganization.identifier),
      );
      // Bridge for consumers still reading `organizationData.functions`.
      store.dispatch("setFunctions", list);
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getAllFunctions };
};

export default useFunctions;
