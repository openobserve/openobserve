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

//! Alert and incident triggers. An alert firing starts the saved AutoResolves of this region that
//! wait for it, each run as the org's SysRcaAgent and approved in Slack; a firing that opens an
//! incident links its run to the incident, and one that joins an open incident starts none. A new
//! incident proposes its saved AutoResolves in Slack, and a person starts one.

use config::meta::{
    alerts::{
        AlertConditionParams, ConditionItem, ConditionList, QueryCondition, QueryType, alert::Alert,
    },
    autoresolve::{ApprovalChannel, TriggerKind},
};
use infra::table::{
    autoresolve as table, autoresolve_runs, entity::autoresolve::Model as AutoResolveRow,
};
use sea_orm::DatabaseConnection;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::OnceCell;

use super::{AutoResolveError, autoresolve_on, saved_connections, start_run_for};

/// The requester of a run no person started.
const SYSTEM_REQUESTER: &str = "system";

/// One firing: what fired, when, and what the planning turn is told about it.
pub(crate) struct Firing {
    pub kind: TriggerKind,
    /// The alert a saved trigger names.
    pub alert_id: String,
    /// The alert itself for an alert firing, the new incident for an incident.
    pub subject_id: String,
    pub fired_at_us: i64,
    pub context: Value,
    /// The incident the firing opened; its run is the incident's one live run.
    pub incident_id: Option<String>,
}

/// Where an alert firing went once incidents correlated it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FiredInto {
    /// No incident: the alert does not create them, incidents are off, or a downtime muted it.
    NoIncident,
    /// A new incident, which the firing's run works on.
    Opened(String),
    /// An incident that was open; it already has its run or a person chooses one.
    Joined,
}

impl Firing {
    /// Every node that handles this firing derives the same key, so the runs' unique key
    /// admits one run per AutoResolve and firing.
    fn key(&self, autoresolve_id: &str) -> String {
        let text = format!(
            "{autoresolve_id}\n{}\n{}\n{}",
            self.kind.as_str(),
            self.subject_id,
            self.fired_at_us
        );
        format!("{:x}", Sha256::digest(text.as_bytes()))
    }
}

/// Starts one saved AutoResolve's run for a firing; tests pass a fake.
#[async_trait::async_trait]
pub(crate) trait RunStarter: Send + Sync {
    /// `None` when `key` already started a run, on this node or another.
    async fn start(
        &self,
        org: &str,
        flow: &AutoResolveRow,
        firing: &Firing,
        key: String,
    ) -> Result<Option<String>, AutoResolveError>;
}

/// The production [RunStarter]; the SysRcaAgent is ensured once per firing, and only when an
/// AutoResolve is about to start.
#[derive(Default)]
struct LiveStarter {
    identity: OnceCell<String>,
}

#[async_trait::async_trait]
impl RunStarter for LiveStarter {
    async fn start(
        &self,
        org: &str,
        flow: &AutoResolveRow,
        firing: &Firing,
        key: String,
    ) -> Result<Option<String>, AutoResolveError> {
        let identity = self
            .identity
            .get_or_try_init(|| sys_rca_identity(org))
            .await?;
        let connections = saved_connections(flow)?;
        start_run_for(
            org,
            &flow.goal,
            &connections,
            SYSTEM_REQUESTER,
            identity,
            firing.kind,
            Some(firing.context.clone()),
            ApprovalChannel::Slack,
            key,
            Some(flow.id.clone()),
            firing.incident_id.clone(),
        )
        .await
    }
}

/// Starts, in the background, the runs a delivered alert firing asks for; never fails or
/// waits on the alert path.
pub fn on_alert_fired(alert: &Alert, fired_at_us: i64, into: FiredInto) {
    let Some(alert_id) = alert.id.as_ref().map(|id| id.to_string()) else {
        return;
    };
    let Some(incident_id) = run_incident(into) else {
        log::debug!("[autoresolve] alert {alert_id} joined an open incident; it starts no run");
        return;
    };
    if !autoresolve_on() {
        return;
    }
    let mut context = alert_context(alert, fired_at_us);
    if let Some(id) = &incident_id {
        context["incident_id"] = id.clone().into();
    }
    let firing = Firing {
        kind: TriggerKind::Alert,
        alert_id: alert_id.clone(),
        subject_id: alert_id,
        fired_at_us,
        context,
        incident_id,
    };
    let org = alert.org_id.clone();
    tokio::spawn(async move { fire(&org, &firing).await });
}

