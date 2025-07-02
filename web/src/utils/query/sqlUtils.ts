import { splitQuotedString, escapeSingleQuotes } from "@/utils/zincutils";

let parser: any;
let parserInitialized = false;

const importSqlParser = async () => {
  if (!parserInitialized) {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();
    parserInitialized = true;
  }
  return parser;
};

export const addLabelsToSQlQuery = async (originalQuery: any, labels: any) => {
  await importSqlParser();

  let dummyQuery = "select * from 'default'";

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    dummyQuery = await addLabelToSQlQuery(
      dummyQuery,
      label.name,
      label.value,
      label.operator,
    );
  }

  try {
    const astOfOriginalQuery: any = parser.astify(originalQuery);
    const astOfDummy: any = parser.astify(dummyQuery);

    // if ast already has a where clause
    if (astOfOriginalQuery.where) {
      const newWhereClause = {
        type: "binary_expr",
        operator: "AND",
        left: {
          ...astOfOriginalQuery.where,
          parentheses: true,
        },
        right: {
          ...astOfDummy.where,
          parentheses: true,
        },
      };
      const newAst = {
        ...astOfOriginalQuery,
        where: newWhereClause,
      };
      const sql = parser.sqlify(newAst);
      const quotedSql = sql.replace(/`/g, '"');
      return quotedSql;
    } else {
      const newAst = {
        ...astOfOriginalQuery,
        where: astOfDummy.where,
      };
      const sql = parser.sqlify(newAst);
      const quotedSql = sql.replace(/`/g, '"');
      return quotedSql;
    }
  } catch (error: any) {
    console.error("There was an error generating query:", error);
  }
};

const formatValue = (value: any): string | null => {
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
  tempValue = `'${tempValue}'`;
  return tempValue;
};

export const addLabelToSQlQuery = async (
  originalQuery: any,
  label: any,
  value: any,
  operator: any,
) => {
  await importSqlParser();

  let condition: any;

  if (operator === "match_all") {
    condition = `match_all(${formatValue(value)})`;
  } else if (operator === "str_match") {
    condition = `str_match(${label}, ${formatValue(value)})`;
  } else if (operator === "str_match_ignore_case") {
    condition = `str_match_ignore_case(${label}, ${formatValue(value)})`;
  } else if (operator === "re_match") {
    condition = `re_match(${label}, ${formatValue(value)})`;
  } else if (operator === "re_not_match") {
    condition = `re_not_match(${label}, ${formatValue(value)})`;
  } else {
    switch (operator) {
      case "Contains":
        operator = "LIKE";
        value = "%" + escapeSingleQuotes(value) + "%";
        break;
      case "Not Contains":
        operator = "NOT LIKE";
        value = "%" + escapeSingleQuotes(value) + "%";
        break;
      case "Starts With":
        operator = "LIKE";
        value = escapeSingleQuotes(value) + "%";
        break;
      case "Ends With":
        operator = "LIKE";
        value = "%" + escapeSingleQuotes(value);
        break;
      case "Is Null":
        operator = "IS NULL";
        break;
      case "Is Not Null":
        operator = "IS NOT NULL";
        break;
      case "IN":
        operator = "IN";
        // add brackets if not present in "IN" conditions
        value = splitQuotedString(value).map((it: any) => ({
          type: "single_quote_string",
          value: escapeSingleQuotes(it),
        }));
        break;
      case "NOT IN":
        operator = "NOT IN";
        // add brackets if not present in "NOT IN" conditions
        value = splitQuotedString(value).map((it: any) => ({
          type: "single_quote_string",
          value: escapeSingleQuotes(it),
        }));
        break;
      case "=":
      case "<>":
      case "!=":
      case "<":
      case ">":
      case "<=":
      case ">=":
        // If value starts and ends with quote, remove it
        value =
          value &&
          value.length > 1 &&
          value.startsWith("'") &&
          value.endsWith("'")
            ? value.substring(1, value.length - 1)
            : value;
        // escape single quotes by doubling them
        value = escapeSingleQuotes(value);
        break;
    }

    // Construct condition based on operator
    condition =
      operator === "IS NULL" || operator === "IS NOT NULL"
        ? {
            type: "binary_expr",
            operator: operator,
            left: {
              type: "column_ref",
              table: null,
              column: label,
            },
            right: {
              type: "",
            },
          }
        : {
            type: "binary_expr",
            operator: operator,
            left: {
              type: "column_ref",
              table: null,
              column: label,
            },
            right: {
              type:
                operator === "IN" || operator === "NOT IN"
                  ? "expr_list"
                  : "string",
              value: value,
            },
          };
  }

  const ast: any = parser.astify(originalQuery);

  let query = "";
  if (!ast.where) {
    // If there is no WHERE clause, create a new one
    const newWhereClause = condition;

    const newAst = {
      ...ast,
      where: newWhereClause,
    };

    const sql = parser.sqlify(newAst);
    const quotedSql = sql.replace(/`/g, '"');
    query = quotedSql;
  } else {
    const newCondition = {
      type: "binary_expr",
      operator: "AND",
      // parentheses: true,
      left: {
        // parentheses: true,
        ...ast.where,
      },
      right: condition,
    };

    const newAst = {
      ...ast,
      where: newCondition,
    };

    const sql = parser.sqlify(newAst);
    const quotedSql = sql.replace(/`/g, '"');

    query = quotedSql;
  }

  return query;
};

