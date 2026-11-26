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

//! Saved AutoResolves: a goal, its connections and an optional trigger, saved and switched on only
//! by someone who may approve changes through every one of its connections.

use std::{collections::HashMap, str::FromStr};

use config::{
    meta::autoresolve::{ApprovalChannel, TriggerKind, named_mcp},
    utils::time::now_micros,
};
use infra::{
    errors::{DbError, Error as InfraError},
    table::{
        autoresolve::{self as table, AutoResolvePatch, NewAutoResolve},
        autoresolve_corrections, autoresolve_runs, autoresolve_steps,
        entity::autoresolve::Model as AutoResolveRow,
        org_ai_toolsets,
    },
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    slack::{
        self as ent_slack,
        insights::feed::settings::{self as slack_settings, LiveKv},
    },
    super_cluster::kv,
};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    AutoResolveError, ConnectionRefusal, MAX_GOAL_CHARS,
    approve::{self, ApproveError, Approver, Seams},
    live::{AutoResolveConnectionRef, connection_ref},
    names_json, saved_connections, start_run_for, validate_connections,
};

const MAX_NAME_CHARS: usize = 100;
const MCP_KIND: &str = "mcp";

/// `POST …/autoresolve/saved` and `PUT …/saved/{id}`; `from_run_id` is read only on create.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct SavedInput {
    pub name: String,
    pub goal: String,
    pub connection_ids: Vec<String>,
    pub trigger_kind: TriggerKind,
    /// Required when `trigger_kind` is `alert` or `incident`.
    #[serde(default)]
    pub trigger_alert_id: Option<String>,
    /// The run this AutoResolve was saved from.
    #[serde(default)]
    pub from_run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SavedTrigger {
    /// `person`, `alert` or `incident`.
    pub kind: String,
    pub alert_id: Option<String>,
    /// Null when the alert is gone.
    pub alert_name: Option<String>,
    pub enabled: bool,
    /// Turned off by an edit; someone who may approve must turn it on again.
    pub paused_for_reapproval: bool,
    pub approved_by: Option<String>,
    pub approved_at_us: Option<i64>,
}

/// One saved AutoResolve as its page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub goal: String,
    /// A removed connection is marked `removed`, under its name at the last save.
    pub connections: Vec<AutoResolveConnectionRef>,
    pub trigger: SavedTrigger,
    pub created_by: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
    pub from_run_id: Option<String>,
    /// This region holds the scheduler claim, so its alert and incident triggers fire.
    pub triggers_fire_here: bool,
}

/// `GET …/autoresolve/saved/{id}`: the AutoResolve and who may approve changes through its MCPs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SavedDetail {
    #[serde(flatten)]
    pub autoresolve: SavedView,
    pub approvers: Vec<Approver>,
}

/// `GET …/autoresolve/saved`, sorted by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SavedList {
    pub autoresolve: Vec<SavedView>,
}

/// Why a saved AutoResolve was not changed; every message but `Db` is one sentence a person reads.
#[derive(Debug, thiserror::Error)]
pub enum SavedError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Connections(ConnectionRefusal),
    #[error("Saved AutoResolve not found.")]
    NotFound,
    #[error("An AutoResolve with this name already exists.")]
    NameTaken,
    #[error(
        "Only someone who may approve changes through {} can save this AutoResolve or turn on its trigger.",
        named_mcp(&connection.name)
    )]
    NoPermission {
        connection: AutoResolveConnectionRef,
        approvers: Vec<Approver>,
    },
    #[error(
        "Slack approval is not available on this deployment, so alert and incident triggers cannot be turned on."
    )]
    SlackOff,
    #[error("Choose a Slack channel for approvals in the Slack app settings.")]
    NoSlackChannel,
    #[error("Slack settings could not be read; try again.")]
    SlackUnreadable,
    #[error("This AutoResolve changed; reload it and try again.")]
    Changed,
    #[error("This AutoResolve already has a run in progress.")]
    RunInProgress,
    #[error(transparent)]
    Run(AutoResolveError),
    #[error(transparent)]
    Db(anyhow::Error),
}

