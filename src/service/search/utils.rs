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

use std::{future::Future, pin::Pin, sync::Arc};

use config::meta::search::ScanStats;
use datafusion::physical_plan::{ExecutionPlan, ExecutionPlanVisitor};
use sqlparser::ast::{BinaryOperator, Expr};
use tokio::sync::Mutex;
#[cfg(feature = "enterprise")]
use {crate::service::grpc::make_grpc_search_client, config::meta::cluster::NodeInfo};

use super::{DATAFUSION_RUNTIME, datafusion::distributed_plan::remote_scan::RemoteScanExec};

type Cleanup = Pin<Box<dyn Future<Output = ()> + Send>>;

/// A utility for running an asynchronous cleanup function when a value is dropped.
pub struct AsyncDefer {
    cleanup: Option<Arc<Mutex<Cleanup>>>,
}

impl AsyncDefer {
    pub fn new<F>(cleanup: F) -> Self
    where
        F: Future<Output = ()> + Send + 'static,
    {
        AsyncDefer {
            cleanup: Some(Arc::new(Mutex::new(Box::pin(cleanup)))),
        }
    }
}

impl Drop for AsyncDefer {
    fn drop(&mut self) {
        if let Some(cleanup) = self.cleanup.take() {
            DATAFUSION_RUNTIME.spawn(async move {
                let mut cleanup = cleanup.lock().await;
                cleanup.as_mut().await;
            });
        }
    }
}

#[derive(Debug)]
pub struct ScanStatsVisitor {
    pub scan_stats: ScanStats,
    pub partial_err: String,
}

impl ScanStatsVisitor {
    pub fn new() -> Self {
        ScanStatsVisitor {
            scan_stats: ScanStats::default(),
            partial_err: String::new(),
        }
    }
}

impl ExecutionPlanVisitor for ScanStatsVisitor {
    type Error = datafusion::common::DataFusionError;

    fn pre_visit(&mut self, plan: &dyn ExecutionPlan) -> Result<bool, Self::Error> {
        let mayby_remote_scan_exec = plan.as_any().downcast_ref::<RemoteScanExec>();
        if let Some(remote_scan_exec) = mayby_remote_scan_exec {
            {
                let guard = remote_scan_exec.scan_stats.lock();
                let stats = *guard;
                self.scan_stats.add(&stats);
            }
            {
                let guard = remote_scan_exec.partial_err.lock();
                let err = (*guard).clone();
                self.partial_err.push_str(&err);
            }
        }
        Ok(true)
    }
}

// split an expression by AND operator
pub fn split_conjunction(expr: &Expr) -> Vec<&Expr> {
    split_conjunction_inner(expr, Vec::new())
}

fn split_conjunction_inner<'a>(expr: &'a Expr, mut exprs: Vec<&'a Expr>) -> Vec<&'a Expr> {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            let exprs = split_conjunction_inner(left, exprs);
            split_conjunction_inner(right, exprs)
        }
        Expr::Nested(expr) => split_conjunction_inner(expr, exprs),
        other => {
            exprs.push(other);
            exprs
        }
    }
}

// conjunction the exprs
pub fn conjunction(exprs: Vec<&Expr>) -> Option<Expr> {
    if exprs.is_empty() {
        None
    } else if exprs.len() == 1 {
        Some(exprs[0].clone())
    } else {
        // conjuction all expr in exprs
        let mut expr = exprs[0].clone();
        if matches!(
            expr,
            Expr::BinaryOp {
                op: BinaryOperator::Or,
                ..
            }
        ) {
            expr = Expr::Nested(Box::new(expr));
        }
        for e in exprs.into_iter().skip(1) {
            expr = Expr::BinaryOp {
                left: Box::new(expr),
                op: BinaryOperator::And,
                right: if matches!(
                    e,
                    Expr::BinaryOp {
                        op: BinaryOperator::Or,
                        ..
                    }
                ) {
                    Box::new(Expr::Nested(Box::new(e.clone())))
                } else {
                    Box::new(e.clone())
                },
            }
        }
        Some(expr)
    }
}

pub fn trim_quotes(s: &str) -> String {
    let s = s
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(s);
    s.strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .unwrap_or(s)
        .to_string()
}

pub fn is_value(e: &Expr) -> bool {
    matches!(e, Expr::Value(_))
}

pub fn is_field(e: &Expr) -> bool {
    matches!(e, Expr::Identifier(_) | Expr::CompoundIdentifier(_) | Expr::Function(_))
}

// Note: the expr should be Identifier, CompoundIdentifier, or Function
pub fn get_field_name(expr: &Expr) -> String {
    match expr {
        Expr::Identifier(ident) => trim_quotes(ident.to_string().as_str()),
        Expr::CompoundIdentifier(ident) => trim_quotes(ident[1].to_string().as_str()),
        Expr::Function(func) => {
            // For function expressions, we need to extract field names from the arguments
            // This is a simplified approach - for complex functions, we might need more sophisticated handling
            match &func.args {
                sqlparser::ast::FunctionArguments::List(args) => {
                    if let Some(first_arg) = args.args.first() {
                        match first_arg {
                            sqlparser::ast::FunctionArg::Unnamed(sqlparser::ast::FunctionArgExpr::Expr(expr)) => {
                                get_field_name(expr)
                            }
                            sqlparser::ast::FunctionArg::ExprNamed { name, .. } => {
                                get_field_name(name)
                            }
                            _ => func.name.to_string(),
                        }
                    } else {
                        func.name.to_string()
                    }
                }
                _ => func.name.to_string(),
            }
        }
        _ => {
            // For other expression types, we can't extract a meaningful field name
            // This should not happen in normal usage, but we'll return a placeholder instead of panicking
            "unknown_field".to_string()
        }
    }
}

