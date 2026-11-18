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

import { inject, reactive, shallowReactive, watchEffect, type InjectionKey, type Ref } from "vue";
import type { AlertSectionId } from "@/components/alerts/alertFormSections";
import {
  ALERT_SETTING_TIERS,
  isTierVisible,
  sectionPlacementOrder,
  sectionTierView,
  type AlertSectionTierView,
  type AlertSettingId,
  type AlertTierState,
} from "@/components/alerts/alertSettingTiers";

export interface AlertSettingTiers {
  isVisible: (id: AlertSettingId) => boolean;
  view: (section: AlertSectionId) => AlertSectionTierView;
  /** Rows the user brings in (More options, "+ add") render below the section's line, so the line never moves. */
  placedBelow: (id: AlertSettingId) => boolean;
  placementOrder: (section: AlertSectionId) => AlertSettingId[];
  setSlot: (id: AlertSettingId, el: Element | null) => void;
  slotFor: (id: AlertSettingId) => Element | null;
  /** Added by the user or shown for its value; Show all alone does not reveal. */
  isRevealed: (id: AlertSettingId) => boolean;
  reveal: (id: AlertSettingId) => void;
  /** Reveal from the section's own line: the row lands below that line. */
  bring: (id: AlertSettingId) => void;
  conceal: (id: AlertSettingId) => void;
  toggle: (section: AlertSectionId) => void;
}

export const ALERT_SETTING_TIERS_KEY: InjectionKey<AlertSettingTiers> = Symbol("alertSettingTiers");

/** Tier state for the sectioned alert editor; `available`/`isSet` read the live form. */
export function useAlertSettingTiers(opts: {
  available: (id: AlertSettingId) => boolean;
  isSet: (id: AlertSettingId) => boolean;
  showAll: Ref<boolean>;
}): AlertSettingTiers {
  const revealed = reactive(new Set<AlertSettingId>());
  const expanded = reactive<Partial<Record<AlertSectionId, boolean>>>({});
  const brought = reactive(new Set<AlertSettingId>());
  const slots = shallowReactive(new Map<AlertSettingId, Element>());
  const state: AlertTierState = {
    available: opts.available,
    isSet: opts.isSet,
    revealed,
    get showAll() {
      return opts.showAll.value;
    },
    expanded: (section) => expanded[section] === true,
  };
  // Once shown for its value, a setting stays: clearing or breaking the value must not unmount it under the cursor.
  watchEffect(() => {
    for (const def of ALERT_SETTING_TIERS) {
      if (revealed.has(def.id) || !opts.isSet(def.id)) continue;
      if (def.tier !== "add" && expanded[def.section] && !opts.showAll.value) brought.add(def.id);
      revealed.add(def.id);
    }
  });
  function isPlacedBelow(id: AlertSettingId): boolean {
    const def = ALERT_SETTING_TIERS.find((d) => d.id === id);
    if (!def || def.inline || opts.showAll.value || !opts.available(id)) return false;
    if (brought.has(id)) return true;
    return (
      def.tier !== "add" && expanded[def.section] === true && !revealed.has(id) && !opts.isSet(id)
    );
  }
  return {
    isVisible: (id) => isTierVisible(id, state),
    view: (section) => sectionTierView(section, state),
    placedBelow: isPlacedBelow,
    placementOrder: (section) => sectionPlacementOrder(section, state),
    setSlot: (id, el) => {
      if (el) slots.set(id, el);
      else slots.delete(id);
    },
    slotFor: (id) => slots.get(id) ?? null,
    isRevealed: (id) => revealed.has(id),
    reveal: (id) => {
      revealed.add(id);
    },
    bring: (id) => {
      brought.add(id);
      revealed.add(id);
    },
    conceal: (id) => {
      brought.delete(id);
      revealed.delete(id);
    },
    toggle: (section) => {
      expanded[section] = !expanded[section];
    },
  };
}

/** For step components: without the sectioned editor every control shows, as before. */
export function useTierVisibility(): (id: AlertSettingId) => boolean {
  const tiers = inject(ALERT_SETTING_TIERS_KEY, null);
  return (id) => !tiers || tiers.isVisible(id);
}
