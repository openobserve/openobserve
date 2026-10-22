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

//! Own test binary: it sets the hook concurrency to one before the process reads its config.

#![cfg(feature = "enterprise")]

use std::time::Duration;

use config::{cluster::LOCAL_NODE, utils::time::now_micros};
use infra::{
    db::get_orm_client_rw,
    table::{
        workflow_http_trigger_requests::{self as ledger, LedgerInsert, NewHookRequest},
        workflows::{self, Workflow},
    },
};
use openobserve_core::workflows::{http_trigger::worker, runtime, trigger_workflow};

const ORG: &str = "acme";

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-hook-isolation-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("O2_WORKFLOWS_ENABLED", "true");
    set_env("O2_WORKFLOW_HOOKS_ENABLED", "true");
    set_env("ZO_WORKFLOW_HOOK_CONCURRENCY", "1");
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
}

fn workflow(id: &str) -> Workflow {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "org_id": ORG,
        "created_at": 0,
        "updated_at": 0,
        "created_by": "a@acme.io",
        "enabled": true,
        "name": id,
        "description": "",
        "nodes": [
            {
                "id": "trigger-1",
                "data": {"node_type": "workflow_trigger"},
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "dest-1",
                "data": {"node_type": "destination", "destination_id": "absent", "template_override": null},
                "position": {"x": 400, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": "e1", "source": "trigger-1", "target": "dest-1"}],
    }))
    .unwrap()
}

fn hook_request(run_id: &str) -> NewHookRequest {
    NewHookRequest {
        trigger_id: "t1".to_string(),
        org_id: ORG.to_string(),
        workflow_id: "wf-hook".to_string(),
        run_id: run_id.to_string(),
        idem_key: None,
        body_sha256: "cd".repeat(32),
        body_bytes: 2,
        content_type: Some("application/json".to_string()),
        meta: "{}".to_string(),
        credential_id: "c1".to_string(),
        credential_prefix: "o2wh_abcd…wxyz".to_string(),
        caller_ip: "203.0.113.7".to_string(),
        received_at: now_micros(),
    }
}

async fn status_of(run_id: &str) -> String {
    ledger::get_run(get_orm_client_rw().await, "t1", run_id)
        .await
        .unwrap()
        .unwrap()
        .status
}

/// The hook lane holds its one slot with a running row and has more queued behind it.
async fn saturate_the_hook_lane() {
    let rw = get_orm_client_rw().await;
    for run_id in ["hook-slow", "hook-queued-1", "hook-queued-2"] {
        let inserted = ledger::enqueue(rw, hook_request(run_id), r#"{"meta":{},"data":[]}"#.into())
            .await
            .unwrap();
        assert!(matches!(inserted, LedgerInsert::Inserted));
    }
    let slow = ledger::get_run(rw, "t1", "hook-slow")
        .await
        .unwrap()
        .unwrap();
    assert!(
        ledger::claim(rw, slow.id, &LOCAL_NODE.uuid, now_micros())
            .await
            .unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_manual_run_completes_while_the_hook_lane_is_saturated() {
    boot().await;
    workflows::save_workflow(workflow("wf-hook")).await.unwrap();
    workflows::save_workflow(workflow("wf-manual"))
        .await
        .unwrap();
    saturate_the_hook_lane().await;
    tokio::spawn(runtime::watch_workflow_triggers());
    tokio::spawn(worker::run_supervisor());

    let mut beating = false;
    for _ in 0..100 {
        if worker::heartbeat_is_fresh().await {
            beating = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        beating,
        "the hook worker took the lock and writes its heartbeat"
    );

    let run = trigger_workflow(
        ORG,
        "wf-manual",
        vec![serde_json::json!({"k": 1})],
        "a@acme.io",
    )
    .await
    .unwrap();
    let mut finished = false;
    for _ in 0..300 {
        let pending = workflows::get_run_data(ORG, "wf-manual", &run.run_id)
            .await
            .unwrap();
        if pending.is_none() {
            finished = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        finished,
        "the manual run never finished behind the full hook lane"
    );

    assert_eq!(status_of("hook-slow").await, "running");
    assert_eq!(status_of("hook-queued-1").await, "queued");
    assert_eq!(status_of("hook-queued-2").await, "queued");
}
