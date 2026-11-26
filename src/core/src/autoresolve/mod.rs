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

//! AutoResolve: the deployment and licence gate, starting a run, and the one function every run
//! state change goes through.

pub mod approve;
pub mod consume;
pub mod corrections;
pub(crate) mod evidence;
mod grading;
pub mod incident;
pub mod live;
pub mod plan;
pub mod saved;
mod slack;
pub mod sweep;
#[cfg(test)]
mod test_support;
pub mod triggers;
pub(crate) mod turn;

use std::collections::{BTreeMap, HashMap, HashSet};

use config::{
    meta::{
        autoresolve::{
            ApprovalChannel, RunState, StepState, TriggerKind, capitalized, mcp_count, named_mcps,
        },
        feature::Feature,
    },
    utils::time::now_micros,
};
use infra::{
    errors::{DbError, Error as InfraError},
    table::{
        autoresolve_runs::{self, NewRun, RunPatch},
        autoresolve_steps,
        entity::{
            autoresolve::Model as AutoResolveRow, autoresolve_runs::Model as RunRow,
            autoresolve_steps::Model as StepRow,
        },
        org_ai_toolsets,
    },
};
use o2_enterprise::enterprise::{
    ai::toolsets::{AutoResolveConnection, ToolsetKind, autoresolve_connection},
    common::config::get_config as get_o2_config,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde_json::Value;
pub(crate) use turn::{LiveTurns, TurnLauncher, spawn_planning_turn};

use self::live::AutoResolveConnectionRef;

/// The longest goal a run or a saved AutoResolve takes.
pub const MAX_GOAL_CHARS: usize = 4000;
// `autoresolve::token::mint` refuses lifetimes over an hour, so a longer turn outlives its token.
const MAX_TOKEN_TTL_SECS: u64 = 3600;
/// Other runs' changes a waiting run or its turns are told about, newest first.
const CHANGES_SHOWN: usize = 20;

/// Why a run did not start or a turn did not launch; each message is one sentence a person reads.
#[derive(Debug, thiserror::Error)]
pub enum AutoResolveError {
    #[error("AutoResolve is not enabled.")]
    NotEnabled,
    #[error("No MCP is registered for this run.")]
    NoConnections,
    #[error("This AutoResolve's MCPs were deleted; edit it to choose others.")]
    ConnectionsGone,
    #[error(transparent)]
    Connections(ConnectionRefusal),
    #[error("{0}")]
    Admission(String),
    #[error("{0}")]
    Turn(String),
    #[error("This step is not running.")]
    StepNotRunning,
    #[error("Another run of this AutoResolve is in progress; finish it first.")]
    RunInProgress,
    /// One live run per incident; the field is that run's id.
    #[error("AutoResolve run {0} is already live on this incident; finish it first.")]
    IncidentHasRun(String),
    #[error("Incident not found.")]
    IncidentNotFound,
    #[error(transparent)]
    Db(#[from] anyhow::Error),
}

impl From<InfraError> for AutoResolveError {
    fn from(e: InfraError) -> Self {
        Self::Db(e.into())
    }
}

impl From<sea_orm::DbErr> for AutoResolveError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Db(e.into())
    }
}

impl From<ConnectionRefusal> for AutoResolveError {
    fn from(e: ConnectionRefusal) -> Self {
        match e {
            ConnectionRefusal::Db(e) => Self::Db(e),
            e => Self::Connections(e),
        }
    }
}

/// Why a chosen connection list was refused; runs and saved AutoResolves share these sentences.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionRefusal {
    #[error("Choose at least one MCP.")]
    NoneChosen,
    #[error("Choose at most {}.", mcp_count(*.0))]
    TooMany(usize),
    #[error("A chosen MCP no longer exists. Choose your MCPs again.")]
    Unknown,
    #[error("{} is not an MCP. Choose an MCP.", connection.name)]
    NotMcp {
        connection: AutoResolveConnectionRef,
    },
    #[error("{}", removed_text(connections))]
    Removed {
        connections: Vec<AutoResolveConnectionRef>,
    },
    #[error(transparent)]
    Db(anyhow::Error),
}