impl From<InfraError> for SavedError {
    fn from(e: InfraError) -> Self {
        match e {
            InfraError::DbError(DbError::UniqueViolation) => Self::NameTaken,
            e => Self::Db(e.into()),
        }
    }
}

impl From<ConnectionRefusal> for SavedError {
    fn from(e: ConnectionRefusal) -> Self {
        match e {
            ConnectionRefusal::Db(e) => Self::Db(e),
            e => Self::Connections(e),
        }
    }
}

impl From<ApproveError> for SavedError {
    fn from(e: ApproveError) -> Self {
        match e {
            ApproveError::Db(e) => Self::Db(e),
            e => Self::Db(anyhow::anyhow!(e.to_string())),
        }
    }
}

/// What a save checks outside the AutoResolve tables; tests pass a fixture.
#[async_trait::async_trait]
pub(crate) trait SavedFacts: Send + Sync {
    /// Slack runs on this deployment; a super cluster or the Slack flag turns it off.
    fn slack_on(&self, org: &str) -> bool;
    /// The org chose a Slack channel, where triggered runs ask for approval.
    async fn has_slack_channel(&self, org: &str) -> anyhow::Result<bool>;
    /// `None` when the org has no such alert.
    async fn alert_name(&self, org: &str, alert_id: &str) -> Option<String>;
}

/// The production [SavedFacts]: the Slack insights settings and the alert store.
pub(crate) struct LiveSavedFacts;

#[async_trait::async_trait]
impl SavedFacts for LiveSavedFacts {
    fn slack_on(&self, org: &str) -> bool {
        slack_approval_available(org)
    }

    async fn has_slack_channel(&self, org: &str) -> anyhow::Result<bool> {
        let (settings, _) = slack_settings::load(&LiveKv, org).await?;
        Ok(settings.channel.is_some())
    }

    async fn alert_name(&self, org: &str, alert_id: &str) -> Option<String> {
        let id = svix_ksuid::Ksuid::from_str(alert_id).ok()?;
        crate::alerts::alert::get_by_id_db(org, id)
            .await
            .ok()
            .map(|alert| alert.name)
    }
}

/// The approve seams plus [SavedFacts].
pub(crate) struct SavedSeams<'a> {
    pub approve: Seams<'a>,
    pub facts: &'a dyn SavedFacts,
}

impl SavedSeams<'static> {
    pub(crate) async fn live() -> Self {
        Self {
            approve: Seams::live().await,
            facts: &LiveSavedFacts,
        }
    }
}

/// A checked input: trimmed text, each connection once with its name.
struct Valid {
    name: String,
    goal: String,
    connections: Vec<AutoResolveConnectionRef>,
    kind: TriggerKind,
    alert_id: Option<String>,
}

impl Valid {
    fn ids(&self) -> Vec<String> {
        self.connections.iter().map(|c| c.id.clone()).collect()
    }
}

/// The org's saved AutoResolves, by name.
pub async fn list(org: &str) -> Result<SavedList, SavedError> {
    let rows = table::list(org).await?;
    Ok(SavedList {
        autoresolve: views(org, rows).await?,
    })
}

pub async fn get(org: &str, id: &str) -> Result<SavedDetail, SavedError> {
    let row = table::get(org, id).await?.ok_or(SavedError::NotFound)?;
    let autoresolve = one_view(org, row).await?;
    let ids: Vec<String> = autoresolve
        .connections
        .iter()
        .filter(|c| !c.removed)
        .map(|c| c.id.clone())
        .collect();
    let approvers = approve::approvers_for(org, &ids).await;
    Ok(SavedDetail {
        autoresolve,
        approvers,
    })
}

/// Saves a new AutoResolve; an alert or incident trigger starts on, approved by the saver.
pub async fn save(org: &str, email: &str, input: SavedInput) -> Result<SavedView, SavedError> {
    let row = save_with(&SavedSeams::live().await, org, email, input).await?;
    one_view(org, row).await
}

/// Edits an AutoResolve; a changed goal, connection list or trigger turns the trigger off until
/// someone who may approve turns it on again.
pub async fn update(
    org: &str,
    email: &str,
    id: &str,
    input: SavedInput,
) -> Result<SavedView, SavedError> {
    let row = update_with(&SavedSeams::live().await, org, email, id, input).await?;
    one_view(org, row).await
}

