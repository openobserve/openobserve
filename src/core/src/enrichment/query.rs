// Copyright 2026 OpenObserve Inc.

use config::{QUERY_WITH_NO_LIMIT, ider, meta::stream::StreamType};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::TaskStatus;

use super::storage::Values;

pub async fn get_enrichment_table_data(
    org_id: &str,
    name: &str,
    _apply_primary_region_if_specified: bool,
    end_time: i64,
) -> Result<Values, anyhow::Error> {
    let start_time = catalog::enrichment::get_start_time(org_id, name).await;
    let query = config::meta::search::Query {
        sql: format!("SELECT * FROM \"{name}\""),
        start_time,
        end_time,
        size: QUERY_WITH_NO_LIMIT,
        ..Default::default()
    };

    #[cfg(feature = "enterprise")]
    let regions = {
        let config = o2_enterprise::enterprise::common::config::get_config();
        let enrichment_table_region = config.super_cluster.enrichment_table_get_region.clone();
        if _apply_primary_region_if_specified
            && config.super_cluster.enabled
            && !enrichment_table_region.is_empty()
        {
            vec![enrichment_table_region]
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
    crate::search::SEARCH_SERVER
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

    let result = crate::search::cluster::http::search_inner(
        request,
        search_query,
        regions,
        vec![],
        true,
        None,
    )
    .await;

    #[cfg(feature = "enterprise")]
    let _ = crate::search::SEARCH_SERVER.remove(&trace_id, false).await;

    match result {
        Ok((batches, _scan_stats, _took_wait, _is_partial, _partial_err)) => {
            log::info!(
                "get enrichment table {org_id}/{name} data success with {} rows",
                batches.iter().map(|batch| batch.num_rows()).sum::<usize>()
            );
            Ok(Values::RecordBatch(batches))
        }
        Err(error) => {
            log::error!("get enrichment table {org_id}/{name} data error: {error}");
            Err(anyhow::anyhow!(
                "get enrichment table {org_id}/{name} error: {error}"
            ))
        }
    }
}
