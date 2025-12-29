import { splitQuotedString, escapeSingleQuotes } from "@/utils/zincutils";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";

export function buildSQLQueryFromInput(
  fields: any,
  defaultStream: any,
): string {
  // Handle undefined or null fields
  if (!fields) {
    return "";
  }

  // if fields type is raw, return rawQuery
  if (fields.type === "raw") {
    return `${fields?.rawQuery ?? ""}`;
  }

  // Extract functionName and args from the input with fallbacks
  const functionName = fields.functionName;
  const args = Array.isArray(fields.args) ? fields.args : [];

  // Find the function definition based on the functionName
  const selectedFunction = functionValidation.find(
    (fn: any) => fn.functionName === (functionName ?? null),
  );

  // If the function is not found, return empty string instead of throwing
  if (!selectedFunction) {
    return "";
  }

  // Validate the provided args against the function's argument definitions
  const argsDefinition = selectedFunction.args;

  if (!argsDefinition || argsDefinition.length === 0) {
    return `${functionName}()`; // If no args are required, return the function call
  }

  const sqlArgs = [];
  for (let i = 0; i < args.length; i++) {
    // Skip if arg is undefined or null
    if (!args[i]) {
      continue;
    }

    const argValue = args[i]?.value;
    const argType = args[i]?.type;

    if (argValue === undefined || argValue === null) {
      continue;
    }

    // Add the argument to the SQL query
    if (argType === "field") {
      // Handle case where field object might be incomplete
      if (!argValue.field) {
        continue;
      }
      // If the argument type is "field", do not wrap with quotes
      sqlArgs.push(
        argValue.streamAlias
          ? argValue.streamAlias + "." + argValue.field
          : defaultStream
            ? defaultStream + "." + argValue.field
            : argValue.field,
      );
    } else if (argType === "string" || argType === "histogramInterval") {
      // Wrap strings in quotes if they are not already wrapped
      if (
        typeof argValue === "string" &&
        !argValue.startsWith("'") &&
        !argValue.endsWith("'")
      ) {
        sqlArgs.push(`'${argValue}'`);
      } else {
        sqlArgs.push(argValue);
      }
    } else if (argType === "number") {
      // Add numbers as-is
      sqlArgs.push(argValue);
    } else if (argType === "function") {
      // Recursively build the SQL query for the nested function
      try {
        const nestedFunctionQuery = buildSQLQueryFromInput(
          argValue,
          defaultStream,
        );
        if (nestedFunctionQuery) {
          sqlArgs.push(nestedFunctionQuery);
        }
      } catch (error) {
        // If nested function fails, just skip this argument
        continue;
      }
    } else {
      // Skip unsupported argument types instead of throwing
      continue;
    }
  }

  // If no valid arguments were found, return minimal query
  if (sqlArgs.length === 0 && argsDefinition.length > 0) {
    return "";
  }

  // Special handling for specific functions
  switch (functionName) {
    case "count-distinct":
      return `count(distinct(${sqlArgs.join(", ")}))`;
    case "p50":
      return `approx_percentile_cont(${sqlArgs.join(", ")}, 0.5)`;
    case "p90":
      return `approx_percentile_cont(${sqlArgs.join(", ")}, 0.9)`;
    case "p95":
      return `approx_percentile_cont(${sqlArgs.join(", ")}, 0.95)`;
    case "p99":
      return `approx_percentile_cont(${sqlArgs.join(", ")}, 0.99)`;
  }

  // Construct the SQL query string
  // if the function is not null, return the function call statement
  // else return the first argument(if function is null, always only one argument will be there)
  return functionName
    ? `${functionName}(${sqlArgs.join(", ")})`
    : sqlArgs.length > 0
      ? `${sqlArgs[0]}`
      : "";
}

