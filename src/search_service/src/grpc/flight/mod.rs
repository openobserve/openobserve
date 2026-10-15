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
    plan::{decode_plan, finalize_plan},
    scan::{StreamSearchSettings, route_files, search_tables},
};
use crate::grpc::QueryParams;

#[tracing::instrument(name = "service:search:grpc:flight:do_get::search", skip_all, fields(org_id = req.query_identifier.org_id))]
pub async fn search(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>, ScanStats), Error> {
    log::info!("[trace_id {trace_id}] flight->search: start");
    let (ctx, physical_plan, source) = decode_plan(trace_id, req).await?;
    let settings = StreamSearchSettings::load(req, &source).await;

    let time_range = (req.search_info.start_time, req.search_info.end_time);
    let (physical_plan, index) = optimizer_physical_plan(
        physical_plan,
        &ctx,
        &source.schema,
        source.stream_type,
        time_range,
        &settings,
        req.index_info.index_optimize_mode.clone().map(Into::into),
    )?;

    let query = Arc::new(QueryParams {
        trace_id: trace_id.to_string(),
        org_id: req.query_identifier.org_id.to_string(),
        stream: source.stream.clone(),
        stream_type: source.stream_type,
        stream_name: source.stream.stream_name().to_string(),
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
    let (aggregates, scan_files) =
        route_files(&query, req, &settings, &index, &mut scan_stats).await?;
    // Moved in so the file list is freed right after the storage load, before the WAL.
    let tables = search_tables(
        &query,
        &ctx,
        &source,
        &settings,
        &index,
        scan_files,
        &mut scan_stats,
    )
    .await?;

    let physical_plan = finalize_plan(
        &query,
        req,
        &ctx,
        physical_plan,
        tables,
        aggregates,
        &mut scan_stats,
    )
    .await?;
    Ok((ctx, physical_plan, scan_stats))
}
