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

//! Fakes and an in-memory meta store shared by the AutoResolve engine tests.

use std::sync::Mutex;

use config::meta::autoresolve::{StepState, TriggerKind};
use infra::table::{
    autoresolve_runs::{self, NewRun},
    autoresolve_steps::NewStep,
    entity::{autoresolve_runs::Model as RunRow, autoresolve_steps::Model as StepRow},
};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};

use super::{AutoResolveError, TurnLauncher};

pub(crate) const ORG: &str = "acme";

/// Records the turns a test asked for instead of starting them.
#[derive(Default)]
pub(crate) struct RecordingTurns {
    pub planned: Mutex<usize>,
    pub executed: Mutex<Vec<Vec<String>>>,
    pub checked: Mutex<Vec<String>>,
    pub cancelled: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl TurnLauncher for RecordingTurns {
    async fn planning(&self, _run: &RunRow, _note: Option<&str>) -> Result<(), AutoResolveError> {
        *self.planned.lock().unwrap() += 1;
        Ok(())
    }

    async fn execute(&self, run: &RunRow, steps: &[StepRow]) -> Result<(), AutoResolveError> {
        assert_eq!(run.state, "proceeding", "launched with the row as written");
        let ids = steps.iter().map(|s| s.id.clone()).collect();
        self.executed.lock().unwrap().push(ids);
        Ok(())
    }

    async fn check(&self, run: &RunRow, _steps: &[StepRow]) -> Result<(), AutoResolveError> {
        assert_eq!(run.state, "checking", "launched with the row as written");
        self.checked.lock().unwrap().push(run.id.clone());
        Ok(())
    }

    async fn cancel(&self, run: &RunRow) {
        self.cancelled.lock().unwrap().push(run.id.clone());
    }
}

/// One connection, because each in-memory SQLite connection is a database of its own.
pub(crate) async fn memory_db() -> DatabaseConnection {
    let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1);
    let db = Database::connect(opts).await.unwrap();
    autoresolve_runs::create_tables_for_tests(&db)
        .await
        .unwrap();
    db
}

/// A person-started run in [ORG], region `r1`, investigating at revision 1, over `c1`
/// "code-host" and `c2` "k8s".
pub(crate) fn new_run(id: &str) -> NewRun {
    NewRun {
        id: id.into(),
        org: ORG.into(),
        region: "r1".into(),
        autoresolve_id: None,
        goal: "restart the stuck deploy".into(),
        connection_ids: r#"["c1","c2"]"#.into(),
        connection_names: r#"{"c1":"code-host","c2":"k8s"}"#.into(),
        trigger_kind: TriggerKind::Person,
        trigger_context: None,
        requester: "rita@example.com".into(),
        turn_identity: "rita@example.com".into(),
        session_id: format!("session-{id}"),
        approval_channel: "screen".into(),
        turn_deadline_us: None,
        idempotency_key: id.into(),
        now_us: 1,
    }
}

/// A proposed change step of revision 1 of `run_id`, using `connection_id` under its `key`.
pub(crate) fn new_step(
    run_id: &str,
    id: &str,
    option: &str,
    seq: i32,
    connection_id: &str,
    key: &str,
) -> NewStep {
    NewStep {
        id: id.into(),
        org: ORG.into(),
        run_id: run_id.into(),
        revision: 1,
        option_id: Some(option.into()),
        seq,
        kind: "change".into(),
        connection_id: connection_id.into(),
        connection_name: key.into(),
        tool: "restart".into(),
        arguments: "{}".into(),
        refs: "[]".into(),
        args_hash: format!("h-{id}"),
        reason: "stuck".into(),
        preview: None,
        tool_def_hash: "d1".into(),
        connection_fingerprint: None,
        state: StepState::Proposed,
        result: None,
        result_raw: None,
        consumed_at_us: None,
        finished_at_us: None,
        created_at_us: 1,
    }
}
