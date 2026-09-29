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

mod index;
mod plan;
mod scan;

use std::sync::Arc;

use ::datafusion::{physical_plan::ExecutionPlan, prelude::SessionContext};
use config::{
    datafusion::request::FlightSearchRequest,
    meta::{search::ScanStats, sql::TableReferenceExt},
};
use infra::errors::Error;

use self::{
    index::optimizer_physical_plan,
    plan::{assemble_plan, decode_plan},
    scan::{StreamIndexSettings, route_files, search_tables},
};
use crate::grpc::QueryParams;

#[tracing::instrument(name = "service:search:grpc:flight:do_get::search", skip_all, fields(org_id = req.query_identifier.org_id))]
pub async fn search(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>, ScanStats), Error> {
    log::info!("[trace_id {trace_id}] flight->search: start");
    // 1. Decode the leader's plan; its placeholder scan names the stream and schema to read.
    let (ctx, physical_plan, target) = decode_plan(trace_id, req).await?;

    // 2. Index, FTS and bloom fields from stream settings, limited to fields in the query schema.
    let stream = StreamIndexSettings::load(req, &target).await;

    let time_range = (req.search_info.start_time, req.search_info.end_time);
    // 3. Pull the index condition out of the plan and pick what the index answers.
    let (physical_plan, index) = optimizer_physical_plan(
        physical_plan,
        &ctx,
        &target.schema,
        target.stream_type,
        time_range,
        stream.fts_fields.clone(),
        stream.index_fields.clone(),
        req.index_info.index_optimize_mode.clone().map(Into::into),
    )?;

    // 4. Shared by the index search, the parquet scan and the WAL scan.
    let query = Arc::new(QueryParams {
        trace_id: trace_id.to_string(),
        org_id: req.query_identifier.org_id.to_string(),
        stream: target.stream.clone(),
        stream_type: target.stream_type,
        stream_name: target.stream.stream_name().to_string(),
        time_range,
        work_group: req.super_cluster_info.work_group.clone(),
        use_inverted_index: index.use_inverted_index(),
    });
    log::info!(
        "[trace_id {trace_id}] flight->search: use_inverted_index: {}, index_condition: {:?}, index_optimizer_rule: {:?}",
        query.use_inverted_index,
        index.condition,
        index.mode,
    );

    let mut scan_stats = ScanStats::new();
    // 5. Decide per file: metadata count, exact index aggregate, or parquet scan.
    let route = route_files(&query, req, &stream, &index, &mut scan_stats).await?;
    // 6. Table providers for the parquet files, plus this node's WAL when it is an ingester.
    let tables = search_tables(
        &query,
        &ctx,
        &target,
        &stream,
        &index,
        route.as_ref().map(|route| route.parquet.as_slice()),
        &mut scan_stats,
    )
    .await?;

    // 7. Replace the placeholder with a union of those tables and add the precomputed aggregates.
    let physical_plan = assemble_plan(
        &query,
        req,
        &ctx,
        physical_plan,
        tables,
        route.unwrap_or_default(),
        &mut scan_stats,
    )
    .await?;
    Ok((ctx, physical_plan, scan_stats))
}