/// Turns the trigger on as the caller's approval, or off keeping the last approval.
pub async fn set_trigger(
    org: &str,
    email: &str,
    id: &str,
    enabled: bool,
) -> Result<SavedView, SavedError> {
    let row = set_trigger_with(&SavedSeams::live().await, org, email, id, enabled).await?;
    one_view(org, row).await
}

/// Deletes the AutoResolve with its corrections, which no other AutoResolve reads.
pub async fn delete(org: &str, id: &str) -> Result<(), SavedError> {
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await.map_err(|e| SavedError::Db(e.into()))?;
    if !table::delete_with(&txn, org, id).await? {
        return Err(SavedError::NotFound);
    }
    autoresolve_corrections::delete_for_autoresolve_with(&txn, org, id).await?;
    txn.commit().await.map_err(|e| SavedError::Db(e.into()))
}

/// Starts a run of the AutoResolve as the caller, approved on screen.
pub async fn run_saved(org: &str, email: &str, id: &str) -> Result<String, SavedError> {
    let row = table::get(org, id).await?.ok_or(SavedError::NotFound)?;
    let connections = saved_connections(&row).map_err(SavedError::Run)?;
    let started = start_run_for(
        org,
        &row.goal,
        &connections,
        email,
        email,
        TriggerKind::Person,
        None,
        ApprovalChannel::Screen,
        autoresolve_runs::new_run_id(),
        Some(row.id),
    )
    .await
    .map_err(SavedError::Run)?;
    // The key is new, so only the one-live-run-per-AutoResolve index can refuse the insert.
    started.ok_or(SavedError::RunInProgress)
}

/// Whether triggered runs can ask for approval in Slack on this deployment.
pub fn slack_approval_available(org: &str) -> bool {
    ent_slack::enabled_for(org)
}

/// Whether this region holds the scheduler claim, as `jobs` reads it; only for the notice,
/// never a lock.
pub async fn triggers_fire_here() -> bool {
    if !get_o2_config().super_cluster.enabled {
        return true;
    }
    let claim = match kv::scheduler::get_job_cluster().await {
        Ok(name) => name,
        Err(e) => {
            log::error!("[autoresolve] could not read the job cluster: {e}");
            return false;
        }
    };
    !claim.is_empty() && claim == config::get_cluster_name()
}

pub(crate) async fn save_with(
    seams: &SavedSeams<'_>,
    org: &str,
    email: &str,
    input: SavedInput,
) -> Result<AutoResolveRow, SavedError> {
    let from_run_id = input
        .from_run_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let known = match &from_run_id {
        Some(run_id) => run_connection_names(seams.approve.db, org, run_id).await?,
        None => HashMap::new(),
    };
    let valid = validate(seams, org, &input, &known).await?;
    if let Some(run_id) = &from_run_id
        && autoresolve_runs::get_with(seams.approve.db, org, run_id)
            .await?
            .is_none()
    {
        return Err(invalid(
            "The run this AutoResolve is saved from was not found.",
        ));
    }
    require_approve(seams, org, email, &valid.connections).await?;
    let triggered = valid.kind != TriggerKind::Person;
    if triggered {
        require_slack_channel(seams, org).await?;
    }
    let now = now_micros();
    let email = email.trim().to_string();
    let new = NewAutoResolve {
        id: autoresolve_runs::new_run_id(),
        org: org.to_string(),
        region: crate::downtimes::notify::this_region(),
        connection_ids: ids_json(&valid.ids())?,
        connection_names: stored_names_json(&valid.connections)?,
        name: valid.name,
        goal: valid.goal,
        trigger_kind: valid.kind,
        trigger_alert_id: valid.alert_id,
        trigger_enabled: triggered,
        trigger_approved_by: triggered.then(|| email.clone()),
        trigger_approved_at_us: triggered.then_some(now),
        created_by: email,
        from_run_id,
        now_us: now,
    };
    Ok(table::insert_with(seams.approve.db, new).await?)
}