/// The incident an alert firing's run works on; `None` when the firing starts no run.
fn run_incident(into: FiredInto) -> Option<Option<String>> {
    match into {
        FiredInto::NoIncident => Some(None),
        FiredInto::Opened(id) => Some(Some(id)),
        FiredInto::Joined => None,
    }
}

/// Proposes, in the background, the AutoResolves a new incident asks for; `alert_id` is the
/// alert that created it. Nothing runs until a person starts one.
pub fn on_incident_created(org: &str, incident_id: &str, alert_id: &str) {
    if !autoresolve_on() {
        return;
    }
    let (org, incident_id, alert_id) = (
        org.to_string(),
        incident_id.to_string(),
        alert_id.to_string(),
    );
    tokio::spawn(async move { propose(&org, &incident_id, &alert_id).await });
}

async fn propose(org: &str, incident_id: &str, alert_id: &str) {
    let region = crate::downtimes::notify::this_region();
    let listed = |kind| table::list_triggered(org, &region, kind, alert_id);
    let (proposed, starts) = match (
        listed(TriggerKind::Incident).await,
        listed(TriggerKind::Alert).await,
    ) {
        (Ok(p), Ok(s)) => (p, s),
        (Err(e), _) | (_, Err(e)) => {
            log::warn!("[autoresolve] {org}: could not read the triggered AutoResolves: {e}");
            return;
        }
    };
    if !posts_proposals(&proposed, &starts) {
        if !proposed.is_empty() {
            log::info!(
                "[autoresolve] {org}: incident {incident_id} gets its run from alert {alert_id}'s own AutoResolve; no proposal posted"
            );
        }
        return;
    }
    let incident = match infra::table::alert_incidents::get_rw(org, incident_id).await {
        Ok(Some(incident)) => incident,
        Ok(None) => return,
        Err(e) => {
            log::warn!("[autoresolve] {org}: could not read incident {incident_id}: {e}");
            return;
        }
    };
    let alert_name = match alert_id.parse::<svix_ksuid::Ksuid>() {
        Ok(id) => crate::alerts::alert::get_by_id_db(org, id)
            .await
            .ok()
            .map(|a| a.name),
        Err(_) => None,
    };
    for flow in &proposed {
        super::slack::propose(org, flow, &incident, alert_name.clone()).await;
    }
}

/// An enabled alert-triggered AutoResolve on the same alert already starts the incident's run,
/// so a proposal would only offer a second one that the incident refuses.
fn posts_proposals<T>(proposed: &[T], starts: &[T]) -> bool {
    !proposed.is_empty() && starts.is_empty()
}

/// Starts a run of each enabled AutoResolve of `region` that waits for this firing, unless one of
/// its runs has not ended yet.
pub(crate) async fn fire_with(
    db: &DatabaseConnection,
    starter: &dyn RunStarter,
    org: &str,
    region: &str,
    firing: &Firing,
) {
    let flows =
        match table::list_triggered_with(db, org, region, firing.kind, &firing.alert_id).await {
            Ok(flows) => flows,
            Err(e) => {
                log::warn!("[autoresolve] {org}: could not read the triggered AutoResolves: {e}");
                return;
            }
        };
    for flow in &flows {
        start_one(db, starter, org, flow, firing).await;
    }
}

async fn fire(org: &str, firing: &Firing) {
    let db = infra::db::get_orm_client_rw().await;
    let region = crate::downtimes::notify::this_region();
    fire_with(db, &LiveStarter::default(), org, &region, firing).await;
}

