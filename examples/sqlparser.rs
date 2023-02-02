use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

fn main() {
    let sql = "SELECT a, b, 123, myfunc(b) \
           FROM table_1 \
           WHERE a > b AND b < 100 AND (c = 1 or b = 2) \
           ORDER BY a DESC, b ASC limit 10,0 ";

    let dialect = GenericDialect {}; // or AnsiDialect, or your own dialect ...

    let parse_result = Parser::parse_sql(&dialect, sql);
    let ast = match parse_result {
        Ok(stmt) => stmt,
        Err(e) => {
            println!("err {:?}", e);
            vec![]
        }
    };

    let query = ast
        .iter()
        .filter_map(|stmt| match stmt {
            sqlparser::ast::Statement::Query(q) => Some(q),
            _ => None,
        })
        .next()
        .unwrap();

    // println!("AST: {:?}", query);

    println!("SQL->body: {:?}", query.body);
    println!("SQL->order_by: {:?}", query.order_by);
    println!("SQL->limit: {:?}", query.limit);
    println!("SQL->offset: {:?}", query.offset);
}