export const getStreamFromQuery = async (query: any) => {
  await importSqlParser();

  try {
    const ast: any = parser.astify(query);
    return ast?.from[0]?.table || "";
  } catch (e: any) {
    return "";
  }
};

// returns 'ASC' or 'DESC' if exist
// return null if not exist

export const isGivenFieldInOrderBy = async (
  sqlQuery: string,
  fieldAlias: string,
) => {
  try {
    await importSqlParser();
    const ast: any = parser.astify(sqlQuery);

    if (ast?.orderby) {
      for (const item of ast.orderby) {
        if (item?.expr?.column?.expr?.value === fieldAlias) {
          return item.type; // 'ASC' or 'DESC'
        }
      }
    }

    return null;
  } catch (error) {
    // Handle the error as needed
    return null;
  }
};

// Function to extract field names, aliases, and aggregation functions
export function extractFields(parsedAst: any, timeField: string) {
  let fields = parsedAst.columns.map((column: any) => {
    const field = {
      column: "",
      alias: "",
      aggregationFunction: null,
    };

    if (column.expr.type === "column_ref") {
      field.column = column?.expr?.column?.expr?.value ?? timeField;
    } else if (column.expr.type === "aggr_func") {
      field.column = column?.expr?.args?.expr?.column?.expr?.value ?? timeField;
      field.aggregationFunction = column?.expr?.name?.toLowerCase() ?? "count";
    } else if (column.expr.type === "function") {
      // histogram field
      field.column =
        column?.expr?.args?.value[0]?.column?.expr?.value ?? timeField;
      field.aggregationFunction =
        column?.expr?.name?.name[0]?.value?.toLowerCase() ?? "histogram";

      if (field.aggregationFunction === "approx_percentile_cont") {
        // check 2nd argument of function
        if (
          column?.expr?.args?.value[1]?.value === "0.5" ||
          column?.expr?.args?.value[1]?.value === "0.50"
        ) {
          field.aggregationFunction = "p50";
        } else if (
          column?.expr?.args?.value[1]?.value === "0.9" ||
          column?.expr?.args?.value[1]?.value === "0.90"
        ) {
          field.aggregationFunction = "p90";
        } else if (column?.expr?.args?.value[1]?.value === "0.95") {
          field.aggregationFunction = "p95";
        } else if (column?.expr?.args?.value[1]?.value === "0.99") {
          field.aggregationFunction = "p99";
        } else {
          throw new Error("Unsupported percentile value");
        }
      }
    }

    field.alias = column?.as ?? field?.column ?? timeField;

    return field;
  });

  // Check if all fields are selected and remove the `*` entry
  const allFieldsSelected = parsedAst.columns.some(
    (column: any) => column.expr && column.expr.column === "*",
  );

  if (allFieldsSelected) {
    // empty fields array
    fields = [];
  }

  return fields;
}

