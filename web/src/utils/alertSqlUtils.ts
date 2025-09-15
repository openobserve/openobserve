/**
 * Alert SQL Query Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

export interface SqlUtilsContext {
  parser: any;
  sqlQueryErrorMsg: any;
}

export const getParser = (sqlQuery: string, context: SqlUtilsContext): boolean => {
  const { parser, sqlQueryErrorMsg } = context;
  try {
    // As default is a reserved keyword in sql-parser, we are replacing it with default1
    const regex = /\bdefault\b/g;
    const columns = parser.astify(
      sqlQuery.replace(regex, "default1"),
    ).columns;
    for (const column of columns) {
      if (column.expr.column === "*") {
        sqlQueryErrorMsg.value = "Selecting all columns is not allowed";
        return false;
      }
    }
    return true;
  } catch (error) {
    // In catch block we are returning true, as we just wanted to validate if user have added * in the query to select all columns
    // select field from default // here default is not wrapped in "" so node sql parser will throw error as default is a reserved keyword. But our Backend supports this query without quotes
    // Query will be validated in the backend
    console.log(error);
    return true;
  }
};