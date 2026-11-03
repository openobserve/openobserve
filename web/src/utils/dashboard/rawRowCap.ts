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

import { gt, type I18nText } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { addCommasToNumber } from "@/utils/formatters";
import { DISTRIBUTION_ROW_LIMIT, isRawValueChart } from "./chartTypeGroups";

// The query builder caps a raw-value query that sets no limit, so reaching the cap means the chart is a sample.
export const hitRawRowCap = (panelSchema: any, data: any[]): boolean =>
  (panelSchema?.queries ?? []).some(
    (query: any, index: number) =>
      !query?.customQuery &&
      !query?.config?.limit &&
      (Array.isArray(data?.[index]) ? data[index].length : 0) >= DISTRIBUTION_ROW_LIMIT,
  );

/** Top-right ECharts text note saying the chart only read the first capped rows. */
export const rawSampleNote = () => ({
  type: "text",
  right: 16,
  top: 4,
  silent: true,
  style: {
    text: gt("dashboard.utils.rawValueSampled", {
      count: addCommasToNumber(DISTRIBUTION_ROW_LIMIT),
    }),
    fill: chartColor("--color-text-secondary"),
    fontSize: 11,
  },
});

/** Helper text under Query Limit: a raw-value chart left at 0 still reads only the capped rows. */
export const rawRowLimitHelp = (chartType: unknown, limit: unknown): I18nText | undefined =>
  isRawValueChart(chartType) && !limit
    ? gt("dashboard.rawValueRowLimit", { count: addCommasToNumber(DISTRIBUTION_ROW_LIMIT) })
    : undefined;