/// Looks up a connection by id or connection key; tests pass a fixture that needs no
/// encryption keys.
#[async_trait::async_trait]
pub(crate) trait ConnectionSource: Send + Sync {
    async fn get(
        &self,
        org: &str,
        name_or_id: &str,
    ) -> anyhow::Result<Option<AutoResolveConnection>>;

    /// The toolset with this id of any kind, as its name and whether it is an MCP connection.
    async fn toolset(&self, org: &str, id: &str) -> anyhow::Result<Option<(String, bool)>> {
        let found = self.get(org, id).await?.filter(|c| c.id == id);
        Ok(found.map(|c| (c.name, true)))
    }
}

/// The production [ConnectionSource]: the org's registered MCP toolsets.
pub(crate) struct LiveConnections;

#[async_trait::async_trait]
impl ConnectionSource for LiveConnections {
    async fn get(
        &self,
        org: &str,
        name_or_id: &str,
    ) -> anyhow::Result<Option<AutoResolveConnection>> {
        autoresolve_connection(org, name_or_id).await
    }

    async fn toolset(&self, org: &str, id: &str) -> anyhow::Result<Option<(String, bool)>> {
        let found = org_ai_toolsets::get(org, id).await?.filter(|t| t.id == id);
        Ok(found.map(|t| {
            let mcp = t.kind.parse::<ToolsetKind>() == Ok(ToolsetKind::Mcp);
            (t.name, mcp)
        }))
    }
}

/// A [ConnectionSource] that hides the toolsets outside `permitted`, so choosing one is refused
/// as an unknown one is; `None` permits every toolset.
struct Listable<'a> {
    source: &'a dyn ConnectionSource,
    permitted: Option<Vec<String>>,
}

impl Listable<'_> {
    fn permits(&self, org: &str, id: &str) -> bool {
        approve::is_permitted(org, id, self.permitted.as_deref())
    }
}

#[async_trait::async_trait]
impl ConnectionSource for Listable<'_> {
    async fn get(
        &self,
        org: &str,
        name_or_id: &str,
    ) -> anyhow::Result<Option<AutoResolveConnection>> {
        let found = self.source.get(org, name_or_id).await?;
        Ok(found.filter(|c| self.permits(org, &c.id)))
    }

    async fn toolset(&self, org: &str, id: &str) -> anyhow::Result<Option<(String, bool)>> {
        let found = self.source.toolset(org, id).await?;
        Ok(found.filter(|_| self.permits(org, id)))
    }
}

/// The one definition of the gate: `/config`, the router and every handler call this.
pub fn autoresolve_on() -> bool {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    if !cfg.autoresolve.enabled {
        return false;
    }
    gate_open(
        cfg.autoresolve.enabled,
        o2_enterprise::enterprise::license::check_features(&[Feature::Autoresolve]),
        o2_enterprise::enterprise::slack::token::configured_keys().is_ok(),
        !cfg.ai.internal_secret.is_empty(),
    )
}

/// A run a person starts on screen, as that person, over the connections they chose.
pub async fn start_person_run(
    org: &str,
    user_email: &str,
    goal: &str,
    connection_ids: &[String],
    incident_id: Option<String>,
) -> Result<String, AutoResolveError> {
    let source = Listable {
        source: &LiveConnections,
        permitted: approve::permitted_connections(org, user_email, "LIST").await?,
    };
    let connections = validate_connections(&source, org, connection_ids, &HashMap::new()).await?;
    let context = match &incident_id {
        Some(id) => Some(triggers::incident_context(org, id).await?),
        None => None,
    };
    let started = start_run_for(
        org,
        goal,
        &connections,
        user_email,
        user_email,
        TriggerKind::Person,
        context,
        ApprovalChannel::Screen,
        autoresolve_runs::new_run_id(),
        None,
        incident_id,
    )
    .await?;
    started.ok_or_else(|| AutoResolveError::Db(anyhow::anyhow!("a new run id was already taken")))
}

