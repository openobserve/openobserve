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

use config::{datafusion::request::Request, meta::cluster::NodeInfo};
use datafusion::sql::TableReference;
use hashbrown::HashMap;
use infra::errors::Error;
use parking_lot::Mutex;
#[cfg(feature = "enterprise")]
use {
    datafusion::physical_optimizer::PhysicalOptimizerRule,
    o2_enterprise::enterprise::search::datafusion::optimizer::stream_aggregate::StreamingAggsRule,
};

pub enum PhysicalOptimizerContext {
    RemoteScan(RemoteScanContext),
    AggregateTopk,
    StreamingAggregation(Option<StreamingAggregationContext>),
}

pub struct RemoteScanContext {
    pub nodes: Vec<Arc<dyn NodeInfo>>,
    pub partitioned_file_lists: HashMap<TableReference, Vec<Vec<i64>>>,
    pub context: opentelemetry::Context,
    pub is_leader: bool,
}

#[cfg(feature = "enterprise")]
pub struct StreamingAggregationContext {
    pub streaming_id: String,
    pub start_time: i64,
    pub end_time: i64,
    pub is_complete_cache_hit: Arc<Mutex<bool>>,
    pub overwrite_cache: bool,
}

#[cfg(feature = "enterprise")]
impl StreamingAggregationContext {
    pub async fn new(
        request: &Request,
        is_complete_cache_hit: Arc<Mutex<bool>>,
    ) -> Result<Option<Self>, Error> {
        if !request.streaming_output || !config::get_config().common.feature_query_streaming_aggs {
            return Ok(None);
        }

        let org_settings = crate::service::db::organization::get_org_setting(&request.org_id)
            .await
            .unwrap_or_default();
        if !org_settings.streaming_aggregation_enabled {
            return Ok(None);
        }

        let streaming_id = request.streaming_id.clone();
        let Some(streaming_id) = streaming_id else {
            return Err(Error::Message(
                "streaming_id is required for streaming aggregation query".to_string(),
            ));
        };

        Ok(Some(Self {
            streaming_id,
            start_time: request.time_range.unwrap_or_default().0,
            end_time: request.time_range.unwrap_or_default().1,
            is_complete_cache_hit,
            overwrite_cache: request.overwrite_cache,
        }))
    }
}

#[cfg(feature = "enterprise")]
pub fn generate_streaming_agg_rules(
    context: StreamingAggregationContext,
) -> Arc<dyn PhysicalOptimizerRule + Send + Sync> {
    Arc::new(StreamingAggsRule::new(
        context.streaming_id,
        context.start_time,
        context.end_time,
        context.is_complete_cache_hit,
        context.overwrite_cache,
    )) as _
}

#[cfg(not(feature = "enterprise"))]
pub struct StreamingAggregationContext {}

#[cfg(not(feature = "enterprise"))]
impl StreamingAggregationContext {
    pub async fn new(
        _request: &Request,
        _is_complete_cache_hit: Arc<Mutex<bool>>,
    ) -> Result<Option<Self>, Error> {
        Ok(None)
    }
}
