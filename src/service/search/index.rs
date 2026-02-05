// Copyright 2025 OpenObserve Inc.
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

use std::{
    fmt::{self, Debug, Formatter},
    sync::Arc,
};

use config::{
    INDEX_FIELD_NAME_FOR_ALL, get_config,
    meta::inverted_index::UNKNOWN_NAME,
    utils::tantivy::{query::contains_query::ContainsQuery, tokenizer::o2_collect_search_tokens},
};
use datafusion::{
    arrow::datatypes::{DataType, SchemaRef},
    config::ConfigOptions,
    logical_expr::Operator,
    physical_expr::{ScalarFunctionExpr, conjunction},
    physical_plan::{
        PhysicalExpr,
        expressions::{
            BinaryExpr, CastExpr, Column, InListExpr, IsNotNullExpr, LikeExpr, Literal, NotExpr,
        },
    },
    scalar::ScalarValue,
};
use hashbrown::HashSet;
use sqlparser::ast::{
    BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, UnaryOperator,
};
use tantivy::{
    Term,
    query::{
        AllQuery, BooleanQuery, FuzzyTermQuery, Occur, PhrasePrefixQuery, Query, RegexQuery,
        TermQuery,
    },
    schema::{Field, IndexRecordOption, Schema},
};

use super::{
    datafusion::udf::fuzzy_match_udf,
    utils::{is_field, is_value, split_conjunction, trim_quotes},
};
use crate::service::search::{
    datafusion::udf::{
        MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
        STR_MATCH_UDF_NAME,
        match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
        str_match_udf,
    },
    utils::get_field_name,
};

pub fn get_index_condition_from_expr(
    index_fields: &HashSet<String>,
    expr: &Expr,
) -> (Option<IndexCondition>, Option<Expr>) {
    let mut other_expr = Vec::new();
    let expr_list = split_conjunction(expr);
    let mut index_condition = IndexCondition::default();
    for e in expr_list {
        if !is_expr_valid_for_index(e, index_fields) {
            other_expr.push(e);
            continue;
        }

        let multi_condition = Condition::from_expr(e);
        index_condition.add_condition(multi_condition);
    }

    let new_expr = super::utils::conjunction(other_expr);
    if index_condition.is_empty() {
        (None, new_expr)
    } else {
        (Some(index_condition), new_expr)
    }
}

// note the condition in IndexCondition is connection by AND operator
#[derive(Default, Clone, Hash, Eq, PartialEq)]
pub struct IndexCondition {
    pub conditions: Vec<Condition>,
}

impl IndexCondition {
    pub fn new() -> Self {
        IndexCondition {
            conditions: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.conditions.is_empty()
    }

    pub fn add_condition(&mut self, condition: Condition) {
        self.conditions.push(condition);
    }
}

impl Debug for IndexCondition {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_query())
    }
}

