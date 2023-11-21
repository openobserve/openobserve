import { Parser } from "node-sql-parser/build/mysql";

export const addLabelToSQlQuery = (
  originalQuery: any,
  label: any,
  value: any,
  operator: any
) => {
  const parser = new Parser();
  const ast = parser.astify(originalQuery)
  console.log("ast",ast);
  
  console.log("originalQuery", originalQuery);
  console.log("label", label);

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
    console.log("sqlll", ast);
    
    console.log("sqlll", sql);

    query = quotedSql;
  } else {
    const newCondition = {
      type: "binary_expr",
      operator: "AND",
      left: ast.where,
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
    console.log("sqlll", sql);

    query = quotedSql;
  }
 
  return query;
};
