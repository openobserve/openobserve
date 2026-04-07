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

import {
  ref,
  computed,
  watch,
  nextTick,
  onBeforeMount,
  onUnmounted,
} from "vue";
import {
  getAllDashboardsByFolderId,
  getDashboard,
  getFoldersList,
} from "@/utils/commons";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import { getUTCTimestampFromZonedTimestamp } from "@/utils/dashboard/dateTimeUtils";
import { normalizeVariableSyntax } from "@/utils/dashboard/variables/variablesUtils";
import searchService from "@/services/search";

export function usePanelDrilldown({
  panelSchema,
  variablesData,
  selectedTimeObj,
  metadata,
  data,
  panelData,
  filteredData,
  resultMetaData,
  store,
  route,
  router,
  emit,
  allowAnnotationsAdd,
  isAddAnnotationMode,
  editAnnotation,
  handleAddAnnotation,
  chartPanelRef,
  drilldownPopUpRef,
  annotationPopupRef,
  selectedAnnotationData,
  isCursorOverPanel,
  showErrorNotification,
}: {
  panelSchema: any;
  variablesData: any;
  selectedTimeObj: any;
  metadata: any;
  data: any;
  panelData: any;
  filteredData: any;
  resultMetaData: any;
  store: any;
  route: any;
  router: any;
  emit: any;
  allowAnnotationsAdd: any;
  isAddAnnotationMode: any;
  editAnnotation: any;
  handleAddAnnotation: any;
  chartPanelRef: any;
  drilldownPopUpRef: any;
  annotationPopupRef: any;
  selectedAnnotationData: any;
  isCursorOverPanel: any;
  showErrorNotification: any;
}) {
  // Cross-linking: store cross-links from result_schema response
  const crossLinksData: any = ref({ stream_links: [], org_links: [] });

  const drilldownArray: any = ref([]);

  // need to save click event params, to open drilldown
  let drilldownParams: any = [];

  let parser: any;

  const importSqlParser = async () => {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();
  };

  onBeforeMount(async () => {
    await importSqlParser();
  });

  onUnmounted(() => {
    parser = null;
  });

  // get interval from resultMetaData if it exists
  const interval = computed(
    () => resultMetaData?.value?.[0]?.[0]?.histogram_interval,
  );

  // get interval in micro seconds
  const intervalMicro = computed(() => interval.value * 1000 * 1000);

  watch(
    () => resultMetaData.value,
    (newVal) => {
      emit("result-metadata-update", newVal);
    },
    { deep: true },
  );

  // drilldown
  const replacePlaceholders = (str: any, obj: any) => {
    str = normalizeVariableSyntax(str);
    // if the str is same as the key, return it's value(it can be an string or array).
    for (const key in obj) {
      // ${varName} == str or {{varName}} == str
      if (`\$\{${key}\}` == str || `{{${key}}}` == str) {
        return obj[key];
      }
    }

    // Replace both {{key}} and ${key} patterns
    return str.replace(/(?:\{\{([^}]+)\}\})|(?:\$\{([^}]+)\})/g, function (_: any, mustacheKey: any, dollarKey: any) {
      const key = (mustacheKey || dollarKey).trim();
      // Split the key into parts by either a dot or a ["xyz"] pattern and filter out empty strings
      let parts = key.split(/\.|\["(.*?)"\]/).filter(Boolean);

      let value = obj;
      for (let part of parts) {
        if (value && part in value) {
          value = value[part];
        } else {
          return mustacheKey ? "{{" + key + "}}" : "${" + key + "}";
        }
      }
      return value;
    });
  };

  const replaceDrilldownToLogs = (str: any, obj: any) => {
    str = normalizeVariableSyntax(str);
    // If str is exactly equal to a key, return its value directly
    for (const key in obj) {
      if (`\$\{${key}\}` === str || `{{${key}}}` === str) {
        let value = obj[key];

        // Ensure string values are wrapped in quotes
        return typeof value === "string" ? `'${value}'` : value;
      }
    }

    // Replace both {{key}} and ${key} patterns
    return str.replace(/(?:\{\{([^}]+)\}\})|(?:\$\{([^}]+)\})/g, function (_: any, mustacheKey: any, dollarKey: any) {
      const key = (mustacheKey || dollarKey).trim();
      // Split the key into parts by either a dot or a ["xyz"] pattern and filter out empty strings
      let parts = key.split(/\.|\["(.*?)"\]/).filter(Boolean);

      let value = obj;
      for (let part of parts) {
        if (value && part in value) {
          value = value[part];
        } else {
          return mustacheKey ? "{{" + key + "}}" : "${" + key + "}"; // Keep the placeholder if the key is not found
        }
      }

      // Ensure string values are wrapped in quotes
      return typeof value === "string" ? `'${value}'` : value;
    });
  };

  // get offset from parent
  function getOffsetFromParent(parent: any, child: any) {
    const parentRect = parent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();

    return {
      left: childRect.left - parentRect.left,
      top: childRect.top - parentRect.top,
    };
  }

  // Helper function to calculate popup offset
  const calculatePopupOffset = (
    offsetX: any,
    offsetY: any,
    popupRef: any,
    containerRef: any,
  ) => {
    let offSetValues = { left: offsetX, top: offsetY };

    if (popupRef.value) {
      if (
        offSetValues.top + popupRef.value.offsetHeight >
        containerRef.value.offsetHeight
      ) {
        offSetValues.top -= popupRef.value.offsetHeight;
      }
      if (
        offSetValues.left + popupRef.value.offsetWidth >
        containerRef.value.offsetWidth
      ) {
        offSetValues.left -= popupRef.value.offsetWidth;
      }
    }

    return offSetValues;
  };

  const getOriginalQueryAndStream = (queryDetails: any, metadata: any) => {
    const originalQuery = metadata?.value?.queries[0]?.query;
    const streamName = queryDetails?.queries[0]?.fields?.stream;

    if (!originalQuery || !streamName) {
      return null;
    }

    return { originalQuery, streamName };
  };

  const calculateTimeRange = (
    hoveredTimestamp: number | null,
    interval: number | undefined,
  ) => {
    if (interval && hoveredTimestamp) {
      const startTime = hoveredTimestamp; // hovertedTimestamp is in microseconds
      return {
        startTime,
        endTime: startTime + interval,
      };
    }
    return {
      startTime: selectedTimeObj.value.start_time.getTime(),
      endTime: selectedTimeObj.value.end_time.getTime(),
    };
  };

  const parseQuery = async (originalQuery: string, parser: any) => {
    try {
      return parser.astify(originalQuery);
    } catch (error) {
      return null;
    }
  };

  const buildWhereClause = (
    ast: any,
    breakdownColumn?: string,
    breakdownValue?: string,
  ): string => {
    let whereClause = ast?.where
      ? parser
          .sqlify({ type: "select", where: ast.where })
          .slice("SELECT".length)
      : "";

    if (breakdownColumn && breakdownValue) {
      const breakdownCondition = `${breakdownColumn} = '${breakdownValue}'`;
      whereClause += whereClause
        ? ` AND ${breakdownCondition}`
        : ` WHERE ${breakdownCondition}`;
    }

    return whereClause;
  };

  const replaceVariablesValue = (
    query: any,
    currentDependentVariablesData: any,
    panelSchema: any,
  ) => {
    // Normalize spaces inside variable syntax before replacement
    query = normalizeVariableSyntax(query);
    const queryType = panelSchema?.value?.queryType;
    currentDependentVariablesData?.forEach((variable: any) => {
      const variableName = `$${variable.name}`;
      const variableNameWithBrackets = `\${${variable.name}}`;

      let variableValue = "";
      if (Array.isArray(variable.value)) {
        const value = variable.value
          .map(
            (value: any) =>
              `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`,
          )
          .join(",");
        const possibleVariablesPlaceHolderTypes = [
          // Mustache forms
          {
            placeHolder: `{{${variable.name}:csv}}`,
            value: variable.value.join(","),
          },
          {
            placeHolder: `{{${variable.name}:pipe}}`,
            value: variable.value.join("|"),
          },
          {
            placeHolder: `{{${variable.name}:doublequote}}`,
            value: variable.value.map((value: any) => `"${value}"`).join(","),
          },
          {
            placeHolder: `{{${variable.name}:singlequote}}`,
            value: value,
          },
          {
            placeHolder: `{{${variable.name}}}`,
            value: queryType === "sql" ? value : variable.value.join("|"),
          },
          // Dollar-sign forms (existing)
          {
            placeHolder: `\${${variable.name}:csv}`,
            value: variable.value.join(","),
          },
          {
            placeHolder: `\${${variable.name}:pipe}`,
            value: variable.value.join("|"),
          },
          {
            placeHolder: `\${${variable.name}:doublequote}`,
            value: variable.value.map((value: any) => `"${value}"`).join(","),
          },
          {
            placeHolder: `\${${variable.name}:singlequote}`,
            value: value,
          },
          {
            placeHolder: `\${${variable.name}}`,
            value: queryType === "sql" ? value : variable.value.join("|"),
          },
          {
            placeHolder: `\$${variable.name}`,
            value: queryType === "sql" ? value : variable.value.join("|"),
          },
        ];

        possibleVariablesPlaceHolderTypes.forEach((placeHolderObj) => {
          // if (query.includes(placeHolderObj.placeHolder)) {
          //   metadata.push({
          //     type: "variable",
          //     name: variable.name,
          //     value: placeHolderObj.value,
          //   });
          // }
          query = query.replaceAll(
            placeHolderObj.placeHolder,
            placeHolderObj.value,
          );
        });
      } else {
        variableValue =
          variable.value === null
            ? ""
            : `${
                variable.escapeSingleQuotes
                  ? escapeSingleQuotes(variable.value)
                  : variable.value
              }`;
        // if (query.includes(variableName)) {
        //   metadata.push({
        //     type: "variable",
        //     name: variable.name,
        //     value: variable.value,
        //   });
        // }
        const mustachePlaceholder = `{{${variable.name}}}`;
        query = query.replaceAll(`{{${variable.name}:csv}}`, variableValue);
        query = query.replaceAll(`{{${variable.name}:pipe}}`, variableValue);
        query = query.replaceAll(`{{${variable.name}:doublequote}}`, `"${variableValue}"`);
        query = query.replaceAll(`{{${variable.name}:singlequote}}`, `'${variableValue}'`);
        query = query.replaceAll(mustachePlaceholder, variableValue);
        query = query.replaceAll(variableNameWithBrackets, variableValue);
        query = query.replaceAll(variableName, variableValue);
      }
    });

    return query;
  };

  const constructLogsUrl = (
    streamName: string,
    calculatedTimeRange: { startTime: number; endTime: number },
    encodedQuery: string,
    queryDetails: any,
    currentUrl: string,
  ) => {
    const logsUrl = new URL(currentUrl + "/logs");
    logsUrl.searchParams.set(
      "stream_type",
      queryDetails.queries[0]?.fields?.stream_type,
    );
    logsUrl.searchParams.set("stream", streamName);
    logsUrl.searchParams.set("from", calculatedTimeRange.startTime.toString());
    logsUrl.searchParams.set("to", calculatedTimeRange.endTime.toString());
    logsUrl.searchParams.set("sql_mode", "true");
    logsUrl.searchParams.set("query", encodedQuery);
    logsUrl.searchParams.set(
      "org_identifier",
      store.state.selectedOrganization.identifier,
    );
    if (store.state.zoConfig.quick_mode_enabled) {
      logsUrl.searchParams.set("quick_mode", "true");
    } else {
      logsUrl.searchParams.set("quick_mode", "false");
    }
    logsUrl.searchParams.set("show_histogram", "false");

    return logsUrl;
  };

  // Cross-linking: convert URL using fieldΓåÆalias mapping
  const crossLinkToDrilldownUrl = (
    url: string,
    fields: Array<{ name: string; alias?: string }>,
  ): string => {
    const aliasMap: Record<string, string> = {};
    for (const f of fields) {
      aliasMap[f.name] = f.alias || f.name;
    }
    return url.replace(/(?:\{\{\s*(\w+)\s*\}\})|(?:\$?\{\s*(\w+)\s*\})/g, (_match: string, mustacheField: string, dollarField: string) => {
      const fieldName = mustacheField || dollarField;
      const resolved = aliasMap[fieldName] || fieldName;
      return '${row.field["' + resolved + '"]}';
    });
  };

  // Cross-linking: merge stream + org links with field-level replacement
  const getCrossLinkDrilldownItems = (): any[] => {
    const { stream_links = [], org_links = [] } = crossLinksData.value || {};

    // Collect all fields covered by stream links
    const streamCoveredFields = new Set<string>();
    for (const link of stream_links) {
      for (const f of link.fields) {
        if (f.alias) streamCoveredFields.add(f.name);
      }
    }

    // Start with all stream links
    const result: any[] = stream_links.map((link: any) => ({
      name: link.name,
      type: "byUrl",
      targetBlank: true,
      data: {
        url: crossLinkToDrilldownUrl(link.url, link.fields),
        _rawUrl: link.url,
        _fields: link.fields,
      },
      _isCrossLink: true,
    }));

    // Add org links only if they have at least one matched field NOT covered by stream
    for (const link of org_links) {
      const matchedFields = link.fields.filter((f: any) => f.alias);
      const hasUncovered = matchedFields.some(
        (f: any) => !streamCoveredFields.has(f.name),
      );
      if (matchedFields.length > 0 && !hasUncovered) continue;

      result.push({
        name: link.name,
        type: "byUrl",
        targetBlank: true,
        data: {
          url: crossLinkToDrilldownUrl(link.url, link.fields),
          _rawUrl: link.url,
          _fields: link.fields,
        },
        _isCrossLink: true,
      });
    }

    return result;
  };

  const hidePopupsAndOverlays = () => {
    if (drilldownPopUpRef.value) {
      drilldownPopUpRef.value.style.display = "none";
    }
    if (annotationPopupRef.value) {
      annotationPopupRef.value.style.display = "none";
    }
    isCursorOverPanel.value = false;
  };

  const onChartClick = async (params: any, ...args: any) => {
    // Check if we have both drilldown and annotation at the same point
    const hasAnnotation =
      params?.componentType === "markLine" ||
      params?.componentType === "markArea";
    const hasDrilldown = panelSchema.value.config.drilldown?.length > 0;

    // If in annotation add mode, handle that first
    if (allowAnnotationsAdd.value) {
      if (isAddAnnotationMode.value) {
        if (hasAnnotation) {
          editAnnotation(params?.data?.annotationDetails);
        } else {
          handleAddAnnotation(
            params?.data?.[0] || params?.data?.time || params?.data?.name,
            null,
          );
        }
        return;
      }
    }

    // Store click parameters for drilldown (including cross-links)
    const crossLinkItems = getCrossLinkDrilldownItems();
    const shouldShowDrilldown = hasDrilldown || crossLinkItems.length > 0;

    if (shouldShowDrilldown) {
      drilldownParams = [params, args];
      const panelDrilldowns = panelSchema.value.config.drilldown ?? [];
      drilldownArray.value = [...panelDrilldowns, ...crossLinkItems];
    }

    // Calculate offset values based on chart type
    let offsetValues = { left: 0, top: 0 };
    if (panelSchema.value.type === "table") {
      offsetValues = getOffsetFromParent(chartPanelRef.value, params?.target);
      offsetValues.left += params?.offsetX;
      offsetValues.top += params?.offsetY;
    } else {
      offsetValues.left = params?.event?.offsetX;
      offsetValues.top = params?.event?.offsetY;
    }

    // Handle popup displays with priority
    if (shouldShowDrilldown) {
      // Show drilldown popup first
      drilldownPopUpRef.value.style.display = "block";
      await nextTick();

      const drilldownOffset = calculatePopupOffset(
        offsetValues.left,
        offsetValues.top,
        drilldownPopUpRef,
        chartPanelRef,
      );

      drilldownPopUpRef.value.style.top = drilldownOffset.top + 5 + "px";
      drilldownPopUpRef.value.style.left = drilldownOffset.left + 5 + "px";
    } else if (hasAnnotation) {
      // Only show annotation popup if there's no drilldown
      const description = params?.data?.annotationDetails?.text;
      if (description) {
        selectedAnnotationData.value = params?.data?.annotationDetails;
        annotationPopupRef.value.style.display = "block";

        await nextTick();

        const annotationOffset = calculatePopupOffset(
          offsetValues.left,
          offsetValues.top,
          annotationPopupRef,
          chartPanelRef,
        );

        annotationPopupRef.value.style.top = annotationOffset.top + 5 + "px";
        annotationPopupRef.value.style.left = annotationOffset.left + 5 + "px";
      }
    }

    // Hide popups if no content to display
    if (
      !shouldShowDrilldown &&
      (!hasAnnotation || !params?.data?.annotationDetails?.text)
    ) {
      hidePopupsAndOverlays();
    }
  };

  const openDrilldown = async (index: any) => {
    // hide the drilldown pop up
    hidePopupsAndOverlays();

    // Handle cross-link items (they exist in drilldownArray but not in panelSchema.config.drilldown)
    const drilldownItem = drilldownArray.value[index];
    if (drilldownItem?._isCrossLink) {
      try {
        const rawUrl = drilldownItem.data._rawUrl;
        const linkFields = drilldownItem.data._fields || [];

        // Find the first matching field from cross-link's fields array that has a value
        let fieldName = "";
        let fieldValue: any = "";

        if (panelSchema.value?.type === "table" && drilldownParams[1]?.[0]) {
          // Table: row data is directly available
          const rowData = drilldownParams[1][0];
          const panelFields: any = [
            ...(panelSchema.value.queries?.[0]?.fields?.x || []),
            ...(panelSchema.value.queries?.[0]?.fields?.y || []),
            ...(panelSchema.value.queries?.[0]?.fields?.z || []),
          ];
          for (const lf of linkFields) {
            const alias = lf.alias || lf.name;
            const pf = panelFields.find(
              (f: any) => f.alias === alias || f.label === lf.name,
            );
            const val = rowData[alias] ?? rowData[lf.name];
            if (val !== undefined && val !== null) {
              fieldName = lf.name;
              fieldValue = val;
              break;
            }
          }
        } else {
          // Non-table: find value from raw query data or chart click
          const chartType = panelSchema.value?.type;
          const isPieOrDonut = ["pie", "donut"].includes(chartType);
          const dataIndex = drilldownParams[0]?.dataIndex;
          const xAxisData = panelData.value?.options?.xAxis?.[0]?.data;

          // Build a record from raw data
          const record: Record<string, any> = {};
          const queryResult = data.value?.[0]?.result;
          const xFields = panelSchema.value?.queries?.[0]?.fields?.x || [];
          const breakdownFields =
            panelSchema.value?.queries?.[0]?.fields?.breakdown || [];

          let xAxisValue: any;
          if (isPieOrDonut) {
            xAxisValue = drilldownParams[0]?.name;
          } else if (chartType === "heatmap") {
            xAxisValue = drilldownParams[0]?.value?.[0];
          } else {
            xAxisValue = xAxisData?.[dataIndex];
          }
          const seriesName = isPieOrDonut
            ? drilldownParams[0]?.name
            : drilldownParams[0]?.seriesName;

          if (queryResult?.length > 0) {
            for (const row of queryResult) {
              let matches = true;
              if (xFields.length > 0 && xAxisValue !== undefined) {
                if (String(row[xFields[0].alias]) !== String(xAxisValue))
                  matches = false;
              }
              if (
                matches &&
                breakdownFields.length > 0 &&
                seriesName &&
                !isPieOrDonut
              ) {
                if (
                  String(row[breakdownFields[0].alias]) !== String(seriesName)
                )
                  matches = false;
              }
              if (matches) {
                Object.assign(record, row);
                break;
              }
            }
          }

          // Find first matching field with a value
          for (const lf of linkFields) {
            const alias = lf.alias || lf.name;
            const val = record[alias] ?? record[lf.name];
            if (val !== undefined && val !== null) {
              fieldName = lf.name;
              fieldValue = val;
              break;
            }
          }
        }

        // Get time range
        const startTime = selectedTimeObj?.value?.start_time
          ? new Date(selectedTimeObj.value.start_time.toISOString()).getTime()
          : 0;
        const endTime = selectedTimeObj?.value?.end_time
          ? new Date(selectedTimeObj.value.end_time.toISOString()).getTime()
          : 0;

        // Get query
        const currentQuery =
          metadata?.value?.queries?.[0]?.query ??
          panelSchema?.value?.queries?.[0]?.query ??
          "";

        // Resolve the 6 fixed variables
        const resolvedUrl = rawUrl
          .replace(
            /(?:\{\{field\.__name\}\})|(?:\$\{field\.__name\})/g,
            encodeURIComponent(String(fieldName)),
          )
          .replace(
            /(?:\{\{field\.__value\}\})|(?:\$\{field\.__value\})/g,
            encodeURIComponent(String(fieldValue)),
          )
          .replace(/(?:\{\{start_time\}\})|(?:\$\{start_time\})/g, String(startTime))
          .replace(/(?:\{\{end_time\}\})|(?:\$\{end_time\})/g, String(endTime))
          .replace(/(?:\{\{query\}\})|(?:\$\{query\})/g, encodeURIComponent(currentQuery))
          .replace(/(?:\{\{query_encoded\}\})|(?:\$\{query_encoded\})/g, b64EncodeUnicode(currentQuery));

        window.open(resolvedUrl, "_blank");
      } catch (error) {
        console.error("Failed to open cross-link:", error);
      }
      return;
    }

    // if panelSchema exists
    if (panelSchema.value) {
      // check if drilldown data exists
      if (
        !panelSchema.value.config.drilldown ||
        panelSchema.value.config.drilldown.length == 0
      ) {
        return;
      }

      // find drilldown data
      const drilldownData = panelSchema.value.config.drilldown[index];

      const navigateToLogs = async () => {
        const queryDetails = panelSchema.value;
        if (!queryDetails) {
          return;
        }

        const { originalQuery, streamName } =
          getOriginalQueryAndStream(queryDetails, metadata) || {};
        if (!originalQuery || !streamName) return;

        const hoveredTime = drilldownParams[0]?.value?.[0];
        const hoveredTimestamp = hoveredTime
          ? getUTCTimestampFromZonedTimestamp(hoveredTime, store.state.timezone)
          : null;
        const breakdown = queryDetails.queries[0].fields?.breakdown || [];

        const calculatedTimeRange = calculateTimeRange(
          hoveredTimestamp,
          intervalMicro.value,
        );

        let modifiedQuery = originalQuery;

        // Check if this is a PromQL query - if so, skip auto mode SQL parsing
        const isPromQLQuery = panelSchema.value.queryType === "promql";

        if (drilldownData.data.logsMode === "auto" && !isPromQLQuery) {
          if (!parser) {
            await importSqlParser();
          }
          const ast = await parseQuery(originalQuery, parser);

          if (!ast) return;

          const tableAliases = ast.from
            ?.filter((fromEntry: any) => fromEntry.as)
            .map((fromEntry: any) => fromEntry.as);

          const aliasClause = tableAliases?.length
            ? ` AS ${tableAliases.join(", ")}`
            : "";

          const breakdownColumn = breakdown[0]?.column;

          const seriesIndex = drilldownParams[0]?.seriesIndex;
          const breakdownSeriesName =
            seriesIndex !== undefined
              ? panelData.value.options.series[seriesIndex]
              : undefined;
          const uniqueSeriesName = breakdownSeriesName
            ? breakdownSeriesName.originalSeriesName
            : drilldownParams[0]?.seriesName;
          const breakdownValue = uniqueSeriesName;

          const whereClause = buildWhereClause(
            ast,
            breakdownColumn,
            breakdownValue,
          );

          modifiedQuery = `SELECT * FROM "${streamName}"${aliasClause} ${whereClause}`;
        } else if (drilldownData.data.logsMode === "auto" && isPromQLQuery) {
          // For PromQL queries in auto mode, create a simple SELECT * query
          // since we can't parse PromQL syntax with SQL parser
          modifiedQuery = `SELECT * FROM "${streamName}"`;
        } else {
          // Create drilldown variables object exactly as you do for other drilldown types
          const drilldownVariables: any = {};

          // Add time range
          if (
            selectedTimeObj?.value?.start_time &&
            selectedTimeObj?.value?.start_time != "Invalid Date"
          ) {
            drilldownVariables.start_time = new Date(
              selectedTimeObj?.value?.start_time?.toISOString(),
            ).getTime();
          }
          if (
            selectedTimeObj?.value?.end_time &&
            selectedTimeObj?.value?.end_time != "Invalid Date"
          ) {
            drilldownVariables.end_time = new Date(
              selectedTimeObj?.value?.end_time?.toISOString(),
            ).getTime();
          }

          // Add query and encoded query
          drilldownVariables.query =
            metadata?.value?.queries[0]?.query ??
            panelSchema?.value?.queries[0]?.query ??
            "";
          drilldownVariables.query_encoded = b64EncodeUnicode(
            drilldownVariables.query,
          );

          // Handle different chart types
          if (panelSchema.value.type == "table") {
            const fields: any = {};
            panelSchema.value.queries.forEach((query: any) => {
              const panelFields: any = [
                ...(query.fields.x || []),
                ...(query.fields.y || []),
                ...(query.fields.z || []),
              ];
              panelFields.forEach((field: any) => {
                fields[field.label] = drilldownParams[1][0][field.alias];
                fields[field.alias] = drilldownParams[1][0][field.alias];
              });
            });
            drilldownVariables.row = {
              field: fields,
              index: drilldownParams[1][1],
            };
          } else if (panelSchema.value.type == "sankey") {
            if (drilldownParams[0].dataType == "node") {
              drilldownVariables.node = {
                __name: drilldownParams[0]?.name ?? "",
                __value: drilldownParams[0]?.value ?? "",
              };
            } else {
              drilldownVariables.edge = {
                __source: drilldownParams[0]?.data?.source ?? "",
                __target: drilldownParams[0]?.data?.target ?? "",
                __value: drilldownParams[0]?.data?.value ?? "",
              };
            }
          } else {
            drilldownVariables.series = {
              __name: ["pie", "donut", "heatmap"].includes(
                panelSchema.value.type,
              )
                ? drilldownParams[0].name
                : drilldownParams[0].seriesName,
              __value: Array.isArray(drilldownParams[0].value)
                ? drilldownParams[0].value[drilldownParams[0].value.length - 1]
                : drilldownParams[0].value,
              __axisValue:
                drilldownParams?.[0]?.value?.[0] ?? drilldownParams?.[0]?.name,
            };
          }

          variablesData?.value?.values?.forEach((variable: any) => {
            if (variable.type != "dynamic_filters") {
              drilldownVariables[variable.name] = variable.value;
            }
          });

          let queryWithReplacedPlaceholders = replaceVariablesValue(
            drilldownData?.data?.logsQuery,
            variablesData?.value?.values,
            panelSchema,
          );

          queryWithReplacedPlaceholders = replaceDrilldownToLogs(
            queryWithReplacedPlaceholders,
            drilldownVariables,
          );

          modifiedQuery = queryWithReplacedPlaceholders;
        }

        modifiedQuery = modifiedQuery.replace(/`/g, '"');

        const encodedQuery: any = b64EncodeUnicode(modifiedQuery);

        const pos = window.location.pathname.indexOf("/web/");
        const currentUrl =
          pos > -1
            ? window.location.origin +
              window.location.pathname.slice(0, pos) +
              "/web"
            : window.location.origin;

        const logsUrl = constructLogsUrl(
          streamName,
          calculatedTimeRange,
          encodedQuery,
          queryDetails,
          currentUrl,
        );

        try {
          if (drilldownData.targetBlank) {
            window.open(logsUrl.toString(), "_blank");
          } else {
            await store.dispatch("logs/setIsInitialized", false);
            await nextTick();
            await router.push({
              path: "/logs",
              query: Object.fromEntries(logsUrl.searchParams.entries()),
            });
          }
        } catch (error) {}
      };

      // need to change dynamic variables to it's value using current variables, current chart data(params)
      // if pie, donut or heatmap then series name will come in name field
      // also, if value is an array, then last value will be taken
      const drilldownVariables: any = {};

      // selected start time and end time
      if (
        selectedTimeObj?.value?.start_time &&
        selectedTimeObj?.value?.start_time != "Invalid Date"
      ) {
        drilldownVariables.start_time = new Date(
          selectedTimeObj?.value?.start_time?.toISOString(),
        ).getTime();
      }

      if (
        selectedTimeObj?.value?.end_time &&
        selectedTimeObj?.value?.end_time != "Invalid Date"
      ) {
        drilldownVariables.end_time = new Date(
          selectedTimeObj?.value?.end_time?.toISOString(),
        ).getTime();
      }

      // param to pass current query
      // use metadata query[replaced variables values] or panelSchema query
      drilldownVariables.query =
        metadata?.value?.queries[0]?.query ??
        panelSchema?.value?.queries[0]?.query ??
        "";
      drilldownVariables.query_encoded = b64EncodeUnicode(
        metadata?.value?.queries[0]?.query ??
          panelSchema?.value?.queries[0]?.query ??
          "",
      );

      // if chart type is 'table' then we need to pass the table name
      if (panelSchema.value.type == "table") {
        const fields: any = {};
        panelSchema.value.queries.forEach((query: any) => {
          // take all field from x, y and z
          const panelFields: any = [
            ...query.fields.x,
            ...query.fields.y,
            ...query.fields.z,
          ];
          panelFields.forEach((field: any) => {
            // we have label and alias, use both in dynamic values
            fields[field.label] = drilldownParams[1][0][field.alias];
            fields[field.alias] = drilldownParams[1][0][field.alias];
          });
        });
        drilldownVariables.row = {
          field: fields,
          index: drilldownParams[1][1],
        };
      } else if (panelSchema.value.type == "sankey") {
        // if dataType is node then set node data
        // else set edge data
        if (drilldownParams[0].dataType == "node") {
          // set node data
          drilldownVariables.node = {
            __name: drilldownParams[0]?.name ?? "",
            __value: drilldownParams[0]?.value ?? "",
          };
        } else {
          // set edge data
          drilldownVariables.edge = {
            __source: drilldownParams[0]?.data?.source ?? "",
            __target: drilldownParams[0]?.data?.target ?? "",
            __value: drilldownParams[0]?.data?.value ?? "",
          };
        }
      } else {
        // we have an series object
        drilldownVariables.series = {
          __name: ["pie", "donut", "heatmap"].includes(panelSchema.value.type)
            ? drilldownParams[0].name
            : drilldownParams[0].seriesName,
          __value: Array.isArray(drilldownParams[0].value)
            ? drilldownParams[0].value[drilldownParams[0].value.length - 1]
            : drilldownParams[0].value,
          __axisValue:
            drilldownParams?.[0]?.value?.[0] ?? drilldownParams?.[0]?.name,
        };
      }

      variablesData?.value?.values?.forEach((variable: any) => {
        if (variable.type != "dynamic_filters") {
          drilldownVariables[variable.name] = variable.value;
        }
      });

      // if drilldown by url
      if (drilldownData.type == "byUrl") {
        try {
          // open url
          return window.open(
            replacePlaceholders(drilldownData.data.url, drilldownVariables),
            drilldownData.targetBlank ? "_blank" : "_self",
          );
        } catch (error) {}
      } else if (drilldownData.type == "logs") {
        try {
          navigateToLogs();
        } catch (error) {
          showErrorNotification("Failed to navigate to logs");
        }
      } else if (drilldownData.type == "byDashboard") {
        // we have folder, dashboard and tabs name
        // so we have to get id of folder, dashboard and tab

        // get folder id
        if (
          !store.state.organizationData.folders ||
          (Array.isArray(store.state.organizationData.folders) &&
            store.state.organizationData.folders.length === 0)
        ) {
          await getFoldersList(store);
        }
        const folderId = store.state.organizationData.folders.find(
          (folder: any) => folder.name == drilldownData.data.folder,
        )?.folderId;

        if (!folderId) {
          return;
        }

        // get dashboard id
        const allDashboardData = await getAllDashboardsByFolderId(
          store,
          folderId,
        );

        const dashboardId = allDashboardData?.find(
          (dashboard: any) => dashboard.title === drilldownData.data.dashboard,
        )?.dashboardId;

        const dashboardData = await getDashboard(store, dashboardId, folderId);

        if (!dashboardData) {
          return;
        }

        // get tab id
        const tabId =
          dashboardData.tabs.find(
            (tab: any) => tab.name == drilldownData.data.tab,
          )?.tabId ?? dashboardData.tabs[0].tabId;

        // if targetBlank is true then create new url
        // else made changes in current router only
        if (drilldownData.targetBlank) {
          // get current origin
          const pos = window.location.pathname.indexOf("/web/");
          // if there is /web/ in path
          // url will be: origin from window.location.origin + pathname up to /web/ + /web/
          let currentUrl: any =
            pos > -1
              ? window.location.origin +
                window.location.pathname.slice(0, pos) +
                "/web"
              : window.location.origin;

          // always, go to view dashboard page
          currentUrl += "/dashboards/view?";

          // if pass all variables in url
          currentUrl += drilldownData.data.passAllVariables
            ? new URLSearchParams(route.query as any).toString()
            : "";

          const url = new URL(currentUrl);

          // set variables provided by user
          drilldownData.data.variables.forEach((variable: any) => {
            if (variable?.name?.trim() && variable?.value?.trim()) {
              url.searchParams.set(
                "var-" + replacePlaceholders(variable.name, drilldownVariables),
                replacePlaceholders(variable.value, drilldownVariables),
              );
            }
          });

          url.searchParams.set("dashboard", dashboardData.dashboardId);
          url.searchParams.set("folder", folderId);
          url.searchParams.set("tab", tabId);
          currentUrl = url.toString();

          window.open(currentUrl, "_blank");
        } else {
          let oldParams: any = {};
          // if pass all variables is true
          if (drilldownData.data.passAllVariables) {
            // get current query params — spread to avoid mutating Vue Router's reactive object
            oldParams = { ...route.query };
          }

          drilldownData.data.variables.forEach((variable: any) => {
            if (variable?.name?.trim() && variable?.value?.trim()) {
              oldParams[
                "var-" + replacePlaceholders(variable.name, drilldownVariables)
              ] = replacePlaceholders(variable.value, drilldownVariables);
            }
          });

          // make changes in router
          const pushQuery = {
            ...oldParams,
            org_identifier: store.state.selectedOrganization.identifier,
            dashboard: dashboardData.dashboardId,
            folder: folderId,
            tab: tabId,
          };
          await router.push({
            path: "/dashboards/view",
            query: pushQuery,
          });
          // ViewDashboard's var-* watcher detects the route change and calls
          // updateInitialVariableValues() directly via component ref — no emit needed.
        }
      }
    }
  };

  // Cross-linking: fetch cross-links when the executed query (with variables resolved) changes
  watch(
    () =>
      metadata.value?.queries?.[0]?.query ||
      panelSchema.value?.queries?.[0]?.query,
    async (newQuery: string) => {
      if (
        !store.state.zoConfig?.enable_cross_linking ||
        !newQuery ||
        panelSchema.value?.queryType === "promql"
      ) {
        crossLinksData.value = { stream_links: [], org_links: [] };
        return;
      }
      try {
        const response = await searchService.result_schema(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: {
              query: {
                sql: store.state.zoConfig.sql_base64_enabled
                  ? b64EncodeUnicode(newQuery)
                  : newQuery,
                query_fn: null,
                size: -1,
                streaming_output: false,
                streaming_id: null,
              },
              ...(store.state.zoConfig.sql_base64_enabled
                ? { encoding: "base64" }
                : {}),
            },
            page_type: "dashboards",
            is_streaming: false,
            cross_linking: true,
          },
          "dashboards",
        );
        crossLinksData.value = response.data?.cross_links || {
          stream_links: [],
          org_links: [],
        };
      } catch {
        crossLinksData.value = { stream_links: [], org_links: [] };
      }
    },
    { immediate: true },
  );

  return {
    drilldownArray,
    crossLinksData,
    onChartClick,
    openDrilldown,
    hidePopupsAndOverlays,
    parser,
    interval,
    intervalMicro,
  };
}
