// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::DateTime;
use regex::Regex;
use serde::Serialize;
use sqlparser::ast::{
    BinaryOperator, Expr as SqlExpr, Function, FunctionArg, FunctionArgExpr, Offset as SqlOffset,
    OrderByExpr, Select, SelectItem, SetExpr, Statement, TableFactor, TableWithJoins, Value,
};
use sqlparser::parser::Parser;

use crate::infra::config::CONFIG;

/// parsed sql
#[derive(Clone, Debug, Serialize)]
pub struct Sql {
    pub(crate) fields: Vec<String>,           // projection, select, fields
    pub(crate) selection: Option<SqlExpr>,    // where
    pub(crate) source: String,                // table
    pub(crate) order_by: Vec<(String, bool)>, // desc: true / false
    pub(crate) group_by: Vec<String>,         // field
    pub(crate) offset: usize,
    pub(crate) limit: usize,
    pub(crate) quick_text: Vec<(String, String, SqlOperator)>, // use text line quick filter
    pub(crate) full_text: Vec<(String, SqlOperator)>, // fulltext: value1 and value2, and: true / false
    pub(crate) time_range: Option<(i64, i64)>,
    pub(crate) field_alias: Vec<(String, String)>, // alias for select field
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum SqlOperator {
    And,
    Or,
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Like,
}

#[derive(Clone, Debug, Serialize)]
pub enum SqlValue {
    String(String),
    Number(i64),
}

pub struct Projection<'a>(pub(crate) &'a Vec<SelectItem>);
pub struct Quicktext<'a>(pub(crate) &'a Option<SqlExpr>);
pub struct Fulltext<'a>(pub(crate) &'a Option<SqlExpr>);
pub struct Timerange<'a>(pub(crate) &'a Option<SqlExpr>);
pub struct Source<'a>(pub(crate) &'a [TableWithJoins]);
pub struct Order<'a>(pub(crate) &'a OrderByExpr);
pub struct Group<'a>(pub(crate) &'a SqlExpr);
pub struct Offset<'a>(pub(crate) &'a SqlOffset);
pub struct Limit<'a>(pub(crate) &'a SqlExpr);

impl Sql {
    pub fn new(sql: &str) -> Result<Sql, anyhow::Error> {
        if sql.is_empty() {
            return Err(anyhow::anyhow!("SQL is empty"));
        }
        let dialect = sqlparser::dialect::GenericDialect {};
        let statement = Parser::parse_sql(&dialect, sql);
        if statement.is_err() {
            return Err(anyhow::anyhow!(statement.err().unwrap()));
        }
        let statement = statement.unwrap();
        if statement.is_empty() {
            return Err(anyhow::anyhow!("sql is empty"));
        }
        let statement = &statement[0];
        let sql: Result<Sql, anyhow::Error> = statement.try_into();
        if sql.is_err() {
            return Err(sql.err().unwrap());
        }

        Ok(sql.unwrap())
    }
}

impl TryFrom<&Statement> for Sql {
    type Error = anyhow::Error;