impl IndexCondition {
    // this only use for display the query
    pub fn to_query(&self) -> String {
        self.conditions
            .iter()
            .map(|condition| condition.to_query())
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    // get the tantivy query for the index condition
    pub fn to_tantivy_query(
        &self,
        schema: Schema,
        default_field: Option<Field>,
    ) -> anyhow::Result<Box<dyn Query>> {
        let queries = self
            .conditions
            .iter()
            .map(|condition| {
                condition
                    .to_tantivy_query(&schema, default_field)
                    .map(|condition| (Occur::Must, condition))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(Box::new(BooleanQuery::from(queries)))
    }

    // get the fields use for search in datafusion(for add filter back logical)
    pub fn get_schema_fields(&self, fst_fields: &[String]) -> HashSet<String> {
        self.conditions
            .iter()
            .fold(HashSet::new(), |mut acc, condition| {
                acc.extend(condition.get_schema_fields(fst_fields));
                acc
            })
    }

    pub fn get_schema_projection(&self, schema: SchemaRef, fst_fields: &[String]) -> Vec<usize> {
        let fields = self.get_schema_fields(fst_fields);
        let mut projection = Vec::with_capacity(fields.len());
        for field in fields.iter() {
            if let Ok(index) = schema.index_of(field) {
                projection.push(index);
            }
        }
        projection
    }

    pub fn need_all_term_fields(&self) -> Vec<String> {
        self.conditions
            .iter()
            .flat_map(|condition| condition.need_all_term_fields())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn to_physical_expr(
        &self,
        schema: &arrow_schema::Schema,
        fst_fields: &[String],
    ) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
        Ok(conjunction(
            self.conditions
                .iter()
                .map(|condition| condition.to_physical_expr(schema, fst_fields))
                .collect::<Result<Vec<_>, _>>()?,
        ))
    }

    pub fn can_remove_filter(&self) -> bool {
        self.conditions
            .iter()
            .all(|condition| condition.can_remove_filter())
    }

    // check if the index condition is a simple str match condition
    // the simple str match condition is like str_match(field, 'value')
    // use for check if the distinct query can be optimized
    pub fn is_simple_str_match(&self, field: &str) -> bool {
        if self.is_condition_all() {
            return true;
        }

        if self.conditions.len() != 1 {
            return false;
        }
        matches!(
            &self.conditions[0],
            Condition::StrMatch(f, ..) if f == field
        )
    }

    // use for simple distinct optimization
    pub fn get_str_match_condition(&self) -> Option<(String, bool)> {
        match &self.conditions[0] {
            Condition::StrMatch(_, value, case_sensitive) => {
                Some((value.to_string(), *case_sensitive))
            }
            Condition::All() => None, // for the condition that query without filter
            _ => unreachable!("get_str_match_condition only support one str_match condition"),
        }
    }

    // use for check if the index condition is only
    // for the condition that query without filter
    pub fn is_condition_all(&self) -> bool {
        self.conditions.len() == 1 && matches!(self.conditions[0], Condition::All())
    }
}

// single condition
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub enum Condition {
    // field, value
    Equal(String, String),
    // field, value
    NotEqual(String, String),
    // field, value, case_sensitive
    StrMatch(String, String, bool),
    // field, values, negated
    In(String, Vec<String>, bool),
    // field, pattern
    Regex(String, String),
    // term
    MatchAll(String),
    // term, distance
    FuzzyMatchAll(String, u8),
    All(),
    Or(Box<Condition>, Box<Condition>),
    And(Box<Condition>, Box<Condition>),
    Not(Box<Condition>),
}

impl Condition {
    // this only use for display the query
    pub fn to_query(&self) -> String {
        match self {
            Condition::Equal(field, value) => format!("{field}={value}"),
            Condition::NotEqual(field, value) => format!("{field}!={value}"),
            Condition::StrMatch(field, value, case_sensitive) => {
                if *case_sensitive {
                    format!("str_match({field}, '{value}')")
                } else {
                    format!("str_match_ignore_case({field}, '{value}')")
                }
            }
            Condition::In(field, values, negated) => {
                if *negated {
                    format!("{} NOT IN ({})", field, values.join(","))
                } else {
                    format!("{} IN ({})", field, values.join(","))
                }
            }
            Condition::Regex(field, value) => format!("{field}=~{value}"),
            Condition::MatchAll(value) => format!("{INDEX_FIELD_NAME_FOR_ALL}:{value}"),
            Condition::FuzzyMatchAll(value, distance) => {
                format!("{INDEX_FIELD_NAME_FOR_ALL}:fuzzy({value}, {distance})")
            }
            Condition::All() => "ALL".to_string(),
            Condition::Or(left, right) => format!("({} OR {})", left.to_query(), right.to_query()),
            Condition::And(left, right) => {
                format!("({} AND {})", left.to_query(), right.to_query())
            }
            Condition::Not(condition) => format!("NOT({})", condition.to_query()),
        }
    }

    // NOTE: current only used in [`use_inverted_index`]
    pub fn from_expr(expr: &Expr) -> Self {
        match expr {
            Expr::BinaryOp {
                left,
                op: BinaryOperator::Eq | BinaryOperator::NotEq,
                right,
            } => {
                let (field, value) = if is_value(left) && is_field(right) {
                    (get_field_name(right), get_value(left))
                } else if is_value(right) && is_field(left) {
                    (get_field_name(left), get_value(right))
                } else {
                    unreachable!()
                };
                let op = match expr {
                    Expr::BinaryOp { op, .. } => op,
                    _ => unreachable!(),
                };
                if *op == BinaryOperator::Eq {
                    Condition::Equal(field, value)
                } else {
                    Condition::NotEqual(field, value)
                }
            }
            Expr::InList {
                expr,
                list,
                negated,
            } => {
                let field = get_field_name(expr);
                let values = list.iter().map(get_value).collect();
                Condition::In(field, values, *negated)
            }
            Expr::Function(func) => {
                let fn_name = func.name.to_string().to_lowercase();
                if fn_name == MATCH_ALL_UDF_NAME {
                    if let FunctionArguments::List(list) = &func.args {
                        Condition::MatchAll(trim_quotes(list.args[0].to_string().as_str()))
                    } else {
                        unreachable!()
                    }
                } else if fn_name == FUZZY_MATCH_ALL_UDF_NAME {
                    if let FunctionArguments::List(list) = &func.args {
                        let value = trim_quotes(list.args[0].to_string().as_str());
                        let distance = trim_quotes(list.args[1].to_string().as_str())
                            .parse()
                            .unwrap_or(1);
                        Condition::FuzzyMatchAll(value, distance)
                    } else {
                        unreachable!()
                    }
                } else if fn_name == STR_MATCH_UDF_NAME || fn_name == MATCH_FIELD_UDF_NAME {
                    if let FunctionArguments::List(list) = &func.args {
                        let field = get_arg_name(&list.args[0]);
                        let value = trim_quotes(list.args[1].to_string().as_str());
                        Condition::StrMatch(field, value, true)
                    } else {
                        unreachable!()
                    }
                } else if fn_name == STR_MATCH_UDF_IGNORE_CASE_NAME
                    || fn_name == MATCH_FIELD_IGNORE_CASE_UDF_NAME
                {
                    if let FunctionArguments::List(list) = &func.args {
                        let field = get_arg_name(&list.args[0]);
                        let value = trim_quotes(list.args[1].to_string().as_str());
                        Condition::StrMatch(field, value, false)
                    } else {
                        unreachable!()
                    }
                } else {
                    unreachable!()
                }
            }
            Expr::BinaryOp {
                left,
                op: BinaryOperator::Or,
                right,
            } => Condition::Or(
                Box::new(Condition::from_expr(left)),
                Box::new(Condition::from_expr(right)),
            ),
            Expr::BinaryOp {
                left,
                op: BinaryOperator::And,
                right,
            } => Condition::And(
                Box::new(Condition::from_expr(left)),
                Box::new(Condition::from_expr(right)),
            ),
            Expr::Nested(expr) => Condition::from_expr(expr),
            Expr::UnaryOp {
                op: UnaryOperator::Not,
                expr,
            } => Condition::Not(Box::new(Condition::from_expr(expr))),
            _ => unreachable!(),
        }
    }

    pub fn from_physical_expr(expr: &Arc<dyn PhysicalExpr>) -> Self {
        if let Some(expr) = expr.as_any().downcast_ref::<BinaryExpr>() {
            match expr.op() {
                Operator::Eq | Operator::NotEq => {
                    let (field, value) = if is_physical_value(expr.left())
                        && is_physical_column(expr.right())
                    {
                        (
                            get_physical_column_name(expr.right()).to_string(),
                            get_physical_value(expr.left()),
                        )
                    } else if is_physical_value(expr.right()) && is_physical_column(expr.left()) {
                        (
                            get_physical_column_name(expr.left()).to_string(),
                            get_physical_value(expr.right()),
                        )
                    } else {
                        unreachable!()
                    };

                    if *expr.op() == Operator::Eq {
                        Condition::Equal(field, value)
                    } else {
                        Condition::NotEqual(field, value)
                    }
                }
                Operator::And => Condition::And(
                    Box::new(Condition::from_physical_expr(expr.left())),
                    Box::new(Condition::from_physical_expr(expr.right())),
                ),
                Operator::Or => Condition::Or(
                    Box::new(Condition::from_physical_expr(expr.left())),
                    Box::new(Condition::from_physical_expr(expr.right())),
                ),
                _ => unreachable!(),
            }
        } else if let Some(expr) = expr.as_any().downcast_ref::<InListExpr>() {
            let field = get_physical_column_name(expr.expr()).to_string();
            let values = expr.list().iter().map(get_physical_value).collect();
            Condition::In(field, values, expr.negated())
        } else if let Some(expr) = expr.as_any().downcast_ref::<ScalarFunctionExpr>() {
            let name = expr.name();
            match name {
                MATCH_ALL_UDF_NAME => Condition::MatchAll(get_physical_value(&expr.args()[0])),
                FUZZY_MATCH_ALL_UDF_NAME => {
                    let value = get_physical_value(&expr.args()[0]);
                    let distance = get_physical_value(&expr.args()[1]).parse().unwrap_or(1);
                    Condition::FuzzyMatchAll(value, distance)
                }
                STR_MATCH_UDF_NAME | MATCH_FIELD_UDF_NAME => {
                    let field = get_physical_column_name(&expr.args()[0]).to_string();
                    let value = get_physical_value(&expr.args()[1]);
                    Condition::StrMatch(field, value, true)
                }
                STR_MATCH_UDF_IGNORE_CASE_NAME | MATCH_FIELD_IGNORE_CASE_UDF_NAME => {
                    let field = get_physical_column_name(&expr.args()[0]).to_string();
                    let value = get_physical_value(&expr.args()[1]);
                    Condition::StrMatch(field, value, false)
                }
                _ => unreachable!(),
            }
        } else if let Some(expr) = expr.as_any().downcast_ref::<NotExpr>() {
            Condition::Not(Box::new(Condition::from_physical_expr(expr.arg())))
        } else {
            unreachable!()
        }
    }

    pub fn to_tantivy_query(
        &self,
        schema: &Schema,
        default_field: Option<Field>,
    ) -> anyhow::Result<Box<dyn Query>> {
        Ok(match self {
            Condition::Equal(field, value) => {
                let field = schema.get_field(field)?;
                let term = Term::from_field_text(field, value);
                Box::new(TermQuery::new(term, IndexRecordOption::Basic))
            }
            Condition::NotEqual(field, value) => {
                let field = schema.get_field(field)?;
                let term = Term::from_field_text(field, value);
                let query = Box::new(TermQuery::new(term, IndexRecordOption::Basic));
                Box::new(BooleanQuery::new(vec![
                    (Occur::MustNot, query),
                    (Occur::Must, Box::new(AllQuery {})),
                ]))
            }
            Condition::In(field, values, negated) => {
                let field = schema.get_field(field)?;
                let terms: Vec<Box<dyn Query>> = values
                    .iter()
                    .map(|value| {
                        let term = Term::from_field_text(field, value);
                        Box::new(TermQuery::new(term, IndexRecordOption::Basic)) as _
                    })
                    .collect();
                let query = Box::new(BooleanQuery::union(terms));
                if *negated {
                    Box::new(BooleanQuery::new(vec![
                        (Occur::MustNot, query),
                        (Occur::Must, Box::new(AllQuery {})),
                    ]))
                } else {
                    query
                }
            }
            Condition::Regex(field, value) => {
                let field = schema.get_field(field)?;
                Box::new(RegexQuery::from_pattern(value, field)?)
            }
            Condition::StrMatch(field, value, case_sensitive) => {
                let field = schema.get_field(field)?;
                Box::new(ContainsQuery::new(value, field, *case_sensitive)?)
            }
            Condition::MatchAll(value) => {
                let default_field = default_field.ok_or_else(|| {
                    anyhow::anyhow!("There's no FullTextSearch field for match_all() function")
                })?;
                if value.is_empty() || value == "*" {
                    Box::new(AllQuery {})
                } else {
                    let mut tokens = o2_collect_search_tokens(value);
                    let contains_search =
                        tokens.len() == 1 && value.starts_with("*") && value.ends_with("*");
                    let first_prefix = if value.starts_with("*") && !tokens.is_empty() {
                        Some(tokens.remove(0))
                    } else {
                        None
                    };
                    let last_prefix = if value.ends_with("*") {
                        tokens.pop()
                    } else {
                        None
                    };
                    let mut terms: Vec<Box<dyn Query>> = tokens
                        .into_iter()
                        .map(|value| {
                            let term = Term::from_field_text(default_field, &value);
                            Box::new(TermQuery::new(term, IndexRecordOption::Basic)) as _
                        })
                        .collect();
                    if let Some(value) = first_prefix {
                        terms.push(if contains_search {
                            Box::new(ContainsQuery::new_case_insensitive(&value, default_field)?)
                        } else {
                            let value = format!(".*{value}");
                            Box::new(RegexQuery::from_pattern(&value, default_field)?)
                        });
                    }
                    if let Some(value) = last_prefix {
                        terms.push(Box::new(PhrasePrefixQuery::new_with_offset(vec![(
                            0,
                            Term::from_field_text(default_field, &value),
                        )])));
                    }
                    if !terms.is_empty() {
                        if terms.len() > 1 {
                            Box::new(BooleanQuery::intersection(terms))
                        } else {
                            terms.remove(0)
                        }
                    } else {
                        return Err(anyhow::anyhow!(
                            "The value of match_all() function can't be empty"
                        ));
                    }
                }
            }
            Condition::FuzzyMatchAll(value, distance) => {
                let default_field = default_field.ok_or_else(|| {
                    anyhow::anyhow!(
                        "There's no FullTextSearch field for fuzzy_match_all() function"
                    )
                })?;
                if value.is_empty() {
                    return Err(anyhow::anyhow!(
                        "The value of fuzzy_match_all() function can't be empty"
                    ));
                }
                let term = Term::from_field_text(default_field, value);
                Box::new(FuzzyTermQuery::new(term, *distance, false))
            }
            Condition::All() => Box::new(AllQuery {}),
            Condition::Or(left, right) => {
                let left_query = left.to_tantivy_query(schema, default_field)?;
                let right_query = right.to_tantivy_query(schema, default_field)?;
                Box::new(BooleanQuery::union(vec![left_query, right_query]))
            }
            Condition::And(left, right) => {
                let left_query = left.to_tantivy_query(schema, default_field)?;
                let right_query = right.to_tantivy_query(schema, default_field)?;
                Box::new(BooleanQuery::intersection(vec![left_query, right_query]))
            }
            Condition::Not(condition) => {
                let query = condition.to_tantivy_query(schema, default_field)?;
                Box::new(BooleanQuery::new(vec![
                    (Occur::MustNot, query),
                    (Occur::Must, Box::new(AllQuery {})),
                ]))
            }
        })
    }

    pub fn need_all_term_fields(&self) -> HashSet<String> {
        let mut fields = HashSet::new();
        match self {
            Condition::StrMatch(field, ..)
            | Condition::Regex(field, _)
            | Condition::NotEqual(field, _) => {
                fields.insert(field.clone());
            }
            Condition::MatchAll(value) => {
                if value.len() > 1 && (value.starts_with("*") || value.ends_with("*")) {
                    fields.insert(INDEX_FIELD_NAME_FOR_ALL.to_string());
                }
            }
            Condition::FuzzyMatchAll(..) => {
                fields.insert(INDEX_FIELD_NAME_FOR_ALL.to_string());
            }
            Condition::Or(left, right) | Condition::And(left, right) => {
                fields.extend(left.need_all_term_fields());
                fields.extend(right.need_all_term_fields());
            }
            Condition::Not(condition) => {
                // not operator will need get all term for each fields
                fields.extend(condition.get_tantivy_fields());
            }
            Condition::In(field, _, negated) if *negated => {
                fields.insert(field.clone());
            }
            Condition::All() | Condition::Equal(..) | Condition::In(..) => {}
        }
        fields
    }

    // get the fields use for search in tantivy
    pub fn get_tantivy_fields(&self) -> HashSet<String> {
        let mut fields = HashSet::new();
        match self {
            Condition::Equal(field, _)
            | Condition::NotEqual(field, _)
            | Condition::In(field, ..)
            | Condition::Regex(field, _)
            | Condition::StrMatch(field, ..) => {
                fields.insert(field.clone());
            }
            Condition::MatchAll(_) | Condition::FuzzyMatchAll(..) => {
                fields.insert(INDEX_FIELD_NAME_FOR_ALL.to_string());
            }
            Condition::All() => {}
            Condition::Or(left, right) | Condition::And(left, right) => {
                fields.extend(left.get_tantivy_fields());
                fields.extend(right.get_tantivy_fields());
            }
            Condition::Not(condition) => {
                fields.extend(condition.get_tantivy_fields());
            }
        }
        fields
    }

    // get the fields use for search in datafusion(for add filter back logical)
    pub fn get_schema_fields(&self, fst_fields: &[String]) -> HashSet<String> {
        let mut fields = HashSet::new();
        match self {
            Condition::Equal(field, _)
            | Condition::NotEqual(field, _)
            | Condition::StrMatch(field, ..)
            | Condition::In(field, ..)
            | Condition::Regex(field, _) => {
                fields.insert(field.clone());
            }
            Condition::MatchAll(_) | Condition::FuzzyMatchAll(..) => {
                fields.extend(fst_fields.iter().cloned());
            }
            Condition::All() => {}
            Condition::Or(left, right) | Condition::And(left, right) => {
                fields.extend(left.get_schema_fields(fst_fields));
                fields.extend(right.get_schema_fields(fst_fields));
            }
            Condition::Not(condition) => {
                fields.extend(condition.get_schema_fields(fst_fields));
            }
        }
        fields
    }

    pub fn to_physical_expr(
        &self,
        schema: &arrow_schema::Schema,
        fst_fields: &[String],
    ) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
        let cfg = get_config();
        match self {
            Condition::Equal(name, value) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let right = get_scalar_value(value, field.data_type())?;
                Ok(Arc::new(BinaryExpr::new(left, Operator::Eq, right)))
            }
            Condition::NotEqual(name, value) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let right = get_scalar_value(value, field.data_type())?;
                Ok(Arc::new(BinaryExpr::new(left, Operator::NotEq, right)))
            }
            Condition::StrMatch(name, value, case_sensitive) => {
                create_str_match_expr(schema, name, value, *case_sensitive)
            }
            Condition::In(name, values, negated) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let values: Vec<Arc<dyn PhysicalExpr>> = values
                    .iter()
                    .map(|value| get_scalar_value(value, field.data_type()).map(|v| v as _))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Arc::new(InListExpr::try_new(
                    left, values, *negated, schema,
                )?))
            }
            Condition::Regex(..) => {
                unreachable!("Condition::Regex query only support for promql")
            }
            Condition::MatchAll(value) => {
                let value = value
                    .trim_start_matches("re:") // regex
                    .trim_start_matches('*') // contains
                    .trim_end_matches('*') // prefix or contains
                    .to_string();
                let term = if cfg.common.utf8_view_enabled {
                    Arc::new(Literal::new(ScalarValue::Utf8View(Some(format!(
                        "%{value}%"
                    )))))
                } else {
                    Arc::new(Literal::new(ScalarValue::Utf8(Some(format!("%{value}%")))))
                };
                let mut expr_list: Vec<Arc<dyn PhysicalExpr>> =
                    Vec::with_capacity(fst_fields.len());
                for field in fst_fields.iter() {
                    let term = if !cfg.common.utf8_view_enabled
                        && let Some((_idx, schema_field)) = schema.column_with_name(field)
                        && schema_field.data_type() == &DataType::LargeUtf8
                    {
                        Arc::new(Literal::new(ScalarValue::LargeUtf8(Some(format!(
                            "%{value}%"
                        )))))
                    } else {
                        term.clone()
                    };
                    expr_list.push(create_like_expr_with_not_null(field, term, schema));
                }
                if expr_list.is_empty() {
                    return Err(anyhow::anyhow!(
                        "Using match_all() function in a stream that don't have full text search field"
                    )); // already check this in sql.rs
                }
                Ok(disjunction(expr_list))
            }
            Condition::FuzzyMatchAll(value, distance) => {
                let fuzzy_expr = Arc::new(fuzzy_match_udf::FUZZY_MATCH_UDF.clone());
                let term = if cfg.common.utf8_view_enabled {
                    Arc::new(Literal::new(ScalarValue::Utf8View(Some(value.to_string()))))
                } else {
                    Arc::new(Literal::new(ScalarValue::Utf8(Some(value.to_string()))))
                };
                let distance = Arc::new(Literal::new(ScalarValue::Int64(Some(*distance as i64))));
                let mut expr_list: Vec<Arc<dyn PhysicalExpr>> =
                    Vec::with_capacity(fst_fields.len());
                for field in fst_fields.iter() {
                    let term = if !cfg.common.utf8_view_enabled
                        && let Some((_idx, schema_field)) = schema.column_with_name(field)
                        && schema_field.data_type() == &DataType::LargeUtf8
                    {
                        Arc::new(Literal::new(ScalarValue::LargeUtf8(Some(
                            value.to_string(),
                        ))))
                    } else {
                        term.clone()
                    };
                    let new_expr = Arc::new(ScalarFunctionExpr::try_new(
                        fuzzy_expr.clone(),
                        vec![
                            Arc::new(Column::new(field, schema.index_of(field).unwrap())),
                            term,
                            distance.clone(),
                        ],
                        schema,
                        Arc::new(ConfigOptions::default()),
                    )?);
                    expr_list.push(new_expr);
                }
                if expr_list.is_empty() {
                    return Err(anyhow::anyhow!(
                        "Using fuzzy_match_all() function in a stream that don't have full text search field"
                    )); // already check this in sql.rs
                }
                Ok(disjunction(expr_list))
            }
            Condition::All() => Ok(Arc::new(Literal::new(ScalarValue::Boolean(Some(true))))),
            Condition::Or(left, right) => {
                let left = left.to_physical_expr(schema, fst_fields)?;
                let right = right.to_physical_expr(schema, fst_fields)?;
                Ok(Arc::new(BinaryExpr::new(left, Operator::Or, right)))
            }
            Condition::And(left, right) => {
                let left = left.to_physical_expr(schema, fst_fields)?;
                let right = right.to_physical_expr(schema, fst_fields)?;
                Ok(Arc::new(BinaryExpr::new(left, Operator::And, right)))
            }
            Condition::Not(condition) => {
                let expr = condition.to_physical_expr(schema, fst_fields)?;
                Ok(Arc::new(NotExpr::new(expr)))
            }
        }
    }

    pub fn can_remove_filter(&self) -> bool {
        match self {
            Condition::Equal(..) => true,
            Condition::NotEqual(..) => true,
            Condition::StrMatch(..) => true,
            Condition::In(..) => true,
            Condition::Regex(..) => false,
            Condition::MatchAll(v) => is_alphanumeric(v),
            Condition::FuzzyMatchAll(..) => false,
            Condition::All() => true,
            Condition::Or(left, right) => left.can_remove_filter() && right.can_remove_filter(),
            Condition::And(left, right) => left.can_remove_filter() && right.can_remove_filter(),
            Condition::Not(condition) => condition.can_remove_filter(),
        }
    }
}

