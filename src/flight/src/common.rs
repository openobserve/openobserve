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
use datafusion::physical_plan::{ExecutionPlan, display::DisplayableExecutionPlan};
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
    stage: i32,
    node: String,
    metrics: String,
}

/// the CustomMessage is not ready, so we need to use this struct to store
/// the scan stats, and send it to the client when the scan stats is ready
pub enum PreCustomMessage {
    ScanStats(ScanStats),
    ScanStatsRef(Option<Arc<Mutex<ScanStats>>>),
    // physical plan, is_super_cluster
    Metrics(Option<(Arc<dyn ExecutionPlan>, bool)>),
}

impl PreCustomMessage {
    pub fn get_custom_message(&self) -> Option<CustomMessage> {
        match self {
            PreCustomMessage::ScanStats(stats) => Some(CustomMessage::ScanStats(*stats)),
            PreCustomMessage::ScanStatsRef(stats_ref) => stats_ref
                .as_ref()
                .map(|stats| CustomMessage::ScanStats(*stats.lock())),
            PreCustomMessage::Metrics(metrics_ref) => {
                metrics_ref.as_ref().map(|(metrics, is_super_cluster)| {
                    CustomMessage::Metrics(collect_metrics(metrics, *is_super_cluster))
                })
            }
        }
    }
}

// TODO: support collect the metrics from remote scan(for super cluster)
fn collect_metrics(plan: &Arc<dyn ExecutionPlan>, is_super_cluster: bool) -> Vec<Metrics> {
    let plan_with_metrics = DisplayableExecutionPlan::with_metrics(plan.as_ref())
        .set_show_statistics(false)
        .indent(true)
        .to_string();
    let stage = if is_super_cluster { 2 } else { 3 };
    vec![Metrics {
        stage,
        node: LOCAL_NODE.get_grpc_addr().to_string(),
        metrics: plan_with_metrics,
    }]
}
