# Design Specification: Extending PromQL Chart Type Support

**Version:** 2.0 - Final Implementation-Ready
**Date:** 2025-12-20
**Status:** Ready for Implementation
**Author:** System Design

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Proposed Architecture](#2-proposed-architecture)
3. [Technical Design](#3-technical-design)
   - 3.1 [Common Interface & Types](#31-common-interface--types)
   - 3.2 [Shared Data Processor](#32-shared-data-processor)
   - 3.3 [Error Handling System](#33-error-handling-system)
   - 3.4 [Aggregation Functions](#34-aggregation-functions)
   - 3.5 [Converter Implementations](#35-converter-implementations)
4. [Configuration Options](#4-configuration-options)
5. [Multi-Query Support](#5-multi-query-support)
6. [Implementation Plan](#6-implementation-plan)
7. [Testing Strategy](#7-testing-strategy)
8. [Backward Compatibility](#8-backward-compatibility)
9. [UI Changes](#9-ui-changes)
10. [Performance & Monitoring](#10-performance--monitoring)

---

## 1. Executive Summary

### 1.1 Purpose
Extend OpenObserve's PromQL query support to include **all chart types** (pie, donut, table, h-bar, stacked, h-stacked, heatmap, geomap, maps) while maintaining a clean, modular, maintainable architecture.

### 1.2 Current State
- **Supported:** line, area, area-stacked, bar, scatter, gauge, metric, html, markdown, custom_chart (10 types)
- **Unsupported:** pie, donut, table, h-bar, stacked, h-stacked, heatmap, geomap, maps (9 types)
- **✅ Multi-Query Support:** Already supported - multiple PromQL queries can be combined in a single panel
- **Current File:** `convertPromQLData.ts` (1,190 lines) - monolithic implementation

### 1.3 Goals
1. ✅ Enable **all 19 chart types** for PromQL queries
2. ✅ Minimize changes to existing `convertPromQLData.ts` (becomes delegator)
3. ✅ Create **modular, chart-specific** conversion logic
4. ✅ Maintain **consistent data transformation** patterns
5. ✅ Support both **time-series and instant** PromQL queries
6. ✅ **Preserve existing multi-query support** across all new chart types

### 1.4 Critical Requirements

#### 1.4.1 Error Handling
- ✅ Structured error objects with user-friendly messages
- ✅ Actionable suggestions for fixing issues
- ✅ Graceful fallbacks (empty state instead of crash)
- ✅ Validation before rendering

#### 1.4.2 SQL/Logs Isolation
- ✅ **Zero changes** to SQL/logs conversion files
- ✅ Completely separate code paths
- ✅ Independent test suites
- ✅ No shared dependencies

#### 1.4.3 Configurable Labels
- ✅ **GeoMap:** Custom `lat`, `lon`, `weight` fields
- ✅ **Maps:** Custom `name`, `value` fields
- ✅ UI configuration for custom label names
- ✅ Helpful error messages when labels missing

#### 1.4.4 Aggregation Options (9 Types)
For single-value charts (pie, donut, gauge, metric, h-bar):
1. **last** - Latest value (default)
2. **first** - Oldest value
3. **min** - Minimum value
4. **max** - Maximum value
5. **avg** - Average
6. **sum** - Sum
7. **count** - Count of data points
8. **range** - Max - Min
9. **diff** - Last - First

For **table charts** - **Multi-select aggregation support**:
- Users can select multiple aggregation functions
- Each selected aggregation creates a separate column
- Column naming format: `value_{aggregation}` (e.g., `value_last`, `value_sum`, `value_avg`)
- If only one aggregation is selected, column name is simply `value`
- Default: `last` aggregation only

#### 1.4.5 Table Flexibility
- ✅ Auto-column detection from metric labels (default)
- ✅ Custom column configuration
- ✅ Multi-select aggregation with dynamic columns
- ✅ 8 column types: string, number, timestamp, duration, bytes, boolean, link, json
- ✅ Pagination with configurable page size
- ✅ Sortable/filterable columns

**Example Table Configuration:**
```json
{
  "config": {
    "table_aggregations": ["last", "sum", "avg", "max"]
  }
}
```

**Resulting Columns:**
- All metric labels (job, instance, etc.)
- `value_last` - Latest value
- `value_sum` - Sum of all values
- `value_avg` - Average value
- `value_max` - Maximum value

#### 1.4.6 Custom Chart Safety
- ✅ **Zero changes** to custom chart code path
- ✅ Raw data pass-through preserved
- ✅ `convertCustomChartData.ts` unchanged
- ✅ `CustomChartRenderer.vue` unchanged

#### 1.4.7 100% Backward Compatible
- ✅ All existing panels render identically
- ✅ Panel JSON schema unchanged
- ✅ API contracts preserved
- ✅ Snapshot testing for validation
- ✅ Feature flags for safe rollout

### 1.5 Success Metrics
- ✅ 19/19 chart types supported (100%)
- ✅ <1% increase in p95 load time
- ✅ Zero regression bugs
- ✅ >80% code coverage for new modules
- ✅ 100% existing panels render identically

---

## 2. Proposed Architecture

### 2.1 File Structure

```
openobserve/web/src/utils/dashboard/
├── convertPanelData.ts                    # Main router (NO CHANGES)
├── convertPromQLData.ts                   # Refactor: delegate to chart converters
│
├── promql/                                # NEW DIRECTORY
│   ├── index.ts                           # NEW: Export all converters
│   ├── convertPromQLChartData.ts          # NEW: Common converter router
│   ├── convertPromQLTimeSeriesChart.ts    # NEW: Line/Area/Bar/Scatter/Stacked
│   ├── convertPromQLPieChart.ts           # NEW: Pie/Donut
│   ├── convertPromQLTableChart.ts         # NEW: Table
│   ├── convertPromQLGaugeChart.ts         # NEW: Gauge (extracted)
│   ├── convertPromQLMetricChart.ts        # NEW: Metric text (extracted)
│   ├── convertPromQLHeatmapChart.ts       # NEW: Heatmap
│   ├── convertPromQLBarChart.ts           # NEW: H-Bar/Stacked/H-Stacked
│   ├── convertPromQLGeoChart.ts           # NEW: GeoMap (lat, lon, weight)
│   ├── convertPromQLMapsChart.ts          # NEW: Maps (name, value)
│   │
│   └── shared/                            # NEW: Shared utilities
│       ├── types.ts                       # Type definitions
│       ├── dataProcessor.ts               # Common data processing
│       ├── legendBuilder.ts               # Legend generation
│       ├── axisBuilder.ts                 # Axis configuration
│       └── seriesBuilder.ts               # Series utilities
```

### 2.2 Design Principles

1. **Single Responsibility:** Each chart type has its own converter
2. **Dependency Inversion:** All converters implement a common interface
3. **Open/Closed:** Easy to add new chart types without modifying existing code
4. **DRY:** Shared utilities in `promql/shared/`
5. **Backwards Compatible:** Existing panels continue to work

---

## 3. Technical Design

### 3.1 Common Interface

**File:** `src/utils/dashboard/promql/shared/types.ts`

```typescript
/**
 * Standard PromQL API response structure
 */
export interface PromQLResponse {
  status: "success" | "error";
  data: {
    resultType: "matrix" | "vector" | "scalar" | "string";
    result: Array<{
      metric: Record<string, string>;  // Labels
      values?: Array<[number, string]>;  // [timestamp, value] for matrix
      value?: [number, string];          // [timestamp, value] for vector
    }>;
  };
}

/**
 * Processed data structure used by converters
 */
export interface ProcessedPromQLData {
  timestamps: Array<[number, Date | string]>;  // [unix_ts, formatted_date]
  series: Array<{
    name: string;
    metric: Record<string, string>;
    values: Array<[number, string]>;  // [timestamp, value]
    data: Record<number, string>;     // timestamp -> value map
  }>;
  queryIndex: number;
  queryConfig: any;
}

/**
 * Common converter interface
 */
export interface PromQLChartConverter {
  /**
   * Converts PromQL response to ECharts series configuration
   */
  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ): {
    series: any[];
    xAxis?: any;
    yAxis?: any;
    grid?: any;
    tooltip?: any;
    legend?: any;
    [key: string]: any;
  };

  /**
   * Chart types supported by this converter
   */
  supportedTypes: string[];
}

/**
 * Conversion context
 */
export interface ConversionContext {
  panelSchema: any;
  store: any;
  chartPanelRef: any;
  hoveredSeriesState: any;
  annotations: any;
  metadata?: any;
}
```

---

### 3.2 Core Conversion Flow

**File:** `src/utils/dashboard/promql/convertPromQLChartData.ts`

```typescript
import { PromQLResponse, ProcessedPromQLData, ConversionContext } from "./shared/types";
import { processPromQLData, buildXAxisData } from "./shared/dataProcessor";
import { TimeSeriesConverter } from "./convertPromQLTimeSeriesChart";
import { PieConverter } from "./convertPromQLPieChart";
import { TableConverter } from "./convertPromQLTableChart";
import { GaugeConverter } from "./convertPromQLGaugeChart";
import { MetricConverter } from "./convertPromQLMetricChart";
import { HeatmapConverter } from "./convertPromQLHeatmapChart";
import { BarConverter } from "./convertPromQLBarChart";
import { GeoConverter } from "./convertPromQLGeoChart";
import { MapsConverter } from "./convertPromQLMapsChart";

/**
 * Registry of all chart type converters
 */
const CONVERTER_REGISTRY = [
  new TimeSeriesConverter(),
  new PieConverter(),
  new TableConverter(),
  new GaugeConverter(),
  new MetricConverter(),
  new HeatmapConverter(),
  new BarConverter(),
  new GeoConverter(),
  new MapsConverter(),
];

/**
 * Main entry point for PromQL chart conversion
 *
 * @param searchQueryData - Array of PromQL API responses (one per query)
 * @param context - Conversion context with panel config and state
 * @returns ECharts options object
 */
export async function convertPromQLChartData(
  searchQueryData: PromQLResponse[],
  context: ConversionContext,
): Promise<{ options: any; extras: any }> {
  const { panelSchema, store, chartPanelRef, hoveredSeriesState, annotations, metadata } = context;
  const chartType = panelSchema.type;

  // Step 1: Find appropriate converter
  const converter = CONVERTER_REGISTRY.find((c) =>
    c.supportedTypes.includes(chartType)
  );

  if (!converter) {
    throw new Error(`No converter found for chart type: ${chartType}`);
  }

  // Step 2: Preprocess data (common for all chart types)
  const processedData = await processPromQLData(
    searchQueryData,
    panelSchema,
    store,
  );

  // Step 3: Initialize extras object
  const extras: any = {
    legends: [],
    hoveredSeriesState: hoveredSeriesState || null,
  };

  // Step 4: Delegate to chart-specific converter
  const chartConfig = converter.convert(processedData, panelSchema, store, extras);

  // Step 5: Apply common configurations
  const options = {
    backgroundColor: "transparent",
    ...chartConfig,

    // Apply panel-level overrides
    ...(panelSchema.config?.axis_width && {
      grid: {
        ...chartConfig.grid,
        left: panelSchema.config.axis_width,
      },
    }),
  };

  // Step 6: Apply annotations (if applicable)
  if (annotations?.length && chartConfig.series) {
    applyAnnotations(options, annotations, processedData);
  }

  return { options, extras };
}

/**
 * Apply mark lines/areas for annotations
 */
function applyAnnotations(options: any, annotations: any[], processedData: any) {
  // Implementation similar to current convertPromQLData.ts lines 850-1000
  // ... (extract existing annotation logic)
}
```

---

### 3.3 Shared Data Processor

**File:** `src/utils/dashboard/promql/shared/dataProcessor.ts`

```typescript
import { toZonedTime } from "date-fns-tz";
import { PromQLResponse, ProcessedPromQLData } from "./types";
import { getPromqlLegendName } from "./legendBuilder";

/**
 * Preprocess PromQL responses into a common format
 */
export async function processPromQLData(
  searchQueryData: PromQLResponse[],
  panelSchema: any,
  store: any,
): Promise<ProcessedPromQLData[]> {
  const result: ProcessedPromQLData[] = [];

  // Apply series limit
  const seriesLimit = panelSchema.config?.promql_series_limit || 100;
  const limitedData = applySeriesLimit(searchQueryData, seriesLimit);

  // Collect all unique timestamps across all queries
  const allTimestamps = collectAllTimestamps(limitedData);

  // Format timestamps with timezone
  const formattedTimestamps = formatTimestamps(allTimestamps, store.state.timezone);

  // Process each query
  limitedData.forEach((queryData, index) => {
    if (!queryData?.data?.result) return;

    const series = queryData.data.result.map((metric: any) => {
      // Generate series name
      const seriesName = getPromqlLegendName(
        metric.metric,
        panelSchema.queries[index]?.config?.promql_legend,
      );

      // Extract values
      const values = metric.values || (metric.value ? [metric.value] : []);

      // Create timestamp -> value map
      const dataObj: Record<number, string> = {};
      values.forEach(([ts, val]: [number, string]) => {
        dataObj[ts] = val;
      });

      return {
        name: seriesName,
        metric: metric.metric,
        values,
        data: dataObj,
      };
    });

    result.push({
      timestamps: formattedTimestamps,
      series,
      queryIndex: index,
      queryConfig: panelSchema.queries[index]?.config || {},
    });
  });

  return result;
}

/**
 * Collect all unique timestamps from all series
 */
function collectAllTimestamps(data: PromQLResponse[]): Set<number> {
  const timestamps = new Set<number>();

  data.forEach((queryData) => {
    if (!queryData?.data?.result) return;

    queryData.data.result.forEach((metric) => {
      const values = metric.values || (metric.value ? [metric.value] : []);
      values.forEach(([ts]: [number, string]) => {
        timestamps.add(ts);
      });
    });
  });

  return timestamps;
}

/**
 * Format timestamps with timezone
 */
function formatTimestamps(
  timestamps: Set<number>,
  timezone: string,
): Array<[number, Date | string]> {
  const sorted = Array.from(timestamps).sort((a, b) => a - b);

  return sorted.map((ts) => {
    const formatted = timezone !== "UTC"
      ? toZonedTime(ts * 1000, timezone)
      : new Date(ts * 1000).toISOString().slice(0, -1);

    return [ts, formatted];
  });
}

/**
 * Limit number of series per query
 */
function applySeriesLimit(
  data: PromQLResponse[],
  limit: number,
): PromQLResponse[] {
  return data.map((queryData) => {
    if (!queryData?.data?.result) return queryData;

    return {
      ...queryData,
      data: {
        ...queryData.data,
        result: queryData.data.result.slice(0, limit),
      },
    };
  });
}

/**
 * Get instant query value (last value in time series)
 */
export function getInstantValue(values: Array<[number, string]>): string {
  if (!values || values.length === 0) return "0";

  const sorted = values.sort((a, b) => a[0] - b[0]);
  return sorted[sorted.length - 1][1];
}

/**
 * Fill missing timestamps with null values
 */
export function fillMissingTimestamps(
  dataObj: Record<number, string>,
  timestamps: Array<[number, Date | string]>,
): Array<[Date | string, string | null]> {
  return timestamps.map(([ts, formattedTs]) => [
    formattedTs,
    dataObj[ts] ?? null,
  ]);
}
```

---

### 3.4 Chart-Specific Converters

#### 3.4.1 Time Series Converter

**File:** `src/utils/dashboard/promql/convertPromQLTimeSeriesChart.ts`

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { fillMissingTimestamps } from "./shared/dataProcessor";
import { buildXAxis, buildYAxis } from "./shared/axisBuilder";
import { getSeriesColor } from "../../colorPalette";

export class TimeSeriesConverter implements PromQLChartConverter {
  supportedTypes = ["line", "area", "area-stacked", "bar", "scatter"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ) {
    const chartType = panelSchema.type;
    const series: any[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData, index) => {
        // Fill data with null for missing timestamps
        const data = fillMissingTimestamps(
          seriesData.data,
          queryData.timestamps,
        );

        series.push({
          name: seriesData.name,
          type: this.getEChartsType(chartType),
          data,

          // Apply stacking for area-stacked
          ...(chartType === "area-stacked" && { stack: "Total" }),

          // Apply area style for area charts
          ...(chartType.includes("area") && { areaStyle: {} }),

          // Apply custom colors
          ...(panelSchema.queries[queryData.queryIndex]?.customQuery?.fields?.[index]?.color && {
            color: panelSchema.queries[queryData.queryIndex].customQuery.fields[index].color,
          }),

          // Common properties
          emphasis: { focus: "series" },
          lineStyle: { width: 1.5 },
          connectNulls: panelSchema.config?.connect_nulls ?? false,
        });

        // Track for legend
        extras.legends.push(seriesData.name);
      });
    });

    return {
      series,
      xAxis: buildXAxis(panelSchema, store),
      yAxis: buildYAxis(panelSchema),
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
      },
    };
  }

  private getEChartsType(chartType: string): string {
    switch (chartType) {
      case "bar": return "bar";
      case "scatter": return "scatter";
      default: return "line";
    }
  }
}
```

#### 3.4.2 Pie/Donut Converter

**File:** `src/utils/dashboard/promql/convertPromQLPieChart.ts`

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { getInstantValue } from "./shared/dataProcessor";

export class PieConverter implements PromQLChartConverter {
  supportedTypes = ["pie", "donut"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ) {
    const chartType = panelSchema.type;
    const data: any[] = [];

    // Pie charts use instant query values (last value in series)
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const value = parseFloat(getInstantValue(seriesData.values));

        data.push({
          name: seriesData.name,
          value,
        });

        extras.legends.push(seriesData.name);
      });
    });

    const series = [{
      type: "pie",

      // Donut = pie with inner radius
      radius: chartType === "donut" ? ["40%", "70%"] : "70%",

      data,

      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: "rgba(0, 0, 0, 0.5)",
        },
      },

      label: {
        formatter: "{b}: {d}%",  // {b} = name, {d} = percentage
      },
    }];

    return {
      series,
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
      },
      legend: {
        orient: "vertical",
        left: "left",
      },
    };
  }
}
```

#### 3.4.3 Table Converter

**File:** `src/utils/dashboard/promql/convertPromQLTableChart.ts`

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { getUnitValue, formatUnitValue } from "../../convertDataIntoUnitValue";

export class TableConverter implements PromQLChartConverter {
  supportedTypes = ["table"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ) {
    // Get selected aggregations (default: ['last'])
    const aggregations = panelSchema.config?.table_aggregations || ['last'];

    // Build columns from metric labels + aggregated value columns
    const columns = this.buildColumns(processedData, panelSchema, aggregations);

    // Build rows from series data with aggregated values
    const rows = this.buildRows(processedData, panelSchema, aggregations);

    return {
      columns,
      rows,
    };
  }

  private buildColumns(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    aggregations: string[],
  ): any[] {
    // Collect all unique label keys
    const labelKeys = new Set<string>();

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        Object.keys(seriesData.metric).forEach((key) => {
          labelKeys.add(key);
        });
      });
    });

    // Create columns for each label
    const columns = Array.from(labelKeys).map((key) => ({
      name: key,
      field: key,
      label: key,
      align: "left",
      sortable: true,
    }));

    // Add value columns for each selected aggregation
    aggregations.forEach((agg) => {
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
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          );
          return formatUnitValue(unitValue);
        },
      });
    });

    // Add timestamp column (if time-series data)
    if (processedData[0]?.timestamps.length > 1) {
      columns.unshift({
        name: "timestamp",
        field: "timestamp",
        label: "Timestamp",
        align: "left",
        sortable: true,
      });
    }

    return columns;
  }

  private buildRows(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    aggregations: string[],
  ): any[] {
    const rows: any[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const row: any = {
          ...seriesData.metric,
        };

        // Calculate each aggregation for the series
        aggregations.forEach((agg) => {
          const columnName = aggregations.length === 1 ? "value" : `value_${agg}`;
          row[columnName] = this.calculateAggregation(seriesData.values, agg);
        });

        rows.push(row);
      });
    });

    return rows;
  }

  /**
   * Calculate aggregation value for a series
   */
  private calculateAggregation(
    values: Array<[number, string]>,
    aggregation: string,
  ): number {
    if (!values || values.length === 0) return 0;

    const numericValues = values.map(([, val]) => parseFloat(val));

    switch (aggregation) {
      case "last":
        return numericValues[numericValues.length - 1];

      case "first":
        return numericValues[0];

      case "min":
        return Math.min(...numericValues);

      case "max":
        return Math.max(...numericValues);

      case "avg":
        return numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

      case "sum":
        return numericValues.reduce((a, b) => a + b, 0);

      case "count":
        return numericValues.length;

      case "range":
        return Math.max(...numericValues) - Math.min(...numericValues);

      case "diff":
        return numericValues[numericValues.length - 1] - numericValues[0];

      default:
        return numericValues[numericValues.length - 1]; // default to last
    }
  }
}
```

#### 3.4.4 Heatmap Converter

**File:** `src/utils/dashboard/promql/convertPromQLHeatmapChart.ts`

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";

export class HeatmapConverter implements PromQLChartConverter {
  supportedTypes = ["heatmap"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ) {
    // Heatmap requires 3D data: [x, y, value]
    // X-axis: timestamps
    // Y-axis: series names
    // Value: metric values

    const seriesNames: string[] = [];
    const data: any[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData, seriesIndex) => {
        seriesNames.push(seriesData.name);

        queryData.timestamps.forEach(([ts, formattedTs], timeIndex) => {
          const value = parseFloat(seriesData.data[ts] ?? "0");
          data.push([timeIndex, seriesIndex, value]);
        });
      });
    });

    const xAxisData = processedData[0]?.timestamps.map(([, formatted]) => formatted) || [];

    return {
      series: [{
        type: "heatmap",
        data,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      }],
      xAxis: {
        type: "category",
        data: xAxisData,
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: seriesNames,
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: this.calculateMax(data),
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: "0%",
      },
      tooltip: {
        position: "top",
        formatter: (params: any) => {
          const [timeIndex, seriesIndex, value] = params.data;
          return `${seriesNames[seriesIndex]}<br/>${xAxisData[timeIndex]}: ${value}`;
        },
      },
    };
  }

  private calculateMax(data: any[]): number {
    return Math.max(...data.map((d) => d[2]));
  }
}
```

