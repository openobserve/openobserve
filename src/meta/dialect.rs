use sqlparser::dialect::Dialect;

#[derive(Debug, Default)]
pub struct ZincDialect;

// ZincDialect support url as identifier
impl Dialect for ZincDialect {
    fn is_identifier_start(&self, ch: char) -> bool {
        ch.is_ascii_lowercase() || ch.is_ascii_uppercase() || ch == '_'
    }

    // identifier support ':', '/', '?', '&', '='
    fn is_identifier_part(&self, ch: char) -> bool {
        ch.is_ascii_lowercase()
            || ch.is_ascii_uppercase()
            || ch.is_ascii_digit()
            || [':', '/', '?', '&', '=', '-', '_', '.'].contains(&ch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::parser::Parser;

    #[test]
    fn test_zinc_dilect() {
        let sql = {
            let url = "https://github.com/zinc-labs/zinc/blob/main/examples/sql/test.csv";

            let sql = format!(
                "select * from {} where Country IN('GRE', 'USA') and _timestamp > '2022-09-02T06:29:11Z' limit 2",
                url
            );

            sql
        };
        assert!(Parser::parse_sql(&ZincDialect::default(), &sql).is_ok());
    }
}
