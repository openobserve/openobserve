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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import type { DimensionCondition, DowntimeTarget, TargetModule } from "@/services/downtimes";

export const MODULE_ORDER: TargetModule[] = ["alerts", "anomaly_detections", "synthetics", "slos"];

export const MODULE_ICONS: Record<TargetModule, IconName> = {
  alerts: "shield-alert-outline",
  anomaly_detections: "query-stats",
  synthetics: "radar",
  slos: "target",
};

export const MODULE_LABEL_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.modules.alerts",
  anomaly_detections: "alerts.downtimes.modules.anomaly_detections",
  synthetics: "alerts.downtimes.modules.synthetics",
  slos: "alerts.downtimes.modules.slos",
};

export const MODULE_SHORT_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.modulesShort.alerts",
  anomaly_detections: "alerts.downtimes.modulesShort.anomaly_detections",
  synthetics: "alerts.downtimes.modulesShort.synthetics",
  slos: "alerts.downtimes.modulesShort.slos",
};

/** Resolves a folder id of a module's own folder type to its display name. */
export type FolderNameFn = (module: TargetModule, folderId: string) => string | undefined;

export interface TargetChip {
  module: TargetModule;
  icon: IconName;
  label: I18nText;
  text: I18nText;
}

type Pair = Extract<DimensionCondition, { type: "pair" }>;

const isEqPair = (c: DimensionCondition): c is Pair => c.type === "pair" && c.operator === "=";

const pairText = (p: Pair) => `${p.key}${p.operator}${p.value}`;

/** An OR group of `=` pairs on one key, the shape the resource picker writes. */
const orGroupKey = (c: DimensionCondition): string | null => {
  if (c.type !== "group" || c.op !== "or" || c.items.length === 0) return null;
  if (!c.items.every(isEqPair)) return null;
  const keys = new Set(c.items.map((i) => (i as Pair).key));
  return keys.size === 1 ? [...keys][0] : null;
};

const partText = (c: DimensionCondition, t: TranslateFn): string | null => {
  if (isEqPair(c)) return pairText(c);
  const key = orGroupKey(c);
  if (key === null || c.type !== "group") return null;
  return t("alerts.downtimes.summary.valuesOfKey", { count: c.items.length, key }, c.items.length);
};

/** `service=payments · env=prod`, `service=kafka · 3 hosts`, or "condition" for any other tree. */
export function conditionSummary(
  condition: DimensionCondition | undefined | null,
  t: TranslateFn,
): I18nText | null {
  if (!condition) return null;
  const parts =
    condition.type === "group" && condition.op === "and"
      ? condition.items.map((c) => partText(c, t))
      : [partText(condition, t)];
  if (parts.length === 0 || parts.some((p) => p === null)) {
    return t("alerts.downtimes.summary.condition");
  }
  return raw(parts.join(" · "));
}

const foldersText = (target: DowntimeTarget, t: TranslateFn, folderName?: FolderNameFn) => {
  if (target.folders.kind === "all") return t("alerts.downtimes.summary.allFolders");
  const ids = target.folders.folder_ids;
  if (ids.length === 1) {
    const name = folderName?.(target.module, ids[0]) ?? ids[0];
    return t("alerts.downtimes.summary.oneFolder", { name });
  }
  return t("alerts.downtimes.summary.nFolders", { count: ids.length }, ids.length);
};

/** One compact chip per target: the module and its own narrowings, never the shared condition. */
export function targetSummary(
  target: DowntimeTarget,
  t: TranslateFn,
  folderName?: FolderNameFn,
): TargetChip {
  const parts: string[] = [foldersText(target, t, folderName)];
  if (target.tags?.length) {
    parts.push(t("alerts.downtimes.summary.tags", { tags: target.tags.join(", ") }));
  }
  if (target.ids?.length) {
    parts.push(
      t("alerts.downtimes.summary.nItems", { count: target.ids.length }, target.ids.length),
    );
  }
  if (target.module === "slos" && target.slo_mode === "count_as_good") {
    parts.push(t("alerts.downtimes.summary.asGood"));
  }
  return {
    module: target.module,
    icon: MODULE_ICONS[target.module],
    label: t(MODULE_SHORT_KEYS[target.module]),
    text: raw(parts.join(" · ")),
  };
}

/** The targets in the fixed module order of the "Applies to" strip. */
export function sortedTargets(targets: DowntimeTarget[]): DowntimeTarget[] {
  return [...targets].sort(
    (a, b) => MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module),
  );
}