    fn try_from(sql: &Statement) -> Result<Self, Self::Error> {
        match sql {
            // just take case of: query (select ... from ... where ...)
            Statement::Query(q) => {
                let offset = q.offset.as_ref();
                let limit = q.limit.as_ref();
                let orders = &q.order_by;
                let Select {
                    from: table_with_joins,
                    selection,
                    projection,
                    group_by: groups,
                    ..
                } = match &q.body.as_ref() {
                    SetExpr::Select(statement) => statement.as_ref(),
                    _ => {
                        return Err(anyhow::anyhow!(
                            "We only support Select Query at the moment"
                        ))
                    }
                };

                let source = Source(table_with_joins).try_into()?;

                let mut order_by = Vec::new();
                for expr in orders {
                    order_by.push(Order(expr).try_into()?);
                }

                let mut group_by = Vec::new();
                for expr in groups {
                    group_by.push(Group(expr).try_into()?);
                }

                let offset = offset.map_or(0, |v| Offset(v).into());
                let limit = limit.map_or(0, |v| Limit(v).into());

                let fields = Projection(projection).try_into()?;
                let selection = selection.as_ref().cloned();
                let field_alias: Vec<(String, String)> = Projection(projection).try_into()?;

                let quick_text: Vec<(String, String, SqlOperator)> =
                    Quicktext(&selection).try_into()?;
                let full_text: Vec<(String, SqlOperator)> = Fulltext(&selection).try_into()?;
                let time_range: Option<(i64, i64)> = Timerange(&selection).try_into()?;

                Ok(Sql {
                    fields,
                    selection,
                    source,
                    order_by,
                    group_by,
                    offset,
                    limit,
                    quick_text,
                    full_text,
                    time_range,
                    field_alias,
                })
            }
            _ => Err(anyhow::anyhow!("We only support Query at the moment")),
        }
    }
}

impl<'a> TryFrom<Projection<'a>> for Vec<String> {
    type Error = anyhow::Error;

    fn try_from(projection: Projection<'a>) -> Result<Self, Self::Error> {
        let mut fields = Vec::new();
        for item in projection.0 {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    let field = expr.to_string();
                    let field = field.trim_matches(|v| v == '\'' || v == '"');
                    fields.push(field.to_owned());
                }
                SelectItem::Wildcard(_) => {
                    // we use empty to represent all fields
                    // fields.push("*".to_string());
                }
                // _ => return Err(anyhow::anyhow!("We only support UnnamedExpr at the moment")),
                _ => {}
            }
        }
        Ok(fields)
    }
}

impl<'a> TryFrom<Projection<'a>> for Vec<(String, String)> {
    type Error = anyhow::Error;

    fn try_from(projection: Projection<'a>) -> Result<Self, Self::Error> {
        let mut fields = Vec::new();
        for item in projection.0 {
            if let SelectItem::ExprWithAlias { expr, alias } = item {
                fields.push((expr.to_string(), alias.to_string().replace('"', "")))
            }
        }
        Ok(fields)
    }
}

impl<'a> TryFrom<Fulltext<'a>> for Vec<(String, SqlOperator)> {
    type Error = anyhow::Error;

    fn try_from(selection: Fulltext<'a>) -> Result<Self, Self::Error> {
        let mut fields = Vec::new();
        match selection.0 {
            Some(expr) => parse_expr_for_field(expr, "_all", &mut fields)?,
            None => {}
        }

        let fields = fields
            .iter()
            .map(|(_field, value, _op, operator)| {
                (value.to_owned().to_string(), operator.to_owned())
            })
            .collect();

        Ok(fields)
    }
}

impl<'a> TryFrom<Quicktext<'a>> for Vec<(String, String, SqlOperator)> {
    type Error = anyhow::Error;

    fn try_from(selection: Quicktext<'a>) -> Result<Self, Self::Error> {
        let mut fields = Vec::new();
        match selection.0 {
            Some(expr) => parse_expr_for_field(expr, "*", &mut fields)?,
            None => {}
        }

        let fields = fields
            .iter()
            .filter_map(|(field, value, op, operator)| {
                if op == &SqlOperator::Eq || op == &SqlOperator::Like {
                    Some((
                        field.to_string(),
                        value.to_owned().to_string(),
                        operator.to_owned(),
                    ))
                } else {
                    None
                }
            })
            .collect();

        Ok(fields)
    }
}

impl<'a> TryFrom<Timerange<'a>> for Option<(i64, i64)> {
    type Error = anyhow::Error;

