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

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, atomic::Ordering},
};

use config::meta::search::{PARTIAL_ERROR_RESPONSE_MESSAGE, ScanStats};
use datafusion::physical_plan::{ExecutionPlan, ExecutionPlanVisitor};
use infra::runtime::DATAFUSION_RUNTIME;
use tokio::sync::Mutex;

#[cfg(test)]
use super::{conjunction, is_field, is_value, split_conjunction, trim_quotes};
use crate::{
    CAPPED_RESULTS_MSG, datafusion::distributed_plan::remote_scan_exec::RemoteScanExec, sql::Sql,
};

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
    pub peak_memory: usize,
    pub partial_err: String,
}

impl Default for ScanStatsVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl ScanStatsVisitor {
    pub fn new() -> Self {
        ScanStatsVisitor {
            scan_stats: ScanStats::default(),
            peak_memory: 0,
            partial_err: String::new(),
        }
    }
}

impl ExecutionPlanVisitor for ScanStatsVisitor {
    type Error = datafusion::common::DataFusionError;

    fn pre_visit(&mut self, plan: &dyn ExecutionPlan) -> Result<bool, Self::Error> {
        let mayby_remote_scan_exec = plan.downcast_ref::<RemoteScanExec>();
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
            {
                let peak_memory = remote_scan_exec.peak_memory().load(Ordering::Relaxed);
                self.peak_memory = peak_memory.max(self.peak_memory);
            }
        }
        Ok(true)
    }
}

pub fn check_query_default_limit_exceeded(num_rows: usize, partial_err: &mut String, sql: &Sql) {
    if is_default_query_limit_exceeded(num_rows, sql) {
        let capped_err = CAPPED_RESULTS_MSG.to_string();
        if !partial_err.is_empty() {
            partial_err.push('\n');
            partial_err.push_str(&capped_err);
        } else {
            *partial_err = capped_err;
        }
    }
}

pub fn is_default_query_limit_exceeded(num_rows: usize, sql: &Sql) -> bool {
    let default_query_limit = config::get_config().limit.query_default_limit as usize;
    if sql.limit > config::QUERY_WITH_NO_LIMIT && sql.limit <= 0 {
        num_rows > default_query_limit
    } else {
        false
    }
}

pub fn is_permissable_function_error(function_error: &[String]) -> bool {
    if function_error.is_empty() {
        return true;
    }

    function_error.iter().all(|error| {
        // Empty or whitespace-only errors are cachable (no actual error)
        let trimmed = error.trim();
        if trimmed.is_empty() {
            return true;
        }

        // Check if error contains only cachable messages
        error.contains(CAPPED_RESULTS_MSG) || error.contains(PARTIAL_ERROR_RESPONSE_MESSAGE)
    })
}

#[cfg(test)]
mod tests {
    use sqlparser::ast::{BinaryOperator, Expr, Ident, Value};

    use super::*;

    #[test]
    fn test_is_cachable_function_error() {
        let error = vec![];
        assert!(is_permissable_function_error(&error));

        let error = vec!["".to_string()];
        assert!(is_permissable_function_error(&error));

        let error = vec![
            CAPPED_RESULTS_MSG.to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
        ];
        assert!(is_permissable_function_error(&error)); // only this is cachable

        let error = vec![
            CAPPED_RESULTS_MSG.to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
            "parquet not found".to_string(),
        ];
        assert!(!is_permissable_function_error(&error));

        let error = vec![
            "parquet not found".to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
        ];
        assert!(!is_permissable_function_error(&error));

        let error = vec!["parquet not found".to_string()];
        assert!(!is_permissable_function_error(&error));

        let error = vec![
            "parquet not found".to_string(),
            CAPPED_RESULTS_MSG.to_string(),
        ];
        assert!(!is_permissable_function_error(&error));
    }