function buildSQLJoinsFromInput(joins: any[], defaultStream: any): string {
  if (!joins || joins.length === 0) {
    return ""; // No joins, return empty string
  }

  let joinClauses: string[] = [];

  for (const join of joins) {
    const { stream, streamAlias, joinType, conditions } = join;

    if (!stream || !joinType || !conditions || conditions.length === 0) {
      // Invalid join, skip it and continue to the next one
      continue;
    }

    let joinConditionStrings: string[] = [];

    for (const condition of conditions) {
      const { leftField, rightField, operation, logicalOperator } = condition;

      if (!leftField?.field || !rightField?.field || !operation) {
        // Invalid condition, skip it and continue to the next one
        continue;
      }

      const leftFieldStr = leftField.streamAlias
        ? `${leftField.streamAlias}.${leftField.field}`
        : defaultStream
          ? `${defaultStream}.${leftField.field}`
          : leftField.field;

      const rightFieldStr = rightField.streamAlias
        ? `${rightField.streamAlias}.${rightField.field}`
        : defaultStream
          ? `${defaultStream}.${rightField.field}`
          : rightField.field;

      joinConditionStrings.push(
        `${leftFieldStr} ${operation} ${rightFieldStr}`,
      );
    }

    // Skip joins with no valid conditions
    if (joinConditionStrings.length === 0) {
      continue;
    }

    // Combine conditions with logical operators (e.g., AND, OR)
    const joinConditionsSQL = joinConditionStrings.join(" AND ");

    // Construct the JOIN SQL statement
    joinClauses.push(
      `${joinType.toUpperCase()} JOIN "${stream}" AS ${streamAlias ?? defaultStream} ON ${joinConditionsSQL}`,
    );
  }

  // Only return empty string if there are no valid joins after processing
  if (joinClauses.length === 0) {
    return "";
  }

  return joinClauses.join(" ");
}

/**
 * Builds a field expression for SQL SELECT clause
 * @param field Field configuration object
 * @param defaultStream Default stream name
 * @returns SQL field expression string
 */
function buildFieldExpression(field: any, defaultStream: any): string {
  const sqlExpr = buildSQLQueryFromInput(field, defaultStream);
  return sqlExpr ? `${sqlExpr} as "${field.alias}"` : "";
}

/**
 * Generalized chart query builder
 * Builds SQL queries for various chart types with consistent JOIN, WHERE, GROUP BY, HAVING, ORDER BY, and LIMIT clauses
 *
 * @param config Configuration object containing:
 *   - selectFields: Array of field objects to select
 *   - groupByFields: Array of fields for GROUP BY clause (optional)
 *   - havingField: Field with having conditions (optional)
 *   - havingFields: Array of fields with having conditions (optional, for multiple HAVING clauses)
 *   - queryData: Query data containing stream, joins, filters, and config
 *   - buildWhereClause: Function to build WHERE clause from filter conditions
 * @returns SQL query string
 */
function buildChartQuery(config: {
  selectFields: any[];
  groupByFields?: any[];
  havingField?: any;
  havingFields?: any[];
  queryData: any;
  dashboardPanelData: any;
}): string {
  const { queryData, dashboardPanelData } = config;
  const stream = queryData.fields.stream;

  // Only use stream alias when joins exist
  const streamAlias = queryData?.joins?.length > 0 ? stream : "";


  // Build SELECT clause
  const selectExpressions: string[] = [];
  for (const fieldConfig of config.selectFields) {
    if (!fieldConfig || !fieldConfig.field) continue;
    const expr = buildFieldExpression(fieldConfig.field, streamAlias);
    if (expr) selectExpressions.push(expr);
  }

  if (selectExpressions.length === 0) {
    return "";
  }

  let query = `SELECT ${selectExpressions.join(", ")}`;

  // FROM clause with JOIN support
  query += ` FROM "${stream}" ${buildSQLJoinsFromInput(
    queryData.joins,
    queryData?.joins?.length ? stream : "",
  )}`;

  // WHERE clause
  const filterData = queryData.fields.filter.conditions;
  const whereClause = buildWhereClause(filterData, dashboardPanelData);
  query += whereClause;

  // GROUP BY clause
  if (config.groupByFields && config.groupByFields.length > 0) {
    const groupByAliases = config.groupByFields
      .filter((field: any) => field && !field.isDerived)
      .map((field: any) => field.alias);

    if (groupByAliases.length > 0) {
      query += ` GROUP BY ${groupByAliases.join(", ")}`;
    }
  }

  // HAVING clause - handle both single field and multiple fields
  const havingClauses: string[] = [];

  // Handle single havingField (backward compatibility)
  if (config.havingField) {
    const field = config.havingField;
    if (
      field?.havingConditions?.[0]?.operator &&
      field?.havingConditions?.[0]?.value !== undefined &&
      field?.havingConditions?.[0]?.value !== null &&
      field?.havingConditions?.[0]?.value !== ""
    ) {
      havingClauses.push(
        `${field.alias} ${field.havingConditions[0].operator} ${field.havingConditions[0].value}`,
      );
    }
  }

  // Handle multiple havingFields
  if (config.havingFields && config.havingFields.length > 0) {
    config.havingFields.forEach((field: any) => {
      if (
        field?.havingConditions?.[0]?.operator &&
        field?.havingConditions?.[0]?.value !== undefined &&
        field?.havingConditions?.[0]?.value !== null &&
        field?.havingConditions?.[0]?.value !== ""
      ) {
        havingClauses.push(
          `${field.alias} ${field.havingConditions[0].operator} ${field.havingConditions[0].value}`,
        );
      }
    });
  }

  if (havingClauses.length > 0) {
    query += " HAVING " + havingClauses.join(" AND ");
  }

  // ORDER BY clause
  const orderByArr: string[] = [];
  config.selectFields
    .filter((f: any) => f && f.field && !f.field.isDerived && f.field.sortBy)
    .forEach((f: any) => {
      orderByArr.push(`${f.field.alias} ${f.field.sortBy}`);
    });

  if (orderByArr.length > 0) {
    query += ` ORDER BY ${orderByArr.join(", ")}`;
  }

  // LIMIT clause
  const queryLimit = queryData.config.limit ?? 0;
  if (queryLimit > 0) {
    query += ` LIMIT ${queryLimit}`;
  }

  return query;
}