#### 3.4.5 Horizontal Bar & Stacked Converters

**File:** `src/utils/dashboard/promql/convertPromQLBarChart.ts`

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { getInstantValue } from "./shared/dataProcessor";

export class BarConverter implements PromQLChartConverter {
  supportedTypes = ["h-bar", "stacked", "h-stacked"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
  ) {
    const chartType = panelSchema.type;
    const isHorizontal = chartType.startsWith("h-");
    const isStacked = chartType.includes("stacked");

    const series: any[] = [];
    const categories: string[] = [];

    // For stacked charts, we need multiple series
    // For non-stacked, we can have one series with multiple bars

    if (isStacked) {
      // Each series becomes a stack
      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          const data = queryData.timestamps.map(([ts, formatted]) => {
            const value = parseFloat(seriesData.data[ts] ?? "0");
            return value;
          });

          series.push({
            name: seriesData.name,
            type: "bar",
            stack: "total",
            data,
          });

          extras.legends.push(seriesData.name);
        });
      });

      // Categories are timestamps
      processedData[0]?.timestamps.forEach(([, formatted]) => {
        categories.push(formatted.toString());
      });
    } else {
      // Non-stacked: use instant values
      const data: number[] = [];

      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          const value = parseFloat(getInstantValue(seriesData.values));
          data.push(value);
          categories.push(seriesData.name);
        });
      });

      series.push({
        type: "bar",
        data,
      });
    }

    return {
      series,

      ...(isHorizontal
        ? {
            xAxis: { type: "value" },
            yAxis: { type: "category", data: categories },
          }
        : {
            xAxis: { type: "category", data: categories },
            yAxis: { type: "value" },
          }),

      grid: {
        left: isHorizontal ? "15%" : "3%",
        right: "4%",
        bottom: "10%",
        containLabel: true,
      },

      tooltip: {
        trigger: "axis",
        axisPointer: { type: isHorizontal ? "shadow" : "line" },
      },
    };
  }
}
```

---

### 3.5 Refactored Main Converter

**File:** `src/utils/dashboard/convertPromQLData.ts` (REFACTORED)

```typescript
import { convertPromQLChartData } from "./promql/convertPromQLChartData";

