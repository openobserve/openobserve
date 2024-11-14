use std::collections::HashSet;

use sqlparser::ast::{BinaryOperator, Expr, FunctionArguments};

use super::utlis::{conjunction, is_field, is_value, split_conjunction, trim_quotes};

pub fn get_index_condition_from_expr(
    index_fields: &HashSet<String>,
    expr: &Expr,
) -> (IndexCondition, Option<Expr>) {
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

    let new_expr = conjunction(other_expr);
    (index_condition, new_expr)
}

// note the condition in IndexCondition is connection by AND operator
#[derive(Debug, Default)]
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

// single condition
#[derive(Debug)]
pub enum Condition {
    // field, value
    Equal(String, String),
    MatchAll(String),
    Or(Box<Condition>, Box<Condition>),
    And(Box<Condition>, Box<Condition>),
}

impl IndexCondition {
    pub fn to_query(&self) -> String {
        self.conditions
            .iter()
            .map(|condition| condition.to_query())
            .collect::<Vec<_>>()
            .join(" AND ")
    }
}

impl Condition {
    pub fn to_query(&self) -> String {
        match self {
            Condition::Equal(field, value) => format!("{}:{}", field, value),
            Condition::MatchAll(value) => value.to_string(),
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
                let field = if is_value(left) && is_field(right) {
                    trim_quotes(get_field_name(right).as_str())
                } else if is_value(right) && is_field(left) {
                    trim_quotes(get_field_name(left).as_str())
                } else {
                    unreachable!()
                };
                Condition::Equal(field, trim_quotes(right.to_string().as_str()))
            }
            Expr::Function(func) => {
                if !func
                    .name
                    .to_string()
                    .to_lowercase()
                    .starts_with("match_all")
                {
                    unreachable!()
                }
                if let FunctionArguments::List(list) = &func.args {
                    if list.args.len() != 1 {
                        unreachable!()
                    }
                    Condition::MatchAll(trim_quotes(list.args[0].to_string().as_str()))
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
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And | BinaryOperator::Or,
            right,
        } => {
            return is_expr_valid_for_index(left, index_fields)
                && is_expr_valid_for_index(right, index_fields);
        }
        Expr::Function(func) => {
            if !func
                .name
                .to_string()
                .to_lowercase()
                .starts_with("match_all")
            {
                return false;
            }
            if let FunctionArguments::List(list) = &func.args {
                if list.args.len() != 1 {
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
