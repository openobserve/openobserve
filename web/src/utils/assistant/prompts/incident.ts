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

import { gt, raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgRange } from "@/utils/formatters";

import { doorChip, inline, type PromptBuild } from "./format";

/** The report body sent with "Ask about this report"; longer reports are cut, never dropped. */
export const MAX_REPORT_CHARS = 32_000;

/** An incident and the analysis report shown on its tab. */
export interface IncidentReportInput {
  org: string;
  incidentId: string;
  title: string;
  severity?: string;
  status?: string;
  report: string;
  /** "Report 2 · 02:41 · 4 KB": the version and size the Report chip names. */
  reportLabel?: I18nText;
  /** The incident's alert window (ms); the Time chip. */
  window?: { from: number; to: number };
}

/** Ask about this report: the incident and its report as blocks, the question in the text. */
export function buildIncidentReportPrompt(
  input: IncidentReportInput,
  t: TranslateFn = gt,
): PromptBuild {
  const name = inline(input.title || input.incidentId, 60);
  // The composer shows exactly this; the chips carry the incident and the report.
  const text = t("assistant.rca.prompt");
  const incident = doorChip({
    kind: "incident",
    key: `${input.org}|incident|${input.incidentId}`,
    label: t("assistant.context.chip.incident", { name: raw(name) }),
    short: raw(name),
    // Until the server takes interactive incident mode, the incident goes as text.
    secondary: t("assistant.rca.modeFallback"),
    ref: { type: "incident", id: input.incidentId, org: input.org },
    data: {
      title: input.title,
      ...(input.severity && { severity: input.severity }),
      ...(input.status && { status: input.status }),
    },
    sent: "serialized",
  });
  const body = input.report.slice(0, MAX_REPORT_CHARS);
  const report = doorChip({
    kind: "report",
    key: `${input.org}|incident_report|${input.incidentId}`,
    label: input.reportLabel ?? t("assistant.rca.tag"),
    ref: { type: "incident_report", id: input.incidentId, org: input.org },
    data: { report: body },
    sent: "serialized",
  });
  const time = input.window
    ? doorChip({
        kind: "time",
        key: `${input.org}|time|${input.window.from}-${input.window.to}`,
        label: raw(formatOrgRange(input.window.from, input.window.to)),
        ref: { type: "time", org: input.org, from: input.window.from, to: input.window.to },
        sent: "whitelist",
      })
    : null;
  return {
    text,
    chips: time ? [time, incident, report] : [incident, report],
    title: t("assistant.context.chip.incident", { name: raw(name) }),
  };
}