/**
 * LEGACY FUNCTION - Now delegates to modular converter
 *
 * This function is maintained for backwards compatibility.
 * All new development should use convertPromQLChartData directly.
 */
export const convertPromQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  annotations: any,
  metadata: any = null,
) => {
  // Delegate to new modular converter
  return await convertPromQLChartData(searchQueryData, {
    panelSchema,
    store,
    chartPanelRef,
    hoveredSeriesState,
    annotations,
    metadata,
  });
};
```

---

## 4. Implementation Plan

### 4.1 Phase 1: Foundation (Week 1)

**Tasks:**
1. Create `promql/` directory structure
2. Implement shared utilities:
   - `types.ts` - Type definitions
   - `dataProcessor.ts` - Common data processing
   - `legendBuilder.ts` - Extract legend logic
   - `axisBuilder.ts` - Extract axis logic
3. Create `convertPromQLChartData.ts` router
4. Write unit tests for shared utilities

**Deliverables:**
- `promql/shared/` modules with >80% test coverage
- Converter registry infrastructure

---

### 4.2 Phase 2: Extract Existing Charts (Week 2)

**Tasks:**
1. Implement `TimeSeriesConverter` (line, area, bar, scatter)
2. Implement `GaugeConverter`
3. Implement `MetricConverter`
4. Update `convertPromQLData.ts` to delegate to new system
5. Run regression tests on existing panels

**Deliverables:**
- Existing charts work identically via new system
- No breaking changes

---

### 4.3 Phase 3: New Chart Types (Week 3-4)

**Tasks:**
1. Implement `PieConverter` (pie, donut)
2. Implement `TableConverter` (table)
3. Implement `HeatmapConverter` (heatmap)
4. Implement `BarConverter` (h-bar, stacked, h-stacked)
5. Update `ChartSelection.vue` to enable new types for PromQL
6. Write integration tests for each new chart type

**Deliverables:**
- 7 new chart types supported for PromQL
- E2E tests pass

---

### 4.4 Phase 4: Advanced Charts (Week 5)

**Tasks:**
1. Implement `GeoConverter` (geomap with lat, lon, weight)
2. Implement `MapsConverter` (maps with name, value)
3. Add documentation for PromQL chart usage
4. Performance testing and optimization

**Deliverables:**
- All chart types supported
- Documentation updated
- Performance benchmarks

---

### 4.5 Phase 5: Polish & Release (Week 6)

**Tasks:**
1. Code review and refactoring
2. User acceptance testing
3. Migration guide for custom chart users
4. Release notes preparation

---

## 5. Testing Strategy

### 5.1 Unit Tests

```typescript
// Example: promql/shared/__tests__/dataProcessor.test.ts

