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

import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import { formatDate } from "../dateTimeUtils";
import { toZonedTime } from "date-fns-tz";
import {
  parseOverrideConfigs,
  applyColumnOverrides,
  buildValueMappingCache,
  lookupValueMapping,
} from "../tableConfigUtils";

/**
 * Converter for table charts
 * Displays PromQL data in tabular format with metric labels as columns
 */
export class TableConverter implements PromQLChartConverter {
  supportedTypes = ["table"];

  convert(processedData: ProcessedPromQLData[], panelSchema: any, store: any) {
    // Build columns from metric labels + value
    const columns = this.buildColumns(processedData, panelSchema);

    // Build rows from series data
    const rows = this.buildRows(processedData, panelSchema, store);

    // Return the same structure as SQL tables (convertTableData)
    // TableRenderer component (table) handles pagination, sorting, filtering automatically
    const result = {
      rows,
      columns,
      // Required by interface but not used for tables
      series: [],
    };

    return result;
  }

  /**
   * Apply custom column ordering based on config
   * Note: Sticky columns remain in their ordered position (they don't move to front)
   * Sticky is just a CSS property for horizontal scrolling
   */
  private applyColumnOrdering(labelKeys: string[], config: any): string[] {
    const columnOrder: string[] = config.column_order || [];

    // Apply custom ordering if specified
    if (columnOrder.length > 0) {
      // First: columns in column_order (in that order)
      const orderedKeys = columnOrder.filter((key) => labelKeys.includes(key));
      // Then: columns not in column_order (alphabetically)
      const unorderedKeys = labelKeys.filter((key) => !columnOrder.includes(key)).sort();
      return [...orderedKeys, ...unorderedKeys];
    } else {
      // Default: alphabetical sort
      return labelKeys.sort();
    }
  }