    fn try_from(selection: Timerange<'a>) -> Result<Self, Self::Error> {
        let mut fields = Vec::new();
        match selection.0 {
            Some(expr) => parse_expr_for_field(expr, &CONFIG.common.column_timestamp, &mut fields)?,
            None => {}
        }

        let mut time_min = Vec::new();
        for (_field, value, op, _operator) in fields.iter() {
            match op {
                SqlOperator::Gt => match parse_timestamp(value) {
                    Ok(v) => time_min.push(v.unwrap_or_default()),
                    Err(e) => return Err(e),
                },
                SqlOperator::Gte => match parse_timestamp(value) {
                    Ok(v) => time_min.push(v.unwrap_or_default()),
                    Err(e) => return Err(e),
                },
                _ => {}
            }
        }

        let mut time_max = Vec::new();
        for (_field, value, op, _operator) in fields.iter() {
            match op {
                SqlOperator::Lt => match parse_timestamp(value) {
                    Ok(v) => time_max.push(v.unwrap_or_default()),
                    Err(e) => return Err(e),
                },
                SqlOperator::Lte => match parse_timestamp(value) {
                    Ok(v) => time_max.push(v.unwrap_or_default()),
                    Err(e) => return Err(e),
                },
                _ => {}
            }
        }

        let time_min = {
            if !time_min.is_empty() {
                time_min.iter().min().unwrap().to_owned()
            } else {
                0
            }
        };
        let mut time_max = {
            if !time_max.is_empty() {
                time_max.iter().max().unwrap().to_owned()
            } else {
                0
            }
        };
        if time_min > 0 && time_max == 0 {
            time_max = chrono::Utc::now().timestamp_micros();
        }

        Ok(Some((time_min, time_max)))
    }
}

impl<'a> TryFrom<Source<'a>> for String {
    type Error = anyhow::Error;

    fn try_from(source: Source<'a>) -> Result<Self, Self::Error> {
        if source.0.len() != 1 {
            return Err(anyhow::anyhow!(
                "We only support single data source at the moment"
            ));
        }

        let table = &source.0[0];
        if !table.joins.is_empty() {
            return Err(anyhow::anyhow!(
                "We do not support joint data source at the moment"
            ));
        }

        match &table.relation {
            TableFactor::Table { name, .. } => Ok(name.0.first().unwrap().value.clone()),
            _ => Err(anyhow::anyhow!("We only support table")),
        }
    }
}

impl<'a> TryFrom<Order<'a>> for (String, bool) {
    type Error = anyhow::Error;

    fn try_from(order: Order) -> Result<Self, Self::Error> {
        match &order.0.expr {
            SqlExpr::Identifier(id) => Ok((id.to_string(), !order.0.asc.unwrap_or(true))),
            expr => Err(anyhow::anyhow!(
                "We only support identifier for order by, got {expr}"
            )),
        }
    }
}

impl<'a> TryFrom<Group<'a>> for String {
    type Error = anyhow::Error;

    fn try_from(g: Group) -> Result<Self, Self::Error> {
        match &g.0 {
            SqlExpr::Identifier(id) => Ok(id.to_string()),
            expr => Err(anyhow::anyhow!(
                "We only support identifier for order by, got {expr}"
            )),
        }
    }
}

impl std::fmt::Display for SqlValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SqlValue::String(s) => write!(f, "{s}"),
            SqlValue::Number(n) => write!(f, "{n}"),
        }
    }
}

impl<'a> From<Offset<'a>> for usize {
    fn from(offset: Offset) -> Self {
        match offset.0 {
            SqlOffset {
                value: SqlExpr::Value(Value::Number(v, _b)),
                ..
            } => v.parse().unwrap_or(0),
            _ => 0,
        }
    }
}

impl<'a> From<Limit<'a>> for usize {
    fn from(l: Limit<'a>) -> Self {
        match l.0 {
            SqlExpr::Value(Value::Number(v, _b)) => {
                let mut v: usize = v.parse().unwrap_or(0);
                if v > 10000 {
                    v = 10000;
                }
                v
            }
            _ => 0,
        }
    }
}