// check if function is match_all and only have one argument
// check if binary operator is equal and one side is field and the other side is value
// and the field is in the index_fields
// NOTE: current only used in [`use_inverted_index`]
fn is_expr_valid_for_index(expr: &Expr, index_fields: &HashSet<String>) -> bool {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Eq | BinaryOperator::NotEq,
            right,
        } => {
            let field = if is_value(left) && is_field(right) {
                right
            } else if is_value(right) && is_field(left) {
                left
            } else {
                return false;
            };

            if !index_fields.contains(&get_field_name(field)) {
                return false;
            }
        }
        Expr::InList {
            expr,
            list,
            negated: _,
        } => {
            if !is_field(expr) || !index_fields.contains(&get_field_name(expr)) {
                return false;
            }
            for value in list {
                if !is_value(value) {
                    return false;
                }
            }
        }
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And | BinaryOperator::Or,
            right,
        } => {
            return is_expr_valid_for_index(left, index_fields)
                && is_expr_valid_for_index(right, index_fields);
        }
        Expr::Function(func) => {
            let fn_name = func.name.to_string().to_lowercase();
            let FunctionArguments::List(list) = &func.args else {
                return false;
            };

            return match fn_name.as_str() {
                MATCH_ALL_UDF_NAME => list.args.len() == 1,
                FUZZY_MATCH_ALL_UDF_NAME => list.args.len() == 2,
                STR_MATCH_UDF_NAME
                | STR_MATCH_UDF_IGNORE_CASE_NAME
                | MATCH_FIELD_UDF_NAME
                | MATCH_FIELD_IGNORE_CASE_UDF_NAME => {
                    list.args.len() == 2 && index_fields.contains(&get_arg_name(&list.args[0]))
                }
                _ => false,
            };
        }
        Expr::Nested(expr) => {
            return is_expr_valid_for_index(expr, index_fields);
        }
        Expr::UnaryOp {
            op: UnaryOperator::Not,
            expr,
        } => {
            return is_expr_valid_for_index(expr, index_fields);
        }
        _ => return false,
    }
    true
}

