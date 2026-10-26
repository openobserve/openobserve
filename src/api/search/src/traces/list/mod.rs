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

mod plan;
mod query;
mod response;
mod stream;

use axum::response::Response;
use config::meta::{search::Response as SearchResponse, stream::StreamType};
use hashbrown::HashMap;
use infra::errors::Error;
use plan::{TraceColumns, TraceListOptions, TraceSort, validate_filter};
pub use plan::{TraceListMode, TraceListPlan};
pub use query::TraceSearchContext;
use response::TraceBatch;
pub use stream::stream_response;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, traces::schema_compat};

pub enum TraceListResult {
    Empty(Box<SearchResponse>),
    Complete(TraceBatch),
}

pub async fn prepare(
    org_id: &str,
    stream_name: &str,
    user_id: &str,
    query: &HashMap<String, String>,
    mode: TraceListMode,
) -> Result<TraceListPlan, Response> {
    let mut options =
        TraceListOptions::parse(query, mode).map_err(MetaHttpResponse::bad_request)?;
    let max_query_range = search_service::query_range::get_max_query_range(
        &[stream_name.to_string()],
        org_id,
        user_id,
        StreamType::Traces,
    )
    .await;
    let is_llm = infra::schema::get_is_llm_stream(org_id, stream_name, StreamType::Traces).await;
    let schema =
        infra::schema::get_stream_schema_from_cache(org_id, stream_name, StreamType::Traces).await;
    let llm_schema = if is_llm {
        Some(match schema.as_ref() {
            Some(schema) => schema_compat::validate_llm_schema(schema, stream_name)
                .map_err(|error| MetaHttpResponse::bad_request(error.to_string()))?,
            None => schema_compat::ValidatedLlmSchema::fallback(false),
        })
    } else {
        None
    };
    options.restrict_range(max_query_range);
    let sort = TraceSort::parse(query).map_err(MetaHttpResponse::bad_request)?;
    // Kept last so the complete endpoint reports earlier 400s first, as before.
    if mode == TraceListMode::Complete {
        validate_filter(&options.filter).map_err(MetaHttpResponse::bad_request)?;
    }
    Ok(TraceListPlan {
        options,
        sort,
        llm_schema,
        columns: TraceColumns::from_schema(schema.as_ref()),
        mode,
    })
}

pub async fn run(ctx: &TraceSearchContext, plan: &TraceListPlan) -> Result<TraceListResult, Error> {
    let options = &plan.options;
    let request = plan.request(&ctx.stream_name);
    let response = ctx.search(&request).await.inspect_err(|error| {
        log::error!("get traces latest data error: {error:?}");
    })?;
    if response.hits.is_empty() {
        return Ok(TraceListResult::Empty(Box::new(response)));
    }
    let hits = ctx
        .summarize_traces(plan, &request, response.hits, options.range)
        .await
        .inspect_err(|error| {
            log::error!("get traces latest full-summary error: {error:?}");
        })?;
    let mut batch = TraceBatch::from_hits(&hits, options.range);
    drop(hits);
    let service_range = batch.range;
    ctx.fill_services(&mut batch, &request, &plan.columns, service_range)
        .await
        .inspect_err(|error| {
            log::error!("get traces latest service-breakdown error: {error:?}");
        })?;
    Ok(TraceListResult::Complete(batch))
}
