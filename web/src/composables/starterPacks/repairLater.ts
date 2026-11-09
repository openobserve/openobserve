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

import { panelNeeds } from "./dashboardFit";
import { rewriteDashboard, type RewriteChecks, type StreamRename } from "./streamRewriter";
import { contentHash } from "./useInstallRecords";
import { STALE_AFTER_US } from "./usePackHealth";

type Doc = Record<string, any>;

export interface StreamStat {
  name: string;
  type: string;
  firstUs: number;
  lastUs: number;
}

export interface StartedStream {
  stat: StreamStat;
  columns: Set<string>;
}

export interface RepointResult {
  doc: Doc;
  moved: string[];
  kept: string[];
}

// Server-added columns every stream has, so they prove nothing about a rename.
const COMMON_COLUMNS = new Set(["_timestamp", "_all", "_o2_id"]);

export const streamStats = (
  rows: Array<{ name: string; stats?: { doc_time_min?: number; doc_time_max?: number } }>,
  type: string,
): StreamStat[] =>
  rows.map(({ name, stats }) => ({
    name,
    type,
    firstUs: stats?.doc_time_min ?? 0,
    lastUs: stats?.doc_time_max ?? 0,
  }));

/** Live streams of the same type whose first data came no earlier than 30 minutes before the quiet one stopped. */
export const startedSince = (stale: StreamStat, stats: StreamStat[], nowUs: number) =>
  stats.filter(
    ({ name, type, firstUs, lastUs }) =>
      name !== stale.name &&
      type === stale.type &&
      firstUs > 0 &&
      nowUs - lastUs < STALE_AFTER_US &&
      firstUs >= stale.lastUs - STALE_AFTER_US,
  );

/** The one started stream that carries every field of the quiet one; two such streams means ask, so none. */
export const pickReplacement = (
  wanted: Set<string>,
  started: StartedStream[],
): StreamStat | null => {
  const fields = [...wanted].filter((field) => !COMMON_COLUMNS.has(field));
  if (!fields.length) return null;
  const same = started.filter(({ columns }) => fields.every((field) => columns.has(field)));
  return same.length === 1 ? same[0].stat : null;
};

export const panelHash = (panel: Doc) => contentHash(panel);

export const panelReads = (panel: Doc, stream: string): boolean =>
  (panel.queries ?? []).some((query: Doc) => query.fields?.stream === stream) ||
  panelNeeds(panel).streams.has(stream);

/** Repoints the panels that read the old stream and are still as the pack wrote them; edited ones stay. */
export const repointDashboard = async (
  dashboard: Doc,
  rename: StreamRename,
  isOurs: (panel: Doc) => boolean,
  checks: RewriteChecks,
): Promise<RepointResult> => {
  const { doc } = await rewriteDashboard<Doc>({ ...dashboard, tabs: [] }, [rename], checks);
  const moved: string[] = [];
  const kept: string[] = [];
  const tabs: Doc[] = [];
  for (const tab of dashboard.tabs ?? []) {
    const panels: Doc[] = [];
    for (const panel of tab.panels ?? []) {
      if (!panelReads(panel, rename.from) || !isOurs(panel)) {
        if (panelReads(panel, rename.from)) kept.push(panel.id);
        panels.push(panel);
        continue;
      }
      const { doc: shell } = await rewriteDashboard(
        { tabs: [{ panels: [panel] }] },
        [rename],
        checks,
      );
      panels.push(shell.tabs[0].panels[0]);
      moved.push(panel.id);
    }
    tabs.push({ ...tab, panels });
  }
  return { doc: { ...doc, tabs }, moved, kept };
};