pub(crate) async fn update_with(
    seams: &SavedSeams<'_>,
    org: &str,
    email: &str,
    id: &str,
    input: SavedInput,
) -> Result<AutoResolveRow, SavedError> {
    let db = seams.approve.db;
    let row = table::get_with(db, org, id)
        .await?
        .ok_or(SavedError::NotFound)?;
    let valid = validate(seams, org, &input, &stored_names(&row)?).await?;
    require_approve(seams, org, email, &valid.connections).await?;
    let ids = valid.ids();
    let mut stored = stored_ids(&row)?;
    let mut wanted = ids.clone();
    stored.sort();
    wanted.sort();
    let changed = row.goal != valid.goal
        || stored != wanted
        || row.trigger_kind != valid.kind.as_str()
        || row.trigger_alert_id != valid.alert_id;
    let mut patch = AutoResolvePatch {
        name: Some(valid.name),
        goal: Some(valid.goal),
        connection_ids: Some(ids_json(&ids)?),
        connection_names: Some(stored_names_json(&valid.connections)?),
        trigger_kind: Some(valid.kind),
        trigger_alert_id: Some(valid.alert_id),
        updated_at_us: now_micros(),
        ..Default::default()
    };
    if changed {
        patch.trigger_enabled = Some(false);
        patch.trigger_approved_by = Some(None);
        patch.trigger_approved_at_us = Some(None);
    }
    write_unchanged(db, org, &row, patch).await
}

pub(crate) async fn set_trigger_with(
    seams: &SavedSeams<'_>,
    org: &str,
    email: &str,
    id: &str,
    enabled: bool,
) -> Result<AutoResolveRow, SavedError> {
    let row = table::get_with(seams.approve.db, org, id)
        .await?
        .ok_or(SavedError::NotFound)?;
    set_trigger_on(seams, org, email, row, enabled).await
}

/// [set_trigger_with] on the row as it was read; an edit since that read refuses the write.
pub(crate) async fn set_trigger_on(
    seams: &SavedSeams<'_>,
    org: &str,
    email: &str,
    row: AutoResolveRow,
    enabled: bool,
) -> Result<AutoResolveRow, SavedError> {
    if row.trigger_kind == TriggerKind::Person.as_str() {
        return Err(invalid(
            "An AutoResolve that a person starts has no trigger.",
        ));
    }
    let now = now_micros();
    let mut patch = AutoResolvePatch {
        trigger_enabled: Some(enabled),
        updated_at_us: now,
        ..Default::default()
    };
    if enabled {
        let (ids, known) = (stored_ids(&row)?, stored_names(&row)?);
        let connections =
            validate_connections(seams.approve.connections, org, &ids, &known).await?;
        let alert_id = row.trigger_alert_id.as_deref().unwrap_or_default();
        if seams.facts.alert_name(org, alert_id).await.is_none() {
            return Err(invalid(
                "The alert that starts this AutoResolve no longer exists.",
            ));
        }
        require_approve(seams, org, email, &connections).await?;
        require_slack_channel(seams, org).await?;
        patch.trigger_approved_by = Some(Some(email.trim().to_string()));
        patch.trigger_approved_at_us = Some(Some(now));
    }
    write_unchanged(seams.approve.db, org, &row, patch).await
}

/// Writes `patch` only while the row is as `row` read it; a concurrent edit is
/// [SavedError::Changed], so a trigger is never turned on over connections nobody checked.
async fn write_unchanged(
    db: &DatabaseConnection,
    org: &str,
    row: &AutoResolveRow,
    mut patch: AutoResolvePatch,
) -> Result<AutoResolveRow, SavedError> {
    patch.updated_at_us = patch.updated_at_us.max(row.updated_at_us + 1);
    patch.if_updated_at_us = Some(row.updated_at_us);
    if !table::update_with(db, org, &row.id, patch).await? {
        let exists = table::get_with(db, org, &row.id).await?.is_some();
        return Err(if exists {
            SavedError::Changed
        } else {
            SavedError::NotFound
        });
    }
    table::get_with(db, org, &row.id)
        .await?
        .ok_or(SavedError::NotFound)
}