function parseCondition(condition: any) {
  try {
    if (condition.type === "binary_expr") {
      if (condition.operator == "OR" || condition.operator == "AND") {
        const left: any = parseCondition(condition.left);
        const right: any = parseCondition(condition.right);

        // set current logical operator to the right side
        if (Array.isArray(right)) {
          right[0].logicalOperator = condition.operator ?? "AND";
        } else {
          right.logicalOperator = condition.operator ?? "AND";
        }

        // conditions array
        const conditions = [];

        // if left is array
        if (Array.isArray(left)) {
          // distructure left array and push
          conditions.push(...left);
        } else {
          // if left is not array, push left object
          conditions.push(left);
        }

        // if right is array
        if (Array.isArray(right)) {
          // distructure right array and push
          conditions.push(...right);
        } else {
          // if right is not array, push right object
          conditions.push(right);
        }

        // if parentheses are true, create new group
        // else return conditions array
        if (condition.parentheses == true) {
          return {
            filterType: "group",
            logicalOperator: "AND",
            conditions: conditions,
          };
        } else {
          return conditions;
        }
      } else if (
        condition.operator == "=" ||
        condition.operator == "<" ||
        condition.operator == ">" ||
        condition.operator == "<=" ||
        condition.operator == ">="
      ) {
        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value,
          operator: condition?.operator,
          value: `'${condition?.right?.value}'`,
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition.operator == "!=" || condition.operator == "<>") {
        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value,
          operator: "<>",
          value: `'${condition?.right?.value}'`,
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition.operator == "NOT IN") {
        // create values array based on right side of condition
        // quote the values
        const values =
          condition?.right?.value?.map((value: any) => `'${value?.value}'`) ??
          [];

        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value ?? "",
          operator: condition?.operator,
          value: values?.join(","),
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition.operator == "IN") {
        // create values array based on right side of condition
        const values = condition.right.value.map(
          (value: any) => `${value?.value}`,
        );

        return {
          type: "list",
          values: values,
          column: condition?.left?.column?.expr?.value ?? "",
          operator: null,
          value: null,
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition.operator == "IS") {
        // consider this as "IS NULL"
        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value,
          operator: "Is Null",
          value: null,
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition.operator == "IS NOT") {
        // consider this as "IS NOT NULL"
        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value,
          operator: "Is Not Null",
          value: null,
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (condition?.operator == "LIKE") {
        // Check the pattern to determine the specific operator
        const rightValue = condition?.right?.value || "";

        if (rightValue.startsWith("%") && rightValue.endsWith("%")) {
          // Pattern: %value% - Contains
          const value = rightValue?.replace(/^%/, "").replace(/%$/, "");
          return {
            type: "condition",
            values: [],
            column: condition?.left?.column?.expr?.value,
            operator: "Contains",
            value: `${value}`,
            logicalOperator: "AND",
            filterType: "condition",
          };
        } else if (rightValue.startsWith("%")) {
          // Pattern: %value - Ends With
          const value = rightValue.replace(/^%/, "");
          return {
            type: "condition",
            values: [],
            column: condition?.left?.column?.expr?.value,
            operator: "Ends With",
            value: `${value}`,
            logicalOperator: "AND",
            filterType: "condition",
          };
        } else if (rightValue.endsWith("%")) {
          // Pattern: value% - Starts With
          const value = rightValue.replace(/%$/, "");
          return {
            type: "condition",
            values: [],
            column: condition?.left?.column?.expr?.value,
            operator: "Starts With",
            value: `${value}`,
            logicalOperator: "AND",
            filterType: "condition",
          };
        } else {
          // No % pattern - treat as Contains for fallback
          return {
            type: "condition",
            values: [],
            column: condition?.left?.column?.expr?.value,
            operator: "Contains",
            value: `${rightValue}`,
            logicalOperator: "AND",
            filterType: "condition",
          };
        }
      } else if (condition?.operator == "NOT LIKE") {
        // right value may have % at the beginning or end or both
        // so we need to remove it
        const value = condition?.right?.value
          ?.replace(/^%/, "")
          .replace(/%$/, "");
        return {
          type: "condition",
          values: [],
          column: condition?.left?.column?.expr?.value,
          operator: "Not Contains",
          value: `${value}`,
          logicalOperator: "AND",
          filterType: "condition",
        };
      }
    } else if (condition.type === "function") {
      const conditionName = condition?.name?.name?.[0]?.value?.toLowerCase();

      // function with field name and value
      const conditionsWithFieldName = [
        "str_match",
        "str_match_ignore_case",
        "re_match",
        "re_not_match",
      ];

      // function without field name and with value
      const conditionsWithoutFieldName = ["match_all"];

      if (conditionsWithFieldName.includes(conditionName)) {
        return {
          type: "condition",
          values: [],
          column: condition?.args?.value[0]?.column?.expr?.value ?? "",
          operator: conditionName,
          value: condition?.args?.value[1]?.value ?? "",
          logicalOperator: "AND",
          filterType: "condition",
        };
      } else if (conditionsWithoutFieldName.includes(conditionName)) {
        return {
          type: "condition",
          values: [],
          column: "",
          operator: conditionName,
          value: condition?.args?.value[0]?.value ?? "",
          logicalOperator: "AND",
          filterType: "condition",
        };
      }
    }
  } catch (error) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }
}

function convertWhereToFilter(where: any) {
  try {
    if (!where) {
      return {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }
    const parsedCondition = parseCondition(where);

    // if parsed condition is an array, it means it's a group
    if (Array.isArray(parsedCondition)) {
      return {
        filterType: "group",
        logicalOperator: "AND",
        conditions: parsedCondition,
      };
    }
    // if parsed condition is an object, it means it's a condition
    return parsedCondition;
  } catch (error) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }
}

function extractFilters(parsedAst: any) {
  try {
    return convertWhereToFilter(parsedAst.where);
  } catch (error) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }
}