describe("processPromQLData", () => {
  it("should collect all unique timestamps", () => {
    const input = [
      {
        data: {
          resultType: "matrix",
          result: [
            { metric: { job: "api" }, values: [[1000, "10"], [2000, "20"]] },
            { metric: { job: "web" }, values: [[1000, "5"], [3000, "15"]] },
          ],
        },
      },
    ];

    const result = await processPromQLData(input, mockPanelSchema, mockStore);

    expect(result[0].timestamps).toHaveLength(3);
    expect(result[0].timestamps.map(t => t[0])).toEqual([1000, 2000, 3000]);
  });

  it("should apply series limit", () => {
    // ... test with 150 series, limit to 100
  });

  it("should handle vector queries", () => {
    // ... test instant queries
  });
});
```

### 5.2 Integration Tests

```typescript
// Example: promql/__tests__/integration.test.ts

describe("PromQL Chart Conversion Integration", () => {
  it("should convert line chart end-to-end", async () => {
    const mockResponse = fetchMockPromQLResponse("line_chart.json");
    const result = await convertPromQLChartData(mockResponse, mockContext);

    expect(result.options.series).toHaveLength(3);
    expect(result.options.series[0].type).toBe("line");
    expect(result.options.xAxis.type).toBe("time");
  });

  it("should convert pie chart with instant query", async () => {
    // ... test pie chart conversion
  });

  it("should convert table with multiple aggregations", async () => {
    const mockResponse = fetchMockPromQLResponse("table_chart.json");
    const mockContext = {
      panelSchema: {
        type: "table",
        config: {
          table_aggregations: ["last", "sum", "avg"],
        },
      },
      store: mockStore,
    };

    const result = await convertPromQLChartData(mockResponse, mockContext);

    // Verify columns are created for each aggregation
    expect(result.options.columns).toContainEqual(
      expect.objectContaining({ field: "value_last" })
    );
    expect(result.options.columns).toContainEqual(
      expect.objectContaining({ field: "value_sum" })
    );
    expect(result.options.columns).toContainEqual(
      expect.objectContaining({ field: "value_avg" })
    );

    // Verify rows have aggregated values
    expect(result.options.rows[0]).toHaveProperty("value_last");
    expect(result.options.rows[0]).toHaveProperty("value_sum");
    expect(result.options.rows[0]).toHaveProperty("value_avg");
  });

  it("should convert table with single aggregation using simple 'value' column", async () => {
    const mockResponse = fetchMockPromQLResponse("table_chart.json");
    const mockContext = {
      panelSchema: {
        type: "table",
        config: {
          table_aggregations: ["last"],
        },
      },
      store: mockStore,
    };

    const result = await convertPromQLChartData(mockResponse, mockContext);

    // Verify single aggregation uses 'value' column name
    expect(result.options.columns).toContainEqual(
      expect.objectContaining({ field: "value" })
    );
    expect(result.options.rows[0]).toHaveProperty("value");
  });

  it("should handle empty results gracefully", async () => {
    // ... test edge case
  });
});
```

### 5.3 E2E Tests

Use Playwright to test actual panel rendering:

```typescript
test("PromQL pie chart renders correctly", async ({ page }) => {
  await page.goto("/dashboards/test-promql-pie");

  await expect(page.locator(".echarts-pie-chart")).toBeVisible();
  await expect(page.locator(".legend-item")).toHaveCount(5);

  // Verify data is correct
  const tooltipContent = await page.locator(".echarts-tooltip").textContent();
  expect(tooltipContent).toContain("api: 42 (35%)");
});

