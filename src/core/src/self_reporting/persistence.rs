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
        alerts::auto_investigate::{AUTO_INVESTIGATE_DECISIONS_STREAM, DecisionRow},
        self_reporting::{
            ReportingData,
            redaction::{EvidenceScope, GapReason, REDACTION_EVIDENCE_STREAM, RedactionEvidence},
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

#[derive(Default)]
struct BufferedData {
    usages: Vec<config::meta::self_reporting::usage::UsageData>,
    triggers: Vec<json::Value>,
    errors: Vec<json::Value>,
    raw_errors: Vec<config::meta::self_reporting::error::ErrorData>,
    redactions: Vec<RedactionEvidence>,
    decisions: Vec<DecisionRow>,
}

fn collect_additional_reporting_orgs(configured: &str) -> Vec<String> {
    let mut orgs: Vec<String> = configured
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    orgs.push(META_ORG_ID.to_string());
    orgs.sort();
    orgs.dedup();
    orgs
}

fn partition_buffered_data(buffered: Vec<ReportingData>) -> BufferedData {
    let mut out = BufferedData::default();
    for item in buffered {
        match item {
            ReportingData::Usage(usage) => out.usages.push(*usage),
            ReportingData::Trigger(trigger) => out.triggers.push(json::to_value(*trigger).unwrap()),
            ReportingData::Error(error) => {
                let error_data = *error;
                // Keep raw error data for DB batching
                out.errors.push(json::to_value(&error_data).unwrap());
                out.raw_errors.push(error_data);
            }
            ReportingData::Redaction(evidence) => out.redactions.push(*evidence),
            ReportingData::AutoInvestigateDecision(row) => out.decisions.push(*row),
        }
    }
    out
}

async fn ingest_buffered_data(thread_id: usize, buffered: Vec<ReportingData>) {
    log::debug!(
        "[SELF-REPORTING] thread_{thread_id} ingests {} buffered data",
        buffered.len()
    );

    let BufferedData {
        usages,
        triggers,
        errors,
        raw_errors,
        redactions,
        decisions,
    } = partition_buffered_data(buffered);

    if !redactions.is_empty() {
        ingest_redaction_evidence(redactions).await;
    }

    if !decisions.is_empty() {
        ingest_auto_investigate_decisions(decisions).await;
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

    if !usages.is_empty() {
        super::ingestion::ingest_usages(usages).await;
    }

    let additional_reporting_orgs =
        collect_additional_reporting_orgs(&cfg.common.additional_reporting_orgs);

    if !triggers.is_empty() {
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
                    let Ok(mut trigger) = json::from_value::<TriggerData>(trigger_json) else {
                        log::warn!(
                            "[SELF-REPORTING] Skipping un-parseable TriggerData while re-enqueueing"
                        );
                        continue;
                    };
                    // Records written by a pre-rename build carry the legacy
                    // outcome vocabulary; correct them before re-enqueueing.
                    trigger.normalize_legacy_outcome();
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
    if usage_reporting_mode != "remote" {
        for trigger_json in triggers {
            if let Ok(mut trigger) = json::from_value::<TriggerData>(trigger_json.clone()) {
                trigger.normalize_legacy_outcome();
                let org_id = &trigger.org;
                // The fan-out above already wrote every trigger into these orgs
                if additional_reporting_orgs.contains(org_id) {
                    continue;
                }
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

/// Groups by the record's own org: evidence belongs to the tenant, never to `_meta`.
fn group_redactions_by_org(
    redactions: Vec<RedactionEvidence>,
) -> HashMap<String, Vec<RedactionEvidence>> {
    let mut per_org: HashMap<String, Vec<RedactionEvidence>> = HashMap::new();
    for evidence in redactions {
        per_org
            .entry(evidence.org_id.clone())
            .or_default()
            .push(evidence);
    }
    per_org
}

/// Always `_meta`, whatever org a row is about: the log is never written to or billed to that org.
fn decisions_stream() -> StreamParams {
    StreamParams::new(
        META_ORG_ID,
        AUTO_INVESTIGATE_DECISIONS_STREAM,
        StreamType::Logs,
    )
}

/// Never re-enqueued, like redaction evidence: a lost decision row is only a gap in the log.
async fn ingest_auto_investigate_decisions(decisions: Vec<DecisionRow>) {
    let count = decisions.len();
    let values: Vec<_> = decisions
        .iter()
        .filter_map(|row| json::to_value(row).ok())
        .collect();
    if let Err(e) = super::ingestion::ingest_reporting_data(values, decisions_stream()).await {
        log::error!("[SELF-REPORTING] Failed to ingest {count} auto-investigate decisions: {e}");
    }
}

async fn ingest_redaction_evidence(redactions: Vec<RedactionEvidence>) {
    for (org, rows) in group_redactions_by_org(redactions) {
        if let Err(e) =
            super::redaction_schema::ensure_redaction_evidence_stream_initialized(&org).await
        {
            log::warn!(
                "[SDR-EVIDENCE] Failed to ensure {REDACTION_EVIDENCE_STREAM} initialized for {org}: {e}"
            );
        }

        let scope = EvidenceScope::new(&org, REDACTION_EVIDENCE_STREAM, StreamType::Logs);
        let dropped = rows.len() as u64;
        let values: Vec<_> = rows
            .iter()
            .filter_map(|row| json::to_value(row).ok())
            .collect();
        let stream = StreamParams::new(&org, REDACTION_EVIDENCE_STREAM, StreamType::Logs);

        // Never re-enqueue: a duplicated audit count is worse than a dropped one.
        if let Err(e) = super::ingestion::ingest_reporting_data(values, stream).await {
            log::error!("[SDR-EVIDENCE] Failed to ingest redaction evidence for {org}: {e}");
            super::redaction_evidence::record_gap(&scope, GapReason::PersistFailed, dropped);
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::self_reporting::redaction::{DataWindow, FieldOutcome};

    use super::*;

    #[test]
    fn test_collect_additional_reporting_orgs_always_has_meta() {
        assert_eq!(
            collect_additional_reporting_orgs(""),
            vec![META_ORG_ID.to_string()]
        );
    }

    #[test]
    fn test_collect_additional_reporting_orgs_trims_and_dedups() {
        assert_eq!(
            collect_additional_reporting_orgs("default, prod ,,default"),
            vec![
                META_ORG_ID.to_string(),
                "default".to_string(),
                "prod".to_string()
            ]
        );
    }

    #[test]
    fn test_collect_additional_reporting_orgs_covers_own_org_skip() {
        let orgs = collect_additional_reporting_orgs("default");
        assert!(orgs.contains(&"default".to_string()));
        assert!(orgs.contains(&META_ORG_ID.to_string()));
        assert!(!orgs.contains(&"other".to_string()));
    }

    #[test]
    fn buffered_data_partitions_redaction_into_its_own_bucket() {
        let scope = EvidenceScope::new("tenant", "payments", StreamType::Logs);
        let buffered = vec![
            ReportingData::Redaction(Box::new(RedactionEvidence::redaction(
                &scope,
                "message",
                "Redact",
                FieldOutcome {
                    redacted_regions: 2,
                    ..Default::default()
                },
                DataWindow::default(),
            ))),
            ReportingData::Trigger(Box::new(TriggerData::init_for_reflection())),
        ];

        let partitioned = partition_buffered_data(buffered);
        assert_eq!(partitioned.redactions.len(), 1);
        assert_eq!(partitioned.triggers.len(), 1);
        assert!(partitioned.usages.is_empty());
        assert!(partitioned.errors.is_empty());
        assert!(partitioned.raw_errors.is_empty());
        assert_eq!(partitioned.redactions[0].redacted_regions, 2);
    }

    #[test]
    fn auto_investigate_decisions_go_to_the_meta_stream_never_the_alerts_org() {
        use config::meta::alerts::auto_investigate::{
            BudgetCheck, DecisionContext, GateInputs, GateSettings, MarkLookup,
            decide_auto_investigate,
        };

        let inputs = GateInputs {
            is_new_fire: true,
            level: Some(config::meta::alerts::level::AlertLevel::Critical),
            rca_running: false,
            last_auto_investigated_at: None,
            protected: false,
            mark_lookup: MarkLookup::NotChecked,
            onsets_7d: 1,
            evaluations_7d: 10,
            fire_share_7d: 0.1,
            budget: BudgetCheck::Allowed,
            now: 1_000,
            settings: GateSettings::default(),
            settings_version: None,
        };
        let row = DecisionRow::new(
            &decide_auto_investigate(&inputs),
            &inputs,
            DecisionContext {
                org_id: "tenant".to_string(),
                ..Default::default()
            },
        );
        let partitioned = partition_buffered_data(vec![
            ReportingData::AutoInvestigateDecision(Box::new(row.clone())),
            ReportingData::Trigger(Box::new(TriggerData::init_for_reflection())),
        ]);
        assert_eq!(partitioned.decisions, vec![row]);
        assert_eq!(partitioned.triggers.len(), 1);
        assert!(partitioned.redactions.is_empty());

        let stream = decisions_stream();
        assert_eq!(stream.org_id.as_str(), META_ORG_ID);
        assert_eq!(stream.stream_name.as_str(), "auto_investigate_decisions");
        assert_eq!(stream.stream_type, StreamType::Logs);
    }

    #[test]
    fn redaction_evidence_is_grouped_by_its_own_org_and_never_into_meta() {
        let tenant = EvidenceScope::new("tenant", "payments", StreamType::Logs);
        let other = EvidenceScope::new("other", "payments", StreamType::Logs);
        let rows = vec![
            RedactionEvidence::redaction(
                &tenant,
                "message",
                "Redact",
                FieldOutcome::default(),
                DataWindow::default(),
            ),
            RedactionEvidence::redaction(
                &tenant,
                "body",
                "Hash",
                FieldOutcome::default(),
                DataWindow::default(),
            ),
            RedactionEvidence::redaction(
                &other,
                "message",
                "Redact",
                FieldOutcome::default(),
                DataWindow::default(),
            ),
        ];

        let grouped = group_redactions_by_org(rows);
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped["tenant"].len(), 2);
        assert_eq!(grouped["other"].len(), 1);
        // collect_additional_reporting_orgs would have added _meta; this must not.
        assert!(!grouped.contains_key(META_ORG_ID));
    }
}