fn get_value(expr: &Expr) -> String {
    match expr {
        Expr::Value(value) => trim_quotes(value.to_string().as_str()),
        _ => unreachable!(),
    }
}

// TODO: duplication with datafusion/optimizer/physical_optimizer/utils.rs
fn is_physical_column(expr: &Arc<dyn PhysicalExpr>) -> bool {
    if expr.as_any().downcast_ref::<Column>().is_some() {
        true
    } else if let Some(expr) = expr.as_any().downcast_ref::<CastExpr>() {
        is_physical_column(expr.expr())
    } else {
        false
    }
}

// TODO: duplication with datafusion/optimizer/physical_optimizer/utils.rs
fn get_physical_column_name(expr: &Arc<dyn PhysicalExpr>) -> &str {
    if let Some(expr) = expr.as_any().downcast_ref::<Column>() {
        expr.name()
    } else if let Some(expr) = expr.as_any().downcast_ref::<CastExpr>() {
        get_physical_column_name(expr.expr())
    } else {
        UNKNOWN_NAME
    }
}

fn is_physical_value(expr: &Arc<dyn PhysicalExpr>) -> bool {
    expr.as_any().downcast_ref::<Literal>().is_some()
}

fn get_physical_value(expr: &Arc<dyn PhysicalExpr>) -> String {
    if let Some(literal) = expr.as_any().downcast_ref::<Literal>() {
        match literal.value() {
            ScalarValue::Boolean(Some(b)) => b.to_string(),
            ScalarValue::Int64(Some(i)) => i.to_string(),
            ScalarValue::UInt64(Some(i)) => i.to_string(),
            ScalarValue::Float64(Some(f)) => f.to_string(),
            ScalarValue::Utf8(Some(s)) => s.clone(),
            ScalarValue::LargeUtf8(Some(s)) => s.clone(),
            ScalarValue::Utf8View(Some(s)) => s.clone(),
            ScalarValue::Binary(Some(b)) => String::from_utf8_lossy(b).to_string(),
            _ => unimplemented!("get_physical_value not support {:?}", literal),
        }
    } else {
        unreachable!()
    }
}

