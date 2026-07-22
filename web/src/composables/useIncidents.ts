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

const useIncidents = () => {
  const store = useStore();

  // Incidents are an enterprise/cloud feature. The backend can also turn it off
  // at runtime via O2_INCIDENTS_ENABLED, surfaced as incidents_enabled in the
  // config API response.
  const isIncidentsEnabled = computed(() => {
    return (
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store.state.zoConfig.incidents_enabled
    );
  });

  return { isIncidentsEnabled };
};

export default useIncidents;