/// Slack first: with Slack off no channel setting helps, and a triggered run would only lapse.
async fn require_slack_channel(seams: &SavedSeams<'_>, org: &str) -> Result<(), SavedError> {
    if !seams.facts.slack_on(org) {
        return Err(SavedError::SlackOff);
    }
    match seams.facts.has_slack_channel(org).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(SavedError::NoSlackChannel),
        Err(e) => {
            log::error!("[autoresolve] Slack settings of org {org} could not be read: {e}");
            Err(SavedError::SlackUnreadable)
        }
    }
}

fn invalid(message: &str) -> SavedError {
    SavedError::Invalid(message.to_string())
}

/// `known` holds the last names of connections the org may have removed since.
async fn validate(
    seams: &SavedSeams<'_>,
    org: &str,
    input: &SavedInput,
    known: &HashMap<String, String>,
) -> Result<Valid, SavedError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("Give the AutoResolve a name."));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(SavedError::Invalid(format!(
            "The name can be at most {MAX_NAME_CHARS} characters."
        )));
    }
    let goal = input.goal.trim();
    if goal.is_empty() {
        return Err(invalid("Describe what the AutoResolve should do."));
    }
    if goal.chars().count() > MAX_GOAL_CHARS {
        return Err(SavedError::Invalid(format!(
            "The goal can be at most {MAX_GOAL_CHARS} characters."
        )));
    }
    let connections =
        validate_connections(seams.approve.connections, org, &input.connection_ids, known).await?;
    let alert_id = input
        .trigger_alert_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let alert_id = match (input.trigger_kind, alert_id) {
        (TriggerKind::Person, _) => None,
        (_, None) => return Err(invalid("Choose the alert that starts this AutoResolve.")),
        (_, Some(id)) if seams.facts.alert_name(org, id).await.is_none() => {
            return Err(invalid("The chosen alert no longer exists."));
        }
        (_, Some(id)) => Some(id.to_string()),
    };
    Ok(Valid {
        name: name.to_string(),
        goal: goal.to_string(),
        connections,
        kind: input.trigger_kind,
        alert_id,
    })
}

async fn require_approve(
    seams: &SavedSeams<'_>,
    org: &str,
    email: &str,
    connections: &[AutoResolveConnectionRef],
) -> Result<(), SavedError> {
    let ids: Vec<String> = connections.iter().map(|c| c.id.clone()).collect();
    let Some(missing) = approve::first_unapproved_with(&seams.approve, org, email, &ids).await?
    else {
        return Ok(());
    };
    let Some(connection) = connections.iter().find(|c| c.id == missing).cloned() else {
        let e = anyhow::anyhow!("approve check named connection {missing}, which was not chosen");
        return Err(SavedError::Db(e));
    };
    let approvers =
        approve::approvers_for_with(&seams.approve, org, std::slice::from_ref(&missing)).await?;
    Err(SavedError::NoPermission {
        connection,
        approvers,
    })
}

fn stored_ids(row: &AutoResolveRow) -> Result<Vec<String>, SavedError> {
    serde_json::from_str(&row.connection_ids).map_err(|e| SavedError::Db(e.into()))
}

fn ids_json(ids: &[String]) -> Result<String, SavedError> {
    serde_json::to_string(ids).map_err(|e| SavedError::Db(e.into()))
}

fn stored_names(row: &AutoResolveRow) -> Result<HashMap<String, String>, SavedError> {
    serde_json::from_str(&row.connection_names).map_err(|e| SavedError::Db(e.into()))
}

fn stored_names_json(connections: &[AutoResolveConnectionRef]) -> Result<String, SavedError> {
    names_json(connections).map_err(|e| SavedError::Db(e.into()))
}

/// The connection keys the run's steps stored, by connection id.
async fn run_connection_names(
    db: &DatabaseConnection,
    org: &str,
    run_id: &str,
) -> Result<HashMap<String, String>, SavedError> {
    let steps = autoresolve_steps::list_for_run_with(db, org, run_id).await?;
    Ok(steps
        .into_iter()
        .map(|s| (s.connection_id, s.connection_name))
        .collect())
}

