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

    // The leader's IDs can predate publication and retirement of the same WAL files.
    let (local_file_ids, inventory_guard) = if config::get_config().common.local_mode {
        let guard = common::infra::wal::stream_inventory_lock(
            &query.org_id,
            query.stream_type,
            &query.stream_name,
        )
        .await
        .read_owned()
        .await;
        let ids = crate::file_list::query_ids(
            &query.trace_id,
            &query.org_id,
            query.stream_type,
            &query.stream_name,
            query.time_range,
        )
        .await?
        .into_iter()
        .map(|file| file.id)
        .collect::<Vec<_>>();
        (Some(ids), Some(guard))
    } else {
        (None, None)
    };
    let file_ids = local_file_ids
        .as_deref()
        .unwrap_or(&req.search_info.file_id_list);

    let mut scan_stats = ScanStats::new();
    let (aggregates, scan_files) =
        route_files(&query, req, &settings, &index, file_ids, &mut scan_stats).await?;
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

    // SearchingFiles pins protect the captured WAL sources during physical execution.
    drop(inventory_guard);

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

#[cfg(test)]
mod tests;
