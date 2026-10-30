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

import { computed } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";

/** Enterprise or cloud plus `downtimes_enabled`, the rule of the route guard and the nav gate. */
export function useDowntimesEnabled() {
  const store = useStore() as { state?: { zoConfig?: Record<string, unknown> } } | undefined;
  return computed(
    () =>
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store?.state?.zoConfig?.downtimes_enabled === true,
  );
}
