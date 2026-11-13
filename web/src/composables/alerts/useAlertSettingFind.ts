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

import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { CommandSearchItem } from "@/lib/forms/CommandSearch/OCommandSearch.types";
import { ALERT_SECTIONS, type AlertSectionId } from "@/components/alerts/alertFormSections";
import {
  ALERT_FIND_ENTRIES,
  gatingSetting,
  searchAlertSettings,
  type AlertFindEntry,
  type AlertFindId,
} from "@/components/alerts/alertSettingFind";
import type { AlertSettingTiers } from "./useAlertSettingTiers";

export interface AlertSettingFind {
  query: Ref<string>;
  items: ComputedRef<CommandSearchItem[]>;
  countText: ComputedRef<I18nText>;
  emptyText: ComputedRef<I18nText>;
  select: (id: string) => Promise<void>;
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [role="combobox"], [tabindex]:not([tabindex="-1"])';

const onScreen = (el: Element): boolean => el.getClientRects().length > 0;

/** The first of the entry's controls that is rendered and visible. */
export function findControl(
  entry: AlertFindEntry,
  root: ParentNode = document,
): HTMLElement | null {
  for (const id of entry.targets) {
    const hit = Array.from(root.querySelectorAll<HTMLElement>(`[data-test="${id}"]`)).find(
      onScreen,
    );
    if (hit) return hit;
  }
  return null;
}

/** Focus the control itself, or the first focusable element inside its wrapper. */
export function focusControl(el: HTMLElement): void {
  const target = el.matches(FOCUSABLE) ? el : (el.querySelector<HTMLElement>(FOCUSABLE) ?? el);
  target.focus({ preventScroll: true });
}

/** "Find a setting" for the sectioned alert editor: ranked results and the jump to a control. */
export function useAlertSettingFind(opts: {
  t: TranslateFn;
  available: (id: AlertFindId) => boolean;
  tiers: AlertSettingTiers;
  goToSection: (id: AlertSectionId) => void;
  reveal: (el: HTMLElement) => void;
}): AlertSettingFind {
  const { t } = opts;
  const query = ref("");
  const sectionTitle = (id: AlertSectionId): I18nText => {
    const def = ALERT_SECTIONS.find((s) => s.id === id);
    return def ? t(def.titleKey) : t("alerts.find.label");
  };

  const items = computed<CommandSearchItem[]>(() =>
    searchAlertSettings(query.value, t, opts.available).map(({ entry }) => ({
      id: entry.id,
      label: t(entry.labelKey),
      context: [sectionTitle(entry.section), t(entry.groupKey)],
    })),
  );
  const countText = computed(() =>
    t("alerts.find.count", { count: items.value.length }, items.value.length),
  );
  const emptyText = computed(() => t("alerts.find.empty", { query: query.value.trim() }));

  const select = async (id: string): Promise<void> => {
    const entry = ALERT_FIND_ENTRIES.find((e) => e.id === id);
    if (!entry) return;
    const setting = gatingSetting(entry);
    if (setting && !opts.tiers.isVisible(setting)) {
      if (entry.tier === "tucked") opts.tiers.expand(entry.section);
      else opts.tiers.reveal(setting);
    }
    // One tick renders the revealed block, the next lets teleported slices land in their slots.
    await nextTick();
    await nextTick();
    const control = findControl(entry);
    if (!control) {
      opts.goToSection(entry.section);
      return;
    }
    opts.reveal(control);
    focusControl(control);
  };

  return { query, items, countText, emptyText, select };
}
