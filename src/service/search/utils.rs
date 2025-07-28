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
    matches!(e, Expr::Identifier(_) | Expr::CompoundIdentifier(_))
}

// Note: the expr should be Identifier or CompoundIdentifier
pub fn get_field_name(expr: &Expr) -> String {
    match expr {
        Expr::Identifier(ident) => trim_quotes(ident.to_string().as_str()),
        Expr::CompoundIdentifier(ident) => trim_quotes(ident[1].to_string().as_str()),
        _ => unreachable!(),
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
