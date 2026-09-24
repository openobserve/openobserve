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

import type { I18nKey } from "@/types/i18n";
import type { DowntimeRequest, DowntimeTarget, TargetModule } from "@/services/downtimes";

export type QuickMutePreset = "30m" | "1h" | "2h" | "4h";

export const QUICK_MUTE_PRESETS: { key: QuickMutePreset; secs: number; labelKey: I18nKey }[] = [
  { key: "30m", secs: 1800, labelKey: "alerts.downtimes.mute.presets.30m" },
  { key: "1h", secs: 3600, labelKey: "alerts.downtimes.mute.presets.1h" },
  { key: "2h", secs: 7200, labelKey: "alerts.downtimes.mute.presets.2h" },
  { key: "4h", secs: 14400, labelKey: "alerts.downtimes.mute.presets.4h" },
];

export const presetSeconds = (preset: QuickMutePreset): number =>
  QUICK_MUTE_PRESETS.find((p) => p.key === preset)?.secs ?? 3600;

/** What a row action mutes: the ids of one module. */
export interface QuickMuteSelection {
  module: TargetModule;
  ids: string[];
}

/** One target per module, all folders, the named ids, from now, filed in default, no banner. */
export function buildQuickMuteRequest(
  selection: QuickMuteSelection[],
  startsAtMicros: number,
  endsAtMicros: number,
  timezone: string,
  reason?: string,
): DowntimeRequest {
  const body: DowntimeRequest = {
    folder_id: "default",
    targets: selection
      .filter((s) => s.ids.length > 0)
      .map(
        (s): DowntimeTarget => ({ module: s.module, folders: { kind: "all" }, ids: [...s.ids] }),
      ),
    schedule: {
      repeat: "none",
      starts_at: startsAtMicros,
      ends_at: endsAtMicros,
      timezone,
      duration_secs: Math.round((endsAtMicros - startsAtMicros) / 1_000_000),
      weekdays: [],
    },
    show_banner: false,
  };
  const trimmed = reason?.trim();
  if (trimmed) body.reason = trimmed;
  return body;
}

/** Rows of one list can mix modules (alerts and anomaly detections); a target per module. */
export function groupSelection<T>(
  rows: T[],
  moduleOf: (row: T) => TargetModule,
  idOf: (row: T) => string,
): QuickMuteSelection[] {
  const byModule = new Map<TargetModule, string[]>();
  for (const row of rows) {
    const module = moduleOf(row);
    byModule.set(module, [...(byModule.get(module) ?? []), idOf(row)]);
  }
  return [...byModule.entries()].map(([module, ids]) => ({ module, ids }));
}

export const selectionCount = (selection: QuickMuteSelection[]): number =>
  selection.reduce((sum, s) => sum + s.ids.length, 0);
