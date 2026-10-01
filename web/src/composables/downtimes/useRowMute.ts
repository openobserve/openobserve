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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import type { TargetModule } from "@/services/downtimes";
import { groupSelection, type QuickMuteSelection } from "@/utils/downtimes/quickMute";
import { useQuickMute } from "./useQuickMute";

/** The Mute entries of a list: presets create at once, Until… opens the dialog. */
export function useRowMute<T>(moduleOf: (row: T) => TargetModule, idOf: (row: T) => string) {
  const store = useStore() as { state?: { zoConfig?: Record<string, unknown> } } | undefined;
  // Muting reads the org from the store, so a storeless leaf mount gets no mute action at all.
  const quick = store?.state ? useQuickMute() : null;

  // Enterprise or cloud plus `downtimes_enabled`, the rule of the route guard and the nav gate.
  const downtimesEnabled = computed(
    () =>
      !!quick &&
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store?.state?.zoConfig?.downtimes_enabled === true,
  );

  const muteDialogOpen = ref(false);
  const muteSelection = ref<QuickMuteSelection[]>([]);

  const muteRows = async (rows: T[], seconds: number) =>
    quick ? quick.muteFor(groupSelection(rows, moduleOf, idOf), seconds) : null;

  const openMuteDialog = (rows: T[]) => {
    muteSelection.value = groupSelection(rows, moduleOf, idOf);
    muteDialogOpen.value = true;
  };

  return { downtimesEnabled, muteDialogOpen, muteSelection, muteRows, openMuteDialog };
}
