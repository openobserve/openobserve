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
import { fetchFunctions } from "@/composables/query/queries/functions";

const useFunctions = () => {
  const store = useStore();

  /**
   * Called on every Logs entry, alert form open and panel editor open. It now
   * reads the query cache first, so those five call sites share one request
   * inside the tier's staleTime instead of each issuing their own.
   */
  const getAllFunctions = async () => {
    try {
      const list = await fetchFunctions(store.state.selectedOrganization.identifier);
      // Bridge for consumers still reading `organizationData.functions`.
      store.dispatch("setFunctions", list);
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getAllFunctions };
};

export default useFunctions;