fn parse_timestamp(s: &SqlValue) -> Result<Option<i64>, anyhow::Error> {
    match s {
        SqlValue::String(s) => {
            let s = s.to_lowercase();
            let mut s = s.as_str();
            if s.starts_with("to_timestamp") {
                if s.starts_with("to_timestamp_seconds(") {
                    s = s.strip_prefix("to_timestamp_seconds(").unwrap();
                } else if s.starts_with("to_timestamp_micros(") {
                    s = s.strip_prefix("to_timestamp_micros(").unwrap();
                } else if s.starts_with("to_timestamp_millis(") {
                    s = s.strip_prefix("to_timestamp_millis(").unwrap();
                } else if s.starts_with("to_timestamp(") {
                    s = s.strip_prefix("to_timestamp(").unwrap();
                } else {
                    return Err(anyhow::anyhow!("Only support timestamp functions [to_timestamp|to_timestamp_millis|to_timestamp_micros|to_timestamp_seconds]"));
                }
                s = s.strip_suffix(')').unwrap();
                s = s.trim_matches(|v| v == '\'' || v == '"');
            }
            let v = DateTime::parse_from_rfc3339(s)?;
            Ok(Some(v.timestamp_micros()))
        }
        SqlValue::Number(n) => {
            if *n == 0 {
                Ok(None)
            } else if *n > (1e18 as i64) {
                Ok(Some(*n / 1000))
            } else if *n > (1e15 as i64) {
                Ok(Some(*n))
            } else if *n > (1e12 as i64) {
                Ok(Some(*n * 1000))
            } else if *n > (1e9 as i64) {
                Ok(Some(*n * 1000 * 1000))
            } else {
                Err(anyhow::anyhow!("Invalid timestamp: {}", n))
            }
        }
    }
}

