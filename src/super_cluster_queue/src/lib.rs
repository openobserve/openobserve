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

#![cfg(feature = "enterprise")]

mod action_scripts;
mod alert_states;
mod alerts;
mod anomaly_detection;
mod cipher_keys;
mod compactor_manual_jobs;
mod dashboards;
mod destinations;
mod distinct_values;
mod domain_management;
mod enrichment_table;
mod eval_annotation_queues;
mod eval_datasets;
mod eval_jobs;
mod eval_providers;
mod eval_score_configs;
mod eval_scorers;
mod folders;
mod incidents;
mod kv;
mod meta;
mod org_ingestion_token;
mod org_user;
mod organization;
mod pipelines;
mod ratelimit;
mod re_pattern;
mod reports;
mod scheduler;
mod schemas;
mod search_job;
mod semantic_groups;
mod service_streams;
mod short_urls;
mod synthetics;
mod synthetics_locations;
mod synthetics_probe_tokens;
mod templates;
mod user;

use config::cluster::{LOCAL_NODE, is_offline};
use o2_enterprise::enterprise::super_cluster::queue::{
    ActionScriptsQueue, AlertsQueue, DashboardsQueue, DestinationsQueue, EvalAnnotationQueuesQueue,
    EvalDatasetsQueue, EvalJobsQueue, EvalProvidersQueue, EvalScoreConfigsQueue, EvalScorersQueue,
    FoldersQueue, MetaQueue, OrgUsersQueue, PipelinesQueue, SchedulerQueue, SchemasQueue,
    SearchJobsQueue, SuperClusterQueueTrait, SyntheticsQueue, TemplatesQueue,
};

fn parse_eval_key(
    key: &str,
    module: &str,
    invalid_message: &str,
) -> infra::errors::Result<(String, String)> {
    let mut columns = key.split('/');
    match (
        columns.next(),
        columns.next(),
        columns.next(),
        columns.next(),
        columns.next(),
        columns.next(),
    ) {
        (Some(_), Some("eval"), Some(key_module), Some(org_id), Some(entity_id), None)
            if key_module == module && !org_id.is_empty() && !entity_id.is_empty() =>
        {
            Ok((org_id.to_string(), entity_id.to_string()))
        }
        _ => Err(infra::errors::Error::Message(invalid_message.to_string())),
    }
}