// combine all exprs with OR operator
fn disjunction(exprs: Vec<Arc<dyn PhysicalExpr>>) -> Arc<dyn PhysicalExpr> {
    if exprs.len() == 1 {
        exprs[0].clone()
    } else {
        // conjuction all expr in exprs
        let mut expr = exprs[0].clone();
        for e in exprs.into_iter().skip(1) {
            expr = Arc::new(BinaryExpr::new(expr, Operator::Or, e));
        }
        expr
    }
}

fn get_scalar_value(value: &str, data_type: &DataType) -> Result<Arc<Literal>, anyhow::Error> {
    Ok(match data_type {
        DataType::Boolean => Arc::new(Literal::new(ScalarValue::Boolean(Some(value.parse()?)))),
        DataType::Int64 => Arc::new(Literal::new(ScalarValue::Int64(Some(value.parse()?)))),
        DataType::UInt64 => Arc::new(Literal::new(ScalarValue::UInt64(Some(value.parse()?)))),
        DataType::Float64 => Arc::new(Literal::new(ScalarValue::Float64(Some(value.parse()?)))),
        DataType::Utf8 => Arc::new(Literal::new(ScalarValue::Utf8(Some(value.to_string())))),
        DataType::LargeUtf8 => Arc::new(Literal::new(ScalarValue::LargeUtf8(Some(
            value.to_string(),
        )))),
        DataType::Utf8View => {
            Arc::new(Literal::new(ScalarValue::Utf8View(Some(value.to_string()))))
        }
        DataType::Binary => Arc::new(Literal::new(ScalarValue::Binary(Some(
            value.as_bytes().to_vec(),
        )))),
        _ => unimplemented!(),
    })
}

pub(crate) fn get_arg_name(args: &FunctionArg) -> String {
    match args {
        FunctionArg::Named { name, .. } => name.to_string(),
        FunctionArg::ExprNamed { name, .. } => get_field_name(name),
        FunctionArg::Unnamed(arg) => match arg {
            FunctionArgExpr::Expr(expr) => get_field_name(expr),
            _ => UNKNOWN_NAME.to_string(),
        },
    }
}

fn create_like_expr_with_not_null(
    field: &str,
    term: Arc<dyn PhysicalExpr>,
    schema: &arrow_schema::Schema,
) -> Arc<dyn PhysicalExpr> {
    let column = Arc::new(Column::new(field, schema.index_of(field).unwrap()));
    Arc::new(BinaryExpr::new(
        Arc::new(IsNotNullExpr::new(column.clone())),
        Operator::And,
        Arc::new(LikeExpr::new(false, true, column, term.clone())),
    ))
}

fn create_str_match_expr(
    schema: &arrow_schema::Schema,
    name: &str,
    value: &str,
    case_sensitive: bool,
) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
    let index = schema.index_of(name).unwrap();
    let field = schema.field(index);
    let col = Arc::new(Column::new(name, index));

    // if the field is Utf8View, we need to cast it to Utf8 for str_match udf
    let left: Arc<dyn PhysicalExpr> = if *field.data_type() == DataType::Utf8View {
        Arc::new(CastExpr::new(col, DataType::Utf8, None))
    } else {
        col
    };

    // if the field is Utf8View, we need to cast it to Utf8 for str_match udf
    let data_type = if *field.data_type() == DataType::Utf8View {
        DataType::Utf8
    } else {
        field.data_type().clone()
    };

    let right = get_scalar_value(value, &data_type)?;
    let udf = if case_sensitive {
        Arc::new(str_match_udf::STR_MATCH_UDF.clone())
    } else {
        Arc::new(str_match_udf::STR_MATCH_IGNORE_CASE_UDF.clone())
    };

    let udf_expr = Arc::new(ScalarFunctionExpr::try_new(
        udf.clone(),
        vec![left, right],
        schema,
        Arc::new(ConfigOptions::default()),
    )?);
    Ok(udf_expr)
}