async fn start_one(
    db: &DatabaseConnection,
    starter: &dyn RunStarter,
    org: &str,
    flow: &AutoResolveRow,
    firing: &Firing,
) {
    match autoresolve_runs::live_for_autoresolve_with(db, org, &flow.id).await {
        Ok(None) => {}
        Ok(Some(run)) => {
            log::info!(
                "[autoresolve] {org}/{}: run {} has not ended, so this firing starts none",
                flow.id,
                run.id
            );
            return;
        }
        Err(e) => {
            log::warn!(
                "[autoresolve] {org}/{}: could not read its runs: {e}",
                flow.id
            );
            return;
        }
    }
    match starter.start(org, flow, firing, firing.key(&flow.id)).await {
        Ok(Some(run_id)) => log::info!("[autoresolve] {org}/{}: started run {run_id}", flow.id),
        Ok(None) => log::debug!(
            "[autoresolve] {org}/{}: already started, or a run is in progress",
            flow.id
        ),
        Err(AutoResolveError::IncidentHasRun(run)) => log::info!(
            "[autoresolve] {org}/{}: the incident already has run {run}",
            flow.id
        ),
        Err(e) => log::warn!(
            "[autoresolve] {org}/{}: triggered run not started: {e}",
            flow.id
        ),
    }
}

async fn sys_rca_identity(org: &str) -> Result<String, AutoResolveError> {
    crate::organization::ensure_sys_rca_agent(org).await?;
    Ok(crate::organization::sre_agent_email(org))
}

/// The keys RCA's alert context uses, plus when it fired, the condition that matched, and the
/// query with the fields it reads.
fn alert_context(alert: &Alert, fired_at_us: i64) -> Value {
    let condition = &alert.trigger_condition;
    let query = &alert.query_condition;
    json!({
        "subject_type": "alert",
        "subject_id": alert.id.as_ref().map(|id| id.to_string()),
        "alert_name": alert.name,
        "stream": alert.stream_name,
        "stream_type": alert.stream_type,
        "severity": alert.priority,
        "fired_at_us": fired_at_us,
        "condition": {
            "operator": condition.operator,
            "threshold": condition.threshold,
            "period_minutes": condition.period,
        },
        "query": alert_query(query),
        "fields": alert_fields(query),
    })
}

/// Only the parts the alert's query type evaluates; a type switch in the editor leaves the
/// others stored.
fn alert_query(query: &QueryCondition) -> Value {
    let (sql, promql, custom) = match query.query_type {
        QueryType::SQL => (true, false, false),
        QueryType::PromQL => (false, true, false),
        QueryType::Custom => (false, false, true),
        QueryType::Slo => (false, false, false),
    };
    json!({
        "type": query.query_type.to_string(),
        "sql": query.sql.as_ref().filter(|_| sql),
        "promql": query.promql.as_ref().filter(|_| promql),
        "promql_condition": query.promql_condition.as_ref().filter(|_| promql),
        "conditions": query.conditions.as_ref().filter(|_| custom),
        "aggregation": query.aggregation.as_ref().filter(|_| custom),
    })
}

/// The columns a custom alert filters, groups by or aggregates, each once; SQL and PromQL
/// alerts name theirs inside the query text.
fn alert_fields(query: &QueryCondition) -> Vec<String> {
    let mut fields = Vec::new();
    if query.query_type != QueryType::Custom {
        return fields;
    }
    match &query.conditions {
        Some(AlertConditionParams::V1(list)) => list_columns(list, &mut fields),
        Some(AlertConditionParams::V2(group)) => item_columns(&group.conditions, &mut fields),
        None => {}
    }
    if let Some(aggregation) = &query.aggregation {
        let group_by = aggregation.group_by.iter().flatten();
        for column in group_by.chain(std::iter::once(&aggregation.having.column)) {
            push_field(&mut fields, column);
        }
    }
    fields
}

fn list_columns(list: &ConditionList, out: &mut Vec<String>) {
    match list {
        ConditionList::OrNode { or: nodes } | ConditionList::AndNode { and: nodes } => {
            nodes.iter().for_each(|node| list_columns(node, out));
        }
        ConditionList::NotNode { not } => list_columns(not, out),
        ConditionList::LegacyConditions(conditions) => {
            conditions.iter().for_each(|c| push_field(out, &c.column));
        }
        ConditionList::EndCondition(c) => push_field(out, &c.column),
    }
}