test("PromQL table with multi-aggregation renders correctly", async ({ page }) => {
  await page.goto("/dashboards/test-promql-table");

  // Verify table is visible
  await expect(page.locator(".q-table")).toBeVisible();

  // Verify aggregation columns are present
  await expect(page.locator("th:has-text('Value (last)')")).toBeVisible();
  await expect(page.locator("th:has-text('Value (sum)')")).toBeVisible();
  await expect(page.locator("th:has-text('Value (avg)')")).toBeVisible();

  // Verify data in first row
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow.locator("td").nth(2)).toContainText("42.5"); // value_last
  await expect(firstRow.locator("td").nth(3)).toContainText("2550.0"); // value_sum
  await expect(firstRow.locator("td").nth(4)).toContainText("42.5"); // value_avg
});

test("PromQL table with single aggregation uses 'value' column", async ({ page }) => {
  await page.goto("/dashboards/test-promql-table-single");

  // Verify table is visible
  await expect(page.locator(".q-table")).toBeVisible();

  // Verify only 'Value' column (not value_last)
  await expect(page.locator("th:has-text('Value')")).toBeVisible();
  await expect(page.locator("th:has-text('Value (last)')")).not.toBeVisible();
});
```

---

## 6. Multi-Query Support

### 6.1 Overview

PromQL panels **support multiple queries** that are combined into a single visualization. This feature allows:
- Overlaying multiple metrics on one chart
- Comparing data from different time ranges
- Combining instant and range queries
- Using different legend templates per query

### 6.2 Multi-Query Data Flow

**Input Structure:**
```typescript
searchQueryData = [
  {
    // Query 1 results
    resultType: "matrix",
    result: [
      { metric: { job: "api" }, values: [[1000, "10"], [2000, "20"]] },
      { metric: { job: "web" }, values: [[1000, "5"], [2000, "15"]] },
    ],
  },
  {
    // Query 2 results
    resultType: "matrix",
    result: [
      { metric: { instance: "server1" }, values: [[1000, "100"], [2000, "200"]] },
    ],
  },
];

panelSchema.queries = [
  {
    query: "rate(http_requests[5m])",
    config: {
      promql_legend: "{job}",  // Query 1 legend template
      promql_series_limit: 50,
    }
  },
  {
    query: "rate(cpu_usage[5m])",
    config: {
      promql_legend: "{instance}",  // Query 2 legend template
      promql_series_limit: 50,
    }
  },
];
```

### 6.3 Multi-Query Handling in Converters

**Shared Timestamp Alignment:**
All queries share a common timeline. The `processPromQLData` function merges all unique timestamps:

```typescript
// Collect timestamps from ALL queries
const allTimestamps = new Set();
searchQueryData.forEach((queryData) => {
  queryData.result.forEach((metric) => {
    metric.values.forEach(([ts, val]) => {
      allTimestamps.add(ts);  // Merge timestamps
    });
  });
});

// Result: [1000, 2000, 3000] - sorted union of all timestamps
```

**Per-Query Configuration:**
Each query maintains its own configuration:

```typescript
processedData.forEach((queryData) => {
  // queryData.queryIndex = 0, 1, 2, ...
  // queryData.queryConfig = panelSchema.queries[index].config

  queryData.series.forEach((seriesData) => {
    // Use query-specific legend template
    const legendTemplate = queryData.queryConfig.promql_legend;

    // Use query-specific colors
    const customColor = panelSchema.queries[queryData.queryIndex]
      ?.customQuery?.fields?.[seriesIndex]?.color;
  });
});
```

**Series Limiting:**
When multiple queries are present, the series limit is **divided equally**:

```typescript
const maxSeries = 100;  // Global limit
const numberOfQueries = 3;  // User has 3 queries