// Function to extract the table name
function extractTableName(parsedAst: any) {
  return parsedAst.from[0].table ?? null;
}

export const getFieldsFromQuery = async (
  query: any,
  timeField: string = "_timestamp",
) => {
  try {
    await importSqlParser();

    const ast: any = parser.astify(query);

    const streamName = extractTableName(ast) ?? null;
    let fields = extractFields(ast, timeField);
    let filters: any = extractFilters(ast);

    // remove wrong fields and filters
    fields = fields.filter((field: any) => field.column);

    // if type is condition
    if (filters?.filterType === "condition") {
      filters = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [filters],
      };
    }

    return {
      fields,
      filters,
      streamName,
    };
  } catch (error) {
    return {
      fields: [
        {
          column: timeField,
          alias: "x_axis_1",
          aggregationFunction: "histogram",
        },
        {
          column: timeField,
          alias: "y_axis_1",
          aggregationFunction: "count",
        },
      ],
      filters: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      },
      streamName: null,
    };
  }
};

export const buildSqlQuery = (
  tableName: string,
  fields: any,
  whereClause: string,
) => {
  let query = "SELECT ";

  // If the fields array is empty, use *, otherwise join the fields with commas
  if (fields.length === 0) {
    query += "*";
  } else {
    query += fields.join(", ");
  }

  // Add the table name
  query += ` FROM "${tableName}"`;

  // If the whereClause is not empty, add it
  if (whereClause.trim() !== "") {
    query += " WHERE " + whereClause;
  }

  // Return the constructed query
  return query;
};
export const changeHistogramInterval = async (
  query: any,
  histogramInterval: any,
) => {
  try {
    // if histogramInterval is null or query is null or query is empty, return query
    if (query === null || query === "") {
      return query;
    }

    await importSqlParser();
    const ast: any = parser.astify(query);

    // Iterate over the columns to check if the column is histogram
    ast?.columns?.forEach((column: any) => {
      // check if the column is histogram
      if (
        column.expr.type === "function" &&
        column?.expr?.name?.name?.[0]?.value === "histogram" &&
        histogramInterval !== null
      ) {
        const histogramExpr = column.expr;
        if (histogramExpr.args && histogramExpr.args.type === "expr_list") {
          // if selected histogramInterval is null then remove interval argument
          if (!histogramInterval) {
            histogramExpr.args.value = histogramExpr.args.value.slice(0, 1);
          }
          // else update interval argument
          else {
            // check if there is existing interval value
            // if have then do not do anything
            // else insert new arg with given histogramInterval
            if (histogramExpr.args.value[1]) {
              // Update existing interval value
              // histogramExpr.args.value[1] = {
              //   type: "single_quote_string",
              //   value: `${histogramInterval}`,
              // };
            } else {
              // create new arg for interval
              histogramExpr.args.value.push({
                type: "single_quote_string",
                value: `${histogramInterval}`,
              });
            }
          }
        }
      }
    });

    const sql = parser.sqlify(ast);
    return sql.replace(/`/g, '"');
  } catch (error) {
    return query;
  }
};

export const convertQueryIntoSingleLine = async (query: any) => {
  try {
    // if query is null or empty, return query as is
    if (query === null || query === "") {
      return query;
    }

    await importSqlParser();
    const ast: any = parser.astify(query);

    const sql = parser.sqlify(ast);
    return sql.replace(/`/g, '"');
  } catch (error) {
    return query;
  }
};

