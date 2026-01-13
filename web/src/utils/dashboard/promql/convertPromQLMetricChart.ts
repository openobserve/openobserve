// Copyright 2023 OpenObserve Inc.
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

import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";

/**
 * Converter for metric text charts
 * Displays single numeric values with large text formatting
 */
export class MetricConverter implements PromQLChartConverter {
  supportedTypes = ["metric"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const config = panelSchema.config || {};
    const aggregation = config.aggregation || "last";

    // For metric charts, we typically show a single aggregated value
    // If there are multiple series, we can aggregate them or show multiple metrics

    const metrics: any[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const value = applyAggregation(seriesData.values, aggregation);

        const unitValue = getUnitValue(
          value,
          config?.unit,
          config?.unit_custom,
          config?.decimals,
        );

        metrics.push({
          name: seriesData.name,
          value: formatUnitValue(unitValue),
          rawValue: value,
          unit: unitValue.unit,
        });
      });
    });

    // If configured to show only one value, aggregate all metrics
    if (config.show_single_value && metrics.length > 1) {
      const totalValue = metrics.reduce((sum, m) => sum + m.rawValue, 0);
      const avgValue =
        config.aggregate_method === "avg"
          ? totalValue / metrics.length
          : totalValue;

      const unitValue = getUnitValue(
        avgValue,
        config?.unit,
        config?.unit_custom,
        config?.decimals,
      );

      return {
        type: "metric",
        value: formatUnitValue(unitValue),
        label: config.label || "Total",
        fontSize: config.font_size || 32,
        fontColor: config.font_color,
        backgroundColor: config.background_color,
        showTrend: config.show_trend !== false,
        trendData: metrics.map((m) => m.rawValue),
      };
    }

    // Show multiple metrics in grid layout
    return {
      type: "metric",
      metrics,
      layout: config.layout || "grid",
      fontSize: config.font_size || 24,
      fontColor: config.font_color,
      backgroundColor: config.background_color,
    };
  }
}