const limitPerQuery = Math.floor(maxSeries / numberOfQueries);  // 33 series per query
```

### 6.4 Multi-Query Examples by Chart Type

#### Time-Series Charts (Line, Area, Bar)

**Use Case:** Compare API requests vs database queries

```typescript
// Query 1: rate(api_requests[5m])
// Query 2: rate(db_queries[5m])

// Result: Both series plotted on same time axis
series = [
  { name: "api", data: [[t1, v1], [t2, v2], ...] },      // From Query 1
  { name: "mysql", data: [[t1, v1], [t2, v2], ...] },    // From Query 2
  { name: "postgres", data: [[t1, v1], [t2, v2], ...] }, // From Query 2
];
```

#### Pie/Donut Charts

**Use Case:** Aggregate multiple metric types

```typescript
// Query 1: sum by (region) (sales_us)
// Query 2: sum by (region) (sales_eu)

// Result: Combined pie chart
data = [
  { name: "US-East", value: 100 },   // From Query 1
  { name: "US-West", value: 200 },   // From Query 1
  { name: "EU-North", value: 150 },  // From Query 2
  { name: "EU-South", value: 180 },  // From Query 2
];
```

#### Table Charts

**Use Case:** Show metrics from different sources

```typescript
// Query 1: up{job="api"}
// Query 2: up{job="db"}

// Result: Combined table
rows = [
  { job: "api", instance: "10.0.0.1", value: 1 },   // From Query 1
  { job: "api", instance: "10.0.0.2", value: 1 },   // From Query 1
  { job: "db", instance: "10.0.0.3", value: 0 },    // From Query 2
];
```

#### Gauge Charts

**Use Case:** Show multiple gauges side-by-side

```typescript
// Query 1: avg(cpu_usage)
// Query 2: avg(memory_usage)
// Query 3: avg(disk_usage)

// Result: 3 gauges in grid layout
series = [
  { type: "gauge", data: [{ value: 75, name: "CPU" }], gridIndex: 0 },
  { type: "gauge", data: [{ value: 60, name: "Memory" }], gridIndex: 1 },
  { type: "gauge", data: [{ value: 40, name: "Disk" }], gridIndex: 2 },
];
```

#### Heatmap Charts

**Use Case:** Multiple heatmaps with different metrics

```typescript
// Query 1: rate(requests[5m])
// Query 2: rate(errors[5m])

// Result: All series shown in single heatmap
// Y-axis shows series from both queries
yAxis.data = [
  "requests: /api/users",    // From Query 1
  "requests: /api/orders",   // From Query 1
  "errors: /api/users",      // From Query 2
  "errors: /api/orders",     // From Query 2
];
```

### 6.5 Handling Query Mismatches

**Different Time Ranges:**
```typescript
// Query 1: rate(http_requests[5m])  - returns data every 15s
// Query 2: rate(http_requests[1m])  - returns data every 5s

// Solution: Null values filled for missing timestamps
series1.data = [[t0, 10], [t15, null], [t30, 20]];  // null at t15
series2.data = [[t0, 5], [t15, 6], [t30, 7]];       // has value at t15
```

**Different Result Types:**
```typescript
// Query 1: matrix (range query)
// Query 2: vector (instant query)

// Solution: Treat vector as single-point time series
Query1 → [[t1, v1], [t2, v2], [t3, v3]]
Query2 → [[t_now, v_instant]]
```

**Empty Results:**
```typescript
// Query 1: Returns data
// Query 2: Returns empty result

// Solution: Skip empty queries
processedData = processedData.filter(q => q.series.length > 0);
```

### 6.6 Implementation in Converters

Each converter must handle multi-query data:

```typescript
export class PieConverter implements PromQLChartConverter {
  convert(processedData: ProcessedPromQLData[], ...) {
    const data: any[] = [];

    // Iterate through ALL queries
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        data.push({
          name: seriesData.name,  // Already has query-specific legend
          value: getInstantValue(seriesData.values),
        });
      });
    });

    return { series: [{ type: "pie", data }] };
  }
}
```

### 6.7 Testing Multi-Query Support

**Test Cases:**

1. **Two queries with overlapping timestamps**
   - Verify series from both queries appear
   - Verify timestamps are merged correctly

2. **Three queries with different series counts**
   - Verify series limit is divided equally
   - Verify warning appears if total exceeds limit

3. **One empty query + one with data**
   - Verify chart renders with non-empty data
   - Verify no errors for empty query

4. **Different legend templates per query**
   - Verify each query uses its own template
   - Verify series names don't collide

5. **Mixed result types (matrix + vector)**
   - Verify both are handled correctly
   - Verify instant query shows as single point

---

## 7. Data Format Requirements

### 7.1 Chart Type Compatibility Matrix

| Chart Type | PromQL Query Type | Data Requirements | Supported | Multi-Query |
|------------|-------------------|-------------------|-----------|-------------|
| line | range | Time-series values | ✅ Current | ✅ Yes |
| area | range | Time-series values | ✅ Current | ✅ Yes |
| area-stacked | range | Time-series values | ✅ Current | ✅ Yes |
| bar | range | Time-series values | ✅ Current | ✅ Yes |
| scatter | range | Time-series values | ✅ Current | ✅ Yes |
| gauge | instant or range | Single value per series | ✅ Current | ✅ Yes |
| metric | instant or range | Single value per series | ✅ Current | ✅ Yes |
| **pie** | instant or range | Single value per series | 🆕 New | ✅ Yes |
| **donut** | instant or range | Single value per series | 🆕 New | ✅ Yes |
| **table** | instant or range | All labels + values | 🆕 New | ✅ Yes |
| **h-bar** | instant | Single value per series | 🆕 New | ✅ Yes |
| **stacked** | range | Time-series values | 🆕 New | ✅ Yes |
| **h-stacked** | range | Time-series values | 🆕 New | ✅ Yes |
| **heatmap** | range | Time-series values (matrix) | 🆕 New | ✅ Yes |
| **geomap** | instant | Geo coordinates (lat, lon, weight) | 🆕 New | ✅ Yes |
| **maps** | instant | Location name and value | 🆕 New | ✅ Yes |

### 7.2 Example PromQL Queries

**For Pie/Donut:**
```promql
# Instant query - current values
sum by (job) (up)

# Result: job="api" -> 5, job="web" -> 3, job="db" -> 2
```

**For Table:**
```promql
# Range query to show metrics over time with aggregations
rate(http_requests_total[5m])

# With table_aggregations: ['last', 'sum', 'avg', 'max']
# Result table will show:
# job  | instance | value_last | value_sum | value_avg | value_max
# api  | server1  | 42.5       | 2550.0    | 42.5      | 45.2
# web  | server2  | 31.2       | 1872.0    | 31.2      | 33.8
# db   | server3  | 15.6       | 936.0     | 15.6      | 17.1
```

**For Table (Single Aggregation):**
```promql
# Instant query with single aggregation
up