  /**
   * Build table columns from metric labels and value(s)
   * Supports multi-aggregation: creates separate columns for each selected aggregation
   * Supports column filtering: show/hide specific columns via config
   * Supports sticky columns: mark columns as sticky to keep them visible while scrolling
   * Supports column ordering: custom order for visible, non-sticky columns via config
   */
  private buildColumns(processedData: ProcessedPromQLData[], panelSchema: any): any[] {
    const config = panelSchema.config || {};
    const tableMode = config.promql_table_mode || "single";

    // fieldType isn't applied here — PromQL column types are fixed.
    const maps = parseOverrideConfigs(panelSchema.config?.override_config);
    const { unitConfigMap } = maps;

    // Value text-replacement mappings.
    const mappings = panelSchema.config?.mappings || [];
    const valueMappingCache = buildValueMappingCache(mappings);

    // ── Shared column factories (one definition per column kind) ──────────────
    const baseColumn = (name: string, label: string, defaultAlign: string): any => {
      const col: any = { name, field: name, label, sortable: true };
      applyColumnOverrides(col, name.toLowerCase(), maps, defaultAlign);
      return col;
    };

    const textFormat = (val: any) => {
      const mapped = lookupValueMapping(val, valueMappingCache);
      return mapped != null ? mapped : val;
    };

    const valueFormat = (colNameLower: string) => (val: any) => {
      const mapped = lookupValueMapping(val, valueMappingCache);
      if (mapped != null) return mapped;
      const unitToUse = unitConfigMap[colNameLower]?.unit || config?.unit;
      const customUnitToUse = unitConfigMap[colNameLower]?.customUnit || config?.unit_custom;
      return formatUnitValue(getUnitValue(val, unitToUse, customUnitToUse, config?.decimals));
    };

    const makeTimestampColumn = (sticky = false): any => ({
      ...baseColumn("timestamp", "Timestamp", "left"),
      ...(sticky ? { sticky, headerClasses: "sticky-column", classes: "sticky-column" } : {}),
    });

    const makeLabelColumn = (key: string, sticky = false): any => ({
      ...baseColumn(key, key, "left"),
      sticky,
      headerClasses: sticky ? "sticky-column" : undefined,
      classes: sticky ? "sticky-column" : undefined,
      format: textFormat,
    });

    const makeValueColumn = (name: string, label: string): any => ({
      ...baseColumn(name, label, "right"),
      format: valueFormat(name.toLowerCase()),
    });

    const filterLabelKeys = (keys: string[]): string[] => {
      if (Array.isArray(config.visible_columns) && config.visible_columns.length > 0) {
        return keys.filter((k) => config.visible_columns.includes(k));
      }
      if (Array.isArray(config.hidden_columns) && config.hidden_columns.length > 0) {
        return keys.filter((k) => !config.hidden_columns.includes(k));
      }
      return keys;
    };

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [config.aggregation || "last"];

    // In "single" (Timestamp) mode, show timestamp + value columns
    if (tableMode === "single") {
      return [makeTimestampColumn(), makeValueColumn("value", "Value")];
    }

    // In "expanded_timeseries" mode, show timestamp + all metric labels + value
    if (tableMode === "expanded_timeseries") {
      // Collect all unique label keys from all series
      const labelKeys = new Set<string>();
      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          Object.keys(seriesData.metric).forEach((key) => {
            labelKeys.add(key);
          });
        });
      });

      const filteredLabelKeys = filterLabelKeys(Array.from(labelKeys));
      const stickyColumns = config.sticky_columns || [];
      const makeFirstSticky = config.sticky_first_column || false;

      const columns: any[] = [makeTimestampColumn(makeFirstSticky)];

      const sortedLabelKeys = this.applyColumnOrdering(filteredLabelKeys, config);
      sortedLabelKeys.forEach((key) => {
        columns.push(makeLabelColumn(key, stickyColumns.includes(key)));
      });

      columns.push(makeValueColumn("value", "Value"));

      return columns;
    }

    // In "all" (Aggregate) mode, collect all unique label keys across all series
    const labelKeys = new Set<string>();
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        Object.keys(seriesData.metric).forEach((key) => labelKeys.add(key));
      });
    });

    const filteredLabelKeys = filterLabelKeys(Array.from(labelKeys));
    const stickyColumns = config.sticky_columns || [];
    const makeFirstSticky = config.sticky_first_column || false;
    const sortedLabelKeys = this.applyColumnOrdering(filteredLabelKeys, config);

    const columns: any[] = sortedLabelKeys.map((key, index) =>
      makeLabelColumn(key, stickyColumns.includes(key) || (makeFirstSticky && index === 0)),
    );

    aggregations.forEach((agg: string) => {
      const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
      const columnLabel = aggregations.length === 1 ? "Value" : `Value (${agg})`;
      columns.push(makeValueColumn(columnName, columnLabel));
    });

    return columns;
  }

  /**
   * Build table rows from processed data
   * Supports multi-aggregation: calculates all selected aggregations for each series
   */
  private buildRows(processedData: ProcessedPromQLData[], panelSchema: any, store: any): any[] {
    const config = panelSchema.config || {};
    const tableMode = config.promql_table_mode || "single";
    const rows: any[] = [];

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [config.aggregation || "last"];

    // In "single" (Timestamp) mode, create rows with timestamp + value for ALL series
    if (tableMode === "single") {
      const timezone = store.state.timezone;

      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          // Create a row for each data point
          seriesData.values.forEach(([timestamp, value]) => {
            rows.push({
              timestamp: formatDate(toZonedTime(timestamp * 1000, timezone)),
              value: parseFloat(value),
              __legend__: seriesData.name, // Store legend for filtering
            });
          });
        });
      });

      // Apply row limit if specified
      if (config.row_limit) {
        return rows.slice(0, config.row_limit);
      }

      return rows;
    }

    // In "expanded_timeseries" mode, create rows with timestamp + all metric labels + value
    if (tableMode === "expanded_timeseries") {
      const timezone = store.state.timezone;

      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          // Create a row for each data point with all metadata
          seriesData.values.forEach(([timestamp, value]) => {
            const row: any = {
              timestamp: formatDate(toZonedTime(timestamp * 1000, timezone)),
              ...seriesData.metric, // Spread all metric labels (job, instance, etc.)
              value: parseFloat(value),
              __legend__: seriesData.name, // Store legend for filtering
            };
            rows.push(row);
          });
        });
      });

      // Apply row limit if specified
      if (config.row_limit) {
        return rows.slice(0, config.row_limit);
      }

      return rows;
    }

    // In "all" (Aggregate) mode, create rows with metric labels and aggregated values
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        // Create row with metric labels
        const row: any = {
          ...seriesData.metric,
          // Add legend name (series name) for filtering
          __legend__: seriesData.name,
        };

        // Calculate each aggregation for the series
        aggregations.forEach((agg: string) => {
          const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
          row[columnName] = applyAggregation(seriesData.values, agg);
        });

        rows.push(row);
      });
    });

    // Apply row limit if specified
    if (config.row_limit) {
      return rows.slice(0, config.row_limit);
    }

    return rows;
  }
}