async fn one_view(org: &str, row: AutoResolveRow) -> Result<SavedView, SavedError> {
    let mut views = views(org, vec![row]).await?;
    views.pop().ok_or(SavedError::NotFound)
}

async fn views(org: &str, rows: Vec<AutoResolveRow>) -> Result<Vec<SavedView>, SavedError> {
    let names: HashMap<String, String> = org_ai_toolsets::list_kind_names(org, MCP_KIND)
        .await?
        .into_iter()
        .collect();
    let here = triggers_fire_here().await;
    let mut alert_names: HashMap<String, Option<String>> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let alert_name = match &row.trigger_alert_id {
            Some(id) => {
                if !alert_names.contains_key(id) {
                    let name = LiveSavedFacts.alert_name(org, id).await;
                    alert_names.insert(id.clone(), name);
                }
                alert_names.get(id).cloned().flatten()
            }
            None => None,
        };
        out.push(view(row, &names, alert_name, here)?);
    }
    Ok(out)
}

fn view(
    row: AutoResolveRow,
    names: &HashMap<String, String>,
    alert_name: Option<String>,
    triggers_fire_here: bool,
) -> Result<SavedView, SavedError> {
    let stored = stored_names(&row)?;
    // Every save stores a name per id; a gone id without one cannot be shown by name.
    let connections = stored_ids(&row)?
        .into_iter()
        .filter_map(|id| {
            let last = stored.get(&id).cloned();
            if last.is_none() && !names.contains_key(&id) {
                log::error!(
                    "[autoresolve] {} stored no name for connection {id}",
                    row.id
                );
                return None;
            }
            Some(connection_ref(id, names, || last.unwrap_or_default()))
        })
        .collect();
    let triggered = row.trigger_kind != TriggerKind::Person.as_str();
    let paused = triggered && !row.trigger_enabled && row.trigger_approved_by.is_none();
    Ok(SavedView {
        trigger: SavedTrigger {
            kind: row.trigger_kind,
            alert_id: row.trigger_alert_id,
            alert_name,
            enabled: row.trigger_enabled,
            paused_for_reapproval: paused,
            approved_by: row.trigger_approved_by,
            approved_at_us: row.trigger_approved_at_us,
        },
        id: row.id,
        name: row.name,
        goal: row.goal,
        connections,
        created_by: row.created_by,
        created_at_us: row.created_at_us,
        updated_at_us: row.updated_at_us,
        from_run_id: row.from_run_id,
        triggers_fire_here,
    })
}

#[cfg(test)]
mod tests {
    use infra::table::entity::autoresolve::Entity as AutoResolve;
    use o2_enterprise::enterprise::ai::toolsets::AutoResolveConnection;
    use sea_orm::{EntityTrait, PaginatorTrait};

    use super::*;
    use crate::autoresolve::{
        ConnectionSource,
        approve::{ApproverFacts, Holders, RoleHolder},
        test_support::{ORG, RecordingTurns, memory_db},
    };

    const ADA: &str = "ada@example.com";
    const ALICE: &str = "alice@example.com";
    const ALERT: &str = "2qJ0Rk1Xh5vBqT2Jd9eM8nV4cWz";
    const ON: Slack = Slack::Channel;
    const OFF: Slack = Slack::NoChannel;
    const UNREADABLE: Slack = Slack::Unreadable;
    const SLACK_OFF: Slack = Slack::Off;

    /// `c1` "github" and `c2` "k8s" unless `removed`; Alice holds approve on c1 alone, Ada is an
    /// org admin.
    struct Org {
        slack: Slack,
        removed: Option<&'static str>,
    }

    #[async_trait::async_trait]
    impl ConnectionSource for Org {
        async fn get(&self, _org: &str, id: &str) -> anyhow::Result<Option<AutoResolveConnection>> {
            let name = match id {
                _ if self.removed == Some(id) => return Ok(None),
                "c1" => "github",
                "c2" => "k8s",
                _ => return Ok(None),
            };
            Ok(Some(AutoResolveConnection {
                id: id.to_string(),
                name: name.to_string(),
                url: format!("https://{name}.example"),
                read_headers: HashMap::new(),
                write_headers: HashMap::new(),
                fingerprint: format!("fp-{id}"),
            }))
        }
    }

