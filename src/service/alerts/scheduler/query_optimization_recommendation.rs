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

use std::{pin::Pin, sync::Arc};

use config::{META_ORG_ID, get_config, meta::stream::StreamType, spawn_pausable_job};
use o2_enterprise::enterprise::recommendations::{
    meta::{OptimiserRecommendation, Stream},
    service::{QueryRecommendationEngine, QueryRecommendationService},
};
use proto::cluster_rpc::{IngestionData, IngestionRequest, IngestionResponse, IngestionType};

use crate::service::{
    db::organization, ingestion::ingestion_service, search::search, stream::get_streams,
};

#[derive(Clone)]
pub struct QueryOptimizerContext;

impl QueryRecommendationEngine for QueryOptimizerContext {
    fn get_all_org_ids(
        &self,
        limit: Option<i64>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, anyhow::Error>> + Send>> {
        Box::pin(async move {
            Ok(organization::list(limit)
                .await?
                .into_iter()
                .map(|org| org.name)
                .collect())
        })
    }

    fn get_all_stream_settings(
        &self,
        org_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Stream>, anyhow::Error>> + Send>> {
        Box::pin(async move {
            Ok(get_streams(&org_id, None, true, None)
                .await
                .into_iter()
                .map(Into::into)
                .collect())
        })
    }

    fn search(
        &self,
        org_id: String,
        request: config::meta::search::Request,
    ) -> Pin<Box<dyn Future<Output = Result<config::meta::search::Response, anyhow::Error>> + Send>>
    {
        Box::pin(async move {
            search("", &org_id, StreamType::Logs, None, &request)
                .await
                .map_err(Into::into)
        })
    }

    fn ingest_recommendations(
        &self,
        recommendations: Vec<OptimiserRecommendation>,
    ) -> Pin<Box<dyn Future<Output = Result<IngestionResponse, anyhow::Error>> + Send>> {
        Box::pin(async move {
            let request = IngestionRequest {
                org_id: META_ORG_ID.to_string(),
                stream_type: StreamType::Logs.to_string(),
                stream_name: "query_recommendations".to_string(),
                data: Some(IngestionData {
                    data: serde_json::to_vec_pretty(&recommendations).map_err(|e| {
                        anyhow::anyhow!("Recommendation serialization failed. Error={e:?}")
                    })?,
                }),
                ingestion_type: Some(IngestionType::Json as i32),
                metadata: None,
            };
            ingestion_service::ingest(request)
                .await
                .map_err(|e| anyhow::anyhow!("Ingestion failed. Error={e:?}"))
        })
    }
}

pub async fn run() {
    let cfg = get_config();
    let query_recommendation_analysis_interval = cfg.limit.query_recommendation_analysis_interval;
    let query_recommendation_service = QueryRecommendationService {
        ctx: Arc::new(QueryOptimizerContext),
        query_recommendation_analysis_interval: cfg.limit.query_recommendation_analysis_interval,
        query_recommendation_duration: cfg.limit.query_recommendation_duration,
        query_recommendation_top_k: cfg.limit.query_recommendation_top_k,
    };

    spawn_pausable_job!(
        "Query Optimization Recommendations",
        query_recommendation_analysis_interval,
        {
            let _ = query_recommendation_service
                .run()
                .await
                .inspect_err(|e| {
                    log::error!(
                        "Recommendation service stopped with an error: Error={:?}",
                        e
                    );
                })
                .inspect(|_| {
                    log::warn!("Recommendation service quietly ended without an error!");
                });
        }
    );
}
