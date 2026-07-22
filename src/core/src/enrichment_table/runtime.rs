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

use std::sync::Arc;

use config::{QUERY_WITH_NO_LIMIT, ider, meta::stream::StreamType};
use infra::db as infra_db;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::TaskStatus;

use crate::{common::infra::config::ENRICHMENT_TABLES, service::enrichment::StreamTable};

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/enrichment_table/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching stream enrichment_table");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_stream_enrichment_table: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let keys = item_key.split('/').collect::<Vec<&str>>();
                let org_id = keys[0];
                let stream_name = keys[2];

                let data = match crate::enrichment::get_enrichment_table(org_id, stream_name, false)
                    .await
                {
                    Ok(data) => data,
                    Err(e) => {
                        log::error!(
                            "[ENRICHMENT::TABLE watch] get enrichment table {org_id}/{stream_name} error, trying again: {e}"
                        );
                        match crate::enrichment::get_enrichment_table(org_id, stream_name, false)
                            .await
                        {
                            Ok(data) => data,
                            Err(e) => {
                                log::error!(
                                    "[ENRICHMENT::TABLE watch] get enrichment table {org_id}/{stream_name} error, giving up: {e}"
                                );
                                Arc::new(vec![])
                            }
                        }
                    }
                };
                log::info!(
                    "enrichment table: {item_key} cache data length: {}",
                    data.len()
                );
                ENRICHMENT_TABLES.insert(
                    item_key.to_owned(),
                    StreamTable {
                        org_id: org_id.to_string(),
                        stream_name: stream_name.to_string(),
                        data,
                    },
                );
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                if let Some((key, _)) = ENRICHMENT_TABLES.remove(item_key) {
                    log::info!("deleted enrichment table: {key}");
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn get_enrichment_table_data(
    org_id: &str,
    name: &str,
    _apply_primary_region_if_specified: bool,
    end_time: i64,
) -> Result<crate::service::enrichment::storage::Values, anyhow::Error> {
    let start_time = ::db::enrichment_table::get_start_time(org_id, name).await;
    let query = config::meta::search::Query {
        sql: format!("SELECT * FROM \"{name}\""),
        start_time,
        end_time,
        size: QUERY_WITH_NO_LIMIT,
        ..Default::default()
    };

    #[cfg(feature = "enterprise")]
    let regions = {
        let cfg = o2_enterprise::enterprise::common::config::get_config();
        let region = cfg.super_cluster.enrichment_table_get_region.clone();
        if _apply_primary_region_if_specified && cfg.super_cluster.enabled && !region.is_empty() {
            vec![region]
        } else {
            vec![]
        }
    };
    #[cfg(not(feature = "enterprise"))]
    let regions = vec![];

    let search_query: proto::cluster_rpc::SearchQuery = query.clone().into();
    let trace_id = ider::generate_trace_id();
    let mut request = config::datafusion::request::Request::new(
        trace_id.clone(),
        org_id.to_string(),
        StreamType::EnrichmentTables,
        0,
        None,
        Some((search_query.start_time, search_query.end_time)),
        None,
        query.histogram_interval,
        false,
    );
    request.set_local_mode(Some(true));

    log::info!("get enrichment table {org_id}/{name} data req start time: {start_time}");

    #[cfg(feature = "enterprise")]
    crate::service::search::SEARCH_SERVER
        .insert(
            trace_id.clone(),
            TaskStatus::new_leader(
                vec![],
                true,
                None,
                Some(org_id.to_string()),
                Some(request.stream_type.to_string()),
                Some(query.sql.clone()),
                Some(query.start_time),
                Some(query.end_time),
                None,
                None,
            ),
        )
        .await;

    let result = crate::service::search::cluster::http::search_inner(
        request,
        search_query,
        regions,
        vec![],
        true,
        None,
    )
    .await;

    #[cfg(feature = "enterprise")]
    let _ = crate::service::search::SEARCH_SERVER
        .remove(&trace_id, false)
        .await;

    match result {
        Ok((batches, ..)) => {
            log::info!(
                "get enrichment table {org_id}/{name} data success with {} rows",
                batches.iter().map(|b| b.num_rows()).sum::<usize>()
            );
            Ok(crate::service::enrichment::storage::Values::RecordBatch(
                batches,
            ))
        }
        Err(err) => {
            log::error!("get enrichment table {org_id}/{name} data error: {err}");
            Err(anyhow::anyhow!(
                "get enrichment table {org_id}/{name} error: {err}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use config::utils::time::now_micros;

    use super::*;

    #[tokio::test]
    async fn test_get_enrichment_table_data() {
        // This will fail in test environment due to missing dependencies,
        // but tests the function structure
        let result = get_enrichment_table_data("test_org", "test_table", false, now_micros()).await;
        assert!(result.is_err());
    }
}
