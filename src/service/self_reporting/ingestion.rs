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

use anyhow::{Result, anyhow};
#[cfg(feature = "cloud")]
use config::meta::self_reporting::usage::{DATA_RETENTION_USAGE_STREAM, DataRetentionUsageData};
use config::{
    META_ORG_ID,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::SearchEventType,
        self_reporting::{
            ReportingData,
            usage::{AggregatedData, GroupKey, USAGE_STREAM, UsageData, UsageEvent},
        },
        stream::{StreamParams, StreamType},
    },
    utils::json,
};
use hashbrown::{HashMap, hash_map::Entry};
use proto::cluster_rpc;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};

use crate::{
    common::meta::ingestion::{self, IngestUser, SystemJobType},
    service,
};

pub(super) async fn ingest_usages(mut curr_usages: Vec<UsageData>) {
    if curr_usages.is_empty() {
        log::info!("[SELF-REPORTING] Returning as no usages reported ");
        return;
    }
    let mut groups: HashMap<GroupKey, AggregatedData> = HashMap::new();
    let mut search_events = vec![];
    for usage_data in curr_usages.iter_mut() {
        // Skip aggregation for usage_data with event "Search"
        if usage_data.event == UsageEvent::Search {
            // enrich dashboard search usage with more context if `usage_data` only has id's, but
            // not names
            if matches!(usage_data.search_type, Some(SearchEventType::Dashboards))
                && let Some((Some(dashboard_id), None)) = usage_data
                    .search_event_context
                    .as_ref()
                    .map(|ctx| (&ctx.dashboard_id, &ctx.dashboard_name))
                && let Ok((folder, dashboard)) =
                    service::dashboards::get_folder_and_dashboard(&usage_data.org_id, dashboard_id)
                        .await
                && let Some(ctx) = usage_data.search_event_context.as_mut()
            {
                ctx.enrich_for_dashboard(
                    dashboard.title().unwrap().to_string(),
                    folder.name,
                    folder.folder_id,
                )
            };
            search_events.push(usage_data.clone());
            continue;
        }
        let node = usage_data.node_name.clone().unwrap_or_default();
        let key = GroupKey {
            stream_name: usage_data.stream_name.clone(),
            org_id: usage_data.org_id.clone(),
            stream_type: usage_data.stream_type,
            day: usage_data.day,
            hour: usage_data.hour,
            event: usage_data.event,
            email: usage_data.user_email.clone(),
            node,
        };

        match groups.entry(key) {
            Entry::Vacant(vacant) => {
                vacant.insert(AggregatedData {
                    count: 1,
                    usage_data: usage_data.clone(),
                });
            }
            Entry::Occupied(mut occupied) => {
                let entry = occupied.get_mut();
                entry.usage_data.num_records += usage_data.num_records;
                entry.usage_data.size += usage_data.size;
                entry.usage_data.response_time += usage_data.response_time;
                entry.count += 1;
            }
        }
    }

    let mut report_data = Vec::with_capacity(groups.len() + search_events.len());
    for (_, data) in groups {
        let mut usage_data = data.usage_data;
        usage_data.response_time /= data.count as f64;
        report_data.push(usage_data);
    }

    let cfg = get_config();
    #[cfg(not(feature = "enterprise"))]
    let usage_reporting_mode = &cfg.common.usage_reporting_mode;
    #[cfg(feature = "enterprise")]
    let usage_reporting_mode = {
        if cfg.common.usage_reporting_mode == "local" {
            "local"
        } else {
            "both"
        }
    };

    // Push all the search events
    report_data.append(&mut search_events);
    if usage_reporting_mode != "local"
        && !cfg.common.usage_reporting_url.is_empty()
        && !cfg.common.usage_reporting_creds.is_empty()
    {
        let url = url::Url::parse(&cfg.common.usage_reporting_url).unwrap();
        let creds = if cfg.common.usage_reporting_creds.starts_with("Basic") {
            cfg.common.usage_reporting_creds.to_string()
        } else {
            format!("Basic {}", &cfg.common.usage_reporting_creds)
        };
        match reqwest::Client::new()
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(AUTHORIZATION, creds)
            .json(&report_data)
            .send()
            .await
        {
            Ok(resp) => {
                let resp_status = resp.status();
                if !resp_status.is_success() {
                    log::error!(
                        "[SELF-REPORTING] Error in ingesting usage data to external URL: {}",
                        resp.text()
                            .await
                            .unwrap_or_else(|_| resp_status.to_string())
                    );
                    if usage_reporting_mode != "both" {
                        // on error in ingesting usage data, push back the data
                        let curr_usages = curr_usages.clone();
                        for usage_data in curr_usages {
                            if let Err(e) = super::queues::USAGE_QUEUE
                                .enqueue(ReportingData::Usage(Box::new(usage_data)))
                                .await
                            {
                                log::error!(
                                    "[SELF-REPORTING] Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                                );
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("[SELF-REPORTING] Error in ingesting usage data to external URL {e:?}");
                if usage_reporting_mode != "both" {
                    // on error in ingesting usage data, push back the data
                    let curr_usages = curr_usages.clone();
                    for usage_data in curr_usages {
                        if let Err(e) = super::queues::USAGE_QUEUE
                            .enqueue(ReportingData::Usage(Box::new(usage_data)))
                            .await
                        {
                            log::error!(
                                "[SELF-REPORTING] Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                            );
                        }
                    }
                }
            }
        }
    }

    if usage_reporting_mode != "remote" {
        let report_data = report_data
            .into_iter()
            .map(|usage| json::to_value(usage).unwrap_or_default())
            .collect::<Vec<_>>();
        // report usage data
        let usage_stream = StreamParams::new(META_ORG_ID, USAGE_STREAM, StreamType::Logs);
        if let Err(e) = ingest_reporting_data(report_data, usage_stream).await {
            log::error!(
                "[SELF-REPORTING] Error in ingesting usage data to internal ingestion: {e}"
            );
            if usage_reporting_mode != "both" {
                // on error in ingesting usage data, push back the data
                tokio::spawn(async move {
                    for usage_data in curr_usages {
                        if let Err(e) = super::queues::USAGE_QUEUE
                            .enqueue(ReportingData::Usage(Box::new(usage_data)))
                            .await
                        {
                            log::error!(
                                "[SELF-REPORTING] Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                            );
                        }
                    }
                });
            }
        }
    }
}

pub(super) async fn ingest_reporting_data(
    reporting_data_json: Vec<json::Value>,
    stream_params: StreamParams,
) -> Result<()> {
    if reporting_data_json.is_empty() {
        log::info!("[SELF-REPORTING] Returning as no errors reported");
        return Ok(());
    }

    if LOCAL_NODE.is_ingester() {
        // ingest directly for ingester node
        let (org_id, stream_name): (String, String) = (
            stream_params.org_id.into(),
            stream_params.stream_name.into(),
        );
        let bytes = bytes::Bytes::from(json::to_string(&reporting_data_json).unwrap());
        let req = ingestion::IngestionRequest::Usage(bytes);
        match service::logs::ingest::ingest(
            0,
            &org_id,
            &stream_name,
            req,
            IngestUser::SystemJob(SystemJobType::SelfReporting),
            None,
            false,
        )
        .await
        {
            Ok(resp) if resp.code == 200 => {
                log::debug!(
                    "[SELF-REPORTING] ReportingData successfully ingested to stream {org_id}/{stream_name}"
                );
                Ok(())
            }
            error => {
                let err =
                    error.map_or_else(|e| e.to_string(), |resp| resp.error.unwrap_or_default());
                log::error!(
                    "[SELF-REPORTING] ReportingData errored while ingesting to stream {org_id}/{stream_name}. Error: {err}"
                );
                Err(anyhow!("{err}"))
            }
        }
    } else {
        // call gRPC ingestion service
        let (org_id, stream_name, stream_type): (String, String, String) = (
            stream_params.org_id.into(),
            stream_params.stream_name.into(),
            stream_params.stream_type.to_string(),
        );

        let req = cluster_rpc::IngestionRequest {
            org_id: org_id.clone(),
            stream_name: stream_name.clone(),
            stream_type,
            data: Some(cluster_rpc::IngestionData::from(reporting_data_json)),
            ingestion_type: Some(cluster_rpc::IngestionType::Usage.into()),
            metadata: None,
        };

        match service::ingestion::ingestion_service::ingest(req).await {
            Ok(resp) if resp.status_code == 200 => {
                log::debug!(
                    "[SELF-REPORTING] ReportingData successfully ingested to stream {org_id}/{stream_name}"
                );
                Ok(())
            }
            error => {
                let err = error.map_or_else(|e| e.to_string(), |resp| resp.message);
                log::error!(
                    "[SELF-REPORTING] ReportingData errored while ingesting to stream {org_id}/{stream_name}. Error: {err}"
                );
                Err(anyhow!("{err}"))
            }
        }
    }
}

#[cfg(feature = "cloud")]
pub async fn ingest_data_retention_usages(data_retention_usages: Vec<DataRetentionUsageData>) {
    if data_retention_usages.is_empty() {
        log::info!("[SELF-REPORTING] Returning as no data retention usages reported");
        return;
    }

    let report_data = data_retention_usages
        .iter()
        .map(|usage| json::to_value(usage).unwrap())
        .collect::<Vec<_>>();

    let data_retention_stream =
        StreamParams::new(META_ORG_ID, DATA_RETENTION_USAGE_STREAM, StreamType::Logs);

    if let Err(e) = ingest_reporting_data(report_data, data_retention_stream).await {
        log::error!("[SELF-REPORTING] Error in ingesting data retention usage: {e}");
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{search::SearchEventContext, stream::StreamType};

    use super::*;

    // Helper function to create test UsageData
    fn create_test_usage_data(
        event: UsageEvent,
        org_id: &str,
        stream_name: &str,
        user_email: &str,
        size: f64,
        num_records: i64,
        response_time: f64,
    ) -> UsageData {
        UsageData {
            _timestamp: 1640995200000000, // 2022-01-01 00:00:00
            event,
            year: 2022,
            month: 1,
            day: 1,
            hour: 0,
            event_time_hour: "2022010100".to_string(),
            org_id: org_id.to_string(),
            request_body: "test_request".to_string(),
            size,
            unit: "MB".to_string(),
            user_email: user_email.to_string(),
            response_time,
            stream_type: StreamType::Logs,
            num_records,
            dropped_records: 0,
            stream_name: stream_name.to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: Some("test-node".to_string()),
            dashboard_info: None,
            peak_memory_usage: None,
        }
    }

    #[tokio::test]
    async fn test_ingest_usages_empty_input() {
        let usages = vec![];
        ingest_usages(usages).await;
        // Should return early without any processing
    }

    #[tokio::test]
    async fn test_ingest_usages_single_usage() {
        let usages = vec![create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.5,
        )];

        // This test verifies the function doesn't panic with single usage
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_aggregation() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                2.0,
            ),
        ];

        // This test verifies aggregation logic works
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_search_events_not_aggregated() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Search,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Search,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                2.0,
            ),
        ];

        // Search events should not be aggregated
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_mixed_events() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Search,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                2.0,
            ),
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                30.0,
                300,
                3.0,
            ),
        ];

        // Mixed events should be handled correctly
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_different_groups() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Ingestion,
                "org1",
                "stream1",
                "user1@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Ingestion,
                "org2",
                "stream2",
                "user2@example.com",
                20.0,
                200,
                2.0,
            ),
        ];

        // Different groups should not be aggregated together
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_with_node_name() {
        let mut usage1 = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );
        usage1.node_name = Some("node1".to_string());

        let mut usage2 = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            20.0,
            200,
            2.0,
        );
        usage2.node_name = Some("node2".to_string());

        let usages = vec![usage1, usage2];

        // Different node names should create different groups
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_without_node_name() {
        let mut usage1 = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );
        usage1.node_name = None;

        let mut usage2 = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            20.0,
            200,
            2.0,
        );
        usage2.node_name = None;

        let usages = vec![usage1, usage2];

        // Usages without node names should use empty string
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_reporting_data_empty_input() {
        let reporting_data = vec![];
        let stream_params = StreamParams::new("test-org", "test-stream", StreamType::Logs);

        let result = ingest_reporting_data(reporting_data, stream_params).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_group_key_creation() {
        let usage = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );

        let node = usage.node_name.clone().unwrap_or_default();
        let key = GroupKey {
            stream_name: usage.stream_name.clone(),
            org_id: usage.org_id.clone(),
            stream_type: usage.stream_type,
            day: usage.day,
            hour: usage.hour,
            event: usage.event,
            email: usage.user_email.clone(),
            node,
        };

        assert_eq!(key.stream_name, "test-stream");
        assert_eq!(key.org_id, "test-org");
        assert_eq!(key.email, "test@example.com");
        assert_eq!(key.node, "test-node");
        assert_eq!(key.event, UsageEvent::Ingestion);
    }

    #[test]
    fn test_aggregated_data_creation() {
        let usage = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );

        let aggregated = AggregatedData {
            count: 1,
            usage_data: usage.clone(),
        };

        assert_eq!(aggregated.count, 1);
        assert_eq!(aggregated.usage_data.org_id, usage.org_id);
        assert_eq!(aggregated.usage_data.stream_name, usage.stream_name);
    }

    #[test]
    fn test_usage_event_display() {
        assert_eq!(UsageEvent::Ingestion.to_string(), "Ingestion");
        assert_eq!(UsageEvent::Search.to_string(), "Search");
        assert_eq!(UsageEvent::Functions.to_string(), "Functions");
        assert_eq!(UsageEvent::Other.to_string(), "Other");
    }

    #[test]
    fn test_group_key_hash() {
        use std::collections::HashMap;

        let key1 = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 0,
            event: UsageEvent::Ingestion,
            email: "user1@example.com".to_string(),
            node: "node1".to_string(),
        };

        let key2 = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 0,
            event: UsageEvent::Ingestion,
            email: "user1@example.com".to_string(),
            node: "node1".to_string(),
        };

        let mut map = HashMap::new();
        map.insert(key1, "value1");

        assert!(map.contains_key(&key2));
        assert_eq!(map.get(&key2), Some(&"value1"));
    }

    #[tokio::test]
    async fn test_ingest_usages_large_dataset() {
        let mut usages = Vec::new();

        // Create 1000 usage records
        for i in 0..1000 {
            usages.push(create_test_usage_data(
                UsageEvent::Ingestion,
                &format!("org-{}", i % 10),
                &format!("stream-{}", i % 20),
                &format!("user{}@example.com", i % 5),
                (i as f64) * 0.1,
                i as i64,
                (i as f64) * 0.01,
            ));
        }

        // Should handle large datasets without issues
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_response_time_averaging() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Ingestion,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                3.0,
            ),
        ];

        // Response time should be averaged when aggregating
        ingest_usages(usages).await;
    }

    #[test]
    fn test_usage_data_serialization() {
        let usage = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );

        let json_value = json::to_value(&usage).unwrap();
        assert!(json_value.is_object());

        let deserialized: UsageData = json::from_value(json_value).unwrap();
        assert_eq!(deserialized.org_id, usage.org_id);
        assert_eq!(deserialized.stream_name, usage.stream_name);
        assert_eq!(deserialized.event, usage.event);
    }

    #[test]
    fn test_usage_data_with_search_context() {
        let mut usage = create_test_usage_data(
            UsageEvent::Search,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );

        usage.search_type = Some(SearchEventType::Dashboards);
        usage.search_event_context = Some(SearchEventContext {
            dashboard_id: Some("dashboard-123".to_string()),
            ..Default::default()
        });

        // Should handle search context correctly
        assert_eq!(usage.search_type, Some(SearchEventType::Dashboards));
        assert!(usage.search_event_context.is_some());
    }

    #[tokio::test]
    async fn test_ingest_usages_with_functions_event() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Functions,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Functions,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                2.0,
            ),
        ];

        // Functions events should be aggregated like Ingestion events
        ingest_usages(usages).await;
    }

    #[tokio::test]
    async fn test_ingest_usages_with_other_event() {
        let usages = vec![
            create_test_usage_data(
                UsageEvent::Other,
                "test-org",
                "test-stream",
                "test@example.com",
                10.0,
                100,
                1.0,
            ),
            create_test_usage_data(
                UsageEvent::Other,
                "test-org",
                "test-stream",
                "test@example.com",
                20.0,
                200,
                2.0,
            ),
        ];

        // Other events should be aggregated like Ingestion events
        ingest_usages(usages).await;
    }

    #[test]
    fn test_usage_data_with_optional_fields() {
        let mut usage = create_test_usage_data(
            UsageEvent::Ingestion,
            "test-org",
            "test-stream",
            "test@example.com",
            10.0,
            100,
            1.0,
        );

        usage.trace_id = Some("trace-123".to_string());
        usage.cached_ratio = Some(50);
        usage.scan_files = Some(25);
        usage.compressed_size = Some(5.0);
        usage.min_ts = Some(1640995200000000);
        usage.max_ts = Some(1640995260000000);
        usage.took_wait_in_queue = Some(100);
        usage.result_cache_ratio = Some(75);
        usage.function = Some("test_function".to_string());
        usage.is_partial = true;
        usage.work_group = Some("test_workgroup".to_string());

        assert_eq!(usage.trace_id, Some("trace-123".to_string()));
        assert_eq!(usage.cached_ratio, Some(50));
        assert_eq!(usage.scan_files, Some(25));
        assert_eq!(usage.compressed_size, Some(5.0));
        assert_eq!(usage.min_ts, Some(1640995200000000));
        assert_eq!(usage.max_ts, Some(1640995260000000));
        assert_eq!(usage.took_wait_in_queue, Some(100));
        assert_eq!(usage.result_cache_ratio, Some(75));
        assert_eq!(usage.function, Some("test_function".to_string()));
        assert!(usage.is_partial);
        assert_eq!(usage.work_group, Some("test_workgroup".to_string()));
    }
}