    #[async_trait::async_trait]
    impl ApproverFacts for Org {
        async fn is_root(&self, _email: &str) -> bool {
            false
        }

        async fn is_org_admin(&self, _org: &str, email: &str) -> bool {
            email == ADA
        }

        fn openfga_on(&self) -> bool {
            true
        }

        fn checks_bypassed(&self) -> bool {
            false
        }

        async fn holds(&self, _org: &str, email: &str, connection: &str) -> anyhow::Result<bool> {
            Ok(email == ALICE && connection == "c1")
        }

        async fn has_module_access(&self, _org: &str, _email: &str) -> anyhow::Result<bool> {
            Ok(true)
        }

        async fn may_edit_module(&self, _org: &str, _email: &str) -> anyhow::Result<bool> {
            Ok(true)
        }

        async fn holders(&self, _org: &str, _ids: &[String]) -> anyhow::Result<Holders> {
            let roles = vec![RoleHolder {
                name: "sre".to_string(),
                module_access: true,
            }];
            Ok(Holders {
                roles,
                groups: Vec::new(),
            })
        }
    }

    #[async_trait::async_trait]
    impl SavedFacts for Org {
        fn slack_on(&self, _org: &str) -> bool {
            self.slack != Slack::Off
        }

        async fn has_slack_channel(&self, _org: &str) -> anyhow::Result<bool> {
            match self.slack {
                Slack::NoChannel => Ok(false),
                Slack::Unreadable => Err(anyhow::anyhow!("settings store down")),
                Slack::Channel | Slack::Off => Ok(true),
            }
        }

        async fn alert_name(&self, _org: &str, alert_id: &str) -> Option<String> {
            (alert_id == ALERT).then(|| "Checkout errors".to_string())
        }
    }

    enum Then {
        Nothing,
        EditGoal,
        EditConnections,
        Disable,
        Enable(&'static str),
        EnableAfterEdit,
        EditAfterRemoval,
        EditOverCap,
    }

    type Check = fn(&Result<AutoResolveRow, SavedError>) -> bool;

    /// The org's Slack: a channel chosen, none, settings unreadable, or Slack off with a channel.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Slack {
        Channel,
        NoChannel,
        Unreadable,
        Off,
    }

    fn input(kind: TriggerKind, connection_ids: &[&str]) -> SavedInput {
        SavedInput {
            name: "Restart stuck deploys".into(),
            goal: "restart the stuck deploy".into(),
            connection_ids: connection_ids.iter().map(|c| c.to_string()).collect(),
            trigger_kind: kind,
            trigger_alert_id: (kind != TriggerKind::Person).then(|| ALERT.to_string()),
            from_run_id: None,
        }
    }

    fn denied_on_c2(got: &Result<AutoResolveRow, SavedError>) -> bool {
        matches!(got, Err(SavedError::NoPermission { connection, approvers })
            if connection.name == "k8s" && !approvers.is_empty())
    }

    fn paused(got: &Result<AutoResolveRow, SavedError>) -> bool {
        got.as_ref().is_ok_and(|f| {
            !f.trigger_enabled
                && f.trigger_approved_by.is_none()
                && f.trigger_approved_at_us.is_none()
        })
    }

    fn on_by_ada(got: &Result<AutoResolveRow, SavedError>) -> bool {
        got.as_ref()
            .is_ok_and(|f| f.trigger_enabled && f.trigger_approved_by.as_deref() == Some(ADA))
    }