fn item_columns(items: &[ConditionItem], out: &mut Vec<String>) {
    for item in items {
        match item {
            ConditionItem::Condition(c) => push_field(out, &c.column),
            ConditionItem::Group { conditions, .. } => item_columns(conditions, out),
        }
    }
}

fn push_field(out: &mut Vec<String>, column: &str) {
    let column = column.trim();
    if !column.is_empty() && !out.iter().any(|f| f == column) {
        out.push(column.to_string());
    }
}

/// What the planning turn of a run started on an incident is told about it; the incident must be
/// the org's.
pub(crate) async fn incident_context(
    org: &str,
    incident_id: &str,
) -> Result<Value, AutoResolveError> {
    let incident = infra::table::alert_incidents::get_rw(org, incident_id)
        .await?
        .ok_or(AutoResolveError::IncidentNotFound)?;
    Ok(json!({
        "subject_type": "incident",
        "subject_id": incident_id,
        "incident_id": incident_id,
        "title": incident.title,
        "severity": incident.severity,
    }))
}

#[cfg(test)]
mod tests {
    use config::meta::autoresolve::RunState;
    use infra::table::{
        autoresolve::NewAutoResolve,
        autoresolve_runs::RunPatch,
        entity::autoresolve_runs::{Column, Entity as Runs},
    };
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    use super::*;
    use crate::autoresolve::{
        launch_row, record_run_with,
        test_support::{ORG, memory_db},
    };

    const ALERT: &str = "alert-1";
    const FIRST: i64 = 1_000;

