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
    META_ORG_ID, get_config,
    meta::{
        self_reporting::{
            ReportingData,
            usage::{ERROR_STREAM, TRIGGERS_STREAM, TriggerData},
        },
        stream::{StreamParams, StreamType},
    },
    utils::json,
};
use hashbrown::HashMap;

#[cfg(feature = "cloud")]
use crate::organization;

pub struct CoreBatchPublisher;

#[async_trait::async_trait]
impl usage_reporting::BatchPublisher for CoreBatchPublisher {
    async fn publish(&self, thread_id: usize, buffered: Vec<ReportingData>) {
        ingest_buffered_data(thread_id, buffered).await;
    }
}

async fn ingest_buffered_data(thread_id: usize, buffered: Vec<ReportingData>) {
    log::debug!(
        "[SELF-REPORTING] thread_{thread_id} ingests {} buffered data",
        buffered.len()
    );

    let (usages, triggers, errors, raw_errors) = buffered.into_iter().fold(
        (Vec::new(), Vec::new(), Vec::new(), Vec::new()),
        |(mut usages, mut triggers, mut errors, mut raw_errors), item| {
            match item {
                ReportingData::Usage(usage) => usages.push(*usage),
                ReportingData::Trigger(trigger) => triggers.push(json::to_value(*trigger).unwrap()),
                ReportingData::Error(error) => {
                    let error_data = *error;
                    // Keep raw error data for DB batching
                    errors.push(json::to_value(&error_data).unwrap());
                    raw_errors.push(error_data);
                }
            }
            (usages, triggers, errors, raw_errors)
        },
    );

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

    if !usages.is_empty() {
        super::ingestion::ingest_usages(usages).await;
    }

    if !triggers.is_empty() {
        let mut additional_reporting_orgs: Vec<String> =
            if !cfg.common.additional_reporting_orgs.is_empty() {
                cfg.common
                    .additional_reporting_orgs
                    .split(",")
                    .map(|s| s.to_string())
                    .collect()
            } else {
                Vec::new()
            };
        additional_reporting_orgs.push(META_ORG_ID.to_string());

        additional_reporting_orgs.sort();
        additional_reporting_orgs.dedup();

        // Ensure triggers stream exists with complete schema for each org (lazy, once per restart)
        for org in &additional_reporting_orgs {
            if let Err(e) = super::triggers_schema::ensure_triggers_stream_initialized(org).await {
                log::warn!(
                    "[SELF-REPORTING] Failed to ensure triggers stream initialized for {org}: {e}"
                );
            }
        }

        let mut enqueued_on_failure = false;

        for org in &additional_reporting_orgs {
            let trigger_stream = StreamParams::new(org, TRIGGERS_STREAM, StreamType::Logs);

            if super::ingestion::ingest_reporting_data(triggers.clone(), trigger_stream)
                .await
                .is_err()
                && usage_reporting_mode != "both"
                && !enqueued_on_failure
            {
                // Only enqueue once on first failure , this brings risk that it may be duplicated
                enqueued_on_failure = true;

                for trigger_json in triggers.clone() {
                    let trigger: TriggerData = json::from_value(trigger_json).unwrap();
                    if let Err(e) =
                        usage_reporting::enqueue(ReportingData::Trigger(Box::new(trigger))).await
                    {
                        log::error!(
                            "[SELF-REPORTING] Error in pushing back un-ingested TriggerData to UsageQueue: {e}"
                        );
                    }
                }
            }
        }
    }

    let mut per_org_map = HashMap::new();
    // If configured, automatically add each trigger's own org
    if cfg.common.usage_report_to_own_org && usage_reporting_mode != "remote" {
        for trigger_json in triggers {
            if let Ok(trigger) = json::from_value::<TriggerData>(trigger_json.clone()) {
                let org_id = &trigger.org;
                #[cfg(feature = "cloud")]
                match organization::is_org_in_free_trial_period(org_id).await {
                    Ok(ongoing) => {
                        if !ongoing {
                            continue;
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "error checking for trial period for trigger ingestion for {org_id} : {e}"
                        );
                        continue;
                    }
                }
                let entry = per_org_map.entry(org_id.clone()).or_insert(vec![]);
                entry.push(trigger_json);
            }
        }
        for (org, values) in per_org_map.into_iter() {
            let trigger_stream = StreamParams::new(&org, TRIGGERS_STREAM, StreamType::Logs);

            // before pushing to own org ensure that we have a proper triggers stream schema in
            // place
            if let Err(e) = super::triggers_schema::ensure_triggers_stream_initialized(&org).await {
                log::warn!(
                    "[SELF-REPORTING] Failed to ensure triggers stream initialized for {org}: {e}"
                );
            }

            if let Err(e) = super::ingestion::ingest_reporting_data(values, trigger_stream).await {
                log::error!("error in ingesting trigger data for {org} : {e}");
            }
        }
    }

    if cfg.common.usage_reporting_errors_enabled && !errors.is_empty() {
        let error_stream = StreamParams::new(META_ORG_ID, ERROR_STREAM, StreamType::Logs);
        if let Err(e) = super::ingestion::ingest_reporting_data(errors, error_stream).await {
            log::error!("[SELF-REPORTING] Error in ingesting ErrorData: {e}");
        }
    }

    // Batch upsert pipeline errors to DB
    if !raw_errors.is_empty() {
        let pipeline_errors: Vec<_> = raw_errors
            .into_iter()
            .filter_map(|error_data| {
                // Only process pipeline errors
                if let config::meta::self_reporting::error::ErrorSource::Pipeline(pipeline_error) =
                    error_data.error_source
                {
                    Some((
                        pipeline_error.pipeline_id.clone(),
                        pipeline_error.pipeline_name.clone(),
                        error_data.stream_params.org_id.to_string(),
                        error_data._timestamp,
                        pipeline_error,
                    ))
                } else {
                    None
                }
            })
            .collect();

        if !pipeline_errors.is_empty() {
            log::debug!(
                "[SELF-REPORTING] thread_{thread_id} batch upserting {} pipeline errors to DB",
                pipeline_errors.len()
            );
            if let Err(e) = crate::db::pipeline_errors::batch_upsert(pipeline_errors).await {
                log::error!(
                    "[SELF-REPORTING] thread_{thread_id} failed to batch upsert pipeline errors to DB: {e}"
                );
            }
        }
    }
}
