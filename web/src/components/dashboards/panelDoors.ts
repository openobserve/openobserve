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

import type { OpenAssistantArgs } from "@/composables/assistant/pure";

type Payload = OpenAssistantArgs["payload"];

interface PanelShape {
  id?: string;
  title?: string;
  type?: string;
  queryType?: string;
  queries?: { query?: string; customQuery?: boolean; fields?: { stream?: string } }[];
}

interface TimeShape {
  start_time?: Date | number | string;
  end_time?: Date | number | string;
}

interface VariablesShape {
  values?: { name?: string; value?: unknown }[];
}

/** The panel door's context, read from the host when the door fires (all 16 `RenderDashboardCharts` hosts). */
export interface PanelDoorSource {
  org: string;
  dashboardId?: string;
  dashboardTitle?: string;
  panel: PanelShape;
  time?: TimeShape;
  variables?: VariablesShape;
  timeZone: string;
}

/** Epoch ms from a picker value: a Date, an ISO string, or µs/ms since the epoch. */
export function pickerTimeMs(value: Date | number | string | undefined): number | undefined {
  const time =
    value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : value;
  if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return undefined;
  // Dashboards build their picker Dates from µs, so a Date's getTime() can be µs too.
  return time > 1e14 ? Math.round(time / 1000) : time;
}

/** Explain this panel / Add panel to chat with the host's own range and variables. */
export function panelBuild(source: () => PanelDoorSource) {
  return async (): Promise<Payload> => {
    const s = source();
    const now = Date.now();
    const from = pickerTimeMs(s.time?.start_time) ?? now - 15 * 60_000;
    const to = pickerTimeMs(s.time?.end_time) ?? now;
    const language = s.panel.queryType === "promql" ? "PromQL" : "SQL";
    return (await import("@/utils/assistant/prompts")).buildPanelPrompt({
      org: s.org,
      ...(s.dashboardId && { dashboardId: s.dashboardId }),
      ...(s.dashboardTitle && { dashboardTitle: s.dashboardTitle }),
      panelId: String(s.panel.id ?? ""),
      panelTitle: String(s.panel.title ?? ""),
      ...(s.panel.type && { panelType: s.panel.type }),
      queries: (s.panel.queries ?? []).map((q) => ({
        language,
        ...(q.fields?.stream && { stream: q.fields.stream }),
        text: String(q.query ?? ""),
      })),
      variables: (s.variables?.values ?? [])
        .filter((v) => !!v.name)
        .map((v) => ({ name: String(v.name), value: v.value })),
      range: { from, to: Math.max(from, to) },
      timeZone: s.timeZone,
    });
  };
}