/**
 * Advanced SQL chart query builder for complex chart types
 * Handles x, y, z, and breakdown fields with chart-type-specific GROUP BY logic
 *
 * @param config Configuration object containing:
 *   - queryData: Query data containing stream, joins, filters, and config
 *   - chartType: Type of chart (e.g., "heatmap", "table", "stacked")
 * @returns SQL query string
 */
export function buildSQLChartQuery(config: {
  queryData: any;
  chartType: string;
  dashboardPanelData: any;
}): string {
  const { queryData, chartType, dashboardPanelData } = config;

  // Check if there is at least 1 field selected
  if (
    queryData.fields.x.length === 0 &&
    queryData.fields.y.length === 0 &&
    queryData.fields.z.length === 0 &&
    queryData.fields.breakdown?.length === 0
  ) {
    return "";
  }

  const stream = queryData.fields.stream;
  const streamAlias = queryData?.joins?.length ? stream : "";

  // Merge all field lists
  const allFields = [
    ...queryData.fields.x,
    ...queryData.fields.y,
    ...(queryData.fields?.breakdown || []),
    ...(queryData.fields?.z || []),
  ]
    .flat()
    .filter((fieldObj: any) => !fieldObj.isDerived);

  // Build SELECT clause and track valid fields
  const selectExpressions: string[] = [];
  const validFieldAliases = new Set<string>();

  for (const field of allFields) {
    const expr = buildFieldExpression(field, streamAlias);
    if (expr) {
      selectExpressions.push(expr);
      validFieldAliases.add(field.alias);
    }
  }

  if (selectExpressions.length === 0) {
    return "";
  }

  let query = `SELECT ${selectExpressions.join(", ")}`;

  // FROM clause with JOIN support
  query += ` FROM "${stream}" ${buildSQLJoinsFromInput(
    queryData.joins,
    streamAlias,
  )}`;

  // WHERE clause
  const whereClause = buildWhereClause(
    queryData.fields.filter.conditions,
    dashboardPanelData,
  );
  query += whereClause;

  // GROUP BY clause - chart-type-specific logic
  // Only include fields that have valid expressions (are in validFieldAliases)
  const xAxisAliases = queryData.fields.x
    .filter((it: any) => !it?.isDerived && validFieldAliases.has(it?.alias))
    .map((it: any) => it?.alias);

  const yAxisAliases = queryData.fields.y
    .filter((it: any) => !it?.isDerived && validFieldAliases.has(it?.alias))
    .map((it: any) => it?.alias);

  const breakdownAliases =
    queryData.fields?.breakdown
      ?.filter((it: any) => !it?.isDerived && validFieldAliases.has(it?.alias))
      ?.map((it: any) => it?.alias) || [];

  const tableTypeWithXFieldOnly =
    chartType === "table" &&
    xAxisAliases.length > 0 &&
    yAxisAliases.length === 0 &&
    !breakdownAliases?.length;

  if (!tableTypeWithXFieldOnly) {
    if (chartType === "heatmap") {
      if (xAxisAliases.length && yAxisAliases.length) {
        query += ` GROUP BY ${xAxisAliases.join(", ")}, ${yAxisAliases.join(", ")}`;
      }
    } else if (breakdownAliases?.length) {
      if (xAxisAliases.length && breakdownAliases.length) {
        query += ` GROUP BY ${xAxisAliases.join(", ")}, ${breakdownAliases.join(", ")}`;
      }
    } else {
      if (xAxisAliases.length) {
        query += ` GROUP BY ${xAxisAliases.join(", ")}`;
      }
    }
  }

  // HAVING clause - support multiple fields from y-axis and z-axis
  const havingClauses: string[] = [];

  // Process y-axis having conditions (skip for heatmap)
  if (chartType !== "heatmap") {
    queryData.fields.y.forEach((field: any) => {
      if (
        field?.havingConditions?.[0]?.operator &&
        field?.havingConditions?.[0]?.value !== undefined &&
        field?.havingConditions?.[0]?.value !== null &&
        field?.havingConditions?.[0]?.value !== ""
      ) {
        havingClauses.push(
          `${field.alias} ${field.havingConditions[0].operator} ${field.havingConditions[0].value}`,
        );
      }
    });
  }

  // Process z-axis having conditions
  const zAxisFields = queryData.fields?.z || [];
  zAxisFields.forEach((field: any) => {
    if (
      field?.havingConditions?.[0]?.operator &&
      field?.havingConditions?.[0]?.value !== undefined &&
      field?.havingConditions?.[0]?.value !== null &&
      field?.havingConditions?.[0]?.value !== ""
    ) {
      havingClauses.push(
        `${field.alias} ${field.havingConditions[0].operator} ${field.havingConditions[0].value}`,
      );
    }
  });

  if (havingClauses.length > 0) {
    query += " HAVING " + havingClauses.join(" AND ");
  }

  // ORDER BY clause
  const orderByArr: string[] = [];
  allFields.forEach((field: any) => {
    if (field?.sortBy) {
      orderByArr.push(`${field?.alias} ${field?.sortBy}`);
    }
  });

  if (orderByArr.length > 0) {
    query += ` ORDER BY ${orderByArr.join(", ")}`;
  }

  // LIMIT clause
  const queryLimit = queryData.config.limit ?? 0;
  if (queryLimit > 0) {
    query += ` LIMIT ${queryLimit}`;
  }

  return query;
}

