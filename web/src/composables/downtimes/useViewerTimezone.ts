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

import { computed, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { browserTimezone, canonicalTimezone } from "@/utils/timezoneAliases";

const isKnownZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** The zone a downtime page shows times in: the app's chosen zone, else the browser's. */
export function useViewerTimezone(): ComputedRef<string> {
  const store = useStore() as { state?: { timezone?: unknown } } | undefined;
  return computed(() => {
    const chosen = store?.state?.timezone;
    return typeof chosen === "string" && chosen && isKnownZone(chosen)
      ? canonicalTimezone(chosen)
      : browserTimezone();
  });
}
