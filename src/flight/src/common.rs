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

use std::sync::Arc;

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::{
    cluster::LOCAL_NODE,
    meta::{cluster::NodeInfo, search::ScanStats},
};
use datafusion::{
    self,
    physical_plan::{ExecutionPlan, display::DisplayableExecutionPlan},
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub enum FlightMessage {
    Schema(SchemaRef),
    RecordBatch(RecordBatch),
    CustomMessage(CustomMessage),
}

/// Custom message for ser/deserialize
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CustomMessage {
    ScanStats(ScanStats),
    Metrics(Vec<Metrics>),
}

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
pub struct Metrics {
    pub stage: i32,
    pub node: String,
    pub metrics: String,
}

/// the CustomMessage is not ready, so we need to use this struct to store
/// the scan stats, and send it to the client when the scan stats is ready
pub enum PreCustomMessage {
    ScanStats(ScanStats),
    // use for super cluster follower leader
    ScanStatsRef(Option<Arc<Mutex<ScanStats>>>),
    // physical plan, is_super_cluster
    Metrics(Option<MetricsInfo>),
    // use for super cluster follower leader
    MetricsRef(Vec<Arc<Mutex<Vec<Metrics>>>>),
}

pub struct MetricsInfo {
    pub plan: Arc<dyn ExecutionPlan>,
    pub is_super_cluster: bool,
    pub func: Box<dyn Fn() -> bool + Send>,
}

impl PreCustomMessage {
    pub fn is_scan_stats(&self) -> bool {
        matches!(
            self,
            PreCustomMessage::ScanStats(_) | PreCustomMessage::ScanStatsRef(_)
        )
    }

    pub fn get_custom_message(&self) -> Option<CustomMessage> {
        match self {
            PreCustomMessage::ScanStats(stats) => Some(CustomMessage::ScanStats(*stats)),
            PreCustomMessage::ScanStatsRef(stats_ref) => stats_ref
                .as_ref()
                .map(|stats| CustomMessage::ScanStats(*stats.lock())),
            PreCustomMessage::Metrics(metrics_ref) => metrics_ref
                .as_ref()
                .map(|metrics_info| CustomMessage::Metrics(collect_metrics(metrics_info))),
            PreCustomMessage::MetricsRef(metrics) => {
                let metrics: Vec<Metrics> = metrics.iter().flat_map(|m| m.lock().clone()).collect();
                (!metrics.is_empty()).then_some(CustomMessage::Metrics(metrics))
            }
        }
    }
}

// collect metrics from physical plan
fn collect_metrics(metrics_info: &MetricsInfo) -> Vec<Metrics> {
    let plan = &metrics_info.plan;
    let is_super_cluster = metrics_info.is_super_cluster;
    let func = &metrics_info.func;
    let plan_with_metrics = DisplayableExecutionPlan::with_metrics(plan.as_ref())
        .set_show_statistics(false)
        .indent(true)
        .to_string();
    let stage = if func() {
        if is_super_cluster { 1 } else { 2 }
    } else {
        1
    };
    vec![Metrics {
        stage,
        node: LOCAL_NODE.get_grpc_addr().to_string(),
        metrics: plan_with_metrics,
    }]
}