export function addMissingArgs(fields: any): any {
  const { functionName, args } = fields;

  // Find the function definition in functionValidation
  const functionDef = functionValidation.find(
    (fn: any) => fn.functionName === (functionName ?? null),
  );

  if (!functionDef) {
    return fields;
  }

  const updatedArgs = [...args]; // Clone the existing args array

  // Iterate through the function definition's arguments
  functionDef.args.forEach((argDef: any, index: number) => {
    const isArgProvided = updatedArgs?.[index]?.type
      ? argDef.type.map((t: any) => t.value).includes(updatedArgs[index]?.type)
      : false;

    if (!isArgProvided) {
      // If the argument is missing, add it
      const argType = argDef.type[0].value; // Always take the first type
      const defaultValue =
        argDef.defaultValue !== undefined
          ? argDef.defaultValue
          : argType === "field"
            ? {}
            : "";

      updatedArgs.push({
        type: argType,
        value: defaultValue,
      });
    }
  });

  return {
    ...fields,
    args: updatedArgs,
  };
}

/**
 * Format a value to be used in a SQL query.
 * @param value - the value to format
 * @returns the formatted value
 */

const formatValue = (
  value: any,
  column: { field: string; streamAlias: string },
  dashboardPanelData: any,
): string | null => {
  // streamAlias can be undefined or null, also, groupedfield will have one entry with streamAlias as null
  // so we need to handle both cases
  const streamFields = column.streamAlias
    ? dashboardPanelData?.meta?.streamFields?.groupedFields.find(
        (it: any) => it.stream_alias === column.streamAlias,
      )
    : dashboardPanelData?.meta?.streamFields?.groupedFields.find(
        (it: any) => it.stream_alias === null || it.stream_alias === undefined,
      );

  const columnType = streamFields?.schema?.find(
    (it: any) => it.name == column.field,
  )?.type;
  if (value == null) {
    // if value is null or undefined, return it as is
    return value;
  }

  // if value is a string, remove any single quotes and add double quotes
  let tempValue = value;
  if (value?.length > 1 && value.startsWith("'") && value.endsWith("'")) {
    tempValue = value.substring(1, value.length - 1);
  }
  // escape any single quotes in the value
  tempValue = escapeSingleQuotes(tempValue);
  // add double quotes around the value
  tempValue =
    columnType == "Utf8" || columnType === undefined
      ? `'${tempValue}'`
      : `${tempValue}`;

  return tempValue;
};

