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

use config::{
    get_config,
    meta::{cluster::RoleGroup, stream::StreamType},
};
use hashbrown::HashMap;
use infra::{cluster::get_cached_online_querier_nodes, schema::STREAM_SCHEMAS_LATEST};

use crate::{
    common::infra::config::ENRICHMENT_TABLES,
    service::{db, enrichment::StreamTable},
};

pub async fn cache_enrichment_tables() -> Result<(), anyhow::Error> {
    let r = STREAM_SCHEMAS_LATEST.read().await;
    let mut tables = HashMap::new();
    let mut org_tables: HashMap<String, Vec<(String, String)>> = HashMap::new(); // org_id -> [(key, table_name)]

    for schema_key in r.keys() {
        if !schema_key.contains(format!("/{}/", StreamType::EnrichmentTables).as_str()) {
            continue;
        }
        let columns = schema_key.split('/').collect::<Vec<&str>>();
        let org_id = columns[0];
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2];
        if !stream_type.eq(&StreamType::EnrichmentTables) {
            continue;
        }

        // Group by org_id for batch fetching URL jobs
        org_tables
            .entry(org_id.to_string())
            .or_default()
            .push((schema_key.to_owned(), stream_name.to_string()));

        tables.insert(
            schema_key.to_owned(),
            StreamTable {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                data: vec![].into(),
            },
        );
    }
    drop(r);
    if tables.is_empty() {
        log::info!("EnrichmentTables Cached");
        return Ok(());
    }

    // Fetch all URL jobs per organization to check completion status
    // This avoids making individual database calls for each enrichment table
    // Since multiple URL jobs can exist per table, we group by table_name
    let mut url_jobs_by_org: HashMap<
        String,
        HashMap<String, Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>>,
    > = HashMap::new();
    for org_id in org_tables.keys() {
        match db::enrichment_table::list_url_jobs(org_id).await {
            Ok(jobs) => {
                // Group jobs by table_name since multiple jobs can exist per table
                let mut jobs_map: HashMap<
                    String,
                    Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>,
                > = HashMap::new();
                for job in jobs {
                    jobs_map
                        .entry(job.table_name.clone())
                        .or_default()
                        .push(job);
                }
                log::debug!(
                    "[CACHE] Fetched {} URL jobs across {} tables for org {}",
                    jobs_map.values().map(|v| v.len()).sum::<usize>(),
                    jobs_map.len(),
                    org_id
                );
                url_jobs_by_org.insert(org_id.clone(), jobs_map);
            }
            Err(e) => {
                log::warn!("[CACHE] Failed to fetch URL jobs for org {}: {}", org_id, e);
                url_jobs_by_org.insert(org_id.clone(), HashMap::new());
            }
        }
    }

    // Filter out enrichment tables that have NO completed URL jobs
    // Only cache tables if:
    // 1. They are file-based (no URL jobs), OR
    // 2. They have at least one completed URL job (even if other jobs are incomplete/failed)
    let mut tables_to_cache = Vec::new();
    for (key, tbl) in tables.iter() {
        let should_cache = if let Some(org_jobs) = url_jobs_by_org.get(&tbl.org_id) {
            if let Some(url_jobs) = org_jobs.get(&tbl.stream_name) {
                // This is a URL-based enrichment table with multiple possible jobs
                // Only cache if at least ONE job is completed
                let has_completed_job = url_jobs.iter().any(|job| {
                    job.status == config::meta::enrichment_table::EnrichmentTableStatus::Completed
                });
                if !has_completed_job {
                    log::info!(
                        "[CACHE] Skipping enrichment table {}/{} - no completed URL jobs (total jobs: {})",
                        tbl.org_id,
                        tbl.stream_name,
                        url_jobs.len()
                    );
                }
                has_completed_job
            } else {
                // No URL job found - this is a file-based enrichment table, cache it
                true
            }
        } else {
            // No jobs for this org (shouldn't happen but handle gracefully)
            true
        };

        if should_cache {
            tables_to_cache.push((key.clone(), tbl.clone()));
        }
    }

    if tables_to_cache.is_empty() {
        log::info!("EnrichmentTables Cached (0 tables ready)");
        return Ok(());
    }

    log::info!(
        "[CACHE] Caching {} enrichment tables (filtered {} incomplete URL jobs)",
        tables_to_cache.len(),
        tables.len() - tables_to_cache.len()
    );

    // waiting for querier to be ready
    let expect_querier_num = get_config().limit.starting_expect_querier_num;
    loop {
        let nodes = get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
            .await
            .unwrap_or_default();
        if nodes.len() >= expect_querier_num {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        log::info!("Waiting for querier to be ready");
    }

    // fill data
    let total = std::time::Instant::now();
    for (key, tbl) in tables_to_cache {
        let start = std::time::Instant::now();
        // Only use the primary region if specified to fetch enrichment table data assuming only the
        // primary region contains the data.
        let data =
            crate::enrichment::get_enrichment_table(&tbl.org_id, &tbl.stream_name, true).await?;
        let len = data.len();
        ENRICHMENT_TABLES.insert(
            key,
            StreamTable {
                org_id: tbl.org_id.clone(),
                stream_name: tbl.stream_name.clone(),
                data,
            },
        );
        log::info!(
            "EnrichmentTables Cached: org_id: {}, stream_name: {}, len: {}, took {:?}",
            tbl.org_id,
            tbl.stream_name,
            len,
            start.elapsed()
        );
    }
    log::info!("EnrichmentTables Cached, took {:?}", total.elapsed());
    Ok(())
}
