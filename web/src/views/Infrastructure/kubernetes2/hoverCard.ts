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

import type { TranslateFn } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { labelsOf } from "./kubernetesObjects";
import { chipLabel, formatPct, warningLabel, type NodeRow, type PodRow } from "./kubernetesModel";
import type { MapFill } from "./kubernetesUrlState";
import {
  FILL_LABEL,
  fillClass,
  fillValue,
  statusClass,
  type FillClass,
  type StatusClass,
} from "./mapFill";

// Literal class strings, so Tailwind emits them for this markup.
const DOT: Record<StatusClass | "noData", string> = {
  ok: "bg-status-positive",
  warning: "bg-status-warning-text",
  error: "bg-status-negative",
  noData: "bg-surface-subtle border border-border-default",
};

const line = (text: string, cls = "text-text-secondary") =>
  `<div${cls ? ` class="${cls}"` : ""}>${escapeHtml(text)}</div>`;

const card = (lines: string[]) =>
  `<div class="flex flex-col gap-0.5 text-xs whitespace-normal">${lines.join("")}</div>`;

const title = (text: string) => line(text, "text-sm font-semibold text-text-heading break-all");

export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export function tooltipStyle() {
  return {
    backgroundColor: chartColor("--color-surface-overlay"),
    borderColor: chartColor("--color-border-default"),
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: chartColor("--color-text-body") },
    extraCssText:
      "box-shadow: var(--shadow-md); border-radius: var(--radius-surface); max-width: 20rem;",
  };
}

export function podCard(row: PodRow, fill: MapFill, t: TranslateFn, endUs: number | null) {
  const owner = row.workload
    ? `${row.workload.kind}/${row.workload.name}`
    : t("infra.k8s2.mapNoOwner");
  const status = row.status ? chipLabel(row.status, t) : t("infra.k8s2.mapNoData");
  const warning = row.warnings[0] ? ` · ${warningLabel(row.warnings[0], t, endUs)}` : "";
  const lines = [
    title(row.name),
    line(`${row.namespace} · ${owner}`),
    line(t("infra.k8s2.mapTipNode", { name: row.node || t("infra.k8s2.mapUnscheduled") })),
    statusLine(statusClass(row), `${status}${warning}`),
  ];
  if (fill !== "status") {
    lines.push(
      line(
        t("infra.k8s2.mapTipValue", { label: t(FILL_LABEL[fill]), value: fillText(row, fill, t) }),
        "",
      ),
    );
  }
  if (fill !== "restarts" && (row.restarts ?? 0) > 0) {
    lines.push(line(t("infra.k8s2.mapTipRestarts", { count: row.restarts ?? 0 }), ""));
  }
  return card(lines);
}

export function nodeCard(row: NodeRow, t: TranslateFn) {
  const status = row.status ? chipLabel(row.status, t) : t("infra.k8s2.mapNoData");
  const lines = [
    title(row.name),
    statusLine(statusClass(row), [status, ...row.pressures].join(" · ")),
    line(
      t("infra.k8s2.mapTipNodeUsage", {
        cpu: formatPct(row.cpuPct),
        memory: formatPct(row.memoryPct),
      }),
      "",
    ),
  ];
  const zone = labelsOf(row.object)?.["topology.kubernetes.io/zone"];
  if (zone) lines.push(line(t("infra.k8s2.mapTipZone", { zone })));
  return card(lines);
}

export function groupCard(
  name: string,
  count: string,
  summary: { cls: StatusClass; count: number }[],
  t: TranslateFn,
  note?: string,
) {
  const words = Object.fromEntries(summary.map((s) => [s.cls, s.count]));
  const lines = [title(name), line(count), line(t("infra.k8s2.mapSummaryWords", words), "")];
  if (note) lines.push(line(note));
  return card(lines);
}

function statusLine(cls: FillClass, text: string) {
  const dot = `<span class="size-2 shrink-0 rounded-full ${DOT[cls as StatusClass | "noData"]}"></span>`;
  return `<div class="flex items-center gap-1">${dot}<span>${escapeHtml(text)}</span></div>`;
}

function fillText(row: PodRow, fill: Exclude<MapFill, "status">, t: TranslateFn): string {
  if (fillClass(row, fill) === "noData") return t("infra.k8s2.mapNoData");
  const value = fillValue(row, fill);
  return fill === "restarts" ? String(value) : formatPct(value);
}
