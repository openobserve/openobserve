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
    utils::tantivy::{query::contains_query::ContainsQuery, tokenizer::o2_collect_tokens},
};
use datafusion::{
    arrow::datatypes::{DataType, SchemaRef},
    logical_expr::Operator,
    physical_expr::ScalarFunctionExpr,
    physical_plan::{
        PhysicalExpr,
        expressions::{BinaryExpr, Column, InListExpr, LikeExpr, Literal},
    },
    scalar::ScalarValue,
};
use hashbrown::HashSet;
use serde::{Deserialize, Serialize};
use sqlparser::ast::{BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments};
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
use crate::service::search::datafusion::udf::{
    MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
    STR_MATCH_UDF_NAME,
    match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
    str_match_udf,
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
    if index_condition.conditions.is_empty() {
        (None, new_expr)
    } else {
        (Some(index_condition), new_expr)
    }
}

// note the condition in IndexCondition is connection by AND operator
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct IndexCondition {
    pub conditions: Vec<Condition>,
}

impl IndexCondition {
    pub fn new() -> Self {
        IndexCondition {
            conditions: Vec::new(),
        }
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

// single condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Condition {
    // field, value
    Equal(String, String),
    // field, value, case_sensitive
    StrMatch(String, String, bool),
    In(String, Vec<String>),
    Regex(String, String),
    MatchAll(String),
    FuzzyMatchAll(String, u8),
    Or(Box<Condition>, Box<Condition>),
    And(Box<Condition>, Box<Condition>),
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

    pub fn get_tantivy_fields(&self) -> HashSet<String> {
        self.conditions
            .iter()
            .fold(HashSet::new(), |mut acc, condition| {
                acc.extend(condition.get_tantivy_fields());
                acc
            })
    }

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
}

impl Condition {
    // this only use for display the query
    pub fn to_query(&self) -> String {
        match self {
            Condition::Equal(field, value) => format!("{}={}", field, value),
            Condition::StrMatch(field, value, case_sensitive) => {
                if *case_sensitive {
                    format!("str_match({}, '{}')", field, value)
                } else {
                    format!("str_match_ignore_case({}, '{}')", field, value)
                }
            }
            Condition::In(field, values) => format!("{} IN ({})", field, values.join(",")),
            Condition::Regex(field, value) => format!("{}=~{}", field, value),
            Condition::MatchAll(value) => format!("{}:{}", INDEX_FIELD_NAME_FOR_ALL, value),
            Condition::FuzzyMatchAll(value, distance) => format!(
                "{}:fuzzy({}, {})",
                INDEX_FIELD_NAME_FOR_ALL, value, distance
            ),
            Condition::Or(left, right) => format!("({} OR {})", left.to_query(), right.to_query()),
            Condition::And(left, right) => {
                format!("({} AND {})", left.to_query(), right.to_query())
            }
        }
    }