/// Records the run with its connections and launches its planning turn; `None` when
/// `idempotency_key` already started one or the AutoResolve has a live run.
#[allow(clippy::too_many_arguments)]
pub async fn start_run_for(
    org: &str,
    goal: &str,
    connections: &[AutoResolveConnectionRef],
    requester: &str,
    turn_identity: &str,
    trigger: TriggerKind,
    trigger_context: Option<Value>,
    approval_channel: ApprovalChannel,
    idempotency_key: String,
    autoresolve_id: Option<String>,
    incident_id: Option<String>,
) -> Result<Option<String>, AutoResolveError> {
    if !autoresolve_on() {
        return Err(AutoResolveError::NotEnabled);
    }
    let ids: Vec<String> = connections.iter().map(|c| c.id.clone()).collect();
    match turn::load_tools(org, &ids).await {
        Err(AutoResolveError::NoConnections) if autoresolve_id.is_some() => {
            return Err(AutoResolveError::ConnectionsGone);
        }
        loaded => loaded?,
    };
    let new = launch_row(
        org,
        goal,
        connections,
        requester,
        turn_identity,
        trigger,
        trigger_context,
        approval_channel,
        idempotency_key,
        autoresolve_id,
        incident_id.clone(),
    )?;
    let db = infra::db::get_orm_client_rw().await;
    let Some(run) = record_run_with(db, new).await? else {
        return match incident_id {
            Some(id) => incident_refusal(db, org, &id).await,
            None => Ok(None),
        };
    };
    if let Err(e) = spawn_planning_turn(&run, None, true).await {
        fail_unstarted(&run, &e).await;
        return Err(e);
    }
    Ok(Some(run.id))
}

/// The row [start_run_for] records; the run keeps the connections it launched with.
#[allow(clippy::too_many_arguments)]
pub(crate) fn launch_row(
    org: &str,
    goal: &str,
    connections: &[AutoResolveConnectionRef],
    requester: &str,
    turn_identity: &str,
    trigger: TriggerKind,
    trigger_context: Option<Value>,
    approval_channel: ApprovalChannel,
    idempotency_key: String,
    autoresolve_id: Option<String>,
    incident_id: Option<String>,
) -> Result<NewRun, AutoResolveError> {
    let ids: Vec<&str> = connections.iter().map(|c| c.id.as_str()).collect();
    let now = now_micros();
    Ok(NewRun {
        id: autoresolve_runs::new_run_id(),
        org: org.to_string(),
        region: crate::downtimes::notify::this_region(),
        autoresolve_id,
        goal: goal.to_string(),
        connection_ids: serde_json::to_string(&ids).map_err(|e| AutoResolveError::Db(e.into()))?,
        connection_names: names_json(connections).map_err(|e| AutoResolveError::Db(e.into()))?,
        trigger_kind: trigger,
        trigger_context: trigger_context.map(|c| c.to_string()),
        requester: requester.to_string(),
        turn_identity: turn_identity.to_string(),
        session_id: sea_orm::prelude::Uuid::new_v4().to_string(),
        approval_channel: approval_channel.as_str().to_string(),
        turn_deadline_us: Some(turn_deadline_us(now)),
        idempotency_key,
        incident_id,
        now_us: now,
    })
}

/// A refused insert of a run on an incident: the incident's live run names the refusal, else
/// the other unique keys refused it.
async fn incident_refusal(
    db: &sea_orm::DatabaseConnection,
    org: &str,
    incident_id: &str,
) -> Result<Option<String>, AutoResolveError> {
    match autoresolve_runs::live_for_incident_with(db, org, incident_id).await? {
        Some(live) => Err(AutoResolveError::IncidentHasRun(live.id)),
        None => Ok(None),
    }
}

/// [transition_with] on the global client, then [after_transition] when the run moved.
pub(crate) async fn transition(
    org: &str,
    run_id: &str,
    from: &[RunState],
    to: RunState,
    patch: RunPatch,
) -> Result<bool, AutoResolveError> {
    let conn = infra::db::get_orm_client_rw().await;
    let moved = transition_with(conn, org, run_id, from, to, patch).await?;
    if moved {
        after_transition(org, run_id, to).await;
    }
    Ok(moved)
}