    #[tokio::test]
    async fn save_needs_approve_permission_on_every_connection() {
        use TriggerKind::{Alert, Person};
        #[rustfmt::skip]
        let cases: [(&str, &str, TriggerKind, Slack, Then, Check); 13] = [
            ("permission on both", ADA, Person, OFF, Then::Nothing, |got| got.as_ref().is_ok_and(|f| !f.trigger_enabled && f.trigger_approved_by.is_none())),
            ("lacks one", ALICE, Person, OFF, Then::Nothing, denied_on_c2),
            ("alert trigger with channel", ADA, Alert, ON, Then::Nothing, on_by_ada),
            ("alert trigger without channel", ADA, Alert, OFF, Then::Nothing, |got| matches!(got, Err(SavedError::NoSlackChannel))),
            ("alert trigger with Slack off", ADA, Alert, SLACK_OFF, Then::Nothing, |got| matches!(got, Err(SavedError::SlackOff))),
            ("goal edited", ADA, Alert, ON, Then::EditGoal, paused),
            ("connections edited", ADA, Alert, ON, Then::EditConnections, paused),
            ("disabled by owner", ADA, Alert, ON, Then::Disable, |got| got.as_ref().is_ok_and(|f| !f.trigger_enabled && f.trigger_approved_by.as_deref() == Some(ADA))),
            ("enabled without permission", ADA, Alert, ON, Then::Enable(ALICE), denied_on_c2),
            ("slack settings unreadable", ADA, Alert, UNREADABLE, Then::Nothing, |got| matches!(got, Err(SavedError::SlackUnreadable))),
            ("enabled over a concurrent edit", ADA, Alert, ON, Then::EnableAfterEdit, |got| matches!(got, Err(SavedError::Changed))),
            ("connection removed since the save", ADA, Person, OFF, Then::EditAfterRemoval, |got| matches!(got, Err(SavedError::Connections(ConnectionRefusal::Removed { connections }))
                if matches!(connections.as_slice(), [c] if c.id == "c2" && c.name == "k8s" && c.removed))),
            ("more connections than the cap", ADA, Person, OFF, Then::EditOverCap, |got| got.as_ref().is_err_and(|e| e.to_string() == "Choose at most 20 MCPs.")),
        ];
        for (name, saver, kind, slack, then, check) in cases {
            let db = memory_db().await;
            let org = Org {
                slack,
                removed: None,
            };
            let turns = RecordingTurns::default();
            let seams = SavedSeams {
                approve: Seams {
                    db: &db,
                    turns: &turns,
                    connections: &org,
                    facts: &org,
                },
                facts: &org,
            };
            let saved = save_with(&seams, ORG, saver, input(kind, &["c1", "c2"])).await;
            if saved.is_err() {
                assert_eq!(
                    AutoResolve::find().count(&db).await.unwrap(),
                    0,
                    "{name}: nothing saved"
                );
            }
            let got = match (saved, then) {
                (Ok(flow), Then::EditGoal) => {
                    let edit = SavedInput {
                        goal: "restart it twice".into(),
                        ..input(kind, &["c1", "c2"])
                    };
                    update_with(&seams, ORG, ADA, &flow.id, edit).await
                }
                (Ok(flow), Then::EditConnections) => {
                    update_with(&seams, ORG, ADA, &flow.id, input(kind, &["c1"])).await
                }
                (Ok(flow), Then::Disable) => {
                    set_trigger_with(&seams, ORG, ADA, &flow.id, false).await
                }
                (Ok(flow), Then::Enable(who)) => {
                    set_trigger_with(&seams, ORG, who, &flow.id, true).await
                }
                (Ok(flow), Then::EnableAfterEdit) => {
                    let edit = SavedInput {
                        goal: "restart it twice".into(),
                        ..input(kind, &["c1", "c2"])
                    };
                    update_with(&seams, ORG, ADA, &flow.id, edit).await.unwrap();
                    set_trigger_on(&seams, ORG, ADA, flow, true).await
                }
                (Ok(flow), Then::EditAfterRemoval) => {
                    let org = Org {
                        slack,
                        removed: Some("c2"),
                    };
                    let seams = SavedSeams {
                        approve: Seams {
                            db: &db,
                            turns: &turns,
                            connections: &org,
                            facts: &org,
                        },
                        facts: &org,
                    };
                    update_with(&seams, ORG, ADA, &flow.id, input(kind, &["c1", "c2"])).await
                }
                (Ok(flow), Then::EditOverCap) => {
                    let ids: Vec<String> = (0..21).map(|i| format!("c{i}")).collect();
                    let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
                    update_with(&seams, ORG, ADA, &flow.id, input(kind, &ids)).await
                }
                (saved, _) => saved,
            };
            assert!(check(&got), "{name}: {got:?}");
        }
    }
}
