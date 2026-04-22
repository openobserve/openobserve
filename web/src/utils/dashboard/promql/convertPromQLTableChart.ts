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
import {
  getUnitValue,
  formatUnitValue,
} from "../convertDataIntoUnitValue";
import { formatDate } from "../dateTimeUtils";
import { findFirstValidMappedValue } from "../dashboardValidator";
import { toZonedTime } from "date-fns-tz";
import { parseOverrideConfigs } from "../tableConfigUtils";

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
    chartPanelRef?: any,
  ) {
    // Build columns from metric labels + value
    const columns = this.buildColumns(processedData, panelSchema);

    // Build rows from series data
    const rows = this.buildRows(processedData, panelSchema, store);

    // Return the same structure as SQL tables (convertTableData)
    // TableRenderer component (q-table) handles pagination, sorting, filtering automatically
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
  private applyColumnOrdering(
    labelKeys: string[],
    config: any,
  ): string[] {
    const columnOrder = config.column_order || [];

    // Apply custom ordering if specified
    if (columnOrder.length > 0) {
      // First: columns in column_order (in that order)
      const orderedKeys = columnOrder.filter((key) =>
        labelKeys.includes(key),
      );
      // Then: columns not in column_order (alphabetically)
      const unorderedKeys = labelKeys
        .filter((key) => !columnOrder.includes(key))
        .sort();
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
  private buildColumns(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
  ): any[] {
    const config = panelSchema.config || {};
    const tableMode = config.promql_table_mode || "single";

    // Build override maps (color/unit/style) to mimic SQL table behavior
    const { colorConfigMap, unitConfigMap, styleConfigMap } = parseOverrideConfigs(
      panelSchema.config?.override_config,
    );

    // Mappings for value text replacements
    const mappings = panelSchema.config?.mappings || [];

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [
      config.aggregation || "last",
    ];

    // In "single" (Timestamp) mode, show timestamp + value columns
    if (tableMode === "single") {
      const tsStyle = styleConfigMap["timestamp"];
      const valStyle = styleConfigMap["value"];
      return [
        {
          name: "timestamp",
          field: "timestamp",
          label: "Timestamp",
          align: tsStyle?.alignment || "left",
          sortable: true,
          colorMode: colorConfigMap["timestamp"]?.autoColor ? "auto" : undefined,
          ...(tsStyle?.textColor ? { textColor: tsStyle.textColor } : {}),
          ...(tsStyle?.bgColor ? { bgColor: tsStyle.bgColor } : {}),
        },
        {
          name: "value",
          field: "value",
          label: "Value",
          align: valStyle?.alignment || "right",
          sortable: true,
          format: (val: any) => {
            const mapped = findFirstValidMappedValue(val, mappings, "text");
            if (mapped && mapped.text) return mapped.text;
            const unitToUse = unitConfigMap["value"]?.unit || config?.unit;
            const customUnitToUse = unitConfigMap["value"]?.customUnit || config?.unit_custom;
            return formatUnitValue(getUnitValue(val, unitToUse, customUnitToUse, config?.decimals));
          },
          colorMode: colorConfigMap["value"]?.autoColor ? "auto" : undefined,
          ...(valStyle?.textColor ? { textColor: valStyle.textColor } : {}),
          ...(valStyle?.bgColor ? { bgColor: valStyle.bgColor } : {}),
        },
      ];
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

      // Apply column filter if configured
      let filteredLabelKeys = Array.from(labelKeys);

      if (
        config.visible_columns &&
        Array.isArray(config.visible_columns) &&
        config.visible_columns.length > 0
      ) {
        // If visible_columns is specified, only show those columns
        filteredLabelKeys = filteredLabelKeys.filter((key) =>
          config.visible_columns.includes(key),
        );
      } else if (
        config.hidden_columns &&
        Array.isArray(config.hidden_columns) &&
        config.hidden_columns.length > 0
      ) {
        // If hidden_columns is specified, hide those columns
        filteredLabelKeys = filteredLabelKeys.filter(
          (key) => !config.hidden_columns.includes(key),
        );
      }

      // Handle sticky columns configuration
      const stickyColumns = config.sticky_columns || [];
      const makeFirstSticky = config.sticky_first_column || false;

      const tsStyle2 = styleConfigMap["timestamp"];
      const columns: any[] = [
        {
          name: "timestamp",
          field: "timestamp",
          label: "Timestamp",
          align: tsStyle2?.alignment || "left",
          sortable: true,
          sticky: makeFirstSticky,
          headerClasses: makeFirstSticky ? "sticky-column" : undefined,
          classes: makeFirstSticky ? "sticky-column" : undefined,
          colorMode: colorConfigMap["timestamp"]?.autoColor ? "auto" : undefined,
          ...(tsStyle2?.textColor ? { textColor: tsStyle2.textColor } : {}),
          ...(tsStyle2?.bgColor ? { bgColor: tsStyle2.bgColor } : {}),
        },
      ];

      const sortedLabelKeys = this.applyColumnOrdering(filteredLabelKeys, config);
      sortedLabelKeys.forEach((key) => {
        const isSticky = stickyColumns.includes(key);
        const keyLower = key.toLowerCase();
        const keyStyle = styleConfigMap[keyLower];
        columns.push({
          name: key,
          field: key,
          label: key,
          align: keyStyle?.alignment || "left",
          sortable: true,
          sticky: isSticky,
          headerClasses: isSticky ? "sticky-column" : undefined,
          classes: isSticky ? "sticky-column" : undefined,
          format: (val: any) => {
            const mapped = findFirstValidMappedValue(val, mappings, "text");
            return mapped && mapped.text ? mapped.text : val;
          },
          colorMode: colorConfigMap[keyLower]?.autoColor ? "auto" : undefined,
          ...(keyStyle?.textColor ? { textColor: keyStyle.textColor } : {}),
          ...(keyStyle?.bgColor ? { bgColor: keyStyle.bgColor } : {}),
        });
      });

      const valStyle2 = styleConfigMap["value"];
      columns.push({
        name: "value",
        field: "value",
        label: "Value",
        align: valStyle2?.alignment || "right",
        sortable: true,
        format: (val: any) => {
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          if (mapped && mapped.text) return mapped.text;
          const unitToUse = unitConfigMap["value"]?.unit || config?.unit;
          const customUnitToUse = unitConfigMap["value"]?.customUnit || config?.unit_custom;
          return formatUnitValue(getUnitValue(val, unitToUse, customUnitToUse, config?.decimals));
        },
        colorMode: colorConfigMap["value"]?.autoColor ? "auto" : undefined,
        ...(valStyle2?.textColor ? { textColor: valStyle2.textColor } : {}),
        ...(valStyle2?.bgColor ? { bgColor: valStyle2.bgColor } : {}),
      });

      return columns;
    }

    // In "all" (Aggregate) mode, collect all unique label keys across all series
    const labelKeys = new Set<string>();

    processedData.forEach((queryData, qIndex) => {
      queryData.series.forEach((seriesData, sIndex) => {
        Object.keys(seriesData.metric).forEach((key) => {
          labelKeys.add(key);
        });
      });
    });

    // Apply column filter if configured
    // config.visible_columns: array of column names to show (if not set, show all)
    // config.hidden_columns: array of column names to hide (if not set, hide none)
    let filteredLabelKeys = Array.from(labelKeys);

    if (
      config.visible_columns &&
      Array.isArray(config.visible_columns) &&
      config.visible_columns.length > 0
    ) {
      // If visible_columns is specified, only show those columns
      filteredLabelKeys = filteredLabelKeys.filter((key) =>
        config.visible_columns.includes(key),
      );
    } else if (
      config.hidden_columns &&
      Array.isArray(config.hidden_columns) &&
      config.hidden_columns.length > 0
    ) {
      // If hidden_columns is specified, hide those columns
      filteredLabelKeys = filteredLabelKeys.filter(
        (key) => !config.hidden_columns.includes(key),
      );
    }

    // Get sticky columns configuration
    // config.sticky_columns: array of column names to make sticky (or "first" to make first column sticky)
    const stickyColumns = config.sticky_columns || [];
    const makeFirstSticky = config.sticky_first_column || false;

    // Apply custom column ordering
    const sortedLabelKeys = this.applyColumnOrdering(filteredLabelKeys, config);

    // Create columns for each label
    const columns = sortedLabelKeys.map((key, index) => {
      const isSticky =
        stickyColumns.includes(key) || (makeFirstSticky && index === 0);
      const keyLower = key.toLowerCase();
      const keyStyle = styleConfigMap[keyLower];
      return {
        name: key,
        field: key,
        label: key,
        align: keyStyle?.alignment || "left",
        sortable: true,
        sticky: isSticky,
        headerClasses: isSticky ? "sticky-column" : undefined,
        classes: isSticky ? "sticky-column" : undefined,
        format: (val: any) => {
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          return mapped && mapped.text ? mapped.text : val;
        },
        colorMode: colorConfigMap[keyLower]?.autoColor ? "auto" : undefined,
        ...(keyStyle?.textColor ? { textColor: keyStyle.textColor } : {}),
        ...(keyStyle?.bgColor ? { bgColor: keyStyle.bgColor } : {}),
      };
    });

    aggregations.forEach((agg: string) => {
      const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
      const columnLabel = aggregations.length === 1 ? "Value" : `Value (${agg})`;
      const colNameLower = columnName.toLowerCase();
      const colStyle = styleConfigMap[colNameLower];
      columns.push({
        name: columnName,
        field: columnName,
        label: columnLabel,
        align: colStyle?.alignment || "right",
        sortable: true,
        format: (val: any) => {
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          if (mapped && mapped.text) return mapped.text;
          const unitToUse = unitConfigMap[colNameLower]?.unit || config?.unit;
          const customUnitToUse = unitConfigMap[colNameLower]?.customUnit || config?.unit_custom;
          return formatUnitValue(getUnitValue(val, unitToUse, customUnitToUse, config?.decimals));
        },
        colorMode: colorConfigMap[colNameLower]?.autoColor ? "auto" : undefined,
        ...(colStyle?.textColor ? { textColor: colStyle.textColor } : {}),
        ...(colStyle?.bgColor ? { bgColor: colStyle.bgColor } : {}),
      } as any);
    });

    // Timestamp column removed as per user request

    return columns;
  }

  /**
   * Build table rows from processed data
   * Supports multi-aggregation: calculates all selected aggregations for each series
   */
  private buildRows(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
  ): any[] {
    const config = panelSchema.config || {};
    const tableMode = config.promql_table_mode || "single";
    const rows: any[] = [];

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [
      config.aggregation || "last",
    ];

    // In "single" (Timestamp) mode, create rows with timestamp + value for ALL series
    if (tableMode === "single") {
      const timezone = store.state.timezone;

      processedData.forEach((queryData, qIndex) => {
        queryData.series.forEach((seriesData, sIndex) => {
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

      processedData.forEach((queryData, qIndex) => {
        queryData.series.forEach((seriesData, sIndex) => {
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
    processedData.forEach((queryData, qIndex) => {
      queryData.series.forEach((seriesData, sIndex) => {
        // Create row with metric labels
        const row: any = {
          ...seriesData.metric,
          // Add legend name (series name) for filtering
          __legend__: seriesData.name,
        };

        // Calculate each aggregation for the series
        aggregations.forEach((agg: string) => {
          const columnName =
            aggregations.length === 1 ? "value" : `value_${agg}`;
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