/// Moves the run while in one of `from`; on `true` the caller runs [after_transition] post-commit.
/// [AutoResolveError::RunInProgress] when it would make a second live run of its AutoResolve.
pub(crate) async fn transition_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
    from: &[RunState],
    to: RunState,
    mut patch: RunPatch,
) -> Result<bool, AutoResolveError> {
    let from: Vec<RunState> = from.iter().copied().filter(|f| f.can_move_to(to)).collect();
    if from.is_empty() {
        return Ok(false);
    }
    if patch.updated_at_us == 0 {
        patch.updated_at_us = now_micros();
    }
    patch.ended_at_us = Some(to.is_terminal().then_some(patch.updated_at_us));
    match autoresolve_runs::set_state_with(conn, org, run_id, &from, to, patch).await {
        Err(InfraError::DbError(DbError::UniqueViolation)) => Err(AutoResolveError::RunInProgress),
        moved => Ok(moved?),
    }
}

/// The side effects of a committed move. They await the network and the global client, so they
/// never run inside a transaction or while a test holds the single SQLite connection.
pub(crate) async fn after_transition(org: &str, run_id: &str, to: RunState) {
    if to.is_terminal() {
        evidence::finish_run(org, run_id).await;
    }
    notify_run_changed(org, run_id, to).await;
}

/// Redraws the run wherever it is shown outside the run page: its Slack card, if it has one.
pub(crate) async fn notify_run_changed(org: &str, run_id: &str, to: RunState) {
    slack::run_changed(org, run_id, to).await;
}

