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
import { raw } from "@/types/i18n";
import type {
  DowntimeRequest,
  DowntimeSchedule,
  DowntimeTarget,
  TargetModule,
} from "@/services/downtimes";
import { conditionSummary, sortedTargets, type FolderNameFn } from "./targetSummary";
import { formatDuration, formatWindowTime } from "./schedule";

const NOUN_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.sentence.nouns.alerts",
  anomaly_detections: "alerts.downtimes.sentence.nouns.anomaly_detections",
  synthetics: "alerts.downtimes.sentence.nouns.synthetics",
  slos: "alerts.downtimes.sentence.nouns.slos",
};

const weekdayList = (days: number[], locale?: string): string => {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => fmt.format(new Date(Date.UTC(2024, 0, d))))
    .join(", ");
};

/** "Every Sunday at 02:00 Europe/Berlin, for 1 h 30 min" or "Once, from … to … UTC". */
export function whenPhrase(s: DowntimeSchedule, t: TranslateFn, locale?: string): I18nText {
  if (s.repeat === "none") {
    return t("alerts.downtimes.sentence.whenOnce", {
      start: formatWindowTime(s.starts_at, s.timezone, locale),
      end: s.ends_at ? formatWindowTime(s.ends_at, s.timezone, locale) : "",
      zone: s.timezone,
    });
  }
  const params = {
    time: s.start_time_local ?? "",
    zone: s.timezone,
    duration: formatDuration(s.duration_secs, t),
    days: weekdayList(s.weekdays, locale),
  };
  return s.repeat === "daily"
    ? t("alerts.downtimes.sentence.whenDaily", params)
    : t("alerts.downtimes.sentence.whenWeekly", params);
}

const folderPhrase = (target: DowntimeTarget, t: TranslateFn, folderName?: FolderNameFn) => {
  if (target.folders.kind === "all") return null;
  const names = target.folders.folder_ids.map((id) => folderName?.(target.module, id) ?? id);
  return t("alerts.downtimes.sentence.inFolders", { names: names.join(", ") }, names.length);
};

/** One module's share of the sentence: its noun, then every narrowing that is present. */
export function targetPhrase(
  target: DowntimeTarget,
  conditionText: string | null,
  t: TranslateFn,
  folderName?: FolderNameFn,
): I18nText {
  const parts: string[] = [t(NOUN_KEYS[target.module])];
  const folders = folderPhrase(target, t, folderName);
  if (folders) parts.push(folders);
  if (conditionText && target.module !== "synthetics") {
    parts.push(t("alerts.downtimes.sentence.withCondition", { condition: conditionText }));
  }
  if (target.tags?.length) {
    parts.push(t("alerts.downtimes.sentence.tagged", { tags: target.tags.join(", ") }));
  }
  if (target.ids?.length) {
    parts.push(
      t("alerts.downtimes.sentence.named", { count: target.ids.length }, target.ids.length),
    );
  }
  return raw(parts.join(" "));
}

const sloClause = (
  targets: DowntimeTarget[],
  conditionText: string | null,
  t: TranslateFn,
  folderName?: FolderNameFn,
): I18nText => {
  const slo = targets.find((tg) => tg.module === "slos");
  if (!slo) return t("alerts.downtimes.sentence.sloUnchanged");
  const slos = targetPhrase(slo, conditionText, t, folderName);
  return slo.slo_mode === "count_as_good"
    ? t("alerts.downtimes.sentence.sloAsGood", { slos })
    : t("alerts.downtimes.sentence.sloExcluded", { slos });
};

/** The Summary pane's plain sentence, in the style of AlertSummary. */
export function summarySentence(
  request: Pick<DowntimeRequest, "condition" | "targets" | "schedule">,
  t: TranslateFn,
  folderName?: FolderNameFn,
  locale?: string,
): I18nText {
  const conditionText = conditionSummary(request.condition, t);
  const who = sortedTargets(request.targets)
    .filter((tg) => tg.module !== "slos")
    .map((tg) => targetPhrase(tg, conditionText, t, folderName));
  const when = whenPhrase(request.schedule, t, locale);
  const muted = who.length
    ? t("alerts.downtimes.sentence.stopNotifying", { when, targets: who.join(", ") })
    : t("alerts.downtimes.sentence.nothingMuted", { when });
  return raw(`${muted} ${sloClause(request.targets, conditionText, t, folderName)}`);
}