function hasAggregation(columns: any) {
  if (columns) {
    for (const column of columns) {
      if (column.expr && column.expr.type === "aggr_func") {
        return true; // Found aggregation function or non-null groupby property
      }
    }
  }
  return false; // No aggregation function or non-null groupby property found
}

const isLimitQuery = (parsedSQL: any = null) => {
  return parsedSQL?.limit && parsedSQL?.limit.value?.length > 0;
};

export const shouldUseHistogramQuery = async (query: any) => {
  try {
    await importSqlParser();
    const ast: any = parser.astify(query);

    if (!query) return true;

    if (isLimitQuery(ast)) return false;

    if (hasAggregation(ast.columns)) return false;

    return true;
  } catch (error) {
    return true;
  }
};

// // Test function for extractFields
// export const testExtractFields = async () => {
//   console.log("=== Testing extractFields function ===");
  
//   const testCases = [
//     {
//       query: "SELECT _timestamp FROM table1",
//       testName: "Basic timestamp selection",
//     },
//     {
//       query: "SELECT name, _timestamp, status FROM table1",
//       testName: "Multiple column selection",
//     },
//     {
//       query: "SELECT * FROM table1",
//       testName: "Wildcard selection",
//     },
//     {
//       query: "SELECT COUNT(*) FROM table1",
//       testName: "Count aggregation",
//     },
//     {
//       query: "SELECT COUNT(*) AS total_count FROM table1",
//       testName: "Count aggregation with alias",
//     },
//     {
//       query: "SELECT MAX(_timestamp) FROM table1",
//       testName: "Max aggregation without alias",
//     },
//     {
//       query: "SELECT MAX(_timestamp) AS max_time FROM table1",
//       testName: "Max aggregation with alias",
//     },
//     {
//       query: "SELECT histogram(_timestamp) FROM table1",
//       testName: "Histogram function",
//     },
//     {
//       query: "SELECT histogram(_timestamp) AS time_hist FROM table1",
//       testName: "Histogram function with alias",
//     },
//     {
//       query: "SELECT histogram(_timestamp, '1h') FROM table1",
//       testName: "Histogram function with interval",
//     },
//     {
//       query: "SELECT approx_percentile_cont(_timestamp, 0.5) FROM table1",
//       testName: "Percentile p50",
//     },
//     {
//       query: "SELECT approx_percentile_cont(_timestamp, 0.9) FROM table1",
//       testName: "Percentile p90",
//     },
//     {
//       query: "SELECT approx_percentile_cont(_timestamp, 0.95) FROM table1",
//       testName: "Percentile p95",
//     },
//     {
//       query: "SELECT approx_percentile_cont(_timestamp, 0.99) FROM table1",
//       testName: "Percentile p99",
//     },
//     {
//       query: "SELECT approx_percentile_cont(response_time, 0.5) AS median_response FROM table1",
//       testName: "Percentile with different field and alias",
//     },
//     {
//       query: "SELECT COUNT(*), MAX(_timestamp), MIN(response_time) FROM table1",
//       testName: "Multiple aggregations",
//     },
//     {
//       query: "SELECT name, COUNT(*) AS count, histogram(_timestamp) AS time_bucket FROM table1",
//       testName: "Mixed columns and functions",
//     },
//     {
//       query: "SELECT _timestamp AS time, name AS user_name, status FROM table1",
//       testName: "Columns with aliases",
//     },
//     // Additional test cases for timestamp detection
//     {
//       query: "SELECT _timestamp FROM table1",
//       testName: "Direct timestamp selection",
//     },
//     {
//       query: "SELECT name, _timestamp FROM table1",
//       testName: "Timestamp with other columns",
//     },
//     {
//       query: "SELECT * FROM table1",
//       testName: "Wildcard selection includes timestamp",
//     },
//     {
//       query: "SELECT name FROM table1",
//       testName: "No timestamp selected",
//     },
//     {
//       query: "SELECT MAX(_timestamp) FROM table1",
//       testName: "Function without _timestamp alias",
//     },
//     {
//       query: "SELECT MAX(_timestamp), MAX(_timestamp) as _timestamp FROM table1",
//       testName: "One function has _timestamp alias",
//     },
//     {
//       query: "SELECT MAX(_timestamp) as _timestamp FROM table1",
//       testName: "Function aliased as _timestamp",
//     },
//     {
//       query: "SELECT MIN(_timestamp) as other FROM table1",
//       testName: "Function with different alias",
//     },
//     {
//       query: "SELECT _timestamp + 1 FROM table1",
//       testName: "Expression without _timestamp alias",
//     },
//     {
//       query: "SELECT (_timestamp + 1) as _timestamp FROM table1",
//       testName: "Expression aliased as _timestamp",
//     },
//     {
//       query: "SELECT t1._timestamp FROM table1 t1",
//       testName: "Table qualified timestamp",
//     },
//     {
//       query: "SELECT t1._timestamp as other FROM table1 t1",
//       testName: "Table qualified timestamp with alias",
//     },
//     {
//       query: "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END FROM table1",
//       testName: "CASE without alias",
//     },
//     {
//       query: "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END as _timestamp FROM table1",
//       testName: "CASE aliased as _timestamp",
//     },
//     {
//       query: "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
//       testName: "CTE without timestamp in final result",
//     },
//   ];

//   for (const testCase of testCases) {
//     try {
//       console.log(`\n--- ${testCase.testName} ---`);
//       console.log(`Query: ${testCase.query}`);
      
//       await importSqlParser();
//       const ast = parser.astify(testCase.query);
//       const result = extractFields(ast, "_timestamp");
      
//       console.log("Result:", JSON.stringify(result, null, 2));
//     } catch (error) {
//       console.error(`Error in test "${testCase.testName}":`, error);
//     }
//   }
  
//   console.log("\n=== Test completed ===");
// };

// // Call the test function
// // Uncomment the line below to run the tests
// testExtractFields();