    #[test]
    fn test_split_conjunction() {
        // Test simple expression
        let expr = Expr::Value(Value::Number("1".to_string(), false).into());
        let result = split_conjunction(&expr);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0], Expr::Value(_)));

        // Test AND expression
        let left = Expr::Value(Value::Number("1".to_string(), false).into());
        let right = Expr::Value(Value::Number("2".to_string(), false).into());
        let and_expr = Expr::BinaryOp {
            left: Box::new(left),
            op: BinaryOperator::And,
            right: Box::new(right),
        };
        let result = split_conjunction(&and_expr);
        assert_eq!(result.len(), 2);
        assert!(matches!(result[0], Expr::Value(_)));
        assert!(matches!(result[1], Expr::Value(_)));

        // Test nested AND expressions
        let nested_right = Expr::Value(Value::Number("3".to_string(), false).into());
        let nested_and = Expr::BinaryOp {
            left: Box::new(and_expr),
            op: BinaryOperator::And,
            right: Box::new(nested_right),
        };
        let result = split_conjunction(&nested_and);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_conjunction() {
        // Test empty vector
        let exprs: Vec<&Expr> = vec![];
        let result = conjunction(exprs);
        assert!(result.is_none());

        // Test single expression
        let expr = Expr::Value(Value::Number("1".to_string(), false).into());
        let exprs = vec![&expr];
        let result = conjunction(exprs);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), Expr::Value(_)));

        // Test multiple expressions
        let expr1 = Expr::Value(Value::Number("1".to_string(), false).into());
        let expr2 = Expr::Value(Value::Number("2".to_string(), false).into());
        let exprs = vec![&expr1, &expr2];
        let result = conjunction(exprs);
        assert!(result.is_some());
        if let Some(Expr::BinaryOp { op, .. }) = result {
            assert!(matches!(op, BinaryOperator::And));
        } else {
            panic!("Expected BinaryOp with And operator");
        }
    }

    #[test]
    fn test_trim_quotes() {
        let inp_exp_arr = [
            ("\"hello\"", "hello"),
            ("'world'", "world"),
            ("no_quotes", "no_quotes"),
            ("\"partial", "\"partial"),
            ("partial\"", "partial\""),
            ("", ""),
            ("\"mixed'quotes\"", "mixed'quotes"),
        ];
        for (input, expected) in inp_exp_arr {
            assert_eq!(trim_quotes(input), expected);
        }
    }

    #[test]
    fn test_is_value() {
        // Test value expression
        let value_expr = Expr::Value(Value::Number("123".to_string(), false).into());
        assert!(is_value(&value_expr));

        // Test non-value expression
        let ident_expr = Expr::Identifier(Ident::new("field".to_string()));
        assert!(!is_value(&ident_expr));
    }

    #[test]
    fn test_is_field() {
        // Test identifier expression
        let ident_expr = Expr::Identifier(Ident::new("field".to_string()));
        assert!(is_field(&ident_expr));

        // Test compound identifier expression
        let compound_expr = Expr::CompoundIdentifier(vec![
            Ident::new("table".to_string()),
            Ident::new("field".to_string()),
        ]);
        assert!(is_field(&compound_expr));

        // Test non-field expression
        let value_expr = Expr::Value(Value::Number("123".to_string(), false).into());
        assert!(!is_field(&value_expr));
    }

    #[tokio::test]
    async fn test_async_defer() {
        let cleanup_called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cleanup_called_clone = cleanup_called.clone();

        {
            let _defer = AsyncDefer::new(async move {
                cleanup_called_clone.store(true, std::sync::atomic::Ordering::Relaxed);
            });
            // Defer should be dropped here and cleanup should be called
        }

        // Give some time for the async cleanup to run
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        assert!(cleanup_called.load(std::sync::atomic::Ordering::Relaxed));
    }

    #[test]
    fn test_scan_stats_visitor_new() {
        let visitor = ScanStatsVisitor::new();
        assert_eq!(visitor.partial_err, "");
    }

    #[test]
    fn test_scan_stats_visitor_pre_visit() {
        let mut visitor = ScanStatsVisitor::new();

        // Create a mock execution plan that's not a RemoteScanExec
        let mock_plan = datafusion::physical_plan::empty::EmptyExec::new(Arc::new(
            datafusion::arrow::datatypes::Schema::empty(),
        ));

        let result = visitor.pre_visit(&mock_plan);
        assert!(result.is_ok_and(|v| v));
    }
}
