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
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { CommandSearchItem } from "@/lib/forms/CommandSearch/OCommandSearch.types";
import { ALERT_SECTIONS, type AlertSectionId } from "@/components/alerts/alertFormSections";
import {
  ALERT_FIND_ENTRIES,
  FIND_MODE_OF,
  gatingSetting,
  searchAlertSettings,
  type AlertFindEntry,
  type AlertFindId,
  type AlertFindMode,
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

// Product names, the same in every language.
const MODE_NAMES: Record<AlertFindMode, string> = { sql: "SQL", promql: "PromQL" };

const onScreen = (el: Element): boolean => el.getClientRects().length > 0;

/** The first of the entry's controls that is rendered and visible. */
export function findControl(
  entry: Pick<AlertFindEntry, "targets">,
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

/** How long a jump's landing row stays tinted. */
export const LANDED_MS = 2000;

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
    return def ? t(def.navKey) : t("alerts.find.label");
  };

  // The mode's tab is on screen only where this alert can switch to it (PromQL needs metrics).
  const modeTab = (mode: AlertFindMode) => findControl({ targets: [`query-mode-${mode}`] });
  const modeFor = (id: AlertFindId): AlertFindMode | undefined => {
    const mode = FIND_MODE_OF[id];
    return mode && modeTab(mode) ? mode : undefined;
  };
  const modeContext = (mode: AlertFindMode): I18nText[] => {
    const name = raw(MODE_NAMES[mode]);
    return [t("alerts.find.needsMode", { mode: name }), t("alerts.find.switchTo", { mode: name })];
  };

  const items = computed<CommandSearchItem[]>(() =>
    searchAlertSettings(query.value, t, opts.available, modeFor).map(({ entry, needsMode }) => ({
      id: entry.id,
      label: t(entry.labelKey),
      // Results name the step by its nav name; only More options adds a second place.
      context: needsMode
        ? [sectionTitle(entry.section), ...modeContext(needsMode)]
        : [
            sectionTitle(entry.section),
            ...(entry.groupKey === "alerts.find.groups.more" ? [t(entry.groupKey)] : []),
            ...(entry.parentKey ? [t(entry.parentKey)] : []),
          ],
    })),
  );
  const countText = computed(() =>
    t("alerts.find.count", { count: items.value.length }, items.value.length),
  );
  const emptyText = computed(() => t("alerts.find.empty", { query: query.value.trim() }));

  // A link in one step can open a setting in another; the tint shows where the jump went.
  let landed: { row: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  const markLanded = (control: HTMLElement): void => {
    if (landed) {
      clearTimeout(landed.timer);
      landed.row.removeAttribute("data-landed");
    }
    const row = control.closest<HTMLElement>("[data-o-setting-row]") ?? control;
    row.setAttribute("data-landed", "");
    landed = { row, timer: setTimeout(() => row.removeAttribute("data-landed"), LANDED_MS) };
  };

  const select = async (id: string): Promise<void> => {
    const entry = ALERT_FIND_ENTRIES.find((e) => e.id === id);
    if (!entry) return;
    const setting = gatingSetting(entry);
    const mode = opts.available(setting ?? entry.id) ? undefined : modeFor(entry.id);
    if (mode) {
      modeTab(mode)?.click();
      await nextTick();
      await nextTick();
    }
    // An entry that lands on its own "+ add" link leaves the adding to that link.
    const landsOnLink = entry.targets[0]?.startsWith("add-alert-add-");
    if (setting && !landsOnLink && !opts.tiers.isVisible(setting)) opts.tiers.reveal(setting);
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
    markLanded(control);
  };

  return { query, items, countText, emptyText, select };
}