/**
 * Format a value for an IN clause in a SQL query.
 * If the value contains a variable, e.g. $variable, it will be returned as is.
 * Otherwise, if the value is a string, it will be split into individual values
 * using the `splitQuotedString` util function. Each value will be escaped and
 * enclosed in single quotes, and the resulting array of strings will be joined
 * with commas.
 * @param value - the value to format
 * @returns the formatted value
 */
const formatINValue = (value: any) => {
  // if variable is present, don't want to use splitQuotedString
  if (value?.includes("$")) {
    if (value.startsWith("(") && value.endsWith(")")) {
      return value.substring(1, value.length - 1);
    }
    return value;
  } else {
    return splitQuotedString(value ?? "")
      ?.map((it: any) => {
        return `'${escapeSingleQuotes(it)}'`;
      })
      .join(", ");
  }
};

/**
 * Build a single condition from the given condition object.
 * @param {object} condition - a filter object with properties for column,
 *   operator, value, and logicalOperator.
 * @returns {string} - the condition as a string.
 */
export const buildCondition = (condition: any, dashboardPanelData: any) => {
  // Check if joins exist to determine whether to use stream alias
  const hasJoins =
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.joins?.length > 0;

  const streamAlias = hasJoins
    ? (condition?.column?.streamAlias ??
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.stream)
    : "";

  if (condition.filterType === "group") {
    const groupConditions = condition.conditions
      .map((condition) => buildCondition(condition, dashboardPanelData))
      .filter(Boolean);
    const logicalOperators = condition.conditions
      .map((c: any) => c.logicalOperator)
      .filter(Boolean);

    let groupQuery = "";
    groupConditions.forEach((c: any, index: any) => {
      if (index > 0) {
        groupQuery += ` ${logicalOperators[index]} `;
      }
      groupQuery += c;
    });

    return groupConditions.length ? `(${groupQuery})` : "";
  } else if (condition.type === "list" && condition.values?.length > 0) {
    const fieldRef = streamAlias
      ? `${streamAlias}.${condition.column.field}`
      : condition.column.field;
    return `${fieldRef} IN (${condition.values
      .map((value: any) =>
        formatValue(value, condition.column, dashboardPanelData),
      )
      .join(", ")})`;
  } else if (condition.type === "condition" && condition.operator != null) {
    let selectFilter = "";
    if (["Is Null", "Is Not Null"].includes(condition.operator)) {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `${fieldRef} `;
      switch (condition.operator) {
        case "Is Null":
          selectFilter += `IS NULL`;
          break;
        case "Is Not Null":
          selectFilter += `IS NOT NULL`;
          break;
      }
    } else if (condition.operator === "IN") {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `${fieldRef} IN (${formatINValue(condition.value)})`;
    } else if (condition.operator === "NOT IN") {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `${fieldRef} NOT IN (${formatINValue(condition.value)})`;
    } else if (condition.operator === "match_all") {
      selectFilter += `match_all(${formatValue(condition.value, condition.column, dashboardPanelData)})`;
    } else if (
      condition.operator === "str_match" ||
      condition.operator === "Contains"
    ) {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `str_match(${fieldRef}, ${formatValue(
        condition.value,
        condition.column,
        dashboardPanelData,
      )})`;
    } else if (condition.operator === "str_match_ignore_case") {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `str_match_ignore_case(${fieldRef}, ${formatValue(condition.value, condition.column, dashboardPanelData)})`;
    } else if (condition.operator === "re_match") {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `re_match(${fieldRef}, ${formatValue(
        condition.value,
        condition.column,
        dashboardPanelData,
      )})`;
    } else if (condition.operator === "re_not_match") {
      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `re_not_match(${fieldRef}, ${formatValue(
        condition.value,
        condition.column,
        dashboardPanelData,
      )})`;
    } else if (condition.value != null && condition.value !== "") {
      // streamAlias can be undefined or null, also, groupedfield will have one entry with streamAlias as null
      // so we need to handle both cases
      const streamFields = condition.column.streamAlias
        ? dashboardPanelData?.meta?.streamFields?.groupedFields.find(
            (it: any) => it.stream_alias === condition.column.streamAlias,
          )
        : dashboardPanelData?.meta?.streamFields?.groupedFields.find(
            (it: any) =>
              it.stream_alias === null || it.stream_alias === undefined,
          );

      const columnType = streamFields?.schema?.find(
        (it: any) => it.name == condition.column.field,
      )?.type;

      const fieldRef = streamAlias
        ? `${streamAlias}.${condition.column.field}`
        : condition.column.field;
      selectFilter += `${fieldRef} `;
      switch (condition.operator) {
        case "=":
        case "<>":
        case "<":
        case ">":
        case "<=":
        case ">=":
          selectFilter += `${condition.operator} ${formatValue(
            condition.value,
            condition.column,
            dashboardPanelData,
          )}`;
          break;
        case "Not Contains":
          selectFilter +=
            columnType === "Utf8"
              ? `NOT LIKE '%${condition.value}%'`
              : `NOT LIKE %${condition.value}%`;
          break;
        case "Starts With":
          selectFilter +=
            columnType === "Utf8"
              ? `LIKE '${condition.value}%'`
              : `LIKE ${condition.value}%`;
          break;
        case "Ends With":
          selectFilter +=
            columnType === "Utf8"
              ? `LIKE '%${condition.value}'`
              : `LIKE %${condition.value}`;
          break;
        default:
          selectFilter += `${condition.operator} ${formatValue(
            condition.value,
            condition.column,
            dashboardPanelData,
          )}`;
          break;
      }
    }
    return selectFilter;
  }
  return "";
};

