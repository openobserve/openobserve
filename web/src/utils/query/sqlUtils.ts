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
    console.log("inside");


    const sql = parser.sqlify({
      ...ast,
      where: {
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
    });
    
    const quotedSql = sql.replace(/`/g, '"');
    console.log("sqlll", sql);

    query = quotedSql;
  }
 
  return query;
};
