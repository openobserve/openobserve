/**
 * Alert Query Builder Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

export interface StreamFieldsMap {
  [key: string]: {
    label: string;
    value: string;
    type: string;
  };
}

export interface QueryCondition {
  conditions: any;
  sql: string;
  promql: string;
  type: string;
  aggregation: {
    group_by: string[];
    function: string;
    having: {
      column: string;
      operator: string;
      value: number;
    };
  } | null;
  promql_condition: any;
  vrl_function: any;
  multi_time_range: any[];
}

export interface AlertFormData {
  stream_name: string;
  query_condition: QueryCondition;
}

export const getFormattedCondition = (
  column: string,
  operator: string,
  value: number | string,
) => {
  let condition = "";
  switch (operator) {
    case "=":
    case "<>":
    case "<":
    case ">":
    case "<=":
    case ">=":
      condition = column + ` ${operator} ${value}`;
      break;
    //this is done because when we get from BE the response includes the operator in lowercase
    //so we need to handle it separately
    case "contains":
      condition = column + ` LIKE '%${value}%'`;
      break;
    //this is done because when we get from BE the response includes the operator in lowercase and converted NotContains to not_contains
    //so we need to handle it separately
    case "not_contains":
      condition = column + ` NOT LIKE '%${value}%'`;
      break;
    case "Contains":
      condition = column + ` LIKE '%${value}%'`;
      break;
    //this is done because in the FE we are not converting the operator to lowercase
    case "NotContains":
      condition = column + ` NOT LIKE '%${value}%'`;
      break;
    default:
      condition = column + ` ${operator} ${value}`;
      break;
  }
  return condition;
};

export const generateWhereClause = (
  group: any,
  streamFieldsMap: StreamFieldsMap,
) => {
  //this method is used to format the value
  //if the value is a number or a string and the operator is contains or not contains then we need to return the value as it is
  //else we need to return the value as a string and add single quotes to it
  const formatValue = (column: any, operator: any, value: any) => {
    return streamFieldsMap[column]?.type === "Int64" ||
      operator === "contains" ||
      operator === "not_contains" ||
      operator === "Contains" ||
      operator === "NotContains"
      ? value
      : `'${value}'`;
  };
  //this method is used to parse the group
  //if the group is not present or the items are not present then we need to return an empty string
  //else we need to iterate over the items and get the conditions
  //and then we need to return the where clause
  const parseGroup = (groupNode: any): string => {
    if (!groupNode || !Array.isArray(groupNode.items)) return "";

    const parts = groupNode.items
      .map((item: any) => {
        // Nested group
        if (item.items && Array.isArray(item.items)) {
          return `(${parseGroup(item)})`;
        }

        // Single condition
        if (item.column && item.operator && item.value !== undefined) {
          const formattedValue = formatValue(
            item.column,
            item.operator,
            item.value,
          );
          return getFormattedCondition(
            item.column,
            item.operator,
            formattedValue,
          );
        }

        return "";
      })
      .filter(Boolean);

    return parts.join(` ${groupNode.label.toUpperCase()} `);
  };

  const clause = parseGroup(group);
  return clause.trim().length ? "WHERE " + clause : "";
};

export const generateSqlQuery = (
  formData: AlertFormData,
  streamFieldsMap: StreamFieldsMap,
  isAggregationEnabled: boolean,
  timestampColumn: string = "_timestamp",
) => {
  // SELECT histgoram(_timestamp, '1 minute') AS zo_sql_key, COUNT(*) as zo_sql_val FROM _rundata
  // WHERE geo_info_country='india' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC

  // SELECT histgoram(_timestamp, '1 minute') AS zo_sql_key, avg(action_error_count) as zo_sql_val,
  // geo_info_city FROM _rundata WHERE geo_info_country='india' GROUP BY zo_sql_key,geo_info_city ORDER BY zo_sql_key ASC;
  let query = `SELECT histogram(${timestampColumn}) AS zo_sql_key,`;
  //this method is used to generate the where clause
  //previously it was just iterating over the conditions and getting the where clause
  //now we are using the new format of conditions and getting the where clause using generateWhereClause method
  const whereClause = generateWhereClause(
    formData.query_condition.conditions,
    streamFieldsMap,
  );

  if (!isAggregationEnabled) {
    query +=
      ` COUNT(*) as zo_sql_val FROM "${formData.stream_name}" ` +
      whereClause +
      " GROUP BY zo_sql_key ORDER BY zo_sql_key ASC";
  } else {
    const aggFn = formData.query_condition.aggregation?.function;
    const column = formData.query_condition.aggregation?.having.column;

    const isAggValid = aggFn?.trim()?.length && column?.trim()?.length;

    let groupByAlias = "";
    let groupByCols: string[] = [];
    formData.query_condition.aggregation?.group_by.forEach((column: any) => {
      if (column.trim().length) groupByCols.push(column);
    });

    let concatGroupBy = "";
    if (groupByCols.length) {
      groupByAlias = ", x_axis_2";
      concatGroupBy = `, concat(${groupByCols.join(",' : ',")}) as x_axis_2`;
    }

    const percentileFunctions: any = {
      p50: 0.5,
      p75: 0.75,
      p90: 0.9,
      p95: 0.95,
      p99: 0.99,
    };

    if (isAggValid) {
      if (percentileFunctions[aggFn]) {
        query +=
          ` approx_percentile_cont(${column}, ${percentileFunctions[aggFn]}) as zo_sql_val ${concatGroupBy} FROM "${formData.stream_name}" ` +
          whereClause +
          ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
      } else {
        query +=
          ` ${aggFn}(${column}) as zo_sql_val ${concatGroupBy} FROM "${formData.stream_name}" ` +
          whereClause +
          ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
      }
    } else {
      query +=
        ` COUNT(*) as zo_sql_val ${concatGroupBy} FROM "${formData.stream_name}" ` +
        whereClause +
        ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
    }
  }

  return query;
};