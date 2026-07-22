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

use config::get_config;
use infra::{coordinator::get_coordinator, db::Event};

use super::{WorkflowTrigger, handle_workflow_trigger};

const CHECK_INTERVAL_MIN: u64 = 30;
pub const WORKFLOW_TRIGGER_PREFIX: &str = "/workflow_trigger/";

pub async fn clean() {
    let duration_limit = get_config().limit.workflow_error_retention_secs * 1_000_000;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_mins(CHECK_INTERVAL_MIN));

    loop {
        interval.tick().await;
        let limit_time = chrono::Utc::now().timestamp_micros() - duration_limit;

        let errors = match db::workflows::delete_errors_older_than(limit_time).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "error listing workflow errors older than {limit_time} for cleanup : {e}"
                );
                continue;
            }
        };
        log::info!("cleaned {errors} old entries for workflow errors");

        let runs = match db::workflows::delete_runs_older_than(limit_time).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "error listing workflow runs older than {limit_time} for cleanup : {e}"
                );
                continue;
            }
        };
        log::info!("cleaned {runs} old entries for workflow run data");
    }
}

pub async fn send_workflow_trigger(trigger: WorkflowTrigger) -> Result<(), anyhow::Error> {
    get_coordinator()
        .await
        .put(
            WORKFLOW_TRIGGER_PREFIX,
            serde_json::to_vec(&trigger)?.into(),
            true,
            None,
        )
        .await?;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled {
        match o2_enterprise::enterprise::super_cluster::queue::send_workflow_trigger(
            serde_json::to_string(&trigger)?,
        )
        .await
        {
            Ok(_) => {
                log::info!(
                    "successfully sent workflow trigger notification to super cluster queue for type: {:?} workflow_id: {} trace_id: {}",
                    trigger.trigger_type,
                    trigger.workflow_id,
                    trigger.trace_id
                );
            }
            Err(e) => {
                log::error!(
                    "error in sending workflow trigger notification to super cluster queue for type: {:?} workflow_id: {} trace_id: {} : {e}",
                    trigger.trigger_type,
                    trigger.workflow_id,
                    trigger.trace_id
                );
            }
        }
    }
    Ok(())
}

pub async fn watch_workflow_triggers() -> Result<(), anyhow::Error> {
    let mut events = get_coordinator()
        .await
        .watch(WORKFLOW_TRIGGER_PREFIX)
        .await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching workflow triggers");

    loop {
        let Some(event) = events.recv().await else {
            log::error!("watch_workflow_triggers: event channel closed");
            return Ok(());
        };

        if let Event::Put(event) = event {
            let Some(value) = event.value else {
                log::error!("watch_workflow_triggers: missing value for put");
                continue;
            };
            let Ok(trigger) = serde_json::from_slice::<WorkflowTrigger>(&value) else {
                log::error!("watch_workflow_triggers: invalid json value for put");
                continue;
            };
            handle_workflow_trigger(trigger).await;
        }
    }
}