fn parse_expr_for_field(
    expr: &SqlExpr,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    // println!("! parse_expr -> {:?}", expr);
    match expr {
        SqlExpr::Nested(e) => parse_expr_for_field(e, field, fields)?,
        SqlExpr::BinaryOp { left, op, right } => {
            let next_op: SqlOperator = op.try_into()?;

            match &**left {
                SqlExpr::Nested(e) => parse_expr_for_field(e, field, fields)?,
                SqlExpr::BinaryOp { left, op, right } => {
                    parse_expr_for_field(
                        &SqlExpr::BinaryOp {
                            left: left.clone(),
                            op: op.clone(),
                            right: right.clone(),
                        },
                        field,
                        fields,
                    )?;
                }
                SqlExpr::Identifier(ident) => {
                    let nop = op.try_into()?;
                    let eq = parse_expr_check_field_name(&ident.value, field);
                    if ident.value == field || (eq && nop == SqlOperator::Eq) {
                        let val = get_value_from_expr(right);
                        if val.is_none() {
                            return Err(anyhow::anyhow!(
                                "SqlExpr::Identifier: We only support Identifier at the moment"
                            ));
                        }
                        fields.push((ident.value.to_string(), val.unwrap(), nop, next_op));
                    }
                }
                SqlExpr::Like {
                    negated,
                    expr,
                    pattern,
                    escape_char,
                } => {
                    parse_expr_like(negated, expr, pattern, escape_char, next_op, field, fields)
                        .unwrap();
                }
                SqlExpr::InList {
                    expr,
                    list,
                    negated,
                } => {
                    parse_expr_in_list(expr, list, negated, field, fields).unwrap();
                }
                SqlExpr::Between {
                    expr,
                    negated,
                    low,
                    high,
                } => {
                    let ret = parse_expr_between(expr, negated, low, high, field, fields);
                    if ret.is_err() {
                        return Err(anyhow::anyhow!("{:?}", ret.err()));
                    }
                }
                SqlExpr::Function(f) => {
                    // Hack _timestamp
                    if field == CONFIG.common.column_timestamp {
                        let f_name = f.to_string().to_lowercase();
                        if parse_expr_check_field_name(&f_name, field) {
                            let val = get_value_from_expr(right);
                            if val.is_none() {
                                return Err(anyhow::anyhow!(
                                    "SqlExpr::Identifier: We only support Identifier at the moment [_timestamp]"
                                ));
                            }
                            fields.push((
                                CONFIG.common.column_timestamp.clone(),
                                val.unwrap(),
                                next_op,
                                next_op,
                            ));
                        }
                    }
                    let ret = parse_expr_function(f, field, fields);
                    if ret.is_err() {
                        return Err(anyhow::anyhow!("{:?}", ret.err()));
                    }
                }
                _ => {}
            }

            match &**right {
                SqlExpr::Nested(e) => parse_expr_for_field(e, field, fields)?,
                SqlExpr::BinaryOp { left, op, right } => {
                    parse_expr_for_field(
                        &SqlExpr::BinaryOp {
                            left: left.clone(),
                            op: op.clone(),
                            right: right.clone(),
                        },
                        field,
                        fields,
                    )?;
                }
                SqlExpr::Like {
                    negated,
                    expr,
                    pattern,
                    escape_char,
                } => {
                    parse_expr_like(negated, expr, pattern, escape_char, next_op, field, fields)
                        .unwrap();
                }
                SqlExpr::InList {
                    expr,
                    list,
                    negated,
                } => {
                    parse_expr_in_list(expr, list, negated, field, fields).unwrap();
                }
                SqlExpr::Between {
                    expr,
                    negated,
                    low,
                    high,
                } => {
                    let ret = parse_expr_between(expr, negated, low, high, field, fields);
                    if ret.is_err() {
                        return Err(anyhow::anyhow!("{:?}", ret.err()));
                    }
                }
                SqlExpr::Function(f) => {
                    let ret = parse_expr_function(f, field, fields);
                    if ret.is_err() {
                        return Err(anyhow::anyhow!("{:?}", ret.err()));
                    }
                }
                _ => {}
            }
        }
        SqlExpr::InList {
            expr,
            list,
            negated,
        } => {
            parse_expr_in_list(expr, list, negated, field, fields).unwrap();
        }
        SqlExpr::Between {
            expr,
            negated,
            low,
            high,
        } => {
            let ret = parse_expr_between(expr, negated, low, high, field, fields);
            if ret.is_err() {
                return Err(anyhow::anyhow!("{:?}", ret.err()));
            }
        }
        SqlExpr::Function(f) => {
            let ret = parse_expr_function(f, field, fields);
            if ret.is_err() {
                return Err(anyhow::anyhow!("{:?}", ret.err()));
            }
        }
        _ => {}
    }

    Ok(())
}