/// Inserts the run; `None` when its idempotency key started one or its AutoResolve has a live run,
/// on any node.
pub(crate) async fn record_run_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    new: NewRun,
) -> Result<Option<RunRow>, AutoResolveError> {
    match autoresolve_runs::insert_with(conn, new).await {
        Ok(run) => Ok(Some(run)),
        Err(InfraError::DbError(DbError::UniqueViolation)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The connection ids a run may use: those it was started with.
pub(crate) fn run_connection_ids(run: &RunRow) -> Result<Vec<String>, AutoResolveError> {
    serde_json::from_str(&run.connection_ids).map_err(|e| AutoResolveError::Db(e.into()))
}

/// A saved AutoResolve's connections as it stored them; a run copies them at launch.
pub(crate) fn saved_connections(
    flow: &AutoResolveRow,
) -> Result<Vec<AutoResolveConnectionRef>, AutoResolveError> {
    let ids: Vec<String> =
        serde_json::from_str(&flow.connection_ids).map_err(|e| AutoResolveError::Db(e.into()))?;
    let names: HashMap<String, String> =
        serde_json::from_str(&flow.connection_names).map_err(|e| AutoResolveError::Db(e.into()))?;
    Ok(ids
        .into_iter()
        .map(|id| AutoResolveConnectionRef {
            name: names.get(&id).cloned().unwrap_or_default(),
            id,
            removed: false,
        })
        .collect())
}

/// The chosen ids once each, in order, checked in [ConnectionRefusal]'s order; `known` holds
/// the names a saved AutoResolve stored, so a connection removed since is named.
pub(crate) async fn validate_connections(
    source: &dyn ConnectionSource,
    org: &str,
    ids: &[String],
    known: &HashMap<String, String>,
) -> Result<Vec<AutoResolveConnectionRef>, ConnectionRefusal> {
    let cap = get_o2_config().autoresolve.max_connections;
    let ids = ids.iter().map(|id| id.trim()).filter(|id| !id.is_empty());
    let ids = distinct_within(ids, cap).ok_or(ConnectionRefusal::TooMany(cap))?;
    if ids.is_empty() {
        return Err(ConnectionRefusal::NoneChosen);
    }
    let mut found = Vec::with_capacity(ids.len());
    for id in ids {
        let toolset = source
            .toolset(org, &id)
            .await
            .map_err(ConnectionRefusal::Db)?;
        found.push((id, toolset));
    }
    let missing: Vec<&String> = found
        .iter()
        .filter(|(_, toolset)| toolset.is_none())
        .map(|(id, _)| id)
        .collect();
    if !missing.is_empty() {
        let removed: Vec<AutoResolveConnectionRef> = missing
            .into_iter()
            .filter_map(|id| {
                known.get(id).map(|name| AutoResolveConnectionRef {
                    id: id.clone(),
                    name: name.clone(),
                    removed: true,
                })
            })
            .collect();
        return Err(if removed.is_empty() {
            ConnectionRefusal::Unknown
        } else {
            ConnectionRefusal::Removed {
                connections: removed,
            }
        });
    }
    let chosen: Vec<(AutoResolveConnectionRef, bool)> = found
        .into_iter()
        .filter_map(|(id, toolset)| toolset.map(|t| (id, t)))
        .map(|(id, (name, mcp))| {
            let connection = AutoResolveConnectionRef {
                id,
                name,
                removed: false,
            };
            (connection, mcp)
        })
        .collect();
    if let Some((connection, _)) = chosen.iter().find(|(_, mcp)| !mcp) {
        return Err(ConnectionRefusal::NotMcp {
            connection: connection.clone(),
        });
    }
    Ok(chosen.into_iter().map(|(c, _)| c).collect())
}

/// Connection names by id, as the `connection_names` columns store them.
pub(crate) fn names_json(connections: &[AutoResolveConnectionRef]) -> serde_json::Result<String> {
    let names: BTreeMap<&str, &str> = connections
        .iter()
        .map(|c| (c.id.as_str(), c.name.as_str()))
        .collect();
    serde_json::to_string(&names)
}

/// When a plan shown at `now_us` lapses unless someone decides on it.
pub(crate) fn approval_deadline_us(now_us: i64) -> i64 {
    let wait_us = get_o2_config()
        .autoresolve
        .approval_wait_minutes
        .saturating_mul(60_000_000);
    now_us.saturating_add(i64::try_from(wait_us).unwrap_or(i64::MAX))
}

/// When a turn started at `now_us` is presumed dead.
pub(crate) fn turn_deadline_us(now_us: i64) -> i64 {
    let secs = get_o2_config().autoresolve.turn_timeout_secs;
    now_us.saturating_add(
        i64::try_from(secs)
            .unwrap_or(i64::MAX)
            .saturating_mul(1_000_000),
    )
}

/// The run token's lifetime: the turn timeout, capped where `mint` refuses.
pub(crate) fn token_ttl_secs() -> i64 {
    let secs = get_o2_config().autoresolve.turn_timeout_secs;
    i64::try_from(secs.clamp(1, MAX_TOKEN_TTL_SECS)).unwrap_or(1)
}

/// The steps of the chosen option in the run's current revision, by seq.
pub(crate) fn chosen_steps<'a>(run: &RunRow, steps: &'a [StepRow]) -> Vec<&'a StepRow> {
    let Some(option) = run.chosen_option_id.as_deref() else {
        return Vec::new();
    };
    let mut chosen: Vec<&StepRow> = steps
        .iter()
        .filter(|s| s.revision == run.revision && s.option_id.as_deref() == Some(option))
        .collect();
    chosen.sort_by_key(|s| s.seq);
    chosen
}

/// Other runs' changes to this run's MCPs sent at or after `since_us`, newest first.
pub(crate) async fn changed_since(
    run: &RunRow,
    since_us: i64,
) -> Result<Vec<StepRow>, AutoResolveError> {
    let ids = run_connection_ids(run)?;
    let conn = infra::db::get_orm_client_ro().await;
    let rows = autoresolve_steps::changed_since_with(
        conn,
        &run.org,
        &run.id,
        &ids,
        since_us,
        CHANGES_SHOWN,
    )
    .await?;
    Ok(rows)
}

/// Marks the approved steps among `chosen` as never run, once the run ended before them.
pub(crate) async fn mark_not_run<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    chosen: &[&StepRow],
) -> Result<u64, AutoResolveError> {
    let ids: Vec<String> = chosen
        .iter()
        .filter(|s| s.state == StepState::Approved.as_str())
        .map(|s| s.id.clone())
        .collect();
    let (from, to) = ([StepState::Approved], StepState::NotRun);
    Ok(autoresolve_steps::set_many(conn, org, &ids, &from, to).await?)
}

/// Each id once, in first-seen order.
pub(crate) fn distinct_ids<'a>(ids: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    distinct_within(ids, usize::MAX).unwrap_or_default()
}