# With table_aggregations: ['last'] (or default)
# Result table will show:
# instance    | job | value
# 10.0.0.1    | api | 1
# 10.0.0.2    | web | 1
# 10.0.0.3    | db  | 0
```

**For Heatmap:**
```promql
# Time-series of multiple series
rate(http_requests_total[5m])

# Shows request rate over time for each endpoint
```

**For GeoMap:**
```promql
# Requires custom labels with lat, lon, and weight
node_info{lat=~".*", lon=~".*"}

# Example: lat="37.7749", lon="-122.4194", weight=100
```

**For Maps:**
```promql
# Requires location name and value
sum by (country) (requests_total)

# Example: name="United States", value=5000
# Or: name="Germany", value=3000
```

---

## 8. UI Changes

### 8.1 Chart Selection Component

**File:** `src/components/dashboards/addPanel/ChartSelection.vue`

**Current Code (lines 33-43):**
```vue
:disable="
  (promqlMode &&
    item.id != 'line' &&
    item.id != 'area' &&
    item.id != 'bar' &&
    item.id != 'scatter' &&
    item.id != 'area-stacked' &&
    item.id != 'metric' &&
    item.id != 'gauge' &&
    item.id != 'html' &&
    item.id != 'markdown' &&
    item.id != 'custom_chart')
"
```

**Updated Code:**
```vue
:disable="promqlMode && !isChartTypeSupported(item.id)"
```

**New Method:**
```typescript
const PROMQL_SUPPORTED_CHARTS = [
  // Time-series
  'line', 'area', 'area-stacked', 'bar', 'scatter',
  // Single value
  'gauge', 'metric',
  // Aggregated
  'pie', 'donut',
  // Data display
  'table', 'heatmap',
  // Bar variants
  'h-bar', 'stacked', 'h-stacked',
  // Geo & Maps
  'geomap', 'maps',
  // Static
  'html', 'markdown', 'custom_chart',
];

function isChartTypeSupported(chartType: string): boolean {
  return PROMQL_SUPPORTED_CHARTS.includes(chartType);
}
```

### 8.2 Table Aggregation Configuration

**File:** `src/components/dashboards/addPanel/PanelConfig.vue` (or similar)

Add a multi-select dropdown for table aggregation options:

```vue
<template>
  <!-- Show only when chart type is 'table' -->
  <q-select
    v-if="panelSchema.type === 'table'"
    v-model="panelSchema.config.table_aggregations"
    :options="aggregationOptions"
    label="Table Aggregations"
    multiple
    chips
    dense
    outlined
    hint="Select aggregation functions to display as columns"
    class="q-mb-md"
  >
    <template v-slot:hint>
      Each aggregation creates a column: value_last, value_sum, etc.
    </template>
  </q-select>
</template>

<script>
const aggregationOptions = [
  { label: 'Last', value: 'last' },
  { label: 'First', value: 'first' },
  { label: 'Min', value: 'min' },
  { label: 'Max', value: 'max' },
  { label: 'Average', value: 'avg' },
  { label: 'Sum', value: 'sum' },
  { label: 'Count', value: 'count' },
  { label: 'Range (Max-Min)', value: 'range' },
  { label: 'Diff (Last-First)', value: 'diff' },
];
</script>
```

**Example Output:**

If user selects `['last', 'sum', 'avg']`, the table will show:

| job | instance | value_last | value_sum | value_avg |
|-----|----------|------------|-----------|-----------|
| api | server1  | 42.5       | 425.0     | 42.5      |
| web | server2  | 31.2       | 312.0     | 31.2      |

If user selects only `['last']`, the table will show:

| job | instance | value |
|-----|----------|-------|
| api | server1  | 42.5  |
| web | server2  | 31.2  |

### 8.3 Query Configuration Hints

Add helper text in the query editor when specific chart types are selected:

```vue
<!-- In QueryEditor.vue -->
<q-banner v-if="showPromQLHint" class="bg-info text-white">
  <template v-slot:avatar>
    <q-icon name="info" />
  </template>
  {{ getPromQLHint() }}
</q-banner>
```

**Hints:**
- **Pie/Donut:** "Use instant queries or the latest value from range queries will be used"
- **Table:** "All metric labels will be displayed as columns. Select aggregations to calculate multiple values per metric."
- **Heatmap:** "Use range queries with multiple series for best results"
- **GeoMap:** "Ensure metrics have 'lat', 'lon', and 'weight' labels"
- **Maps:** "Ensure metrics have 'name' (location name) and 'value' labels"

---

## 9. Migration Strategy

### 9.1 Backwards Compatibility

All existing panels will continue to work without changes:

1. **Function Signature Unchanged:**
   - `convertPromQLData()` maintains same parameters
   - Return format stays identical

2. **Delegation Pattern:**
   ```typescript
   // Old code path (still works)
   convertPromQLData(schema, data, ...)
   // → internally calls →
   convertPromQLChartData(data, context)
   ```

3. **Gradual Adoption:**
   - Phase 1: Old and new systems coexist
   - Phase 2: New system becomes primary
   - Phase 3: Old code marked deprecated
   - Phase 4: Old code removed (after 2-3 releases)

### 8.2 Custom Chart Migration

Users with custom JavaScript charts will need to update if they were relying on undocumented behavior.

**Migration Guide:**

```markdown
## Custom Chart Migration for PromQL

### Before (v1.x):
Your custom chart received raw PromQL response:
```javascript
// data[0].data.result[0].values = [[ts, val], ...]
```

### After (v2.0):
Data structure remains the same, no changes needed unless you were using internal utilities.

### If Using convertPromQLDataForCustomChart.ts:
This file never existed in the codebase. If your documentation references it, use the new converters:

```javascript
import { processPromQLData } from "@/utils/dashboard/promql/shared/dataProcessor";

// Your custom logic here
```
```

---

## 10. Performance Considerations

### 10.1 Optimizations

1. **Lazy Loading:**
   ```typescript
   // Only load converters when needed
   const converters = {
     pie: () => import("./convertPromQLPieChart"),
     table: () => import("./convertPromQLTableChart"),
     // ...
   };
   ```

2. **Data Caching:**
   - Cache processed timestamps (shared across queries)
   - Memoize legend names
   - Reuse series color calculations

3. **Series Limiting:**
   - Default: 100 series
   - Configurable via panel settings
   - Warning when approaching limit

4. **Memory Management:**
   - Use Map instead of Object for large datasets
   - Clear old data when panel updates
   - Implement virtual scrolling for tables with >1000 rows

### 9.2 Benchmarks

Target performance metrics:

| Chart Type | Series Count | Data Points | Load Time |
|------------|--------------|-------------|-----------|
| Line | 10 | 1000 | <100ms |
| Line | 100 | 1000 | <500ms |
| Table | 50 | 5000 rows | <300ms |
| Heatmap | 20 | 2000 | <400ms |
| Pie | 50 slices | N/A | <50ms |

---

## 11. Documentation Updates

### 11.1 User Documentation

**File:** `docs/user-guide/promql-charts.md`

```markdown
# PromQL Chart Types

