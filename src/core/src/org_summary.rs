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

//! The per-organization overview shown on the landing page.
//!
//! This aggregates across most of the product -- streams, pipelines, alerts, functions,
//! dashboards -- so it sits above all of them rather than in `organization`, which the same
//! domains depend on.

use config::{
    meta::{
        alerts::alert::ListAlertsParams, dashboards::ListDashboardsParams,
        pipeline::components::PipelineSource, self_reporting::usage, stream::StreamType,
    },
    utils::{json, time},
};
use infra::table;
use stream::get_streams;

use crate::{
    common::meta::organization::{
        AlertSummary, OrgSummary, PipelineSummary, StreamSummary, TriggerStatus,
        TriggerStatusSearchResult,
    },
    db,
};

pub async fn get_summary(org_id: &str) -> OrgSummary {
    let streams = get_streams(org_id, None, false, None).await;
    let mut stream_summary = StreamSummary::default();
    let mut has_trigger_stream = false;
    for stream in streams.iter() {
        if stream.name == usage::TRIGGERS_STREAM {
            has_trigger_stream = true;
        }
        if !stream.stream_type.eq(&StreamType::Index)
            && !stream.stream_type.eq(&StreamType::Metadata)
        {
            stream_summary.num_streams += 1;
            stream_summary.total_records += stream.stats.doc_num;
            stream_summary.total_storage_size += stream.stats.storage_size;
            stream_summary.total_compressed_size += stream.stats.compressed_size;
            stream_summary.total_index_size += stream.stats.index_size;
        }
    }

    let trigger_status_results = if !has_trigger_stream {
        vec![]
    } else {
        let sql = format!(
            "SELECT module, status FROM {} WHERE org = '{}' GROUP BY module, status, key",
            usage::TRIGGERS_STREAM,
            org_id
        );
        let end_time = time::now_micros();
        let start_time = end_time - time::second_micros(900); // 15 mins
        crate::usage_search::get_usage(sql, start_time, end_time, false)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| json::from_value::<TriggerStatusSearchResult>(v).ok())
            .collect::<Vec<_>>()
    };

    let pipelines = crate::pipeline::list_user_pipelines(org_id, None)
        .await
        .unwrap_or_default();
    let pipeline_summary = PipelineSummary {
        num_realtime: pipelines
            .iter()
            .filter(|p| matches!(p.source, PipelineSource::Realtime(_)))
            .count() as i64,
        num_scheduled: pipelines
            .iter()
            .filter(|p| matches!(p.source, PipelineSource::Scheduled(_)))
            .count() as i64,
        trigger_status: TriggerStatus::from_search_results(
            &trigger_status_results,
            usage::TriggerDataType::DerivedStream,
        ),
    };

    let alerts = crate::alerts::alert::list_with_folders_db(ListAlertsParams::new(org_id))
        .await
        .unwrap_or_default();
    let alert_summary = AlertSummary {
        num_realtime: alerts.iter().filter(|(_, a)| a.is_real_time).count() as i64,
        num_scheduled: alerts.iter().filter(|(_, a)| !a.is_real_time).count() as i64,
        trigger_status: TriggerStatus::from_search_results(
            &trigger_status_results,
            usage::TriggerDataType::Alert,
        ),
    };

    let functions = db::functions::list(org_id).await.unwrap_or_default();
    let dashboards = table::dashboards::list(ListDashboardsParams::new(org_id))
        .await
        .unwrap_or_default();

    OrgSummary {
        streams: stream_summary,
        pipelines: pipeline_summary,
        alerts: alert_summary,
        total_functions: functions.len() as i64,
        total_dashboards: dashboards.len() as i64,
    }
}
