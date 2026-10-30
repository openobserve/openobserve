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

import { inject, reactive, watchEffect, type InjectionKey } from "vue";
import type { AlertSectionId } from "@/components/alerts/alertFormSections";
import {
  ALERT_SETTING_TIERS,
  isTierVisible,
  sectionTierView,
  type AlertSectionTierView,
  type AlertSettingId,
  type AlertTierState,
} from "@/components/alerts/alertSettingTiers";

export interface AlertSettingTiers {
  isVisible: (id: AlertSettingId) => boolean;
  view: (section: AlertSectionId) => AlertSectionTierView;
  reveal: (id: AlertSettingId) => void;
  toggle: (section: AlertSectionId) => void;
  expand: (section: AlertSectionId) => void;
}

export const ALERT_SETTING_TIERS_KEY: InjectionKey<AlertSettingTiers> = Symbol("alertSettingTiers");

/** Tier state for the sectioned alert editor; `available`/`isSet` read the live form. */
export function useAlertSettingTiers(opts: {
  available: (id: AlertSettingId) => boolean;
  isSet: (id: AlertSettingId) => boolean;
}): AlertSettingTiers {
  const revealed = reactive(new Set<AlertSettingId>());
  const expanded = reactive<Partial<Record<AlertSectionId, boolean>>>({});
  const state: AlertTierState = {
    available: opts.available,
    isSet: opts.isSet,
    revealed,
    expanded: (section) => expanded[section] === true,
  };
  // Once shown for its value, a setting stays: clearing or breaking the value must not unmount it under the cursor.
  watchEffect(() => {
    for (const def of ALERT_SETTING_TIERS) {
      if (def.tier !== "shown" && !revealed.has(def.id) && opts.isSet(def.id)) revealed.add(def.id);
    }
  });
  return {
    isVisible: (id) => isTierVisible(id, state),
    view: (section) => sectionTierView(section, state),
    reveal: (id) => {
      revealed.add(id);
    },
    toggle: (section) => {
      expanded[section] = !expanded[section];
    },
    expand: (section) => {
      expanded[section] = true;
    },
  };
}

/** For step components: without the sectioned editor every control shows, as before. */
export function useTierVisibility(): (id: AlertSettingId) => boolean {
  const tiers = inject(ALERT_SETTING_TIERS_KEY, null);
  return (id) => !tiers || tiers.isVisible(id);
}