OpenObserve supports all chart types with PromQL queries:

## Time-Series Charts
- Line, Area, Bar, Scatter
- Use range queries: `rate(http_requests[5m])`

## Single-Value Charts
- Gauge, Metric
- Use instant queries: `up`

## Aggregated Charts
- **Pie, Donut** 🆕
  - Shows distribution of instant query values
  - Example: `sum by (job) (up)`

## Data Display Charts
- **Table** 🆕
  - Shows all metrics with labels as columns
  - Example: `node_info`

- **Heatmap** 🆕
  - Shows value intensity over time
  - Example: `rate(requests[5m])`

## Geo & Map Charts
- **GeoMap** 🆕
  - Shows data on geographical coordinates
  - Requires lat, lon, weight labels
  - Example: `node_info{lat=~".*", lon=~".*"}`

- **Maps** 🆕
  - Shows data by location name
  - Requires name (location) and value
  - Example: `sum by (country) (requests_total)`

...
```

### 10.2 Developer Documentation

**File:** `docs/developer-guide/adding-chart-converters.md`

```markdown
# Adding New PromQL Chart Converters

## Step 1: Implement PromQLChartConverter

Create a new file in `src/utils/dashboard/promql/`:

```typescript
import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";

export class MyChartConverter implements PromQLChartConverter {
  supportedTypes = ["my-chart"];

  convert(processedData, panelSchema, store, extras) {
    // Your conversion logic
    return {
      series: [...],
      // Other ECharts options
    };
  }
}
```

## Step 2: Register Converter

Add to `convertPromQLChartData.ts`:

```typescript
import { MyChartConverter } from "./convertPromQLMyChart";

const CONVERTER_REGISTRY = [
  // ... existing converters
  new MyChartConverter(),
];
```

## Step 3: Enable in UI

Update `ChartSelection.vue`:

```typescript
const PROMQL_SUPPORTED_CHARTS = [
  // ... existing types
  'my-chart',
];
```

...
```

---

## 12. Risk Analysis

### 12.1 Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking changes to existing panels | High | Low | Comprehensive regression testing |
| Performance degradation | Medium | Medium | Benchmarking, lazy loading |
| User confusion with new chart types | Low | High | Documentation, examples, hints |
| Incomplete data for advanced charts | Medium | High | Validation, helpful error messages |

### 11.2 Rollback Plan

If issues are discovered post-release:

1. **Feature Flag:**
   ```typescript
   const USE_NEW_CONVERTER = store.state.featureFlags.promqlConverter;

   if (USE_NEW_CONVERTER) {
     return convertPromQLChartData(...);
   } else {
     return legacyConvertPromQLData(...);
   }
   ```

2. **Gradual Rollout:**
   - Enable for 10% of users (canary)
   - Monitor error rates
   - Roll out to 50%, then 100%

3. **Quick Disable:**
   - Admin can disable via settings
   - Automatically reverts to old system

---

## 13. Success Metrics

### 13.1 Quantitative

- ✅ 100% of chart types supported for PromQL
- ✅ <1% increase in p95 load time
- ✅ Zero regression bugs in existing charts
- ✅ >80% code coverage for new modules

### 12.2 Qualitative

- ✅ Positive user feedback on new chart types
- ✅ Reduced GitHub issues about chart limitations
- ✅ Developer velocity improves (easier to add new charts)

---

## 14. Future Enhancements

### 14.1 Post-Launch Features

1. **Chart Type Recommendations:**
   - Analyze query result structure
   - Suggest optimal chart type
   - Example: "This query has geo labels, try GeoMap!"

2. **Smart Defaults:**
   - Auto-configure legend templates based on labels
   - Suggest series limits based on cardinality
   - Optimize axis ranges

3. **Query Templates:**
   - Pre-built queries for common use cases
   - One-click examples per chart type

4. **Advanced Transformations:**
   - Aggregations (sum, avg, percentile)
   - Filtering (top N, bottom N)
   - Calculations (rate of change, moving average)

---

## 15. Appendix

### 15.1 File Size Estimates

| File | Current | Estimated (Refactored) |
|------|---------|------------------------|
| convertPromQLData.ts | 1,190 lines | ~100 lines (delegator) |
| convertPromQLChartData.ts | N/A | ~150 lines (router) |
| convertPromQLTimeSeriesChart.ts | N/A | ~200 lines |
| convertPromQLPieChart.ts | N/A | ~80 lines |
| convertPromQLTableChart.ts | N/A | ~150 lines |
| convertPromQLHeatmapChart.ts | N/A | ~120 lines |
| convertPromQLBarChart.ts | N/A | ~180 lines |
| convertPromQLGaugeChart.ts | N/A | ~150 lines |
| convertPromQLMetricChart.ts | N/A | ~100 lines |
| shared/dataProcessor.ts | N/A | ~250 lines |
| shared/legendBuilder.ts | N/A | ~80 lines |
| shared/axisBuilder.ts | N/A | ~120 lines |
| **Total** | **1,190 lines** | **~1,680 lines** (+41%) |

**Note:** Increase in total lines is due to:
- Modular structure (more files)
- Type definitions (~150 lines)
- Additional chart types (~500 lines)
- Better separation of concerns

### 14.2 Related Files Requiring Updates

1. **ChartSelection.vue** - Update disable logic
2. **QueryEditor.vue** - Add hints for chart-specific requirements
3. **PanelSchemaRenderer.vue** - No changes (uses same interface)
4. **convertPanelData.ts** - No changes (delegates to convertPromQLData)

### 14.3 Dependencies

No new npm dependencies required. All converters use existing libraries:
- ECharts (already installed)
- date-fns-tz (already installed)
- Quasar (already installed)

---

## 16. Conclusion

This design provides a scalable, maintainable solution for extending PromQL chart support while minimizing changes to existing code. The modular architecture makes it easy to add new chart types in the future, and the comprehensive testing strategy ensures reliability.

**Key Benefits:**
1. ✅ Minimal changes to `convertPromQLData.ts` (becomes a thin delegator)
2. ✅ Common utilities shared across all converters
3. ✅ Clear separation of concerns per chart type
4. ✅ Easy to test and maintain
5. ✅ Supports all chart types with proper data transformations
6. ✅ Backwards compatible with existing panels
7. ✅ **Full multi-query support preserved** across all chart types

**Next Steps:**
1. Review and approve this design spec
2. Create GitHub issues for each phase
3. Assign developers to implementation tasks
4. Set up testing infrastructure
5. Begin Phase 1 implementation

---

**Approval Sign-off:**

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Tech Lead | | | |
| Frontend Lead | | | |
| QA Lead | | | |

---

**End of Design Specification**