#[cfg(feature = "enterprise")]
pub async fn collect_scan_stats(
    nodes: &[Arc<dyn NodeInfo>],
    trace_id: &str,
    is_leader: bool,
) -> ScanStats {
    let mut scan_stats = ScanStats::default();
    for node in nodes {
        let mut scan_stats_request = tonic::Request::new(proto::cluster_rpc::GetScanStatsRequest {
            trace_id: trace_id.to_string(),
            is_leader,
        });
        let mut client =
            match make_grpc_search_client(trace_id, &mut scan_stats_request, node).await {
                Ok(c) => c,
                Err(e) => {
                    log::error!("error in creating get scan stats client :{e}, skipping");
                    continue;
                }
            };
        let stats = match client.get_scan_stats(scan_stats_request).await {
            Ok(v) => v,
            Err(e) => {
                log::error!("error in getting scan stats : {e}, skipping");
                continue;
            }
        };
        let stats = stats.into_inner().stats.unwrap_or_default();
        scan_stats.add(&(&stats).into());
    }
    scan_stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::ast::{Expr, Function, FunctionArg, FunctionArgExpr, FunctionArguments, Ident, ObjectName, Value};

    #[test]
    fn test_get_field_name_identifier() {
        let expr = Expr::Identifier(Ident::new("field_name"));
        assert_eq!(get_field_name(&expr), "field_name");
    }

    #[test]
    fn test_get_field_name_quoted_identifier() {
        let expr = Expr::Identifier(Ident::new("\"quoted_field\""));
        assert_eq!(get_field_name(&expr), "quoted_field");
    }

    #[test]
    fn test_get_field_name_compound_identifier() {
        let expr = Expr::CompoundIdentifier(vec![
            Ident::new("table"),
            Ident::new("field_name")
        ]);
        assert_eq!(get_field_name(&expr), "field_name");
    }

    #[test]
    fn test_get_field_name_coalesce_function() {
        // Test the specific case that was failing: coalesce(k8s_cluster,k8s_app_instance,'unknown')
        let expr = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("coalesce")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("k8s_cluster")))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("k8s_app_instance")))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(Value::SingleQuotedString("unknown".to_string())))),
                ],
                duplicate_treatment: None,
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });
        
        // Should extract the first field name from the function arguments
        assert_eq!(get_field_name(&expr), "k8s_cluster");
    }

    #[test]
    fn test_get_field_name_nested_coalesce() {
        // Test nested coalesce: coalesce(coalesce(field1, field2), field3)
        let inner_coalesce = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("coalesce")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("field1")))),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("field2")))),
                ],
                duplicate_treatment: None,
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });

        let outer_coalesce = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("coalesce")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(inner_coalesce)),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("field3")))),
                ],
                duplicate_treatment: None,
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });
        
        // Should extract the first field name from the nested function
        assert_eq!(get_field_name(&outer_coalesce), "field1");
    }

    #[test]
    fn test_get_field_name_function_with_named_args() {
        let expr = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("some_function")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("field_name")))),
                ],
                duplicate_treatment: None,
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });
        
        // Should extract the field name from the first argument
        assert_eq!(get_field_name(&expr), "field_name");
    }

    #[test]
    fn test_get_field_name_function_no_args() {
        let expr = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("no_args_function")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::None,
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });
        
        // Should return the function name when no arguments
        assert_eq!(get_field_name(&expr), "no_args_function");
    }

    #[test]
    fn test_get_field_name_unsupported_expr() {
        // Test with an unsupported expression type (like a binary operation)
        let expr = Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("left"))),
            op: sqlparser::ast::BinaryOperator::Plus,
            right: Box::new(Expr::Identifier(Ident::new("right"))),
        };
        
        // Should return the fallback value instead of panicking
        assert_eq!(get_field_name(&expr), "unknown_field");
    }

    #[test]
    fn test_is_field() {
        assert!(is_field(&Expr::Identifier(Ident::new("field"))));
        assert!(is_field(&Expr::CompoundIdentifier(vec![Ident::new("table"), Ident::new("field")])));
        
        // Test function expressions
        let func_expr = Expr::Function(Function {
            name: ObjectName(vec![Ident::new("coalesce")]),
            parameters: FunctionArguments::None,
            args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(Ident::new("field1")))),
                ],
                duplicate_treatment: None,
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
        });
        assert!(is_field(&func_expr));
        
        // Test non-field expressions
        assert!(!is_field(&Expr::Value(Value::Number("123".to_string(), false))));
        assert!(!is_field(&Expr::BinaryOp {
            left: Box::new(Expr::Identifier(Ident::new("left"))),
            op: sqlparser::ast::BinaryOperator::Plus,
            right: Box::new(Expr::Identifier(Ident::new("right"))),
        }));
    }

    #[test]
    fn test_trim_quotes() {
        assert_eq!(trim_quotes("field"), "field");
        assert_eq!(trim_quotes("\"quoted\""), "quoted");
        assert_eq!(trim_quotes("'single_quoted'"), "single_quoted");
        assert_eq!(trim_quotes("\"partial"), "\"partial");
        assert_eq!(trim_quotes("partial\""), "partial\"");
    }
}
