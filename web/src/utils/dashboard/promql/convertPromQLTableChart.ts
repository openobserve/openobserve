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
import {
  getUnitValue,
  formatUnitValue,
  formatDate,
  findFirstValidMappedValue,
} from "../convertDataIntoUnitValue";
import { toZonedTime } from "date-fns-tz";

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
   * Build table columns from metric labels and value(s)
   * Supports multi-aggregation: creates separate columns for each selected aggregation
   * Supports column filtering: show/hide specific columns via config
   * Supports sticky columns: mark columns as sticky to keep them visible while scrolling
   */
  private buildColumns(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
  ): any[] {
    const config = panelSchema.config || {};
    const tableMode = config.promql_table_mode || "single";

    // Build override maps (color/unit) to mimic SQL table behavior
    const overrideConfigs = panelSchema.config?.override_config || [];
    const colorConfigMap: Record<string, any> = {};
    const unitConfigMap: Record<string, any> = {};

    overrideConfigs.forEach((o: any) => {
      const alias = o?.field?.value;
      const cfg = o?.config?.[0];
      if (alias && cfg) {
        const aliasLower = alias.toLowerCase();
        if (cfg.type === "unique_value_color") {
          colorConfigMap[aliasLower] = { autoColor: cfg.autoColor };
        } else if (cfg.type === "unit") {
          unitConfigMap[aliasLower] = {
            unit: cfg.value?.unit,
            customUnit: cfg.value?.customUnit,
          };
        }
      }
    });

    // Mappings for value text replacements
    const mappings = panelSchema.config?.mappings || [];

    // Get selected aggregations (default: ['last'])
    const aggregations = config.table_aggregations || [
      config.aggregation || "last",
    ];

    // In "single" (Timestamp) mode, show timestamp + value columns
    if (tableMode === "single") {
      return [
        {
          name: "timestamp",
          field: "timestamp",
          label: "Timestamp",
          align: "left",
          sortable: true,
          // support override configs for coloring
          colorMode: colorConfigMap["timestamp"]?.autoColor
            ? "auto"
            : undefined,
        },
        {
          name: "value",
          field: "value",
          label: "Value",
          align: "right",
          sortable: true,
          format: (val: any) => {
            // Apply configured value mappings first
            const mapped = findFirstValidMappedValue(val, mappings, "text");
            if (mapped && mapped.text) return mapped.text;

            // Allow per-field unit override via override_config
            const aliasLower = "value";
            const unitToUse = unitConfigMap[aliasLower]?.unit || config?.unit;
            const customUnitToUse =
              unitConfigMap[aliasLower]?.customUnit || config?.unit_custom;

            const unitValue = getUnitValue(
              val,
              unitToUse,
              customUnitToUse,
              config?.decimals,
            );
            return formatUnitValue(unitValue);
          },
          // support override configs for coloring
          colorMode: colorConfigMap["value"]?.autoColor ? "auto" : undefined,
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

      const columns: any[] = [
        {
          name: "timestamp",
          field: "timestamp",
          label: "Timestamp",
          align: "left",
          sortable: true,
          sticky: makeFirstSticky, // Make timestamp sticky if first column should be sticky
          headerClasses: makeFirstSticky ? "sticky-column" : undefined,
          classes: makeFirstSticky ? "sticky-column" : undefined,
          // support override configs for coloring
          colorMode: colorConfigMap["timestamp"]?.autoColor
            ? "auto"
            : undefined,
        },
      ];

      // Add columns for each label
      const sortedLabelKeys = filteredLabelKeys.sort();
      sortedLabelKeys.forEach((key) => {
        const isSticky = stickyColumns.includes(key);
        // Note: Don't apply makeFirstSticky here because timestamp is already the first column

        columns.push({
          name: key,
          field: key,
          label: key,
          align: "left",
          sortable: true,
          sticky: isSticky, // Make sticky only if explicitly in sticky_columns list
          headerClasses: isSticky ? "sticky-column" : undefined,
          classes: isSticky ? "sticky-column" : undefined,
          // apply value mapping for label columns
          format: (val: any) => {
            const mapped = findFirstValidMappedValue(val, mappings, "text");
            return mapped && mapped.text ? mapped.text : val;
          },
          // support override configs for coloring
          colorMode: colorConfigMap[key.toLowerCase()]?.autoColor
            ? "auto"
            : undefined,
        });
      });

      // Add value column at the end
      columns.push({
        name: "value",
        field: "value",
        label: "Value",
        align: "right",
        sortable: true,
        format: (val: any) => {
          // Apply configured value mappings first
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          if (mapped && mapped.text) return mapped.text;

          // Unit override support
          const aliasLower = "value";
          const unitToUse = unitConfigMap[aliasLower]?.unit || config?.unit;
          const customUnitToUse =
            unitConfigMap[aliasLower]?.customUnit || config?.unit_custom;

          const unitValue = getUnitValue(
            val,
            unitToUse,
            customUnitToUse,
            config?.decimals,
          );
          return formatUnitValue(unitValue);
        },
        // support override configs for coloring
        colorMode: colorConfigMap["value"]?.autoColor ? "auto" : undefined,
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

    // Create columns for each label
    const columns = filteredLabelKeys.map((key, index) => {
      const isSticky =
        stickyColumns.includes(key) || (makeFirstSticky && index === 0);

      return {
        name: key,
        field: key,
        label: key,
        align: "left",
        sortable: true,
        // Mark column as sticky for CSS styling
        sticky: isSticky,
        headerClasses: isSticky ? "sticky-column" : undefined,
        classes: isSticky ? "sticky-column" : undefined,
        // value mapping for text replacement
        format: (val: any) => {
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          return mapped && mapped.text ? mapped.text : val;
        },
        // optional override-config based automatic color
        colorMode: colorConfigMap[key.toLowerCase()]?.autoColor
          ? "auto"
          : undefined,
      };
    });

    // Add value columns for each selected aggregation
    aggregations.forEach((agg: string) => {
      const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
      const columnLabel =
        aggregations.length === 1 ? "Value" : `Value (${agg})`;

      columns.push({
        name: columnName,
        field: columnName,
        label: columnLabel,
        align: "right",
        sortable: true,
        // Apply value mapping and per-column unit overrides
        format: (val: any) => {
          const mapped = findFirstValidMappedValue(val, mappings, "text");
          if (mapped && mapped.text) return mapped.text;

          const aliasLower = columnName.toLowerCase();
          const unitToUse = unitConfigMap[aliasLower]?.unit || config?.unit;
          const customUnitToUse =
            unitConfigMap[aliasLower]?.customUnit || config?.unit_custom;

          const unitValue = getUnitValue(
            val,
            unitToUse,
            customUnitToUse,
            config?.decimals,
          );
          return formatUnitValue(unitValue);
        },
        // support override configs for coloring
        colorMode: colorConfigMap[columnName.toLowerCase()]?.autoColor
          ? "auto"
          : undefined,
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