    /// Records the row `start_run_for` builds in the test database, without a turn.
    struct DbStarter<'a> {
        db: &'a DatabaseConnection,
    }

    #[async_trait::async_trait]
    impl RunStarter for DbStarter<'_> {
        async fn start(
            &self,
            org: &str,
            flow: &AutoResolveRow,
            firing: &Firing,
            key: String,
        ) -> Result<Option<String>, AutoResolveError> {
            let new = launch_row(
                org,
                &flow.goal,
                &saved_connections(flow)?,
                SYSTEM_REQUESTER,
                SYSTEM_REQUESTER,
                firing.kind,
                Some(firing.context.clone()),
                ApprovalChannel::Slack,
                key,
                Some(flow.id.clone()),
                firing.incident_id.clone(),
            )?;
            Ok(record_run_with(self.db, new).await?.map(|run| run.id))
        }
    }

    struct Row {
        name: &'static str,
        saved: (&'static str, TriggerKind, bool),
        earlier: Option<RunState>,
        fired: (TriggerKind, &'static str, i64),
        /// The firing passed the live check before the earlier run was recorded.
        raced: bool,
        runs: u64,
    }

    fn firing(kind: TriggerKind, alert_id: &str, at: i64) -> Firing {
        Firing {
            kind,
            alert_id: alert_id.to_string(),
            subject_id: format!("{}-{alert_id}", kind.as_str()),
            fired_at_us: at,
            context: json!({}),
            incident_id: None,
        }
    }

    #[tokio::test]
    async fn a_trigger_starts_one_run_per_firing() {
        use TriggerKind::Alert as A;
        let rows = [
            Row {
                name: "first fire",
                saved: ("r1", A, true),
                earlier: None,
                fired: (A, ALERT, FIRST),
                raced: false,
                runs: 1,
            },
            Row {
                name: "same firing on a second node after its run ended",
                saved: ("r1", A, true),
                earlier: Some(RunState::Failed),
                fired: (A, ALERT, FIRST),
                raced: false,
                runs: 1,
            },
            Row {
                name: "later firing after the run ended",
                saved: ("r1", A, true),
                earlier: Some(RunState::Failed),
                fired: (A, ALERT, FIRST + 1),
                raced: false,
                runs: 2,
            },
            Row {
                name: "later firing while the run waits for approval",
                saved: ("r1", A, true),
                earlier: Some(RunState::WaitingApproval),
                fired: (A, ALERT, FIRST + 1),
                raced: false,
                runs: 1,
            },
            Row {
                name: "two firings on two nodes both past the live check",
                saved: ("r1", A, true),
                earlier: Some(RunState::Investigating),
                fired: (A, ALERT, FIRST + 1),
                raced: true,
                runs: 1,
            },
            Row {
                name: "saved in another region",
                saved: ("r2", A, true),
                earlier: None,
                fired: (A, ALERT, FIRST),
                raced: false,
                runs: 0,
            },
            Row {
                name: "trigger off",
                saved: ("r1", A, false),
                earlier: None,
                fired: (A, ALERT, FIRST),
                raced: false,
                runs: 0,
            },
        ];
        for row in rows {
            let db = memory_db().await;
            let starter = DbStarter { db: &db };
            let (region, kind, enabled) = row.saved;
            let flow = table::insert_with(&db, saved(region, kind, enabled))
                .await
                .unwrap();
            if let Some(state) = row.earlier {
                fire_with(&db, &starter, ORG, "r1", &firing(kind, ALERT, FIRST)).await;
                let run = autoresolve_runs::live_for_autoresolve_with(&db, ORG, &flow.id)
                    .await
                    .unwrap()
                    .expect("the earlier firing started a run");
                let (from, patch) = ([RunState::Investigating], RunPatch::default());
                autoresolve_runs::set_state_with(&db, ORG, &run.id, &from, state, patch)
                    .await
                    .unwrap();
            }
            let (kind, alert_id, at) = row.fired;
            let fired = firing(kind, alert_id, at);
            if row.raced {
                let started = starter.start(ORG, &flow, &fired, fired.key(&flow.id)).await;
                assert!(matches!(started, Ok(None)), "{}: {started:?}", row.name);
            } else {
                fire_with(&db, &starter, ORG, "r1", &fired).await;
            }
            let runs = Runs::find()
                .filter(Column::AutoresolveId.eq(flow.id.as_str()))
                .all(&db)
                .await
                .unwrap();
            assert_eq!(runs.len() as u64, row.runs, "{}", row.name);
            for run in &runs {
                let copied = (run.connection_ids.as_str(), run.connection_names.as_str());
                let saved = (flow.connection_ids.as_str(), flow.connection_names.as_str());
                assert_eq!(
                    copied, saved,
                    "{}: the run keeps the AutoResolve's list",
                    row.name
                );
            }
        }
    }

    #[test]
    fn a_firing_starts_a_run_unless_it_joined_an_open_incident() {
        let cases = [
            (FiredInto::NoIncident, Some(None)),
            (
                FiredInto::Opened("inc-1".into()),
                Some(Some("inc-1".to_string())),
            ),
            (FiredInto::Joined, None),
        ];
        for (into, want) in cases {
            assert_eq!(run_incident(into.clone()), want, "{into:?}");
        }
    }

    #[tokio::test]
    async fn the_incident_a_firing_opened_gets_one_run() {
        let db = memory_db().await;
        let starter = DbStarter { db: &db };
        let first = table::insert_with(&db, saved("r1", TriggerKind::Alert, true))
            .await
            .unwrap();
        let mut second = saved("r1", TriggerKind::Alert, true);
        second.id = "flow-2".into();
        second.name = "second flow".into();
        let second = table::insert_with(&db, second).await.unwrap();
        let mut fired = firing(TriggerKind::Alert, ALERT, FIRST);
        fired.incident_id = Some("inc-1".into());
        fire_with(&db, &starter, ORG, "r1", &fired).await;
        let runs = Runs::find()
            .filter(Column::IncidentId.eq("inc-1"))
            .all(&db)
            .await
            .unwrap();
        assert_eq!(
            runs.len(),
            1,
            "two flows on the alert, one run on its incident"
        );
        let run_of = runs[0].autoresolve_id.as_deref();
        assert!(run_of == Some(first.id.as_str()) || run_of == Some(second.id.as_str()));

        let mut later = firing(TriggerKind::Alert, ALERT, FIRST + 1);
        later.incident_id = Some("inc-2".into());
        fire_with(&db, &starter, ORG, "r1", &later).await;
        let other = Runs::find()
            .filter(Column::IncidentId.eq("inc-2"))
            .all(&db)
            .await
            .unwrap();
        assert_eq!(
            other.len(),
            1,
            "another incident gets its own run from the free flow"
        );
    }

    #[test]
    fn an_incident_proposes_only_when_its_alert_starts_no_run() {
        let (incident, alert, none): ([&str; 1], [&str; 1], [&str; 0]) =
            (["incident flow"], ["alert flow"], []);
        assert!(posts_proposals(&incident, &none));
        assert!(
            !posts_proposals(&incident, &alert),
            "the alert's flow starts the run"
        );
        assert!(!posts_proposals(&none, &none));
    }

    #[test]
    fn alert_context_carries_the_query_its_type_evaluates() {
        let sql = json!({"type": "sql", "sql": "SELECT count(*) FROM shop", "conditions": null,
            "promql": "stale", "promql_condition": null, "aggregation": null});
        let promql = json!({"type": "promql", "sql": "stale", "promql": "rate(errors[5m])",
            "promql_condition": {"column": "value", "operator": ">=", "value": 1},
            "conditions": null, "aggregation": null});
        let having = json!({"column": "took", "operator": ">", "value": 500});
        let custom = json!({"type": "custom", "sql": null, "promql": null, "promql_condition": null,
            "conditions": {"or": [{"column": "status", "operator": ">=", "value": 500},
                {"and": [{"column": "path", "operator": "=", "value": "/pay"}]}]},
            "aggregation": {"group_by": ["path", "pod"], "function": "avg", "having": having}});
        let v2 = json!({"type": "custom", "sql": null, "promql": null, "promql_condition": null,
            "aggregation": null, "conditions": {"version": 2, "conditions": {"filterType": "group",
            "logicalOperator": "AND", "conditions": [{"filterType": "condition", "column": "level",
            "operator": "=", "value": "error", "logicalOperator": "AND"}]}}});
        let slo = json!({"type": "slo", "sql": "stale", "promql": null, "promql_condition": null,
            "conditions": null, "aggregation": null});
        #[rustfmt::skip]
        let cases = [
            ("sql", sql, json!(["sql", "SELECT count(*) FROM shop", null, false, []])),
            ("promql", promql, json!(["promql", null, "rate(errors[5m])", false, []])),
            ("custom", custom, json!(["custom", null, null, true, ["status", "path", "pod", "took"]])),
            ("v2 conditions", v2, json!(["custom", null, null, true, ["level"]])),
            ("slo", slo, json!(["slo", null, null, false, []])),
        ];
        for (name, query, want) in cases {
            let mut alert = Alert::default();
            alert.query_condition = serde_json::from_value(query).unwrap();
            let c = alert_context(&alert, FIRST);
            let q = &c["query"];
            let got = json!([
                q["type"],
                q["sql"],
                q["promql"],
                !q["conditions"].is_null(),
                c["fields"]
            ]);
            assert_eq!(got, want, "{name}");
            assert_eq!(c["fired_at_us"], FIRST, "{name}");
        }
    }

    fn saved(region: &str, kind: TriggerKind, enabled: bool) -> NewAutoResolve {
        NewAutoResolve {
            id: autoresolve_runs::new_run_id(),
            org: ORG.to_string(),
            region: region.to_string(),
            name: "Restart stuck deploys".to_string(),
            goal: "restart the stuck deploy".to_string(),
            connection_ids: r#"["c1","c2"]"#.to_string(),
            connection_names: r#"{"c1":"code-host","c2":"k8s"}"#.to_string(),
            trigger_kind: kind,
            trigger_alert_id: Some(ALERT.to_string()),
            trigger_enabled: enabled,
            trigger_approved_by: enabled.then(|| "ada@example.com".to_string()),
            trigger_approved_at_us: enabled.then_some(1),
            created_by: "ada@example.com".to_string(),
            from_run_id: None,
            now_us: 1,
        }
    }
}