/**
 * Build a WHERE clause from the given filter data.
 * @param {array} filterData - an array of filter objects, each with properties
 *   for column, operator, value, and logicalOperator.
 * @returns {string} - the WHERE clause as a string.
 */
const buildWhereClause = (filterData: any, dashboardPanelData: any) => {
  const whereConditions = filterData
    ?.map((condition) => buildCondition(condition, dashboardPanelData))
    ?.filter(Boolean);

  const logicalOperators = filterData.map((it: any) => it.logicalOperator);
  if (whereConditions.length > 0) {
    return ` WHERE ${whereConditions
      .map((cond: any, index: any) => {
        const logicalOperator =
          index < logicalOperators.length && logicalOperators[index + 1]
            ? logicalOperators[index + 1]
            : "";

        return index < logicalOperators.length
          ? `${cond} ${logicalOperator}`
          : cond;
      })
      .join(" ")}`;
  }

  return "";
};

export const mapChart = (dashboardPanelData: any) => {
  const queryData =
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ];
  const { name, value_for_maps } = queryData.fields;

  return buildChartQuery({
    selectFields: [
      { name: "name", field: name },
      { name: "value_for_maps", field: value_for_maps },
    ],
    groupByFields: [name],
    havingField: value_for_maps,
    queryData,
    dashboardPanelData,
  });
};

export const geoMapChart = (dashboardPanelData: any) => {
  const queryData =
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ];
  const { latitude, longitude, weight } = queryData.fields;

  return buildChartQuery({
    selectFields: [
      { name: "latitude", field: latitude },
      { name: "longitude", field: longitude },
      { name: "weight", field: weight },
    ],
    groupByFields: [latitude, longitude],
    havingField: weight,
    queryData,
    dashboardPanelData,
  });
};

export const sankeyChartQuery = (dashboardPanelData: any) => {
  const queryData =
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ];
  const { source, target, value } = queryData.fields;

  return buildChartQuery({
    selectFields: [
      { name: "source", field: source },
      { name: "target", field: target },
      { name: "value", field: value },
    ],
    groupByFields: [source, target],
    havingField: value,
    queryData,
    dashboardPanelData,
  });
};
