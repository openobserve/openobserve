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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { AlertSectionId } from "./alertFormSections";

/** Shown = always visible; one = its own "+ add" link; tucked = behind the section's "N more" link. */
export type AlertSettingTier = "shown" | "one" | "tucked";

export type AlertSettingId =
  | "warning"
  | "holdFor"
  | "groupBy"
  | "compareWithPast"
  | "destinations"
  | "createsIncident"
  | "template"
  | "variables"
  | "recovery"
  | "oncall"
  | "dedup"
  | "keepFiring"
  | "description"
  | "rowTemplate"
  | "priority"
  | "tags";

/** The labelled row a one-click setting's "+ add" link sits in. */
export type AlertAddRow = "fires" | "message";

export interface AlertSettingTierDef {
  id: AlertSettingId;
  section: AlertSectionId;
  tier: AlertSettingTier;
  nameKey: I18nKey;
  row?: AlertAddRow;
}

// From the Oct 2026 introspect usage study of hand-written alerts: Core (25%+) shown, Common (5-25%) one click, Rare (<5%) tucked.
export const ALERT_SETTING_TIERS: readonly AlertSettingTierDef[] = [
  { id: "warning", section: "condition", tier: "tucked", nameKey: "alerts.tiers.names.warning" },
  { id: "holdFor", section: "condition", tier: "tucked", nameKey: "alerts.tiers.names.holdFor" },
  { id: "groupBy", section: "condition", tier: "tucked", nameKey: "alerts.tiers.names.groupBy" },
  {
    id: "compareWithPast",
    section: "condition",
    tier: "tucked",
    nameKey: "alerts.tiers.names.compareWithPast",
  },
  {
    id: "destinations",
    section: "notify",
    tier: "shown",
    nameKey: "alerts.tiers.names.destinations",
  },
  {
    id: "createsIncident",
    section: "notify",
    tier: "one",
    nameKey: "alerts.tiers.names.createsIncident",
    row: "fires",
  },
  {
    id: "template",
    section: "notify",
    tier: "one",
    nameKey: "alerts.tiers.names.template",
    row: "message",
  },
  {
    id: "variables",
    section: "notify",
    tier: "one",
    nameKey: "alerts.tiers.names.variables",
    row: "message",
  },
  { id: "recovery", section: "notify", tier: "tucked", nameKey: "alerts.tiers.names.recovery" },
  { id: "oncall", section: "notify", tier: "tucked", nameKey: "alerts.tiers.names.oncall" },
  { id: "dedup", section: "notify", tier: "tucked", nameKey: "alerts.tiers.names.dedup" },
  { id: "keepFiring", section: "notify", tier: "tucked", nameKey: "alerts.tiers.names.keepFiring" },
  {
    id: "description",
    section: "details",
    tier: "shown",
    nameKey: "alerts.tiers.names.description",
  },
  {
    id: "rowTemplate",
    section: "details",
    tier: "shown",
    nameKey: "alerts.tiers.names.rowTemplate",
  },
  { id: "priority", section: "details", tier: "tucked", nameKey: "alerts.tiers.names.priority" },
  { id: "tags", section: "details", tier: "tucked", nameKey: "alerts.tiers.names.tags" },
];

export interface AlertTierState {
  /** The setting applies to this alert type and build at all. */
  available: (id: AlertSettingId) => boolean;
  /** The setting holds a non-default value, so it always shows. */
  isSet: (id: AlertSettingId) => boolean;
  revealed: ReadonlySet<AlertSettingId>;
  expanded: (section: AlertSectionId) => boolean;
}

export interface AlertSectionTierView {
  addLinks: AlertSettingTierDef[];
  /** Tucked settings that are available and unset: what the "N more" link names. */
  tucked: AlertSettingTierDef[];
  expanded: boolean;
}

const defOf = (id: AlertSettingId) => ALERT_SETTING_TIERS.find((d) => d.id === id);

/** Whether a tiered control renders; unknown ids always render. */
export function isTierVisible(id: AlertSettingId, state: AlertTierState): boolean {
  const def = defOf(id);
  if (!def || def.tier === "shown" || state.isSet(id) || state.revealed.has(id)) return true;
  return def.tier === "tucked" && state.available(id) && state.expanded(def.section);
}

export function sectionTierView(
  section: AlertSectionId,
  state: AlertTierState,
): AlertSectionTierView {
  const own = ALERT_SETTING_TIERS.filter(
    (d) => d.section === section && state.available(d.id) && !state.isSet(d.id),
  );
  return {
    addLinks: own.filter((d) => d.tier === "one" && !state.revealed.has(d.id)),
    tucked: own.filter((d) => d.tier === "tucked" && !state.revealed.has(d.id)),
    expanded: state.expanded(section),
  };
}

/** "4 more: warning, hold for, group by, compare with past"; past five, the first three and a count. */
export function moreLinkLabel(names: I18nText[], t: TranslateFn): I18nText {
  if (names.length > 5) {
    return t("alerts.tiers.moreSome", {
      count: names.length,
      names: names.slice(0, 3).join(", "),
      rest: names.length - 3,
    });
  }
  return t("alerts.tiers.moreAll", { count: names.length, names: names.join(", ") });
}