    pub fn from_expr(expr: &Expr) -> Self {
        match expr {
            Expr::BinaryOp {
                left,
                op: BinaryOperator::Eq,
                right,
            } => {
                let (field, value) = if is_value(left) && is_field(right) {
                    (get_field_name(right), get_value(left))
                } else if is_value(right) && is_field(left) {
                    (get_field_name(left), get_value(right))
                } else {
                    unreachable!()
                };
                Condition::Equal(field, value)
            }
            Expr::InList {
                expr,
                list,
                negated: _,
            } => {
                let field = get_field_name(expr);
                let values = list.iter().map(get_value).collect();
                Condition::In(field, values)
            }
            Expr::Function(func) => {
                let fn_name = func.name.to_string().to_lowercase();
                if fn_name == MATCH_ALL_UDF_NAME {
                    if let FunctionArguments::List(list) = &func.args {
                        if list.args.len() != 1 {
                            unreachable!()
                        }
                        Condition::MatchAll(trim_quotes(list.args[0].to_string().as_str()))
                    } else {
                        unreachable!()
                    }
                } else if fn_name == FUZZY_MATCH_ALL_UDF_NAME {
                    if let FunctionArguments::List(list) = &func.args {
                        if list.args.len() != 2 {
                            unreachable!()
                        }
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
                        if list.args.len() != 2 {
                            unreachable!()
                        }
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
                        if list.args.len() != 2 {
                            unreachable!()
                        }
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
            _ => unreachable!(),
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
            Condition::In(field, values) => {
                let field = schema.get_field(field)?;
                let terms: Vec<Box<dyn Query>> = values
                    .iter()
                    .map(|value| {
                        let term = Term::from_field_text(field, value);
                        Box::new(TermQuery::new(term, IndexRecordOption::Basic)) as _
                    })
                    .collect();
                Box::new(BooleanQuery::union(terms))
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
                } else if value.starts_with("*") && value.ends_with("*") {
                    let value = format!(".*{}.*", value.trim_matches('*'));
                    Box::new(RegexQuery::from_pattern(&value, default_field)?)
                } else {
                    let mut tokens = o2_collect_tokens(value);
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
                    if let Some(value) = last_prefix {
                        terms.push(Box::new(PhrasePrefixQuery::new_with_offset(vec![(
                            0,
                            Term::from_field_text(default_field, &value),
                        )])));
                    }
                    if !terms.is_empty() {
                        Ok(if terms.len() > 1 {
                            Box::new(BooleanQuery::intersection(terms))
                        } else {
                            terms.remove(0)
                        })
                    } else {
                        Err(anyhow::anyhow!(
                            "The value of match_all() function can't be empty"
                        ))
                    }?
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
        })
    }

    pub fn need_all_term_fields(&self) -> Vec<String> {
        match self {
            Condition::StrMatch(field, ..) => vec![field.clone()],
            Condition::Regex(field, _) => vec![field.clone()],
            Condition::MatchAll(value) => {
                if (value.len() > 1 && (value.starts_with("*") || value.ends_with("*")))
                    || (value.len() > 3 && value.starts_with("re:"))
                {
                    vec![INDEX_FIELD_NAME_FOR_ALL.to_string()]
                } else {
                    vec![]
                }
            }
            Condition::FuzzyMatchAll(..) => vec![INDEX_FIELD_NAME_FOR_ALL.to_string()],
            _ => vec![],
        }
    }

    pub fn get_tantivy_fields(&self) -> HashSet<String> {
        let mut fields = HashSet::new();
        match self {
            Condition::Equal(field, _) => {
                fields.insert(field.clone());
            }
            Condition::StrMatch(field, ..) => {
                fields.insert(field.clone());
            }
            Condition::In(field, _) => {
                fields.insert(field.clone());
            }
            Condition::Regex(field, _) => {
                fields.insert(field.clone());
            }
            Condition::MatchAll(_) => {
                fields.insert(INDEX_FIELD_NAME_FOR_ALL.to_string());
            }
            Condition::FuzzyMatchAll(..) => {
                fields.insert(INDEX_FIELD_NAME_FOR_ALL.to_string());
            }
            Condition::Or(left, right) | Condition::And(left, right) => {
                fields.extend(left.get_tantivy_fields());
                fields.extend(right.get_tantivy_fields());
            }
        }
        fields
    }

    pub fn get_schema_fields(&self, fst_fields: &[String]) -> HashSet<String> {
        let mut fields = HashSet::new();
        match self {
            Condition::Equal(field, _) => {
                fields.insert(field.clone());
            }
            Condition::StrMatch(field, ..) => {
                fields.insert(field.clone());
            }
            Condition::In(field, _) => {
                fields.insert(field.clone());
            }
            Condition::Regex(field, _) => {
                fields.insert(field.clone());
            }
            Condition::MatchAll(_) => {
                fields.extend(fst_fields.iter().cloned());
            }
            Condition::FuzzyMatchAll(..) => {
                fields.extend(fst_fields.iter().cloned());
            }
            Condition::Or(left, right) | Condition::And(left, right) => {
                fields.extend(left.get_schema_fields(fst_fields));
                fields.extend(right.get_schema_fields(fst_fields));
            }
        }
        fields
    }

    pub fn to_physical_expr(
        &self,
        schema: &arrow_schema::Schema,
        fst_fields: &[String],
    ) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
        match self {
            Condition::Equal(name, value) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let right = get_scalar_value(value, field.data_type())?;
                Ok(Arc::new(BinaryExpr::new(left, Operator::Eq, right)))
            }
            Condition::StrMatch(name, value, case_sensitive) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let right = get_scalar_value(value, field.data_type())?;
                let udf = if *case_sensitive {
                    Arc::new(str_match_udf::STR_MATCH_UDF.clone())
                } else {
                    Arc::new(str_match_udf::STR_MATCH_IGNORE_CASE_UDF.clone())
                };
                let udf_expr = Arc::new(ScalarFunctionExpr::new(
                    udf.name(),
                    udf.clone(),
                    vec![left, right],
                    DataType::Boolean,
                ));
                Ok(udf_expr)
            }
            Condition::In(name, values) => {
                let index = schema.index_of(name).unwrap();
                let left = Arc::new(Column::new(name, index));
                let field = schema.field(index);
                let values: Vec<Arc<dyn PhysicalExpr>> = values
                    .iter()
                    .map(|value| get_scalar_value(value, field.data_type()).map(|v| v as _))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Arc::new(InListExpr::new(left, values, false, None)))
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
                let term = if get_config().common.utf8_view_enabled {
                    Arc::new(Literal::new(ScalarValue::Utf8View(Some(format!(
                        "%{value}%"
                    )))))
                } else {
                    Arc::new(Literal::new(ScalarValue::Utf8(Some(format!("%{value}%")))))
                };
                let mut expr_list: Vec<Arc<dyn PhysicalExpr>> =
                    Vec::with_capacity(fst_fields.len());
                for field in fst_fields.iter() {
                    let new_expr = Arc::new(LikeExpr::new(
                        false,
                        true,
                        Arc::new(Column::new(field, schema.index_of(field).unwrap())),
                        term.clone(),
                    ));
                    expr_list.push(new_expr);
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
                let term = if get_config().common.utf8_view_enabled {
                    Arc::new(Literal::new(ScalarValue::Utf8View(Some(value.clone()))))
                } else {
                    Arc::new(Literal::new(ScalarValue::Utf8(Some(value.clone()))))
                };
                let distance = Arc::new(Literal::new(ScalarValue::Int64(Some(*distance as i64))));
                let mut expr_list: Vec<Arc<dyn PhysicalExpr>> =
                    Vec::with_capacity(fst_fields.len());
                for field in fst_fields.iter() {
                    let new_expr = Arc::new(ScalarFunctionExpr::new(
                        fuzzy_expr.name(),
                        fuzzy_expr.clone(),
                        vec![
                            Arc::new(Column::new(field, schema.index_of(field).unwrap())),
                            term.clone(),
                            distance.clone(),
                        ],
                        DataType::Boolean,
                    ));
                    expr_list.push(new_expr);
                }
                if expr_list.is_empty() {
                    return Err(anyhow::anyhow!(
                        "Using fuzzy_match_all() function in a stream that don't have full text search field"
                    )); // already check this in sql.rs
                }
                Ok(disjunction(expr_list))
            }
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
        }
    }