fn parse_expr_check_field_name(s: &str, field: &str) -> bool {
    if s == field {
        return true;
    }
    if field == "*" && s != "_all" && s != CONFIG.common.column_timestamp.clone() {
        return true;
    }

    // check function, like: to_timestamp_micros("field")
    let re = Regex::new(&format!(r#"(?i)\(['"]?{field}['"]?\)"#)).unwrap();
    re.is_match(s)
}

fn parse_expr_like(
    _negated: &bool,
    expr: &SqlExpr,
    pattern: &SqlExpr,
    _escape_char: &Option<char>,
    next_op: SqlOperator,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    if let SqlExpr::Identifier(ident) = expr {
        if parse_expr_check_field_name(&ident.value, field) {
            let nop = SqlOperator::Like;
            let val = get_value_from_expr(pattern);
            if val.is_none() {
                return Err(anyhow::anyhow!(
                    "SqlExpr::Like: We only support Identifier at the moment"
                ));
            }
            fields.push((ident.value.to_string(), val.unwrap(), nop, next_op));
        }
    }
    Ok(())
}

fn parse_expr_in_list(
    expr: &SqlExpr,
    list: &[SqlExpr],
    negated: &bool,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    if *negated {
        return Ok(());
    }
    let field_name = get_value_from_expr(expr).unwrap().to_string();
    if parse_expr_check_field_name(&field_name, field) {
        for val in list.iter() {
            fields.push((
                field.to_string(),
                SqlValue::String(val.to_string()),
                SqlOperator::Eq,
                SqlOperator::Or,
            ));
        }
    }

    Ok(())
}

fn parse_expr_between(
    expr: &SqlExpr,
    negated: &bool,
    low: &SqlExpr,
    high: &SqlExpr,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    if *negated {
        return Ok(());
    }
    let f_name = get_value_from_expr(expr).unwrap().to_string();
    if parse_expr_check_field_name(&f_name, field) {
        let min = get_value_from_expr(low).unwrap();
        let max = get_value_from_expr(high).unwrap();
        fields.push((field.to_string(), min, SqlOperator::Gte, SqlOperator::And));
        fields.push((field.to_string(), max, SqlOperator::Lt, SqlOperator::And));
    }
    Ok(())
}

fn parse_expr_function(
    f: &Function,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    let f_name = f.name.to_string().to_lowercase();
    if ![
        "strpos",
        "contains",
        "match",
        "time_range",
        "to_timestamp",
        "to_timestamp_millis",
        "to_timestamp_micros",
        "to_timestamp_seconds",
    ]
    .contains(&f_name.as_str())
    {
        return Ok(());
    }

    // Hack time_range
    if f_name == "time_range" {
        return parse_expr_fun_time_range(f, field, fields);
    }

    if f.args.len() < 2 {
        return Ok(());
    }

    let nop = SqlOperator::And;
    let next_op = SqlOperator::And;
    let field_name = f.args.get(0).unwrap().to_string();
    let field_name = field_name.trim_matches(|c: char| c == '\'' || c == '"');
    if parse_expr_check_field_name(field_name, field) {
        match f.args.get(1).unwrap() {
            FunctionArg::Named { name: _name, arg } => {
                match arg {
                    FunctionArgExpr::Expr(expr) => {
                        let val = get_value_from_expr(expr);
                        if val.is_none() {
                            return Err(anyhow::anyhow!("SqlExpr::Function<Named>: We only support Identifier at the moment"));
                        }
                        fields.push((field.to_string(), val.unwrap(), nop, next_op));
                    }
                    _ => return Err(anyhow::anyhow!("We only support String at the moment")),
                }
            }
            FunctionArg::Unnamed(arg) => {
                match arg {
                    FunctionArgExpr::Expr(expr) => {
                        let val = get_value_from_expr(expr);
                        if val.is_none() {
                            return Err(anyhow::anyhow!("SqlExpr::Function<Unnamed>: We only support Identifier at the moment"));
                        }
                        fields.push((field.to_string(), val.unwrap(), nop, next_op));
                    }
                    _ => return Err(anyhow::anyhow!("We only support String at the moment")),
                }
            }
        }
    }

    Ok(())
}

fn parse_expr_fun_time_range(
    f: &Function,
    field: &str,
    fields: &mut Vec<(String, SqlValue, SqlOperator, SqlOperator)>,
) -> Result<(), anyhow::Error> {
    if f.args.len() != 3 {
        return Err(anyhow::anyhow!(
            "SqlExpr::Function: time_range function must have 3 arguments"
        ));
    }

    let next_op = SqlOperator::And;
    let field_name = f.args.get(0).unwrap().to_string();
    let field_name = field_name.trim_matches(|c: char| c == '\'' || c == '"');
    if parse_expr_check_field_name(field_name, field) {
        let mut vals = Vec::new();
        for arg in f.args.iter() {
            let val = match arg {
                FunctionArg::Named { name: _name, arg } => match arg {
                    FunctionArgExpr::Expr(expr) => {
                        let val = get_value_from_expr(expr);
                        if val.is_none() {
                            return Err(anyhow::anyhow!("SqlExpr::Function<Named>: We only support Identifier at the moment"));
                        }
                        val.unwrap()
                    }
                    _ => return Err(anyhow::anyhow!("We only support String at the moment")),
                },
                FunctionArg::Unnamed(arg) => match arg {
                    FunctionArgExpr::Expr(expr) => {
                        let val = get_value_from_expr(expr);
                        if val.is_none() {
                            return Err(anyhow::anyhow!("SqlExpr::Function<Unnamed>: We only support Identifier at the moment"));
                        }
                        val.unwrap()
                    }
                    _ => return Err(anyhow::anyhow!("We only support String at the moment")),
                },
            };
            vals.push(val);
        }

        fields.push((
            field_name.to_string(),
            vals.get(1).unwrap().to_owned(),
            SqlOperator::Gte,
            next_op,
        ));
        fields.push((
            field_name.to_string(),
            vals.get(2).unwrap().to_owned(),
            SqlOperator::Lt,
            next_op,
        ));
    }

    Ok(())
}

fn get_value_from_expr(expr: &SqlExpr) -> Option<SqlValue> {
    match expr {
        SqlExpr::Identifier(ident) => Some(SqlValue::String(ident.value.to_string())),
        SqlExpr::Value(value) => match value {
            Value::SingleQuotedString(s) => Some(SqlValue::String(s.to_string())),
            Value::DoubleQuotedString(s) => Some(SqlValue::String(s.to_string())),
            Value::Number(s, _) => Some(SqlValue::Number(s.parse::<i64>().unwrap())),
            _ => None,
        },
        SqlExpr::Function(f) => Some(SqlValue::String(f.to_string())),
        _ => None,
    }
}

impl TryFrom<&BinaryOperator> for SqlOperator {
    type Error = anyhow::Error;
    fn try_from(value: &BinaryOperator) -> Result<Self, Self::Error> {
        match value {
            BinaryOperator::And => Ok(SqlOperator::And),
            BinaryOperator::Or => Ok(SqlOperator::Or),
            BinaryOperator::Eq => Ok(SqlOperator::Eq),
            BinaryOperator::NotEq => Ok(SqlOperator::Neq),
            BinaryOperator::Gt => Ok(SqlOperator::Gt),
            BinaryOperator::GtEq => Ok(SqlOperator::Gte),
            BinaryOperator::Lt => Ok(SqlOperator::Lt),
            BinaryOperator::LtEq => Ok(SqlOperator::Lte),
            _ => Err(anyhow::anyhow!(
                "We only support BinaryOperator at the moment"
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::parser::Parser;

    use super::*;
    use crate::meta::sql::SqlValue;

    #[test]
    fn parse_sql_works() {
        let table = "index.1.2022";
        let sql = format!(
            "select a, b, c from \"{}\" where a=1 and b=1 or c=1 order by c desc limit 5 offset 10",
            table
        );
        let dialect = sqlparser::dialect::GenericDialect {};
        let statement = &Parser::parse_sql(&dialect, sql.as_ref()).unwrap()[0];
        let sql: Sql = statement.try_into().unwrap();
        assert_eq!(sql.source, table);
        assert_eq!(sql.limit, 5);
        assert_eq!(sql.offset, 10);
        assert_eq!(sql.order_by, vec![("c".into(), true)]);
        assert_eq!(sql.fields, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_new_sql() {
        let table = "index.1.2022";
        let sql = format!(
            "select a, b, c from \"{}\" where a=1 and b=1 or c=1 order by c desc limit 5 offset 10",
            table
        );
        let local_sql: Sql = Sql::new(sql.as_str()).unwrap();
        assert_eq!(local_sql.source, table);
        assert_eq!(local_sql.limit, 5);
        assert_eq!(local_sql.offset, 10);
        assert_eq!(local_sql.order_by, vec![("c".into(), true)]);
        assert_eq!(local_sql.fields, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_parse_sqls() {
        let sqls = [
            ("select * from table1", true),
            ("select * from table1 where a=1", true),
            ("select * from table1 where a='b'", true),
            ("select * from table1 where a='b' limit 10 offset 10", true),
            ("select * from table1 where a='b' group by abc", true),
            (
                "select * from table1 where a='b' group by abc having count(*) > 19",
                true,
            ),
            ("select * from table1, table2 where a='b'", false),
            (
                "select * from table1 left join table2 on table1.a=table2.b where a='b'",
                false,
            ),
            (
                "select * from table1 union select * from table2 where a='b'",
                false,
            ),
        ];
        for (sql, ok) in sqls {
            let ret = Sql::new(sql);
            assert_eq!(ret.is_ok(), ok);
        }
    }

    #[test]
    fn test_parse_timestamp() {
        let val = 1666093521151350;
        let ts_val = SqlValue::Number(val);
        let ts = parse_timestamp(&ts_val).unwrap().unwrap();
        let ts_str_val = SqlValue::String("to_timestamp1()".to_string());
        let ts_str = parse_timestamp(&ts_str_val);
        assert_eq!(ts, val);
        assert!(ts_str.is_err());
    }

    #[test]
    fn test_parse_timerange() {
        let samples = vec![
            ("select * from tbl where ts in (1, 2, 3)", (0,0)),
            ("select * from tbl where _timestamp >= 1666093521151350", (1666093521151350,0)),
            ("select * from tbl where _timestamp >= 1666093521151350 AND _timestamp < 1666093521151351", (1666093521151350,1666093521151351)),
            ("select * from tbl where a=1 AND _timestamp>=1666093521151350 AND _timestamp < 1666093521151351", (1666093521151350,1666093521151351)),
            ("select * from tbl where a=1 AND b = 2 AND _timestamp>=1666093521151350 AND _timestamp < 1666093521151351", (1666093521151350,1666093521151351)),
            (r#"select * from tbl where "a"=1 AND b = 2 AND (_timestamp>=1666093521151350 AND _timestamp < 1666093521151351)"#, (1666093521151350,1666093521151351)),
            ("select * from tbl where b = 2 AND (_timestamp>=1666093521151350 AND _timestamp < 1666093521151351)", (1666093521151350,1666093521151351)),
            ("select * from tbl where b = 2 AND _timestamp>=1666093521151350 AND _timestamp < 1666093521151351", (1666093521151350,1666093521151351)),
            ("select * from tbl where (_timestamp>=1666093521151350 AND _timestamp < 1666093521151351)", (1666093521151350,1666093521151351)),
            ("select * from tbl where _timestamp>=1666093521151350 AND _timestamp < 1666093521151351", (1666093521151350,1666093521151351)),
            ("select * from tbl where a=1 AND b = 2 AND (_timestamp BETWEEN 1666093521151350 AND 1666093521151351)", (1666093521151350,1666093521151351)),
            ("select * from tbl where b = 2 AND (_timestamp BETWEEN 1666093521151350 AND 1666093521151351)", (1666093521151350,1666093521151351)),
            ("select * from tbl where (_timestamp BETWEEN 1666093521151350 AND 1666093521151351)", (1666093521151350,1666093521151351)),
            ("select * from tbl where _timestamp BETWEEN 1666093521151350 AND 1666093521151351", (1666093521151350,1666093521151351)),
            (r#"select * from tbl where time_range("_timestamp", '2022-10-19T15:19:24.587Z','2022-10-19T15:34:24.587Z')"#,(1666192764587000,1666193664587000))].to_vec();

        for (sql, (expected_t1, expected_t2)) in samples {
            let (actual_t1, actual_t2) = Sql::new(sql).unwrap().time_range.unwrap();
            assert_eq!(actual_t1, expected_t1);
            if expected_t2 != 0 {
                assert_eq!(actual_t2, expected_t2);
            }
        }
    }
}
