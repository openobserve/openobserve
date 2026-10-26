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

import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { paintByPalette } from "./convertTreemapData";

export const FUNNEL_SORTS = ["descending", "ascending", "none"] as const;
export const FUNNEL_ORIENTS = ["vertical", "horizontal"] as const;

/** One funnel stage; `percent` is its share of the first stage. */
export interface FunnelStage {
  name: string;
  value: number;
  percent: number;
  itemStyle?: { color: string };
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Sums the y field per x value in query order; the first stage is the widest when sorted, else the first row. */
export const buildFunnelStages = (panelSchema: any, data: any[]): FunnelStage[] => {
  const totals = new Map<string, number>();
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    const stage = query?.fields?.x?.[0];
    const value = query?.fields?.y?.[0];
    if (!Array.isArray(rows) || !stage || !value || query?.config?.hide) return;
    rows.forEach((row: any) => {
      const amount = toNumber(getDataValue(row, value.alias));
      if (amount === null || amount < 0) return;
      const name = String(getDataValue(row, stage.alias) ?? "");
      totals.set(name, (totals.get(name) ?? 0) + amount);
    });
  });
  const stages = [...totals].map(([name, value]) => ({ name, value, percent: 0 }));
  if (!stages.length) return stages;
  const sort = choice(panelSchema?.config?.funnel_sort, FUNNEL_SORTS, "descending");
  const base = sort === "none" ? stages[0].value : Math.max(...stages.map((stage) => stage.value));
  stages.forEach((stage) => {
    stage.percent = base > 0 ? (stage.value / base) * 100 : 0;
  });
  return stages;
};

const formatPercent = (percent: number) => `${Math.round(percent * 10) / 10}%`;

/** Converts SQL rows into a funnel: one stage per x value, sized by the y value. */
export const convertFunnelData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const stages = buildFunnelStages(panelSchema, Array.isArray(data) ? data : []);
  if (!stages.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(stages, config, store?.state?.theme);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const showPercent = config.funnel_show_percent === true;
  const describe = (stage: FunnelStage | undefined, value: unknown) =>
    showPercent && stage ? `${format(value)} (${formatPercent(stage.percent)})` : format(value);
  const horizontal = choice(config.funnel_orient, FUNNEL_ORIENTS, "vertical") === "horizontal";

  const options = {
    backgroundColor: "transparent",
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) =>
        `${escapeHtml(params?.name ?? "")}: <strong>${escapeHtml(describe(params?.data, params?.value))}</strong>`,
    },
    series: [
      {
        type: "funnel",
        sort: choice(config.funnel_sort, FUNNEL_SORTS, "descending"),
        orient: horizontal ? "horizontal" : "vertical",
        top: 16,
        bottom: 16,
        left: "4%",
        // A vertical funnel's narrow stages cannot hold their label, so labels go beside it.
        width: horizontal ? "92%" : "64%",
        minSize: "2%",
        gap: 2,
        itemStyle: { borderColor: chartColor("--color-surface-base"), borderWidth: 1 },
        label: {
          show: true,
          position: horizontal ? "inside" : "right",
          color: horizontal ? chartColor("--color-text-inverse") : chartColor("--color-text-body"),
          lineHeight: 16,
          overflow: "truncate",
          formatter: (params: any) =>
            `${params?.name ?? ""}${horizontal ? "\n" : "  "}${describe(params?.data, params?.value)}`,
        },
        labelLine: {
          show: !horizontal,
          lineStyle: { color: chartColor("--color-border-default") },
        },
        emphasis: { label: { fontWeight: "bold" } },
        data: stages,
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