/// Creates a super cluster queue for each super cluster topic and begins
/// polling messages from each queue in a separate thread.
pub async fn init() -> Result<(), anyhow::Error> {
    let meta_queue = MetaQueue {
        on_meta_msg: meta::process,
        on_distinct_values_msg: distinct_values::process,
        on_short_url_msg: short_urls::process,
        on_schema_msg: schemas::process,
        on_alert_msg: alerts::process,
        on_scheduler_msg: scheduler::process,
        on_search_job_msg: search_job::process,
        on_dashboard_msg: dashboards::process,
        on_pipeline_msg: pipelines::process,
        on_cipher_key_msg: cipher_keys::process,
        on_rate_limit_msg: ratelimit::process,
        on_re_patterns_msg: re_pattern::process,
        on_domain_management_msg: domain_management::process,
        on_compactor_manual_job_msg: compactor_manual_jobs::process,
        on_enrichment_file_list_delete_msg: enrichment_table::process_file_list_delete,
        on_kv_msg: kv::process,
        on_service_streams_msg: service_streams::process,
    };
    let schema_queue = SchemasQueue {
        on_schema_msg: schemas::process,
    };
    let alerts_queue = AlertsQueue {
        on_alert_msg: alerts::process,
        on_scheduler_msg: scheduler::process,
        on_semantic_groups_msg: semantic_groups::process,
        on_incident_msg: incidents::process,
        on_anomaly_detection_msg: anomaly_detection::process,
        on_alert_state_msg: alert_states::process,
    };
    let scheduler_queue = SchedulerQueue {
        on_scheduler_msg: scheduler::process,
    };
    let search_jobs_queue = SearchJobsQueue {
        on_search_job_msg: search_job::process,
    };
    let dashboards_queue = DashboardsQueue {
        on_dashboard_msg: dashboards::process,
        on_report_msg: reports::process,
    };
    let pipelines_queue = PipelinesQueue {
        on_pipeline_msg: pipelines::process,
    };
    let eval_providers_queue = EvalProvidersQueue {
        on_eval_provider_msg: eval_providers::process,
    };
    let eval_score_configs_queue = EvalScoreConfigsQueue {
        on_eval_score_config_msg: eval_score_configs::process,
    };
    let eval_annotation_queues_queue = EvalAnnotationQueuesQueue {
        on_eval_annotation_queue_msg: eval_annotation_queues::process,
    };
    let eval_datasets_queue = EvalDatasetsQueue {
        on_eval_dataset_msg: eval_datasets::process,
    };
    let eval_scorers_queue = EvalScorersQueue {
        on_eval_scorer_msg: eval_scorers::process,
    };
    let eval_jobs_queue = EvalJobsQueue {
        on_eval_job_msg: eval_jobs::process,
    };
    let folders_queue = FoldersQueue {
        on_folder_msg: folders::process,
    };
    let templates_queue = TemplatesQueue {
        on_template_msg: templates::process,
    };
    let destinations_queue = DestinationsQueue {
        on_destination_msg: destinations::process,
    };
    let action_scripts_queue = ActionScriptsQueue {
        on_action_script_msg: action_scripts::process,
    };
    // One topic, three modules: the subscriber routes on the key's module
    // segment, and an unmatched module falls through to `Ok(())` — so a handler
    // left off here does not fail to compile, it silently drops every message
    // for that table.
    let synthetics_queue = SyntheticsQueue {
        on_synthetics_msg: synthetics::process,
        on_locations_msg: synthetics_locations::process,
        on_probe_tokens_msg: synthetics_probe_tokens::process,
    };
    let org_users_queue = OrgUsersQueue {
        on_org_users_msg: org_user::process,
        on_user_msg: user::process,
        on_meta_msg: meta::process,
        on_orgs_msg: organization::process,
        on_org_ingestion_token_msg: org_ingestion_token::process,
    };
    let queues: Vec<Box<dyn SuperClusterQueueTrait + Sync + Send>> = vec![
        Box::new(meta_queue),
        Box::new(schema_queue),
        Box::new(alerts_queue),
        Box::new(search_jobs_queue),
        Box::new(dashboards_queue),
        Box::new(pipelines_queue),
        Box::new(eval_providers_queue),
        Box::new(eval_score_configs_queue),
        Box::new(eval_annotation_queues_queue),
        Box::new(eval_datasets_queue),
        Box::new(eval_scorers_queue),
        Box::new(eval_jobs_queue),
        Box::new(folders_queue),
        Box::new(templates_queue),
        Box::new(destinations_queue),
        Box::new(action_scripts_queue),
        Box::new(scheduler_queue),
        Box::new(synthetics_queue),
        Box::new(org_users_queue),
    ];

    for queue in queues {
        queue.create_queue().await?;

        if LOCAL_NODE.is_compactor() {
            tokio::task::spawn(async move {
                loop {
                    if is_offline() {
                        break;
                    }
                    if let Err(e) = queue.subscribe().await {
                        log::error!("[SUPER_CLUSTER:sync] failed to subscribe: {e}");
                    }
                }
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_eval_keys() {
        assert_eq!(
            parse_eval_key(
                "/eval/annotation_queues/org-1/queue-1",
                "annotation_queues",
                "invalid",
            )
            .unwrap(),
            ("org-1".to_string(), "queue-1".to_string())
        );
        assert!(
            parse_eval_key(
                "/eval/annotation_queues/org-1/",
                "annotation_queues",
                "invalid",
            )
            .is_err()
        );
        assert!(parse_eval_key("/eval/scorers/org-1/id-1", "datasets", "invalid").is_err());
        assert!(parse_eval_key("/eval/datasets/org-1/id-1/extra", "datasets", "invalid").is_err());
    }
}
