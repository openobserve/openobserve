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
      label.operator
    );
  }

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
};

export const addLabelToSQlQuery = async (
  originalQuery: any,
  label: any,
  value: any,
  operator: any
) => {
  await importSqlParser();

  let condition: any;

  switch (operator) {
    case "Contains":
      operator = "LIKE";
      value = "%" + value + "%";
      break;
    case "Not Contains":
      operator = "NOT LIKE";
      value = "%" + value + "%";
      break;
    case "Is Null":
      operator = "IS NULL";
      break;
    case "Is Not Null":
      operator = "IS NOT NULL";
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
            type: "string",
            value: value,
          },
        };

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
  fieldAlias: string
) => {
  await importSqlParser();
  const ast: any = parser.astify(sqlQuery);

  if (ast?.orderby) {
    for (const item of ast.orderby) {
      if (item?.expr?.column === fieldAlias) {
        return item.type; // 'ASC' or 'DESC'
      }
    }
  }

  return null;
};

export const getFieldsFromQuery = async (query: any) => {
  await importSqlParser();
  const ast: any = parser.astify(query);

  // Function to extract field names, aliases, and aggregation functions
  function extractFields(parsedAst: any) {
    const fields = parsedAst.columns.map((column: any) => {
      const field = {
        name: "",
        alias: "",
        aggregation: "",
      };

      if (column.expr.type === "column_ref") {
        field.name = column?.expr?.column;
      } else if (column.expr.type === "aggr_func") {
        field.name = column?.expr?.args?.expr?.column;
        field.aggregation = column?.expr?.name?.toUpperCase();
      }

      if (column.as) {
        field.alias = column.as;
      }

      return field;
    });

    // Check if all fields are selected
    const allFieldsSelected = parsedAst.columns.some(
      (column: any) => column.expr && column.expr.column === "*"
    );

    if (allFieldsSelected) {
      // Add histogram(_timestamp) and count(_timestamp) to the fields array
      fields.push(
        { name: "_timestamp", alias: "", aggregation: "HISTOGRAM" },
        { name: "_timestamp", alias: "", aggregation: "COUNT" }
      );
    }

    return fields;
  }

  // Function to extract conditions from the WHERE clause
  function extractConditions(parsedAst: any) {
    const conditions: any = [];

    function traverseCondition(node: any) {
      if (node.type === "binary_expr") {
        const condition = {
          column: "",
          operator: node.operator,
          value: "",
        };

        if (node.left.type === "column_ref") {
          condition.column = node.left.column;
        }

        if (
          node.right.type === "string" ||
          node.right.type === "number" ||
          node.right.type === "single_quote_string"
        ) {
          condition.value = node.right.value;
        } else if (node.right.type === "column_ref") {
          condition.value = node.right.column;
        } else if (node.right.type === "expr_list") {
          condition.value = node.right.value.map(
            (item: any) => item.value || item.column
          );
        }

        conditions.push(condition);
      } else if (node.type === "unary_expr" && node.operator === "NOT") {
        const condition = {
          column: "",
          operator: "NOT",
          value: "",
        };

        if (node.expr.type === "binary_expr") {
          condition.operator = `NOT ${node.expr.operator}`;
          if (node.expr.left.type === "column_ref") {
            condition.column = node.expr.left.column;
          }
          if (
            node.expr.right.type === "string" ||
            node.expr.right.type === "number" ||
            node.expr.right.type === "single_quote_string"
          ) {
            condition.value = node.expr.right.value;
          } else if (node.expr.right.type === "column_ref") {
            condition.value = node.expr.right.column;
          }
        }

        conditions.push(condition);
      }

      if (node.left && node.left.type === "binary_expr") {
        traverseCondition(node.left);
      }

      if (node.right && node.right.type === "binary_expr") {
        traverseCondition(node.right);
      }
    }

    if (parsedAst.where) {
      traverseCondition(parsedAst.where);
    }

    return conditions;
  }

  const fields = extractFields(ast);
  const conditions = extractConditions(ast);
  return { fields, conditions };
};