fn is_alphanumeric(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn _is_blank_or_alphanumeric(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_whitespace() || c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use sqlparser::ast::{Function, FunctionArgumentList, Ident, ObjectName, Value};

    use super::*;

    #[test]
    fn test_condition_get_tantivy_fields_equal() {
        let condition = Condition::Equal("field1".to_string(), "value1".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_in() {
        let condition = Condition::In(
            "field2".to_string(),
            vec![
                "value1".to_string(),
                "value2".to_string(),
                "value3".to_string(),
            ],
            false,
        );
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field2"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_regex() {
        let condition = Condition::Regex("field3".to_string(), "pattern.*".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field3"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_match_all() {
        let condition = Condition::MatchAll("search_term".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_get_tantivy_fields_fuzzy_match_all() {
        let condition = Condition::FuzzyMatchAll("search_term".to_string(), 2);
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_get_tantivy_fields_all() {
        let condition = Condition::All();
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 0);
    }

    #[test]
    fn test_condition_get_tantivy_fields_or_simple() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Equal("field2".to_string(), "value2".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 2);
        assert!(fields.contains("field1"));
        assert!(fields.contains("field2"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_and_simple() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::In("field2".to_string(), vec!["value1".to_string()], false);
        let condition = Condition::And(Box::new(left), Box::new(right));
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 2);
        assert!(fields.contains("field1"));
        assert!(fields.contains("field2"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_or_with_overlap() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Equal("field1".to_string(), "value2".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        let fields = condition.get_tantivy_fields();

        // Should only have one field since both conditions use the same field
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_and_with_overlap() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Regex("field1".to_string(), "pattern.*".to_string());
        let condition = Condition::And(Box::new(left), Box::new(right));
        let fields = condition.get_tantivy_fields();

        // Should only have one field since both conditions use the same field
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_nested_complex() {
        // Create a complex nested condition: (field1 = value1 OR field2 = value2) AND (field3 =
        // value3 OR match_all(term))
        let left_or = Condition::Or(
            Box::new(Condition::Equal("field1".to_string(), "value1".to_string())),
            Box::new(Condition::Equal("field2".to_string(), "value2".to_string())),
        );
        let right_or = Condition::Or(
            Box::new(Condition::Equal("field3".to_string(), "value3".to_string())),
            Box::new(Condition::MatchAll("search_term".to_string())),
        );
        let condition = Condition::And(Box::new(left_or), Box::new(right_or));
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 4);
        assert!(fields.contains("field1"));
        assert!(fields.contains("field2"));
        assert!(fields.contains("field3"));
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_get_tantivy_fields_all_types_mixed() {
        // Test with all different condition types mixed together
        let equal_cond = Condition::Equal("equal_field".to_string(), "value".to_string());
        let in_cond = Condition::In("in_field".to_string(), vec!["val1".to_string()], false);
        let regex_cond = Condition::Regex("regex_field".to_string(), "pattern.*".to_string());
        let match_all_cond = Condition::MatchAll("search_term".to_string());
        let fuzzy_match_cond = Condition::FuzzyMatchAll("fuzzy_term".to_string(), 1);
        let all_cond = Condition::All();

        // Create nested structure: ((equal OR in) AND (regex OR match_all)) OR (fuzzy_match_all AND
        // all)
        let left_or = Condition::Or(Box::new(equal_cond), Box::new(in_cond));
        let right_or = Condition::Or(Box::new(regex_cond), Box::new(match_all_cond));
        let left_and = Condition::And(Box::new(left_or), Box::new(right_or));
        let right_and = Condition::And(Box::new(fuzzy_match_cond), Box::new(all_cond));
        let condition = Condition::Or(Box::new(left_and), Box::new(right_and));

        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 4); // equal_field, in_field, regex_field, _all (match_all and fuzzy_match_all both use _all, so deduplicated)
        assert!(fields.contains("equal_field"));
        assert!(fields.contains("in_field"));
        assert!(fields.contains("regex_field"));
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_get_tantivy_fields_empty_field_names() {
        let condition = Condition::Equal("".to_string(), "value".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains(""));
    }

    #[test]
    fn test_condition_get_tantivy_fields_special_characters() {
        let condition = Condition::Equal("field.with.dots".to_string(), "value".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field.with.dots"));
    }

    #[test]
    fn test_condition_get_tantivy_fields_unicode_field_names() {
        let condition = Condition::Equal("поле".to_string(), "значение".to_string());
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("поле"));
    }

    // add some test for str_match
    #[test]
    fn test_str_match() {
        let condition = Condition::StrMatch("field1".to_string(), "value1".to_string(), true);
        let fields = condition.get_tantivy_fields();

        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_is_alphanumeric() {
        assert!(is_alphanumeric("123"));
        assert!(is_alphanumeric("123abc"));
        assert!(!is_alphanumeric("123 abc"));
        assert!(!is_alphanumeric("123 abc 123"));
    }

    #[test]
    fn test_is_blank_or_alphanumeric() {
        assert!(_is_blank_or_alphanumeric("123"));
        assert!(_is_blank_or_alphanumeric("123abc"));
        assert!(_is_blank_or_alphanumeric("123 abc"));
        assert!(_is_blank_or_alphanumeric("123 abc 123"));
    }

    #[test]
    fn test_is_expr_valid_for_index1() {
        let index_fields = HashSet::from_iter(vec!["field1".to_string()]);
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field1"))),
            op: BinaryOperator::NotEq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        };
        let result = is_expr_valid_for_index(&expr, &index_fields);
        assert!(result);
    }

    #[test]
    fn test_is_expr_valid_for_index2() {
        // name not in ('a', 'b') or name = 'c'
        let index_fields = HashSet::from_iter(vec!["name".to_string()]);
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::InList {
                expr: Box::new(Expr::Identifier(Ident::new("name"))),
                list: vec![
                    Expr::Value(Value::SingleQuotedString("a".to_string()).into()),
                    Expr::Value(Value::SingleQuotedString("b".to_string()).into()),
                ],
                negated: true,
            }),
            op: BinaryOperator::Or,
            right: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("name"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("c".to_string()).into(),
                )),
            }),
        };
        let result = is_expr_valid_for_index(&expr, &index_fields);
        assert!(result);
    }

    #[test]
    fn test_is_expr_valid_for_index3() {
        // not (match_all('foo') or name != 'c')
        let index_fields = HashSet::from_iter(vec!["name".to_string()]);
        let expr = Expr::UnaryOp {
            op: UnaryOperator::Not,
            expr: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Function(Function {
                    name: ObjectName::from(vec![Ident::new("match_all")]),
                    uses_odbc_syntax: false,
                    parameters: FunctionArguments::None,
                    args: FunctionArguments::List(FunctionArgumentList {
                        duplicate_treatment: None,
                        args: vec![FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                            Value::SingleQuotedString("foo".to_string()).into(),
                        )))],
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![],
                })),
                op: BinaryOperator::Or,
                right: Box::new(Expr::BinaryOp {
                    left: Box::new(Expr::Identifier(Ident::new("name"))),
                    op: BinaryOperator::NotEq,
                    right: Box::new(Expr::Value(
                        Value::SingleQuotedString("c".to_string()).into(),
                    )),
                }),
            }),
        };
        let result = is_expr_valid_for_index(&expr, &index_fields);
        assert!(result);
    }

    #[test]
    fn test_get_index_condition_from_expr_simple_equality() {
        let index_fields = HashSet::from_iter(vec!["field1".to_string()]);
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field1"))),
            op: BinaryOperator::Eq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        };

        let (condition, other_expr) = get_index_condition_from_expr(&index_fields, &expr);

        assert!(condition.is_some());
        let condition = condition.unwrap();
        assert_eq!(condition.conditions.len(), 1);
        assert!(matches!(
            condition.conditions[0],
            Condition::Equal(ref field, ref value) if field == "field1" && value == "value1"
        ));
        assert!(other_expr.is_none());
    }

    #[test]
    fn test_get_index_condition_from_expr_non_indexed_field() {
        let index_fields = HashSet::from_iter(vec!["field1".to_string()]);
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field2"))),
            op: BinaryOperator::Eq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        };

        let (condition, other_expr) = get_index_condition_from_expr(&index_fields, &expr);

        assert!(condition.is_none());
        assert!(other_expr.is_some());
    }

    #[test]
    fn test_get_index_condition_from_expr_mixed_conditions() {
        let index_fields = HashSet::from_iter(vec!["field1".to_string()]);
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field1"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value1".to_string()).into(),
                )),
            }),
            op: BinaryOperator::And,
            right: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field2"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value2".to_string()).into(),
                )),
            }),
        };

        let (condition, other_expr) = get_index_condition_from_expr(&index_fields, &expr);

        assert!(condition.is_some());
        let condition = condition.unwrap();
        assert_eq!(condition.conditions.len(), 1);
        assert!(other_expr.is_some());
    }

    #[test]
    fn test_condition_from_expr_equality() {
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field1"))),
            op: BinaryOperator::Eq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::Equal(field, value) if field == "field1" && value == "value1"
        ));
    }

    #[test]
    fn test_condition_from_expr_not_equal() {
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field1"))),
            op: BinaryOperator::NotEq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::NotEqual(field, value) if field == "field1" && value == "value1"
        ));
    }

    #[test]
    fn test_condition_from_expr_in_list() {
        let expr = Expr::InList {
            expr: Box::new(Expr::Identifier(Ident::new("field1"))),
            list: vec![
                Expr::Value(Value::SingleQuotedString("value1".to_string()).into()),
                Expr::Value(Value::SingleQuotedString("value2".to_string()).into()),
            ],
            negated: false,
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::In(field, values, negated)
            if field == "field1" && values == vec!["value1", "value2"] && !negated
        ));
    }

    #[test]
    fn test_condition_from_expr_in_list_negated() {
        let expr = Expr::InList {
            expr: Box::new(Expr::Identifier(Ident::new("field1"))),
            list: vec![Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )],
            negated: true,
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::In(field, values, negated)
            if field == "field1" && values == vec!["value1"] && negated
        ));
    }

    #[test]
    fn test_condition_from_expr_match_all() {
        let expr = Expr::Function(Function {
            name: ObjectName::from(vec![Ident::new("match_all")]),
            uses_odbc_syntax: false,
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                    Value::SingleQuotedString("search_term".to_string()).into(),
                )))],
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
        });

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::MatchAll(term) if term == "search_term"
        ));
    }

    #[test]
    fn test_condition_from_expr_fuzzy_match_all() {
        let expr = Expr::Function(Function {
            name: ObjectName::from(vec![Ident::new("fuzzy_match_all")]),
            uses_odbc_syntax: false,
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                        Value::SingleQuotedString("search_term".to_string()).into(),
                    ))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                        Value::Number("2".to_string(), false).into(),
                    ))),
                ],
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
        });

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::FuzzyMatchAll(term, distance) if term == "search_term" && distance == 2
        ));
    }

    #[test]
    fn test_condition_from_expr_str_match() {
        let expr = Expr::Function(Function {
            name: ObjectName::from(vec![Ident::new("str_match")]),
            uses_odbc_syntax: false,
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new(
                        "field1",
                    )))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                        Value::SingleQuotedString("pattern".to_string()).into(),
                    ))),
                ],
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
        });

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::StrMatch(field, pattern, case_sensitive)
            if field == "field1" && pattern == "pattern" && case_sensitive
        ));
    }

    #[test]
    fn test_condition_from_expr_str_match_ignore_case() {
        let expr = Expr::Function(Function {
            name: ObjectName::from(vec![Ident::new("str_match_ignore_case")]),
            uses_odbc_syntax: false,
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new(
                        "field1",
                    )))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
                        Value::SingleQuotedString("pattern".to_string()).into(),
                    ))),
                ],
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
        });

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::StrMatch(field, pattern, case_sensitive)
            if field == "field1" && pattern == "pattern" && !case_sensitive
        ));
    }

    #[test]
    fn test_condition_from_expr_or() {
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field1"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value1".to_string()).into(),
                )),
            }),
            op: BinaryOperator::Or,
            right: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field2"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value2".to_string()).into(),
                )),
            }),
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(condition, Condition::Or(_, _)));
    }

    #[test]
    fn test_condition_from_expr_and() {
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field1"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value1".to_string()).into(),
                )),
            }),
            op: BinaryOperator::And,
            right: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field2"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value2".to_string()).into(),
                )),
            }),
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(condition, Condition::And(_, _)));
    }

    #[test]
    fn test_condition_from_expr_not() {
        let expr = Expr::UnaryOp {
            op: UnaryOperator::Not,
            expr: Box::new(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new("field1"))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(
                    Value::SingleQuotedString("value1".to_string()).into(),
                )),
            }),
        };

        let condition = Condition::from_expr(&expr);
        assert!(matches!(condition, Condition::Not(_)));
    }

    #[test]
    fn test_condition_from_expr_nested() {
        let expr = Expr::Nested(Box::new(Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("field1"))),
            op: BinaryOperator::Eq,
            right: Box::new(Expr::Value(
                Value::SingleQuotedString("value1".to_string()).into(),
            )),
        }));

        let condition = Condition::from_expr(&expr);
        assert!(matches!(
            condition,
            Condition::Equal(field, value) if field == "field1" && value == "value1"
        ));
    }

    #[test]
    fn test_index_condition_new() {
        let condition = IndexCondition::new();
        assert!(condition.conditions.is_empty());
    }

    #[test]
    fn test_index_condition_add_condition() {
        let mut index_condition = IndexCondition::new();
        let condition = Condition::Equal("field1".to_string(), "value1".to_string());

        index_condition.add_condition(condition.clone());

        assert_eq!(index_condition.conditions.len(), 1);
        assert!(matches!(
            index_condition.conditions[0],
            Condition::Equal(ref field, ref value) if field == "field1" && value == "value1"
        ));
    }

    #[test]
    fn test_index_condition_to_query() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        index_condition.add_condition(Condition::Equal("field2".to_string(), "value2".to_string()));

        let query_string = index_condition.to_query();
        assert_eq!(query_string, "field1=value1 AND field2=value2");
    }

    #[test]
    fn test_index_condition_to_query_empty() {
        let index_condition = IndexCondition::new();
        let query_string = index_condition.to_query();
        assert_eq!(query_string, "");
    }

    #[test]
    fn test_index_condition_is_empty() {
        let mut index_condition = IndexCondition::new();
        assert!(index_condition.is_empty());

        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        assert!(!index_condition.is_empty());
    }

    #[test]
    fn test_index_condition_is_simple_str_match() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::StrMatch(
            "field1".to_string(),
            "value1".to_string(),
            true,
        ));

        assert!(index_condition.is_simple_str_match("field1"));
        assert!(!index_condition.is_simple_str_match("field2"));
    }

    #[test]
    fn test_index_condition_is_simple_str_match_multiple_conditions() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::StrMatch(
            "field1".to_string(),
            "value1".to_string(),
            true,
        ));
        index_condition.add_condition(Condition::Equal("field2".to_string(), "value2".to_string()));

        assert!(!index_condition.is_simple_str_match("field1"));
    }

    #[test]
    fn test_index_condition_get_str_match_condition() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::StrMatch(
            "field1".to_string(),
            "value1".to_string(),
            true,
        ));

        let result = index_condition.get_str_match_condition();
        assert_eq!(result, Some(("value1".to_string(), true)));
    }

    #[test]
    fn test_index_condition_get_str_match_condition_all() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::All());

        let result = index_condition.get_str_match_condition();
        assert_eq!(result, None);
    }

    #[test]
    fn test_index_condition_is_condition_all() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::All());

        assert!(index_condition.is_condition_all());

        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        assert!(!index_condition.is_condition_all());
    }

    #[test]
    fn test_condition_to_query_equal() {
        let condition = Condition::Equal("field1".to_string(), "value1".to_string());
        assert_eq!(condition.to_query(), "field1=value1");
    }

    #[test]
    fn test_condition_to_query_not_equal() {
        let condition = Condition::NotEqual("field1".to_string(), "value1".to_string());
        assert_eq!(condition.to_query(), "field1!=value1");
    }

    #[test]
    fn test_condition_to_query_str_match() {
        let condition = Condition::StrMatch("field1".to_string(), "value1".to_string(), true);
        assert_eq!(condition.to_query(), "str_match(field1, 'value1')");

        let condition = Condition::StrMatch("field1".to_string(), "value1".to_string(), false);
        assert_eq!(
            condition.to_query(),
            "str_match_ignore_case(field1, 'value1')"
        );
    }

    #[test]
    fn test_condition_to_query_in() {
        let condition = Condition::In(
            "field1".to_string(),
            vec!["value1".to_string(), "value2".to_string()],
            false,
        );
        assert_eq!(condition.to_query(), "field1 IN (value1,value2)");

        let condition = Condition::In("field1".to_string(), vec!["value1".to_string()], true);
        assert_eq!(condition.to_query(), "field1 NOT IN (value1)");
    }

    #[test]
    fn test_condition_to_query_regex() {
        let condition = Condition::Regex("field1".to_string(), "pattern.*".to_string());
        assert_eq!(condition.to_query(), "field1=~pattern.*");
    }

    #[test]
    fn test_condition_to_query_match_all() {
        let condition = Condition::MatchAll("search_term".to_string());
        assert_eq!(condition.to_query(), "_all:search_term");
    }

    #[test]
    fn test_condition_to_query_fuzzy_match_all() {
        let condition = Condition::FuzzyMatchAll("search_term".to_string(), 2);
        assert_eq!(condition.to_query(), "_all:fuzzy(search_term, 2)");
    }

    #[test]
    fn test_condition_to_query_all() {
        let condition = Condition::All();
        assert_eq!(condition.to_query(), "ALL");
    }

    #[test]
    fn test_condition_to_query_or() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Equal("field2".to_string(), "value2".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        assert_eq!(condition.to_query(), "(field1=value1 OR field2=value2)");
    }

    #[test]
    fn test_condition_to_query_and() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Equal("field2".to_string(), "value2".to_string());
        let condition = Condition::And(Box::new(left), Box::new(right));
        assert_eq!(condition.to_query(), "(field1=value1 AND field2=value2)");
    }

    #[test]
    fn test_condition_to_query_not() {
        let inner = Condition::Equal("field1".to_string(), "value1".to_string());
        let condition = Condition::Not(Box::new(inner));
        assert_eq!(condition.to_query(), "NOT(field1=value1)");
    }

    #[test]
    fn test_condition_need_all_term_fields_str_match() {
        let condition = Condition::StrMatch("field1".to_string(), "value".to_string(), true);
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_need_all_term_fields_match_all_wildcard() {
        let condition = Condition::MatchAll("*test*".to_string());
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 1);
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_need_all_term_fields_match_all_simple() {
        let condition = Condition::MatchAll("test".to_string());
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 0);
    }

    #[test]
    fn test_condition_need_all_term_fields_fuzzy_match_all() {
        let condition = Condition::FuzzyMatchAll("test".to_string(), 2);
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 1);
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_condition_need_all_term_fields_not_equal() {
        let condition = Condition::NotEqual("field1".to_string(), "value".to_string());
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_need_all_term_fields_in_negated() {
        let condition = Condition::In("field1".to_string(), vec!["value1".to_string()], true);
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }

    #[test]
    fn test_condition_need_all_term_fields_or() {
        let left = Condition::StrMatch("field1".to_string(), "value".to_string(), true);
        let right = Condition::NotEqual("field2".to_string(), "value".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        let fields = condition.need_all_term_fields();
        assert_eq!(fields.len(), 2);
        assert!(fields.contains("field1"));
        assert!(fields.contains("field2"));
    }

    #[test]
    fn test_condition_can_remove_filter_equal() {
        let condition = Condition::Equal("field1".to_string(), "value1".to_string());
        assert!(condition.can_remove_filter());
    }

    #[test]
    fn test_condition_can_remove_filter_regex() {
        let condition = Condition::Regex("field1".to_string(), "pattern.*".to_string());
        assert!(!condition.can_remove_filter());
    }

    #[test]
    fn test_condition_can_remove_filter_match_all_alphanumeric() {
        let condition = Condition::MatchAll("test123".to_string());
        assert!(condition.can_remove_filter());
    }

    #[test]
    fn test_condition_can_remove_filter_match_all_non_alphanumeric() {
        let condition = Condition::MatchAll("test 123".to_string());
        assert!(!condition.can_remove_filter());
    }

    #[test]
    fn test_condition_can_remove_filter_fuzzy_match_all() {
        let condition = Condition::FuzzyMatchAll("test".to_string(), 2);
        assert!(!condition.can_remove_filter());
    }

    #[test]
    fn test_condition_can_remove_filter_or() {
        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Equal("field2".to_string(), "value2".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        assert!(condition.can_remove_filter());

        let left = Condition::Equal("field1".to_string(), "value1".to_string());
        let right = Condition::Regex("field2".to_string(), "pattern.*".to_string());
        let condition = Condition::Or(Box::new(left), Box::new(right));
        assert!(!condition.can_remove_filter());
    }

    #[test]
    fn test_get_value() {
        let expr = Expr::Value(Value::SingleQuotedString("quoted".to_string()).into());
        assert_eq!(get_value(&expr), "quoted");

        let expr = Expr::Value(Value::Number("123".to_string(), false).into());
        assert_eq!(get_value(&expr), "123");
    }

    #[test]
    fn test_disjunction_single() {
        use datafusion::{physical_expr::expressions::Literal, scalar::ScalarValue};

        let expr = Arc::new(Literal::new(ScalarValue::Boolean(Some(true))));
        let result = disjunction(vec![expr.clone()]);
        assert_eq!(result.as_ref() as *const _, expr.as_ref() as *const _);
    }

    #[test]
    fn test_get_scalar_value_boolean() {
        let result = get_scalar_value("true", &DataType::Boolean);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_int64() {
        let result = get_scalar_value("123", &DataType::Int64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_utf8() {
        let result = get_scalar_value("test", &DataType::Utf8);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_error() {
        let result = get_scalar_value("not_a_number", &DataType::Int64);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_arg_name_unnamed() {
        let arg = FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new(
            "field1",
        ))));
        assert_eq!(get_arg_name(&arg), "field1");
    }

    #[test]
    fn test_get_arg_name() {
        use sqlparser::ast::{
            Expr, FunctionArg, FunctionArgExpr, FunctionArgOperator, Ident, ObjectName,
        };

        // Test FunctionArg::Named
        let named_arg = FunctionArg::Named {
            name: Ident::new("field_name"),
            arg: FunctionArgExpr::Expr(Expr::Identifier(Ident::new("value"))),
            operator: FunctionArgOperator::Equals,
        };
        assert_eq!(get_arg_name(&named_arg), "field_name");

        // Test FunctionArg::ExprNamed with field expression
        let expr_named_field = FunctionArg::ExprNamed {
            name: Expr::Identifier(Ident::new("field_name")),
            arg: FunctionArgExpr::Expr(Expr::Identifier(Ident::new("value"))),
            operator: FunctionArgOperator::Equals,
        };
        assert_eq!(get_arg_name(&expr_named_field), "field_name");

        // Test FunctionArg::ExprNamed with compound identifier
        let expr_named_compound = FunctionArg::ExprNamed {
            name: Expr::CompoundIdentifier(vec![Ident::new("table"), Ident::new("field_name")]),
            arg: FunctionArgExpr::Expr(Expr::Identifier(Ident::new("value"))),
            operator: FunctionArgOperator::Equals,
        };
        assert_eq!(get_arg_name(&expr_named_compound), "field_name");

        // Test FunctionArg::ExprNamed with non-field expression (should return UNKNOWN_NAME)
        let expr_named_non_field = FunctionArg::ExprNamed {
            name: Expr::Value(sqlparser::ast::Value::Number("123".to_string(), false).into()),
            arg: FunctionArgExpr::Expr(Expr::Identifier(Ident::new("value"))),
            operator: FunctionArgOperator::Equals,
        };
        assert_eq!(get_arg_name(&expr_named_non_field), UNKNOWN_NAME);

        // Test FunctionArg::Unnamed with field expression
        let unnamed_field = FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(
            Ident::new("field_name"),
        )));
        assert_eq!(get_arg_name(&unnamed_field), "field_name");

        // Test FunctionArg::Unnamed with compound identifier
        let unnamed_compound =
            FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::CompoundIdentifier(vec![
                Ident::new("table"),
                Ident::new("field_name"),
            ])));
        assert_eq!(get_arg_name(&unnamed_compound), "field_name");

        // Test FunctionArg::Unnamed with non-field expression (should return UNKNOWN_NAME)
        let unnamed_non_field = FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(
            sqlparser::ast::Value::Number("123".to_string(), false).into(),
        )));
        assert_eq!(get_arg_name(&unnamed_non_field), UNKNOWN_NAME);

        // Test FunctionArg::Unnamed with Wildcard (should return UNKNOWN_NAME)
        let unnamed_wildcard = FunctionArg::Unnamed(FunctionArgExpr::Wildcard);
        assert_eq!(get_arg_name(&unnamed_wildcard), UNKNOWN_NAME);

        // Test FunctionArg::Unnamed with other FunctionArgExpr variants (should return
        // UNKNOWN_NAME)
        let unnamed_other =
            FunctionArg::Unnamed(FunctionArgExpr::QualifiedWildcard(ObjectName(vec![
                sqlparser::ast::ObjectNamePart::Identifier(Ident::new("table")),
            ])));
        assert_eq!(get_arg_name(&unnamed_other), UNKNOWN_NAME);
    }
}