/// Stored text as JSON, or as a JSON string when it does not parse.
pub(crate) fn json_or_text(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

/// The sentence the run page, its Slack card and the model use for who started a run.
pub(crate) fn trigger_label(run: &RunRow) -> String {
    format!("Started by {}", trigger_by(run))
}

/// Who started a run, for a slot already labelled "Started by"; the alert or incident by the
/// name its context carries.
pub(crate) fn trigger_by(run: &RunRow) -> String {
    let context: Option<Value> = run
        .trigger_context
        .as_deref()
        .and_then(|c| serde_json::from_str(c).ok());
    let named = |key: &str| {
        context
            .as_ref()
            .and_then(|c| c.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string)
    };
    match run.trigger_kind.as_str() {
        k if k == TriggerKind::Person.as_str() => run.requester.clone(),
        k if k == TriggerKind::Alert.as_str() => match named("alert_name") {
            Some(name) => format!("the alert {name}"),
            None => "an alert".to_string(),
        },
        k if k == TriggerKind::Incident.as_str() => match named("title") {
            Some(title) => format!("the incident {title}"),
            None => "an incident".to_string(),
        },
        _ => "OpenObserve".to_string(),
    }
}

fn gate_open(flag: bool, licensed: bool, keys_ok: bool, secret_set: bool) -> bool {
    flag && licensed && keys_ok && secret_set
}

/// Each id once, in first-seen order; `None` as soon as more than `cap` distinct ids appear,
/// because a request body may carry any number of ids.
fn distinct_within<'a>(ids: impl IntoIterator<Item = &'a str>, cap: usize) -> Option<Vec<String>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        if seen.insert(id) {
            if out.len() == cap {
                return None;
            }
            out.push(id.to_string());
        }
    }
    Some(out)
}

fn removed_text(connections: &[AutoResolveConnectionRef]) -> String {
    let names: Vec<String> = connections.iter().map(|c| c.name.clone()).collect();
    let (verb, them) = if names.len() == 1 {
        ("was", "it")
    } else {
        ("were", "them")
    };
    format!(
        "{} {verb} removed. Take {them} out of this AutoResolve or add {them} again.",
        capitalized(&named_mcps(&names))
    )
}