    pub fn can_remove_filter(&self) -> bool {
        match self {
            Condition::Equal(..) => true,
            Condition::StrMatch(..) => true,
            Condition::In(..) => true,
            Condition::Regex(..) => false,
            Condition::MatchAll(v) => is_blank_or_alphanumeric(v),
            Condition::FuzzyMatchAll(..) => false,
            Condition::Or(left, right) => left.can_remove_filter() && right.can_remove_filter(),
            Condition::And(left, right) => left.can_remove_filter() && right.can_remove_filter(),
        }
    }
}

// check if function is match_all and only have one argument
// check if binary operator is equal and one side is field and the other side is value
// and the field is in the index_fields
fn is_expr_valid_for_index(expr: &Expr, index_fields: &HashSet<String>) -> bool {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Eq,
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
            negated,
        } => {
            if *negated {
                return false;
            }
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
            if fn_name == MATCH_ALL_UDF_NAME {
                if let FunctionArguments::List(list) = &func.args {
                    if list.args.len() != 1 {
                        return false;
                    }
                } else {
                    return false;
                }
            } else if fn_name == FUZZY_MATCH_ALL_UDF_NAME {
                if let FunctionArguments::List(list) = &func.args {
                    if list.args.len() != 2 {
                        return false;
                    }
                } else {
                    return false;
                }
            } else if fn_name == STR_MATCH_UDF_NAME
                || fn_name == STR_MATCH_UDF_IGNORE_CASE_NAME
                || fn_name == MATCH_FIELD_UDF_NAME
                || fn_name == MATCH_FIELD_IGNORE_CASE_UDF_NAME
            {
                if let FunctionArguments::List(list) = &func.args {
                    if list.args.len() != 2 {
                        return false;
                    }
                    if !index_fields.contains(&get_arg_name(&list.args[0])) {
                        return false;
                    }
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }
        Expr::Nested(expr) => return is_expr_valid_for_index(expr, index_fields),
        _ => return false,
    }
    true
}

// Note: the expr should be Identifier or CompoundIdentifier
fn get_field_name(expr: &Expr) -> String {
    match expr {
        Expr::Identifier(ident) => trim_quotes(ident.to_string().as_str()),
        Expr::CompoundIdentifier(ident) => trim_quotes(ident[1].to_string().as_str()),
        _ => unreachable!(),
    }
}

fn get_value(expr: &Expr) -> String {
    match expr {
        Expr::Value(value) => trim_quotes(value.to_string().as_str()),
        _ => unreachable!(),
    }
}

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

fn conjunction(exprs: Vec<Arc<dyn PhysicalExpr>>) -> Arc<dyn PhysicalExpr> {
    if exprs.len() == 1 {
        exprs[0].clone()
    } else {
        // conjuction all expr in exprs
        let mut expr = exprs[0].clone();
        for e in exprs.into_iter().skip(1) {
            expr = Arc::new(BinaryExpr::new(expr, Operator::And, e));
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
        DataType::Binary => Arc::new(Literal::new(ScalarValue::Binary(Some(
            value.as_bytes().to_vec(),
        )))),
        DataType::Utf8View => {
            Arc::new(Literal::new(ScalarValue::Utf8View(Some(value.to_string()))))
        }
        _ => unimplemented!(),
    })
}

pub(crate) fn get_arg_name(args: &FunctionArg) -> String {
    match args {
        FunctionArg::Named { name, .. } => name.to_string(),
        FunctionArg::ExprNamed { name, .. } => get_field_name(name),
        FunctionArg::Unnamed(arg) => match arg {
            FunctionArgExpr::Expr(expr) => get_field_name(expr),
            _ => unimplemented!("str_match not support filed type: {:?}", arg),
        },
    }
}

fn is_blank_or_alphanumeric(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_whitespace() || c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
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
        let right = Condition::In("field2".to_string(), vec!["value1".to_string()]);
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

    #[test]
    fn test_index_condition_get_tantivy_fields() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        index_condition.add_condition(Condition::MatchAll("search_term".to_string()));
        index_condition.add_condition(Condition::In(
            "field2".to_string(),
            vec!["val1".to_string()],
        ));

        let fields = index_condition.get_tantivy_fields();

        assert_eq!(fields.len(), 3);
        assert!(fields.contains("field1"));
        assert!(fields.contains("field2"));
        assert!(fields.contains(INDEX_FIELD_NAME_FOR_ALL));
    }

    #[test]
    fn test_index_condition_get_tantivy_fields_empty() {
        let index_condition = IndexCondition::new();
        let fields = index_condition.get_tantivy_fields();

        assert_eq!(fields.len(), 0);
    }

    #[test]
    fn test_index_condition_get_tantivy_fields_duplicate_fields() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value2".to_string()));
        index_condition.add_condition(Condition::Regex(
            "field1".to_string(),
            "pattern.*".to_string(),
        ));

        let fields = index_condition.get_tantivy_fields();

        // Should deduplicate the field names
        assert_eq!(fields.len(), 1);
        assert!(fields.contains("field1"));
    }
}
