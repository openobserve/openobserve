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

use std::ops::ControlFlow;

use infra::errors::Error;
use sqlparser::{
    ast::{
        Expr, Function, FunctionArg, FunctionArgExpr, FunctionArguments, ObjectName, Value,
        ValueWithSpan, VisitMut, VisitorMut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use crate::datafusion::udf::cipher_udf::{
    DECRYPT_SLOW_UDF_NAME, DECRYPT_UDF_NAME, ENCRYPT_UDF_NAME,
};

pub fn get_cipher_key_names(sql: &str) -> Result<Vec<String>, Error> {
    let dialect = &PostgreSqlDialect {};
    let mut statement = Parser::parse_sql(dialect, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .ok_or_else(|| Error::Message("empty sql".to_string()))?;
    let mut visitor = ExtractKeyNamesVisitor::new();
    let _ = statement.visit(&mut visitor);
    if let Some(e) = visitor.error {
        Err(e)
    } else {
        Ok(visitor.keys)
    }
}

struct ExtractKeyNamesVisitor {
    keys: Vec<String>,
    error: Option<Error>,
}

impl ExtractKeyNamesVisitor {
    fn new() -> Self {
        Self {
            keys: Vec::new(),
            error: None,
        }
    }
}

impl VisitorMut for ExtractKeyNamesVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(Function {
            name: ObjectName(names),
            args,
            ..
        }) = expr
        {
            // cipher functions will always be 1-part names
            if names.len() != 1 {
                return ControlFlow::Continue(());
            }
            let Some(fname) = names.first().and_then(|name| name.as_ident()) else {
                return ControlFlow::Continue(());
            };
            // DataFusion lowercases an unquoted function name before it resolves the UDF, so
            // `DECRYPT(..)` reaches the cipher UDF and must be matched here the same way.
            let fname = match fname.quote_style {
                Some(_) => fname.value.clone(),
                None => fname.value.to_ascii_lowercase(),
            };
            if fname == ENCRYPT_UDF_NAME
                || fname == DECRYPT_UDF_NAME
                || fname == DECRYPT_SLOW_UDF_NAME
            {
                let list = match args {
                    FunctionArguments::List(list) => list,
                    _ => {
                        self.error = Some(Error::Message(
                            "invalid arguments to cipher function".to_string(),
                        ));
                        return ControlFlow::Continue(());
                    }
                };
                if list.args.len() < 2 {
                    self.error = Some(Error::Message(
                        "invalid number of arguments to cipher function, expected at least 2: column, key and optional path".to_string(),
                    ));
                    return ControlFlow::Continue(());
                }
                let arg = match &list.args[1] {
                    FunctionArg::Named { arg, .. } => arg,
                    FunctionArg::Unnamed(arg) => arg,
                    FunctionArg::ExprNamed { arg, .. } => arg,
                };
                match arg {
                    FunctionArgExpr::Expr(Expr::Value(ValueWithSpan {
                        value: Value::SingleQuotedString(s),
                        span: _,
                    })) => {
                        self.keys.push(s.to_owned());
                    }
                    _ => {
                        self.error = Some(Error::Message(
                            "key name must be a static string in cipher function".to_string(),
                        ));
                        return ControlFlow::Continue(());
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_cipher_key_names_no_cipher_functions() {
        let sql = "SELECT a, b FROM t WHERE a = 1";
        let keys = get_cipher_key_names(sql).unwrap();
        assert!(keys.is_empty());
    }

    #[test]
    fn test_get_cipher_key_names_encrypt() {
        let sql = "SELECT encrypt(col, 'mykey') FROM t";
        let keys = get_cipher_key_names(sql).unwrap();
        assert_eq!(keys, vec!["mykey"]);
    }

    #[test]
    fn test_get_cipher_key_names_decrypt() {
        let sql = "SELECT decrypt(col, 'secret') FROM t";
        let keys = get_cipher_key_names(sql).unwrap();
        assert_eq!(keys, vec!["secret"]);
    }

    #[test]
    fn test_get_cipher_key_names_decrypt_path() {
        let sql = "SELECT decrypt_path(col, 'pathkey') FROM t";
        let keys = get_cipher_key_names(sql).unwrap();
        assert_eq!(keys, vec!["pathkey"]);
    }

    #[test]
    fn test_get_cipher_key_names_multiple_cipher_calls() {
        let sql = "SELECT encrypt(a, 'k1'), decrypt(b, 'k2') FROM t";
        let mut keys = get_cipher_key_names(sql).unwrap();
        keys.sort();
        assert_eq!(keys, vec!["k1", "k2"]);
    }

    #[test]
    fn test_get_cipher_key_names_uppercase_and_mixed_case() {
        for sql in [
            "SELECT DECRYPT(col, 'secret') FROM t",
            "SELECT DeCrYpT(col, 'secret') FROM t",
            "SELECT ENCRYPT(col, 'secret') FROM t",
            "SELECT Decrypt_Path(col, 'secret') FROM t",
        ] {
            assert_eq!(get_cipher_key_names(sql).unwrap(), vec!["secret"], "{sql}");
        }
    }

    #[test]
    fn test_get_cipher_key_names_quoted_name_keeps_case() {
        // DataFusion resolves a quoted name verbatim, so "DECRYPT" is not the cipher UDF.
        assert!(
            get_cipher_key_names("SELECT \"DECRYPT\"(col, 'secret') FROM t")
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            get_cipher_key_names("SELECT \"decrypt\"(col, 'secret') FROM t").unwrap(),
            vec!["secret"]
        );
    }

    #[test]
    fn test_get_cipher_key_names_where_only() {
        let sql =
            "SELECT _timestamp FROM t WHERE id = 'x' AND substr(decrypt(col, 'wkey'), 1, 1) = 'S'";
        let keys = get_cipher_key_names(sql).unwrap();
        assert_eq!(keys, vec!["wkey"]);
    }

    #[test]
    fn test_get_cipher_key_names_empty_sql_returns_error() {
        assert!(get_cipher_key_names("").is_err());
    }

    #[test]
    fn test_get_cipher_key_names_invalid_sql_returns_error() {
        let result = get_cipher_key_names("NOT VALID SQL @@@@");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_cipher_key_names_too_few_args_returns_err() {
        // encrypt with only 1 arg → "invalid number of arguments" error
        let sql = "SELECT encrypt(col) FROM t";
        let result = get_cipher_key_names(sql);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("invalid number of arguments"), "got: {msg}");
    }

    #[test]
    fn test_get_cipher_key_names_non_string_key_returns_err() {
        // key arg is a column reference instead of string literal
        let sql = "SELECT encrypt(col, other_col) FROM t";
        let result = get_cipher_key_names(sql);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("key name must be a static string"),
            "got: {msg}"
        );
    }
}
