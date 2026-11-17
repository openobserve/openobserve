// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import alertsService from "@/services/alerts";
import { gt } from "@/types/i18n";
import type { NotifyPick, TeamPick } from "@/utils/alerts/prefill/fromAutoObserve";

export type { NotifyPick, TeamPick };

/** The part of an alert list row ownership reads (`GET /api/v2/{org}/alerts`). */
export interface OwnedAlert {
  id?: string | null;
  folder_id?: string | null;
  folder_name?: string | null;
  destinations?: string[] | null;
  /** Microseconds; null or 0 when it has never fired. */
  last_triggered_at?: number | null;
  /** When the alert's condition last matched (microseconds); null until it first fires. */
  last_satisfied_at?: number | null;
  /** The alert's query, period in minutes and stream type, for drawing where it fires on a chart. */
  sql?: string | null;
  period?: number | null;
  streamType?: string | null;
}

export interface FolderRef {
  folderId: string;
  name: string;
}

/** The org's default folder, which every org has under this id. */
export const DEFAULT_FOLDER: FolderRef = { folderId: "default", name: "default" };

interface Tally {
  key: string;
  label: string;
  count: number;
}

/** The most common key; a tie goes to the first label in name order, so the pick never depends on list order. */
const majority = (tallies: Map<string, Tally>): Tally | null =>
  [...tallies.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] ??
  null;

/** PD-4 until team labels exist (G22): the folder most of the service's alerts live in, else the org default. */
export const teamOf = (
  service: string,
  alerts: OwnedAlert[],
  defaultFolder: FolderRef = DEFAULT_FOLDER,
): TeamPick => {
  const tallies = new Map<string, Tally>();
  for (const alert of alerts ?? []) {
    const key = alert?.folder_id;
    if (!key) continue;
    const label = alert.folder_name || key;
    const tally = tallies.get(key) ?? { key, label, count: 0 };
    tally.count += 1;
    tallies.set(key, tally);
  }
  const top = majority(tallies);
  if (!top) {
    return {
      name: gt("insight.targets.team.none"),
      folderId: defaultFolder.folderId,
      folderName: defaultFolder.name,
      source: "default",
      reason: gt("insight.targets.team.defaultReason", { service }),
    };
  }
  return {
    name: top.label,
    folderId: top.key,
    folderName: top.label,
    source: "folder",
    reason: gt("insight.targets.team.folderReason", { service, count: top.count }, top.count),
    alertCount: top.count,
  };
};

/** The destination most of the service's alerts notify, with the sentence that says why it was picked. */
export const notifyOf = (service: string, alerts: OwnedAlert[]): NotifyPick => {
  const tallies = new Map<string, Tally>();
  for (const alert of alerts ?? []) {
    for (const name of new Set(alert?.destinations ?? [])) {
      if (!name) continue;
      const tally = tallies.get(name) ?? { key: name, label: name, count: 0 };
      tally.count += 1;
      tallies.set(name, tally);
    }
  }
  const top = majority(tallies);
  if (!top) return { destinations: [], reason: "none" };
  return {
    destinations: [top.key],
    reason: gt(
      "insight.targets.notify.reason",
      { service, count: top.count, destination: top.key },
      top.count,
    ),
    alertCount: top.count,
  };
};

const ownedOf = (alert: any): OwnedAlert => {
  const folder = alert?.folder_name;
  return {
    id: String(alert?.alert_id ?? alert?.id ?? "") || null,
    folder_id: alert?.folder_id ?? folder?.id ?? null,
    folder_name: typeof folder === "string" ? folder : (folder?.name ?? null),
    destinations: Array.isArray(alert?.destinations) ? alert.destinations : [],
    last_triggered_at: Number(alert?.last_triggered_at) || null,
    last_satisfied_at: Number(alert?.last_satisfied_at) || null,
    sql: alert?.condition?.sql ?? alert?.query_condition?.sql ?? null,
    period: Number(alert?.trigger_condition?.period) || null,
    streamType: alert?.stream_type ?? null,
  };
};

/** The org's alerts with these ids, read with their destinations; empty when there are none or the list can't be read. */
export const loadOwnedAlerts = async (org: string, ids: string[]): Promise<OwnedAlert[]> => {
  if (!org || !ids.length) return [];
  try {
    const res = await alertsService.listByFolderId(
      1,
      0,
      "name",
      false,
      "",
      org,
      undefined,
      undefined,
      undefined,
      true,
      { silentForbidden: true },
    );
    const wanted = new Set(ids);
    const list: any[] = res.data?.list ?? [];
    return list.filter((a) => wanted.has(String(a?.alert_id ?? a?.id ?? ""))).map(ownedOf);
  } catch {
    return [];
  }
};