async fn fail_unstarted(run: &RunRow, e: &AutoResolveError) {
    log::error!("[autoresolve] run {} could not start: {e}", run.id);
    let shown = match e {
        AutoResolveError::Db(_) => "The run could not start.".to_string(),
        e => e.to_string(),
    };
    let patch = RunPatch {
        error: Some(Some(shown)),
        ..Default::default()
    };
    let moved = transition(
        &run.org,
        &run.id,
        &[RunState::Investigating],
        RunState::Failed,
        patch,
    )
    .await;
    if let Err(e) = moved {
        log::error!("[autoresolve] run {} could not be failed: {e}", run.id);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use infra::table::autoresolve_runs;
    use serde_json::json;

    use super::*;
    use crate::autoresolve::test_support::{ORG, memory_db, new_run};

    #[tokio::test]
    async fn trigger_by_names_what_started_the_run() {
        let db = memory_db().await;
        autoresolve_runs::insert_with(&db, new_run("r1"))
            .await
            .unwrap();
        let base = autoresolve_runs::get_with(&db, ORG, "r1")
            .await
            .unwrap()
            .unwrap();
        let alert = json!({"alert_name": " CPU high "}).to_string();
        let blank = json!({"alert_name": "  "}).to_string();
        let incident = json!({"title": "EU1 down"}).to_string();
        let cases = [
            ("person", "person", None, "rita@example.com"),
            ("named alert", "alert", Some(&alert), "the alert CPU high"),
            ("blank alert name", "alert", Some(&blank), "an alert"),
            (
                "named incident",
                "incident",
                Some(&incident),
                "the incident EU1 down",
            ),
            ("incident without context", "incident", None, "an incident"),
            ("unknown kind", "webhook", None, "OpenObserve"),
        ];
        for (case, kind, context, want) in cases {
            let run = RunRow {
                trigger_kind: kind.into(),
                trigger_context: context.cloned(),
                ..base.clone()
            };
            assert_eq!(trigger_by(&run), want, "{case}");
        }
    }

    /// `c1` "code-host" and `c2` "k8s" are MCP connections, `c3` "runner" a skill toolset; counts
    /// the lookups made.
    #[derive(Default)]
    struct Toolsets(AtomicUsize);

    #[async_trait::async_trait]
    impl ConnectionSource for Toolsets {
        async fn get(
            &self,
            _org: &str,
            _key: &str,
        ) -> anyhow::Result<Option<AutoResolveConnection>> {
            unreachable!("the check reads toolsets of any kind")
        }

        async fn toolset(&self, _org: &str, id: &str) -> anyhow::Result<Option<(String, bool)>> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(match id {
                "c1" => Some(("code-host".into(), true)),
                "c2" => Some(("k8s".into(), true)),
                "c3" => Some(("runner".into(), false)),
                _ => None,
            })
        }
    }

    #[tokio::test]
    async fn a_run_takes_one_to_the_cap_of_known_mcp_connections() {
        let over_cap: Vec<String> = (0..21).map(|i| format!("x{i}")).collect();
        let huge: Vec<String> = (0..100_000).map(|i| format!("x{i}")).collect();
        let ids = |ids: &[&str]| ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        let known = HashMap::from([
            ("gone1".to_string(), "postgres".to_string()),
            ("gone2".to_string(), "redis".to_string()),
        ]);
        type Case = (
            &'static str,
            Vec<String>,
            Option<&'static [&'static str]>,
            Result<&'static [&'static str], &'static str>,
        );
        let unknown = Err("A chosen MCP no longer exists. Choose your MCPs again.");
        #[rustfmt::skip]
        let cases: [Case; 11] = [
            ("none", ids(&[" "]), None, Err("Choose at least one MCP.")),
            ("over the cap", over_cap, None, Err("Choose at most 20 MCPs.")),
            ("100k distinct ids", huge, None, Err("Choose at most 20 MCPs.")),
            ("an unknown id, before a skill one", ids(&["c3", "gone", "c1"]), None, unknown),
            ("a skill toolset", ids(&["c1", "c3"]), None, Err("runner is not an MCP. Choose an MCP.")),
            ("one removed since the save", ids(&["c1", "gone1"]), None, Err("The postgres MCP was removed. Take it out of this AutoResolve or add it again.")),
            ("two removed since the save", ids(&["gone1", "c1", "gone2"]), None, Err("The postgres and redis MCPs were removed. Take them out of this AutoResolve or add them again.")),
            ("duplicates collapse in order", ids(&["c2", " c1 ", "c2"]), None, Ok(&["k8s", "code-host"])),
            ("an MCP the caller cannot list", ids(&["c1", "c2"]), Some(&["ai_toolsets:c1"]), unknown),
            ("a skill toolset the caller cannot list", ids(&["c1", "c3"]), Some(&["ai_toolsets:c1"]), unknown),
            ("every toolset of the org listable", ids(&["c2", "c1"]), Some(&["ai_toolsets:_all_acme"]), Ok(&["k8s", "code-host"])),
        ];
        for (case, chosen, listable, want) in cases {
            let toolsets = Toolsets::default();
            let source = Listable {
                source: &toolsets,
                permitted: listable.map(|l| l.iter().map(|o| o.to_string()).collect()),
            };
            let got = validate_connections(&source, "acme", &chosen, &known).await;
            if matches!(got, Err(ConnectionRefusal::TooMany(_))) {
                assert_eq!(toolsets.0.load(Ordering::Relaxed), 0, "{case}: no lookup");
            }
            let got = got
                .as_ref()
                .map(|c| c.iter().map(|c| c.name.as_str()).collect::<Vec<_>>())
                .map_err(ToString::to_string);
            assert_eq!(
                got,
                want.map(<[&str]>::to_vec).map_err(str::to_string),
                "{case}"
            );
        }
    }

    #[test]
    fn autoresolve_gate_needs_all_five() {
        let cases = [
            (true, true, true, true, true),
            (false, true, true, true, false),
            (true, false, true, true, false),
            (true, true, false, true, false),
            (true, true, true, false, false),
        ];
        for (flag, licensed, keys_ok, secret_set, open) in cases {
            assert_eq!(
                gate_open(flag, licensed, keys_ok, secret_set),
                open,
                "flag={flag} licensed={licensed} keys_ok={keys_ok} secret_set={secret_set}"
            );
        }
    }
}
