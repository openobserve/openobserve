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

import type { RouteTarget } from "@/composables/assistant";
import { gt, raw, type TranslateFn } from "@/types/i18n";

import {
  count,
  doorChip,
  finish,
  ident,
  inline,
  promptRange,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { fieldValueOf } from "./logField";

/** A dashboard panel in any of the 16 `RenderDashboardCharts` hosts, with the host's own range and variables. */
export interface PanelInput {
  org: string;
  dashboardId?: string;
  dashboardTitle?: string;
  panelId: string;
  panelTitle: string;
  /** "line", "table", "metric", … */
  panelType?: string;
  queries: { language: string; stream?: string; text: string }[];
  variables?: { name: string; value: unknown }[];
  range: PromptRange;
  timeZone: string;
  route?: RouteTarget;
}

/** Explain this panel: title, dashboard, queries and variables are author- or URL-controlled, so they travel in the Panel block. */
export function buildPanelPrompt(input: PanelInput, t: TranslateFn = gt): PromptBuild {
  // Redaction matches keys, so a variable named like a secret is matched by its name instead.
  const variables = (input.variables ?? [])
    .filter((v) => v.value !== undefined && v.value !== null && v.value !== "")
    .map((v) => ({ name: v.name, value: fieldValueOf(v.name, v.value) }));
  const queries = input.queries.filter((q) => q.text.trim());
  const title = inline(input.panelTitle, 60);
  const chip = doorChip({
    kind: "panel",
    key: `${input.org}|${input.dashboardId ?? ""}|${input.panelId}`,
    label: t("assistant.context.chip.panel", { name: raw(title) }),
    short: raw(title),
    ...(input.dashboardTitle && {
      secondary: t("assistant.context.chip.dashboard", {
        name: raw(inline(input.dashboardTitle, 60)),
      }),
    }),
    ref: {
      type: "panel",
      id: input.panelId,
      org: input.org,
      from: input.range.from,
      to: input.range.to,
      ...(input.route && { route: input.route }),
    },
    data: {
      title: input.panelTitle,
      ...(input.dashboardTitle && { dashboard: input.dashboardTitle }),
      ...(input.panelType && { type: input.panelType }),
      queries,
      variables,
    },
    sent: "serialized",
  });
  const type = input.panelType ? ident(input.panelType) : null;
  const text = finish([
    `Explain the dashboard panel in the attached Panel block${type ? ` (${type})` : ""}.`,
    `Time range ${promptRange(input.range, input.timeZone)}.`,
    `The block holds its title, its dashboard, ${count(queries.length)} ${queries.length === 1 ? "query" : "queries"}${variables.length ? ` and ${count(variables.length)} applied ${variables.length === 1 ? "variable" : "variables"}` : ""}.`,
    "What does it show, what changed in this window, and what is the likely cause?",
  ]);
  const thread = t("assistant.context.chip.dashboard", {
    name: raw(inline(input.dashboardTitle ?? input.panelTitle, 60)),
  });
  return { text, chips: [chip], title: thread };
}
