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
use infra::{
    coordinator::get_coordinator,
    db::{Event, get_orm_client_rw},
    table::workflow_http_trigger_requests::{
        IDEM_KEY_TTL_US, delete_terminal_before, null_idem_keys_before,
    },
};
use sea_orm::{ConnectionTrait, TransactionTrait};

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

        let now = chrono::Utc::now().timestamp_micros();
        if let Err(e) = clean_hook_ledger(get_orm_client_rw().await, now, limit_time).await {
            log::error!("error cleaning the workflow http trigger ledger : {e}");
        }
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

/// Region-local: each region's cleanup loop owns only its own ledger rows.
async fn clean_hook_ledger<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    now_us: i64,
    terminal_before_us: i64,
) -> Result<(), anyhow::Error> {
    let keys = null_idem_keys_before(db, now_us - IDEM_KEY_TTL_US).await?;
    let rows = delete_terminal_before(db, terminal_before_us).await?;
    log::info!("cleaned {keys} idempotency keys and {rows} finished http trigger runs");
    Ok(())
}

#[cfg(test)]
mod tests {
    use infra::table::workflow_http_trigger_requests::{
        self as ledger, HookRunStatus, NewHookRequest, create_tables_for_tests, get_run,
    };
    use sea_orm::{ConnectOptions, Database};

    use super::*;

    const NOW: i64 = 1_760_000_000_000_000;
    const DAY: i64 = 24 * 3600 * 1_000_000;

    fn request(run_id: &str, idem_key: &str, received_at: i64) -> NewHookRequest {
        NewHookRequest {
            trigger_id: "t1".to_string(),
            org_id: "acme".to_string(),
            workflow_id: "wf-1".to_string(),
            run_id: run_id.to_string(),
            idem_key: Some(idem_key.to_string()),
            body_sha256: "cd".repeat(32),
            body_bytes: 2,
            content_type: None,
            meta: "{}".to_string(),
            credential_id: "c1".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.7".to_string(),
            received_at,
        }
    }

    #[tokio::test]
    async fn the_cleanup_loop_clears_old_keys_and_finished_runs() {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables_for_tests(&db).await.unwrap();
        for (run_id, key, at) in [
            ("old", "k-old", NOW - 31 * DAY),
            ("day", "k-day", NOW - 2 * DAY),
        ] {
            ledger::enqueue(&db, request(run_id, key, at), "{}".to_string())
                .await
                .unwrap();
            let id = get_run(&db, "t1", run_id).await.unwrap().unwrap().id;
            ledger::finish_unclaimed(&db, id, HookRunStatus::Expired, None, at)
                .await
                .unwrap();
        }
        ledger::enqueue(&db, request("fresh", "k-fresh", NOW), "{}".to_string())
            .await
            .unwrap();

        clean_hook_ledger(&db, NOW, NOW - 30 * DAY).await.unwrap();
        assert!(get_run(&db, "t1", "old").await.unwrap().is_none());
        let day = get_run(&db, "t1", "day").await.unwrap().unwrap();
        assert_eq!(day.idem_key, None, "keys live for a day");
        let fresh = get_run(&db, "t1", "fresh").await.unwrap().unwrap();
        assert_eq!(fresh.idem_key.as_deref(), Some("k-fresh"));
    }
}
