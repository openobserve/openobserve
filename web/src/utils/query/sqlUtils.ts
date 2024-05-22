let parser: any;

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

importSqlParser();

export const addLabelsToSQlQuery = (originalQuery: any, labels: any) => {
  let dummyQuery = "select * from 'default'";
  labels.forEach((label: any) => {
    dummyQuery = addLabelToSQlQuery(
      dummyQuery,
      label.name,
      label.value,
      label.operator
    );
  });

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

export const addLabelToSQlQuery = (
  originalQuery: any,
  label: any,
  value: any,
  operator: any
) => {
  const ast: any = parser.astify(originalQuery);

  let query = "";
  if (!ast.where) {
    // If there is no WHERE clause, create a new one
    const newWhereClause = {
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
      right: {
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
      },
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

export const getStreamFromQuery = (query: any) => {
  try {
    const ast: any = parser.astify(query);
    return ast?.from[0]?.table || "";
  } catch (e: any) {
    return "";
  }
};
