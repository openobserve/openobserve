// Copyright 2023 Zinc Labs Inc.
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
 * Converter for table charts
 * Displays PromQL data in tabular format with metric labels as columns
 */
export class TableConverter implements PromQLChartConverter {
  supportedTypes = ["table"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any
  ) {
    console.log("=== [TableConverter] Starting conversion ===");
    console.log("Processed Data:", processedData);
    console.log("Panel Schema:", panelSchema);

    // Build columns from metric labels + value
    const columns = this.buildColumns(processedData, panelSchema);
    console.log("Built Columns:", columns);

    // Build rows from series data
    const rows = this.buildRows(processedData, panelSchema);
    console.log("Built Rows:", rows);
    console.log("Rows count:", rows.length);

    // Return the same structure as SQL tables (convertTableData)
    // TableRenderer component (q-table) handles pagination, sorting, filtering automatically
    const result = {
      rows,
      columns,
      // Required by interface but not used for tables
      series: [],
    };

    console.log("=== [TableConverter] Conversion complete ===");
    console.log("Final Result:", result);
    return result;
  }

  /**
   * Build table columns from metric labels and value(s)
   * Supports multi-aggregation: creates separate columns for each selected aggregation
   */
  private buildColumns(processedData: ProcessedPromQLData[], panelSchema: any): any[] {
    const config = panelSchema.config || {};

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [config.aggregation || 'last'];

    console.log("=== [buildColumns] Starting ===");
    console.log("processedData length:", processedData.length);
    console.log("Aggregations:", aggregations);

    // Collect all unique label keys across all series
    const labelKeys = new Set<string>();

    processedData.forEach((queryData, qIndex) => {
      console.log(`Query ${qIndex} - series count:`, queryData.series?.length);
      queryData.series.forEach((seriesData, sIndex) => {
        console.log(`Query ${qIndex}, Series ${sIndex} - metric:`, seriesData.metric);
        Object.keys(seriesData.metric).forEach((key) => {
          labelKeys.add(key);
        });
      });
    });

    console.log("Label keys collected:", Array.from(labelKeys));

    // Create columns for each label
    const columns = Array.from(labelKeys).map((key) => ({
      name: key,
      field: key,
      label: key,
      align: "left",
      sortable: true,
    }));

    // Add value columns for each selected aggregation
    aggregations.forEach((agg: string) => {
      const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
      const columnLabel = aggregations.length === 1 ? "Value" : `Value (${agg})`;

      columns.push({
        name: columnName,
        field: columnName,
        label: columnLabel,
        align: "right",
        sortable: true,
        format: (val: any) => {
          const unitValue = getUnitValue(
            val,
            config?.unit,
            config?.unit_custom,
            config?.decimals
          );
          return formatUnitValue(unitValue);
        },
      } as any);
    });

    // Always add timestamp column if time-series data
    const hasTimeSeriesData = processedData.some((qd) => qd.timestamps.length > 1);
    if (hasTimeSeriesData) {
      columns.unshift({
        name: "timestamp",
        field: "timestamp",
        label: "Timestamp",
        align: "left",
        sortable: true,
      });
    }

    console.log("Built columns:", columns.map(c => c.name));
    return columns;
  }

  /**
   * Build table rows from processed data
   * Supports multi-aggregation: calculates all selected aggregations for each series
   */
  private buildRows(processedData: ProcessedPromQLData[], panelSchema: any): any[] {
    const config = panelSchema.config || {};
    const rows: any[] = [];

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [config.aggregation || 'last'];

    console.log("=== [buildRows] Starting ===");
    console.log("Aggregations:", aggregations);
    console.log("processedData length:", processedData.length);

    processedData.forEach((queryData, qIndex) => {
      console.log(`Query ${qIndex} - timestamps length:`, queryData.timestamps?.length);
      console.log(`Query ${qIndex} - series length:`, queryData.series?.length);

      queryData.series.forEach((seriesData, sIndex) => {
        console.log(`Query ${qIndex}, Series ${sIndex} - values length:`, seriesData.values?.length);
        console.log(`Query ${qIndex}, Series ${sIndex} - metric:`, seriesData.metric);

        // Create row with metric labels
        const row: any = {
          ...seriesData.metric,
        };

        // Calculate each aggregation for the series
        aggregations.forEach((agg: string) => {
          const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
          row[columnName] = applyAggregation(seriesData.values, agg);
        });

        // Add timestamp if it's a single value
        if (queryData.timestamps.length === 1) {
          row.timestamp = queryData.timestamps[0][1];
        }

        rows.push(row);
      });
    });

    // Apply row limit if specified
    if (config.row_limit) {
      return rows.slice(0, config.row_limit);
    }

    console.log("Built rows count:", rows.length);
    return rows;
  }
}
