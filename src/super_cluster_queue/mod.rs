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

mod action_scripts;
mod ai_prompt;
mod alerts;
mod cipher_keys;
mod compactor_manual_jobs;
mod dashboards;
mod destinations;
mod distinct_values;
mod domain_management;
mod enrichment_table;
mod folders;
mod incidents;
mod kv;
mod meta;
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
mod templates;
mod user;

use config::cluster::{LOCAL_NODE, is_offline};
use o2_enterprise::enterprise::super_cluster::queue::{
    ActionScriptsQueue, AiSystemPromptQueue, AlertsQueue, DashboardsQueue, DestinationsQueue,
    FoldersQueue, MetaQueue, OrgUsersQueue, PipelinesQueue, SchedulerQueue, SchemasQueue,
    SearchJobsQueue, SuperClusterQueueTrait, TemplatesQueue,
};

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
    let org_users_queue = OrgUsersQueue {
        on_org_users_msg: org_user::process,
        on_user_msg: user::process,
        on_meta_msg: meta::process,
        on_orgs_msg: organization::process,
    };
    let ai_prompt_queue = AiSystemPromptQueue {
        on_prompt_update_msg: ai_prompt::process,
    };

    let queues: Vec<Box<dyn SuperClusterQueueTrait + Sync + Send>> = vec![
        Box::new(meta_queue),
        Box::new(schema_queue),
        Box::new(alerts_queue),
        Box::new(search_jobs_queue),
        Box::new(dashboards_queue),
        Box::new(pipelines_queue),
        Box::new(folders_queue),
        Box::new(templates_queue),
        Box::new(destinations_queue),
        Box::new(action_scripts_queue),
        Box::new(scheduler_queue),
        Box::new(org_users_queue),
        Box::new(ai_prompt_queue),
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
