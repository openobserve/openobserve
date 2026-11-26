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

//! A person's decision on a plan: approve one option, decline it or ask for another plan; and who
//! may approve changes through a connection: org admins, and IAM roles with Update on its toolset.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use config::{
    meta::autoresolve::{
        CorrectionKind, PersonVerdict, PlanInput, RunState, StepState, Verdict, capitalized,
        named_mcp,
    },
    utils::time::now_micros,
};
use infra::table::{
    autoresolve_corrections::{self, NewCorrection},
    autoresolve_runs::{self, RunPatch},
    autoresolve_steps,
    entity::{autoresolve_runs::Model as RunRow, autoresolve_steps::Model as StepRow},
};
use o2_enterprise::enterprise::ai::toolsets::push::normalize_tool_name;
use sea_orm::{ConnectionTrait, DatabaseConnection, DatabaseTransaction, TransactionTrait};
use tokio::sync::OnceCell;

use super::{
    AutoResolveError, ConnectionSource, LiveConnections, LiveTurns, TurnLauncher, after_transition,
    chosen_steps, distinct_ids,
    live::AutoResolveConnectionRef,
    mark_not_run,
    plan::{OPTION_IDS, history_keeping_attempt},
    run_connection_ids, transition_with, turn_deadline_us,
};

/// A replan note is the person's words to the model; past this it is cut.
const MAX_NOTE_CHARS: usize = 2000;
/// A correction is one short note; the design's box takes this many characters.
pub const MAX_CORRECTION_CHARS: usize = 500;
/// The state a verdict or a "not fixed" correction needs, said to a person who answered too soon.
pub(crate) const VERDICT_STATE: &str =
    "Only a run that ended after making its change can say whether it fixed the problem.";
/// Update (PUT) on `ai_toolsets:{connection id}` is the right to approve changes through it.
pub const APPROVE_OBJECT_TYPE: &str = "ai_toolsets";
/// The relations that hold that PUT; IAM's "All" column writes `ALLOW_ALL`.
const APPROVE_RELATIONS: [&str; 2] = ["ALLOW_PUT", "ALLOW_ALL"];
/// The route checks every run read and decision makes, on `autoresolve:_all_{org}`.
const MODULE_PERMISSIONS: [&str; 2] = ["GET", "POST"];

/// Who may approve: an IAM role, an org group through such a role, or every org admin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApproverKind {
    Role,
    Group,
    OrgAdmins,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct Approver {
    pub kind: ApproverKind,
    pub name: String,
}

impl Approver {
    fn org_admins() -> Self {
        Self {
            kind: ApproverKind::OrgAdmins,
            name: "Org admins".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleHolder {
    pub name: String,
    /// The role also holds AutoResolve GET and POST in IAM; without them its members cannot open
    /// or decide a run, so it is never named as an approver.
    pub module_access: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupHolder {
    pub name: String,
    /// The holding roles the group is assigned.
    pub via_roles: Vec<String>,
}

/// The roles granted approve on some connections, and the groups assigned those roles.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Holders {
    pub roles: Vec<RoleHolder>,
    pub groups: Vec<GroupHolder>,
}

/// Why a decision was refused; every message but `Db` is one sentence a person reads.
#[derive(Debug, thiserror::Error)]
pub enum ApproveError {
    #[error("This plan was already decided or is no longer waiting for a decision.")]
    NotWaiting,
    #[error("The plan changed since you opened it; review the new plan and decide again.")]
    PlanChanged,
    #[error("That option is not part of this plan.")]
    UnknownOption,
    #[error(
        "{} was removed after this plan was made, so this option cannot be approved.",
        capitalized(&named_mcp(&connection.name))
    )]
    ConnectionRemoved {
        connection: AutoResolveConnectionRef,
    },
    #[error("{} was renamed after the plan was made.", capitalized(&named_mcp(name)))]
    ConnectionRenamed { name: String },
    #[error(
        "Only someone who may approve changes on this plan's MCPs can decide on it. Grant Update on \
         those MCPs in IAM › Roles."
    )]
    NoPermission { approvers: Vec<Approver> },
    #[error("Another run of this AutoResolve is in progress; finish it first.")]
    AnotherRunLive,
    /// The run is not in the state the request needs; the text names that state.
    #[error("{0}")]
    WrongState(String),
    #[error("Say what is wrong, so the next plan can take it into account.")]
    NoteRequired,
    #[error("{reason}")]
    CannotChange {
        reason: String,
        approvers: Vec<Approver>,
    },
    #[error("{0}")]
    Refused(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Turn(String),
    #[error(transparent)]
    Db(#[from] anyhow::Error),
}

impl ApproveError {
    pub fn status(&self) -> u16 {
        match self {
            Self::NoPermission { .. } | Self::CannotChange { .. } => 403,
            Self::NotFound(_) => 404,
            Self::NotWaiting
            | Self::PlanChanged
            | Self::ConnectionRemoved { .. }
            | Self::ConnectionRenamed { .. }
            | Self::AnotherRunLive
            | Self::WrongState(_) => 409,
            Self::UnknownOption | Self::NoteRequired | Self::Refused(_) => 422,
            Self::Turn(_) => 503,
            Self::Db(_) => 500,
        }
    }
}

impl From<AutoResolveError> for ApproveError {
    fn from(e: AutoResolveError) -> Self {
        match e {
            AutoResolveError::Db(e) => Self::Db(e),
            AutoResolveError::RunInProgress => Self::AnotherRunLive,
            e => Self::Db(anyhow::anyhow!(e.to_string())),
        }
    }
}

impl From<infra::errors::Error> for ApproveError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Db(e.into())
    }
}

impl From<sea_orm::DbErr> for ApproveError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Db(e.into())
    }
}

/// `POST …/runs/{run_id}/replan`: the person's note and, for a correction, its kind.
#[derive(Debug, Clone, Default)]
pub struct ReplanInput {
    pub note: String,
    pub kind: Option<CorrectionKind>,
    /// Keep the correction for the saved AutoResolve's later runs; ignored on an ad-hoc run.
    pub remember: bool,
    /// The option the correction is about; a not-fixed one is about the chosen option.
    pub option_id: Option<String>,
}

/// Who a person is outside the AutoResolve tables; tests pass a fixture instead of the user cache
/// and OpenFGA.
#[async_trait::async_trait]
pub(crate) trait ApproverFacts: Send + Sync {
    async fn is_root(&self, email: &str) -> bool;
    async fn is_org_admin(&self, org: &str, email: &str) -> bool;
    /// False while role-based access is off.
    fn openfga_on(&self) -> bool;
    /// True while the cloud switch answers every OpenFGA check allowed, so no grant is proven.
    fn checks_bypassed(&self) -> bool;
    /// Whether role grants count; when not, only org admins may approve.
    fn rbac_on(&self) -> bool {
        self.openfga_on() && !self.checks_bypassed()
    }

    /// Whether one of the person's roles, directly or through a group, holds approve on it.
    async fn holds(&self, org: &str, email: &str, connection_id: &str) -> anyhow::Result<bool>;
    /// Whether the person passes the AutoResolve GET and POST route checks.
    async fn has_module_access(&self, org: &str, email: &str) -> anyhow::Result<bool>;
    /// Whether the person passes the AutoResolve PUT route check, half of editing a saved one.
    async fn may_edit_module(&self, org: &str, email: &str) -> anyhow::Result<bool>;
    /// The roles holding approve on any of the connections, and their groups.
    async fn holders(&self, org: &str, connection_ids: &[String]) -> anyhow::Result<Holders>;
}

/// The production [ApproverFacts]: the user cache, then OpenFGA.
pub(crate) struct LiveApproverFacts;

#[async_trait::async_trait]
impl ApproverFacts for LiveApproverFacts {
    async fn is_root(&self, email: &str) -> bool {
        db::user::is_root_user(email)
    }

    async fn is_org_admin(&self, org: &str, email: &str) -> bool {
        crate::users::is_org_admin(org, email).await
    }

    fn openfga_on(&self) -> bool {
        o2_openfga::config::get_config().enabled
    }

    fn checks_bypassed(&self) -> bool {
        cfg!(feature = "cloud") && o2_openfga::config::get_config().cloud_ofga_check_disabled
    }

    async fn holds(&self, org: &str, email: &str, connection_id: &str) -> anyhow::Result<bool> {
        // No org role: the offline rule then never lets a non-admin through while OpenFGA is down.
        let object = connection_object(connection_id);
        let allowed = o2_openfga::authorizer::authz::is_allowed(
            org, email, "PUT", &object, "", "", false, false, true,
        )
        .await;
        Ok(allowed)
    }

    async fn has_module_access(&self, org: &str, email: &str) -> anyhow::Result<bool> {
        let object = module_object(org);
        for permission in MODULE_PERMISSIONS {
            let allowed = o2_openfga::authorizer::authz::is_allowed(
                org, email, permission, &object, "", "", false, false, false,
            )
            .await;
            if !allowed {
                return Ok(false);
            }
        }
        Ok(true)
    }

    async fn may_edit_module(&self, org: &str, email: &str) -> anyhow::Result<bool> {
        let object = module_object(org);
        Ok(o2_openfga::authorizer::authz::is_allowed(
            org, email, "PUT", &object, "", "", false, false, false,
        )
        .await)
    }

    async fn holders(&self, org: &str, connection_ids: &[String]) -> anyhow::Result<Holders> {
        use o2_openfga::authorizer::roles;

        let module =
            roles::roles_permitted_on(org, &module_object(org), &MODULE_PERMISSIONS).await?;
        let mut objects: Vec<String> = connection_ids
            .iter()
            .map(|id| connection_object(id))
            .collect();
        objects.push(all_connections_object(org));
        let grants = roles::roles_granted_on(org, &objects, &APPROVE_RELATIONS).await?;
        let roles = one_row_per_role(grants.into_iter().map(|(role, ..)| role), &module);
        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for role in &roles {
            for group in roles::groups_of_role(org, &role.name).await? {
                groups.entry(group).or_default().push(role.name.clone());
            }
        }
        let groups = groups
            .into_iter()
            .map(|(name, via_roles)| GroupHolder { name, via_roles })
            .collect();
        Ok(Holders { roles, groups })
    }
}

/// The database and the services a decision talks to; tests pass an in-memory database and
/// fixtures.
pub(crate) struct Seams<'a> {
    pub db: &'a DatabaseConnection,
    pub turns: &'a dyn TurnLauncher,
    pub connections: &'a dyn ConnectionSource,
    pub facts: &'a dyn ApproverFacts,
}

impl Seams<'static> {
    pub(super) async fn live() -> Self {
        Self {
            db: infra::db::get_orm_client_rw().await,
            turns: &LiveTurns,
            connections: &LiveConnections,
            facts: &LiveApproverFacts,
        }
    }
}

/// One person's approve permission; whether they are an admin, and their AutoResolve access, are
/// read once per decision.
struct Caller<'a> {
    seams: &'a Seams<'a>,
    org: &'a str,
    email: String,
    admin: bool,
    module: OnceCell<bool>,
}

impl<'a> Caller<'a> {
    async fn new(seams: &'a Seams<'a>, org: &'a str, email: &str) -> Self {
        let email = email.trim().to_lowercase();
        let admin =
            seams.facts.is_root(&email).await || seams.facts.is_org_admin(org, &email).await;
        Self {
            seams,
            org,
            email,
            admin,
            module: OnceCell::new(),
        }
    }

    async fn may_approve(&self, connection_id: &str) -> Result<bool, ApproveError> {
        if self.admin {
            return Ok(true);
        }
        let facts = self.seams.facts;
        if !facts.rbac_on() {
            return Ok(false);
        }
        // A connection grant without AutoResolve access is refused by the routes before this check.
        let module = self
            .module
            .get_or_try_init(|| facts.has_module_access(self.org, &self.email))
            .await?;
        Ok(*module && facts.holds(self.org, &self.email, connection_id).await?)
    }

    /// Without role checks every caller passes the PUT route, and approve alone decides.
    async fn may_edit_module(&self) -> Result<bool, ApproveError> {
        if self.admin || !self.seams.facts.rbac_on() {
            return Ok(true);
        }
        Ok(self
            .seams
            .facts
            .may_edit_module(self.org, &self.email)
            .await?)
    }
}

/// The connection's AI toolset in OpenFGA; Update on it is the right to approve its changes.
pub fn connection_object(connection_id: &str) -> String {
    format!("{APPROVE_OBJECT_TYPE}:{connection_id}")
}

/// Every AI toolset of the org in OpenFGA, the object IAM's type-wide AI Toolsets row grants on.
pub fn all_connections_object(org: &str) -> String {
    connection_object(&format!("_all_{org}"))
}

/// Whether role-based access is on; while it is off only org admins may approve.
pub fn rbac_on() -> bool {
    LiveApproverFacts.rbac_on()
}

/// The toolsets `email` holds `permission` on, as OpenFGA objects; `None` is every toolset, as for
/// root and while role checks are off. An org admin's list holds the org's `_all_` object.
pub async fn permitted_connections(
    org: &str,
    email: &str,
    permission: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    if !rbac_on() {
        return Ok(None);
    }
    db::authz::list_permitted_objects(org, email, permission, APPROVE_OBJECT_TYPE).await
}

/// Whether a list from [permitted_connections] holds the toolset `id`; `None` holds every one.
pub(crate) fn is_permitted(org: &str, id: &str, permitted: Option<&[String]>) -> bool {
    crate::auth::is_ofga_object_visible(org, APPROVE_OBJECT_TYPE, id, permitted)
}

/// Whether the caller may approve changes through each connection, deciding who they are once.
pub(crate) async fn may_approve_each(
    org: &str,
    email: &str,
    connection_ids: &[String],
) -> Vec<bool> {
    let seams = Seams::live().await;
    let caller = Caller::new(&seams, org, email).await;
    let mut allowed = Vec::with_capacity(connection_ids.len());
    for id in connection_ids {
        let ok = caller.may_approve(id).await.unwrap_or_else(|e| {
            log::error!("[autoresolve] approve permission on {id} unknown: {e}");
            false
        });
        allowed.push(ok);
    }
    allowed
}

/// Who may approve changes through these connections: the holding roles, their groups, then the
/// org admins.
pub async fn approvers_for(org: &str, connection_ids: &[String]) -> Vec<Approver> {
    let seams = Seams::live().await;
    approvers_for_with(&seams, org, connection_ids)
        .await
        .unwrap_or_else(|e| {
            log::error!("[autoresolve] approvers of {connection_ids:?} unknown: {e}");
            vec![Approver::org_admins()]
        })
}

/// Approves one option of the plan `fingerprint` names and starts the turn that runs its steps.
pub async fn approve(
    org: &str,
    run_id: &str,
    email: &str,
    option_id: &str,
    fingerprint: &str,
) -> Result<(), ApproveError> {
    let seams = Seams::live().await;
    approve_with(&seams, org, run_id, email, option_id, fingerprint).await
}

/// Ends a waiting run without running anything; the requester or any approver may decline.
/// A given `fingerprint` must name the plan still waiting.
pub async fn decline(
    org: &str,
    run_id: &str,
    email: &str,
    fingerprint: Option<&str>,
) -> Result<(), ApproveError> {
    decline_with(&Seams::live().await, org, run_id, email, fingerprint).await
}

/// Drops the waiting plan, or follows up a run that made things worse or did not fix it, with a
/// new planning turn that reads the note; a correction is also stored.
pub async fn replan(
    org: &str,
    run_id: &str,
    email: &str,
    input: ReplanInput,
) -> Result<(), ApproveError> {
    replan_with(&Seams::live().await, org, run_id, email, input).await
}

pub(crate) async fn approvers_for_with(
    seams: &Seams<'_>,
    org: &str,
    connection_ids: &[String],
) -> Result<Vec<Approver>, ApproveError> {
    let mut out = Vec::new();
    if seams.facts.rbac_on() {
        let holders = seams.facts.holders(org, connection_ids).await?;
        let named: Vec<String> = holders
            .roles
            .into_iter()
            .filter(|r| r.module_access)
            .map(|r| r.name)
            .collect();
        let groups: Vec<Approver> = holders
            .groups
            .into_iter()
            .filter(|g| g.via_roles.iter().any(|r| named.contains(r)))
            .map(|g| Approver {
                kind: ApproverKind::Group,
                name: g.name,
            })
            .collect();
        out.extend(named.into_iter().map(|name| Approver {
            kind: ApproverKind::Role,
            name,
        }));
        out.extend(groups);
    }
    out.push(Approver::org_admins());
    Ok(out)
}

/// Why the person may not change a saved AutoResolve over `connections`, or `None` when they may:
/// the save rule, PUT on AutoResolve plus approve on every connection. `action` ends the sentence.
pub(crate) async fn edit_refusal_with(
    seams: &Seams<'_>,
    org: &str,
    email: &str,
    connections: &[AutoResolveConnectionRef],
    action: &str,
) -> Result<Option<ApproveError>, ApproveError> {
    let caller = Caller::new(seams, org, email).await;
    if !caller.may_edit_module().await? {
        return Ok(Some(ApproveError::CannotChange {
            reason: format!("Only someone who may edit AutoResolve can {action}."),
            approvers: vec![Approver::org_admins()],
        }));
    }
    for connection in connections {
        if !caller.may_approve(&connection.id).await? {
            let ids = std::slice::from_ref(&connection.id);
            return Ok(Some(ApproveError::CannotChange {
                reason: format!(
                    "Only someone who may approve changes through {} can {action}.",
                    named_mcp(&connection.name)
                ),
                approvers: approvers_for_with(seams, org, ids).await?,
            }));
        }
    }
    Ok(None)
}

/// The first of `connection_ids` the person may not approve changes through.
pub(crate) async fn first_unapproved_with(
    seams: &Seams<'_>,
    org: &str,
    email: &str,
    connection_ids: &[String],
) -> Result<Option<String>, ApproveError> {
    let caller = Caller::new(seams, org, email).await;
    for id in connection_ids {
        if !caller.may_approve(id).await? {
            return Ok(Some(id.clone()));
        }
    }
    Ok(None)
}

pub(crate) async fn approve_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    email: &str,
    option_id: &str,
    fingerprint: &str,
) -> Result<(), ApproveError> {
    let now = now_micros();
    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    check_decidable(&run, fingerprint, now)?;
    let option: Vec<StepRow> = autoresolve_steps::list_for_run_with(seams.db, org, run_id)
        .await?
        .into_iter()
        .filter(|s| {
            s.revision == run.revision
                && s.option_id.as_deref() == Some(option_id)
                && s.state == StepState::Proposed.as_str()
        })
        .collect();
    if option.is_empty() {
        return Err(ApproveError::UnknownOption);
    }
    let pins = pin_connections(seams.connections, org, &option).await?;
    let ids = connection_ids(&option);
    let caller = Caller::new(seams, org, email).await;
    for id in &ids {
        if !caller.may_approve(id).await? {
            let approvers = approvers_for_with(seams, org, &ids).await?;
            return Err(ApproveError::NoPermission { approvers });
        }
    }

    let txn = seams.db.begin().await?;
    // A replan and a new plan between the reads above and here would leave `option` stale.
    let current = autoresolve_runs::locked(&txn, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    check_decidable(&current, fingerprint, now)?;
    let patch = RunPatch {
        chosen_option_id: Some(Some(option_id.to_string())),
        approved_by: Some(Some(email.trim().to_string())),
        approved_at_us: Some(Some(now)),
        approval_deadline_us: Some(None),
        turn_deadline_us: Some(Some(turn_deadline_us(now))),
        turn_started_at_us: Some(Some(now)),
        updated_at_us: now,
        ..Default::default()
    };
    let to = RunState::Proceeding;
    if !transition_with(&txn, org, run_id, &[RunState::WaitingApproval], to, patch).await? {
        return Err(ApproveError::NotWaiting);
    }
    let approved =
        autoresolve_steps::approve_with(&txn, org, run_id, current.revision, option_id, &pins)
            .await?;
    if usize::try_from(approved).ok() != Some(option.len()) {
        return Err(ApproveError::PlanChanged);
    }
    txn.commit().await?;
    after_transition(org, run_id, to).await;

    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    let steps: Vec<StepRow> = autoresolve_steps::list_for_run_with(seams.db, org, run_id)
        .await?
        .into_iter()
        .filter(|s| {
            s.revision == run.revision
                && s.option_id.as_deref() == Some(option_id)
                && s.state == StepState::Approved.as_str()
        })
        .collect();
    if let Err(e) = seams.turns.execute(&run, &steps).await {
        return Err(ApproveError::Turn(fail_launch(seams, &run, to, &e).await));
    }
    Ok(())
}

pub(crate) async fn decline_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    email: &str,
    fingerprint: Option<&str>,
) -> Result<(), ApproveError> {
    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .filter(|r| waiting_in_time(r, now_micros()))
        .ok_or(ApproveError::NotWaiting)?;
    same_plan(&run, fingerprint)?;
    authorize_decision(seams, &run, email).await?;
    let to = RunState::Declined;
    let txn = seams.db.begin().await?;
    let current = locked_unchanged(&txn, &run).await?;
    same_plan(&current, fingerprint)?;
    let from = [RunState::WaitingApproval];
    if !transition_with(&txn, org, run_id, &from, to, RunPatch::default()).await? {
        return Err(ApproveError::NotWaiting);
    }
    move_steps(&txn, &current, StepState::Proposed, StepState::NotRun).await?;
    txn.commit().await?;
    after_transition(org, run_id, to).await;
    Ok(())
}

pub(crate) async fn replan_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    email: &str,
    input: ReplanInput,
) -> Result<(), ApproveError> {
    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    let now = now_micros();
    let from = RunState::parse(&run.state)
        .filter(|s| replannable(*s, &run, input.kind, now))
        .ok_or_else(|| match input.kind {
            Some(CorrectionKind::NotFixed) => ApproveError::WrongState(VERDICT_STATE.to_string()),
            _ => ApproveError::NotWaiting,
        })?;
    authorize_decision(seams, &run, email).await?;
    let mut patch = replan_patch(from, now);
    let correction = match input.kind {
        Some(kind) => {
            let note = clean_correction(&input.note).ok_or(ApproveError::NoteRequired)?;
            if kind == CorrectionKind::NotFixed {
                patch.person_verdict = Some(Some(not_fixed_verdict(&run, &note, email, now)));
            }
            let option = match kind {
                CorrectionKind::NotFixed => run.chosen_option_id.as_deref(),
                _ => input.option_id.as_deref(),
            };
            Some(NewCorrection {
                org: org.to_string(),
                autoresolve_id: run.autoresolve_id.clone(),
                run_id: run.id.clone(),
                revision: run.revision,
                kind,
                option_title: option.and_then(|id| option_title(&run, id)),
                note,
                created_by: email.trim().to_lowercase(),
                created_at_us: now,
                active: input.remember && run.autoresolve_id.is_some(),
            })
        }
        None => None,
    };
    let note = correction
        .as_ref()
        .map(|c| c.note.clone())
        .or_else(|| clean_note(&input.note));
    let txn = seams.db.begin().await?;
    let current = locked_unchanged(&txn, &run).await?;
    if let Some(correction) = correction {
        autoresolve_corrections::insert_with(&txn, correction).await?;
    }
    relaunch_planning(seams, txn, &current, from, patch, note.as_deref()).await
}

/// Moves the locked run back to investigating with `patch`, supersedes its proposed steps,
/// commits, and starts the planning turn that reads `note`.
pub(crate) async fn relaunch_planning(
    seams: &Seams<'_>,
    txn: DatabaseTransaction,
    run: &RunRow,
    from: RunState,
    mut patch: RunPatch,
    note: Option<&str>,
) -> Result<(), ApproveError> {
    let (org, run_id, to) = (run.org.as_str(), run.id.as_str(), RunState::Investigating);
    patch.plan_history = history_keeping_attempt(run);
    if !transition_with(&txn, org, run_id, &[from], to, patch).await? {
        return Err(ApproveError::NotWaiting);
    }
    move_steps(&txn, run, StepState::Proposed, StepState::Superseded).await?;
    txn.commit().await?;
    after_transition(org, run_id, to).await;

    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    if let Err(e) = seams.turns.planning(&run, note).await {
        return Err(ApproveError::Turn(fail_launch(seams, &run, to, &e).await));
    }
    Ok(())
}

/// The next plan needs its own approval, as after a hold; the agent's verdict goes with it.
pub(crate) fn replan_patch(from: RunState, now: i64) -> RunPatch {
    RunPatch {
        chosen_option_id: Some(None),
        approved_by: Some(None),
        approved_at_us: Some(None),
        approval_deadline_us: Some(None),
        turn_deadline_us: Some(Some(turn_deadline_us(now))),
        turn_started_at_us: Some(Some(now)),
        check_retried_at_us: Some(None),
        outcome_verdict: Some(None),
        outcome_explanation: Some(None),
        prior_verdict: (from == RunState::Worse).then(|| Verdict::Worse.as_str().to_string()),
        error: Some(None),
        updated_at_us: now,
        ..Default::default()
    }
}

/// The run's requester, or anyone who may approve one of its connections, may decide on it.
pub(crate) async fn authorize_decision(
    seams: &Seams<'_>,
    run: &RunRow,
    email: &str,
) -> Result<(), ApproveError> {
    if same_email(&run.requester, email) {
        return Ok(());
    }
    let steps = autoresolve_steps::list_for_run_with(seams.db, &run.org, &run.id).await?;
    let current: Vec<StepRow> = steps
        .into_iter()
        .filter(|s| s.revision == run.revision)
        .collect();
    let mut ids = connection_ids(&current);
    // A plan without options has no steps; its run's own connections decide who may answer it.
    if ids.is_empty() {
        ids = run_connection_ids(run)?;
    }
    let caller = Caller::new(seams, &run.org, email).await;
    if caller.admin {
        return Ok(());
    }
    for id in &ids {
        if caller.may_approve(id).await? {
            return Ok(());
        }
    }
    let approvers = approvers_for_with(seams, &run.org, &ids).await?;
    Err(ApproveError::NoPermission { approvers })
}

/// The run under its row lock, refused when it moved on since `seen` was read.
pub(crate) async fn locked_unchanged(
    txn: &sea_orm::DatabaseTransaction,
    seen: &RunRow,
) -> Result<RunRow, ApproveError> {
    autoresolve_runs::locked(txn, &seen.org, &seen.id)
        .await?
        .filter(|r| r.state == seen.state && r.revision == seen.revision)
        .ok_or(ApproveError::NotWaiting)
}

/// The person's verdict as the run stores it, next to the agent's own; a run that ended without
/// a check (`outcome_unknown`) gives its end state as the agent's.
pub(crate) fn person_verdict_json(
    run: &RunRow,
    verdict: PersonVerdict,
    note: Option<&str>,
    email: &str,
    now: i64,
) -> String {
    serde_json::json!({
        "verdict": verdict.as_str(),
        "note": note,
        "by": email.trim().to_lowercase(),
        "at_us": now,
        "revision": run.revision,
        "agent_verdict": run.outcome_verdict.as_deref().unwrap_or(&run.state),
        "agent_explanation": run.outcome_explanation,
        "agent_checked_at_us": run.ended_at_us,
    })
    .to_string()
}

/// The sweeper may not have lapsed a run past its approval deadline yet, so every decision
/// checks the deadline itself.
pub(crate) fn waiting_in_time(run: &RunRow, now_us: i64) -> bool {
    run.state == RunState::WaitingApproval.as_str()
        && run.approval_deadline_us.is_none_or(|d| now_us <= d)
}

/// The run waits for a decision on exactly the plan the person saw.
fn check_decidable(run: &RunRow, fingerprint: &str, now_us: i64) -> Result<(), ApproveError> {
    if !waiting_in_time(run, now_us) {
        return Err(ApproveError::NotWaiting);
    }
    same_plan(run, Some(fingerprint))
}

/// A decision that names a plan applies only while that plan is the one waiting.
fn same_plan(run: &RunRow, fingerprint: Option<&str>) -> Result<(), ApproveError> {
    match fingerprint {
        Some(fp) if run.plan_fingerprint.as_deref() != Some(fp) => Err(ApproveError::PlanChanged),
        _ => Ok(()),
    }
}

/// Each connection's fingerprint as it is now, refusing one that is gone or renamed, because
/// its steps could no longer run.
async fn pin_connections(
    source: &dyn ConnectionSource,
    org: &str,
    steps: &[StepRow],
) -> Result<HashMap<String, String>, ApproveError> {
    let mut pins = HashMap::new();
    for step in steps {
        if pins.contains_key(&step.connection_id) {
            continue;
        }
        let conn = source
            .get(org, &step.connection_id)
            .await?
            .filter(|c| c.id == step.connection_id)
            .ok_or_else(|| ApproveError::ConnectionRemoved {
                connection: AutoResolveConnectionRef {
                    id: step.connection_id.clone(),
                    name: step.connection_name.clone(),
                    removed: true,
                },
            })?;
        if normalize_tool_name(&conn.name) != step.connection_name {
            return Err(ApproveError::ConnectionRenamed {
                name: step.connection_name.clone(),
            });
        }
        pins.insert(step.connection_id.clone(), conn.fingerprint);
    }
    Ok(pins)
}

async fn move_steps<C: ConnectionTrait>(
    conn: &C,
    run: &RunRow,
    from: StepState,
    to: StepState,
) -> Result<u64, ApproveError> {
    let ids: Vec<String> = autoresolve_steps::list_for_run_with(conn, &run.org, &run.id)
        .await?
        .into_iter()
        .filter(|s| s.revision == run.revision && s.state == from.as_str())
        .map(|s| s.id)
        .collect();
    Ok(autoresolve_steps::set_many(conn, &run.org, &ids, &[from], to).await?)
}

/// Fails a run whose next turn could not start, as a run whose first turn could not start is
/// failed; returns the sentence stored on the run.
async fn fail_launch(
    seams: &Seams<'_>,
    run: &RunRow,
    from: RunState,
    e: &AutoResolveError,
) -> String {
    log::error!("[autoresolve] run {} turn could not start: {e}", run.id);
    let shown = match e {
        AutoResolveError::Db(_) => "The AI turn could not start.".to_string(),
        e => e.to_string(),
    };
    if let Err(err) = settle_failed(seams.db, run, from, &shown).await {
        log::error!("[autoresolve] run {} could not be failed: {err}", run.id);
    }
    shown
}

async fn settle_failed(
    db: &DatabaseConnection,
    run: &RunRow,
    from: RunState,
    shown: &str,
) -> Result<(), ApproveError> {
    let to = RunState::Failed;
    let patch = RunPatch {
        error: Some(Some(shown.to_string())),
        ..Default::default()
    };
    let txn = db.begin().await?;
    let moved = transition_with(&txn, &run.org, &run.id, &[from], to, patch).await?;
    if moved {
        let steps = autoresolve_steps::list_for_run_with(&txn, &run.org, &run.id).await?;
        mark_not_run(&txn, &run.org, &chosen_steps(run, &steps)).await?;
    }
    txn.commit().await?;
    if moved {
        after_transition(&run.org, &run.id, to).await;
    }
    Ok(())
}

/// One row per role, sorted by name.
fn one_row_per_role(
    grants: impl IntoIterator<Item = String>,
    module: &[String],
) -> Vec<RoleHolder> {
    let names: BTreeSet<String> = grants.into_iter().collect();
    names
        .into_iter()
        .map(|name| RoleHolder {
            module_access: module.contains(&name),
            name,
        })
        .collect()
}

/// The OpenFGA object the AutoResolve routes check, for every run of the org.
fn module_object(org: &str) -> String {
    format!("autoresolve:_all_{org}")
}

fn connection_ids(steps: &[StepRow]) -> Vec<String> {
    distinct_ids(steps.iter().map(|s| s.connection_id.as_str()))
}

/// A replan without a kind is today's; a correction of the plan needs it still waiting, and
/// "not fixed" needs a run that made its change.
fn replannable(state: RunState, run: &RunRow, kind: Option<CorrectionKind>, now: i64) -> bool {
    match kind {
        None => state == RunState::Worse || waiting_in_time(run, now),
        Some(CorrectionKind::NotFixed) => matches!(
            state,
            RunState::Worked | RunState::OutcomeUnknown | RunState::Worse
        ),
        Some(_) => waiting_in_time(run, now),
    }
}

fn not_fixed_verdict(run: &RunRow, note: &str, email: &str, now: i64) -> String {
    person_verdict_json(run, PersonVerdict::NotFixed, Some(note), email, now)
}

/// The stored plan's title of the option with this id.
fn option_title(run: &RunRow, option_id: &str) -> Option<String> {
    let plan: PlanInput = serde_json::from_str(run.plan.as_deref()?).ok()?;
    let at = OPTION_IDS.iter().position(|id| *id == option_id)?;
    plan.options.into_iter().nth(at).map(|o| o.title)
}

fn clean_correction(note: &str) -> Option<String> {
    let note = note.trim();
    (!note.is_empty()).then(|| note.chars().take(MAX_CORRECTION_CHARS).collect())
}

fn clean_note(note: &str) -> Option<String> {
    let note = note.trim();
    (!note.is_empty()).then(|| note.chars().take(MAX_NOTE_CHARS).collect())
}

fn same_email(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use infra::table::entity::autoresolve_steps::Entity as Steps;
    use o2_enterprise::enterprise::ai::toolsets::AutoResolveConnection;
    use sea_orm::EntityTrait;
    use tokio::sync::Barrier;

    use super::*;
    use crate::autoresolve::{
        live::AutoResolvePersonVerdict,
        test_support::{ORG, RecordingTurns, memory_db, new_run, new_step},
    };

    const RUN: &str = "run1";
    const PLAN_FP: &str = "plan-fp-1";
    const BOB: &str = "bob@example.com";
    const ADA: &str = "ada@example.com";
    const BOTH: Connections = Connections(&[("c1", "github"), ("c2", "k8s")]);
    const FACTS: Facts = Facts {
        rbac: true,
        bypassed: false,
    };
    /// `(role, connection)`: `sre` holds approve on c1 and c2, `dba` on c1 only, `ops` on both.
    const GRANTS: [(&str, &str); 5] = [
        ("sre", "c1"),
        ("sre", "c2"),
        ("dba", "c1"),
        ("ops", "c1"),
        ("ops", "c2"),
    ];
    /// The roles that also hold AutoResolve GET and POST; `ops` does not.
    const MODULE: [&str; 2] = ["sre", "dba"];
    /// Gus holds `sre` through the group `platform`; Bob is assigned `dba`, Olga `ops`.
    const MEMBERS: [(&str, &str); 3] = [
        ("gus@example.com", "sre"),
        (BOB, "dba"),
        ("olga@example.com", "ops"),
    ];

    type Check = fn(&Result<(), ApproveError>) -> bool;

    /// Registered connections as `(id, key)`.
    struct Connections(&'static [(&'static str, &'static str)]);

    #[async_trait::async_trait]
    impl ConnectionSource for Connections {
        async fn get(&self, _org: &str, id: &str) -> anyhow::Result<Option<AutoResolveConnection>> {
            let found = self.0.iter().find(|(c, _)| *c == id);
            Ok(found.map(|(id, name)| AutoResolveConnection {
                id: id.to_string(),
                name: name.to_string(),
                url: format!("https://{name}.example"),
                read_headers: HashMap::new(),
                write_headers: HashMap::new(),
                fingerprint: format!("conn-fp-{id}"),
            }))
        }
    }

    /// [Connections] whose first two lookups wait for each other, so both callers pass the checks
    /// made before the transaction before either opens it.
    struct Racing {
        connections: Connections,
        barrier: Barrier,
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl ConnectionSource for Racing {
        async fn get(&self, org: &str, id: &str) -> anyhow::Result<Option<AutoResolveConnection>> {
            if self.calls.fetch_add(1, Ordering::SeqCst) < 2 {
                self.barrier.wait().await;
            }
            self.connections.get(org, id).await
        }
    }

    /// [GRANTS] and [MEMBERS] as OpenFGA would answer them; Ada is an org admin.
    struct Facts {
        rbac: bool,
        bypassed: bool,
    }

    #[async_trait::async_trait]
    impl ApproverFacts for Facts {
        async fn is_root(&self, email: &str) -> bool {
            email == "root@example.com"
        }

        async fn is_org_admin(&self, _org: &str, email: &str) -> bool {
            email == ADA
        }

        fn openfga_on(&self) -> bool {
            self.rbac
        }

        fn checks_bypassed(&self) -> bool {
            self.bypassed
        }

        async fn holds(&self, _org: &str, email: &str, connection: &str) -> anyhow::Result<bool> {
            let held = |role: &str| GRANTS.contains(&(role, connection));
            Ok(MEMBERS
                .iter()
                .any(|(who, role)| *who == email && held(role)))
        }

        async fn has_module_access(&self, _org: &str, email: &str) -> anyhow::Result<bool> {
            let held = |role: &str| MODULE.contains(&role);
            Ok(MEMBERS
                .iter()
                .any(|(who, role)| *who == email && held(role)))
        }

        async fn may_edit_module(&self, org: &str, email: &str) -> anyhow::Result<bool> {
            self.has_module_access(org, email).await
        }

        async fn holders(&self, _org: &str, ids: &[String]) -> anyhow::Result<Holders> {
            let mut roles: Vec<&str> = Vec::new();
            for (role, connection) in GRANTS {
                if ids.iter().any(|id| id == connection) && !roles.contains(&role) {
                    roles.push(role);
                }
            }
            let groups = roles.contains(&"sre").then(|| GroupHolder {
                name: "platform".to_string(),
                via_roles: vec!["sre".to_string()],
            });
            let roles = roles.into_iter().map(|name| RoleHolder {
                name: name.to_string(),
                module_access: MODULE.contains(&name),
            });
            Ok(Holders {
                roles: roles.collect(),
                groups: groups.into_iter().collect(),
            })
        }
    }

    /// A run waiting on revision 1: option A = [c1], option B = [c2, c1].
    async fn waiting_run() -> DatabaseConnection {
        waiting_until(i64::MAX).await
    }

    async fn waiting_until(approval_deadline_us: i64) -> DatabaseConnection {
        let db = memory_db().await;
        autoresolve_runs::insert_with(&db, new_run(RUN))
            .await
            .unwrap();
        let patch = RunPatch {
            plan: Some("{}".into()),
            plan_fingerprint: Some(PLAN_FP.into()),
            approval_deadline_us: Some(Some(approval_deadline_us)),
            updated_at_us: 2,
            ..Default::default()
        };
        let from = [RunState::Investigating];
        let to = RunState::WaitingApproval;
        assert!(
            autoresolve_runs::set_state_with(&db, ORG, RUN, &from, to, patch)
                .await
                .unwrap()
        );
        let steps = vec![
            new_step(RUN, "a1", "A", 1, "c1", "github"),
            new_step(RUN, "b1", "B", 1, "c2", "k8s"),
            new_step(RUN, "b2", "B", 2, "c1", "github"),
        ];
        autoresolve_steps::insert_many(&db, steps).await.unwrap();
        db
    }

    /// Step id -> (state, connection fingerprint).
    async fn step_rows(db: &DatabaseConnection) -> HashMap<String, (String, Option<String>)> {
        let rows = Steps::find().all(db).await.unwrap();
        rows.into_iter()
            .map(|s| (s.id, (s.state, s.connection_fingerprint)))
            .collect()
    }

    async fn run_state(db: &DatabaseConnection) -> String {
        let run = autoresolve_runs::get_with(db, ORG, RUN)
            .await
            .unwrap()
            .unwrap();
        run.state
    }

    #[tokio::test]
    async fn approve_twice_concurrently_one_wins() {
        let db = waiting_run().await;
        let turns = RecordingTurns::default();
        let racing = Racing {
            connections: BOTH,
            barrier: Barrier::new(2),
            calls: AtomicUsize::new(0),
        };
        let seams = Seams {
            db: &db,
            turns: &turns,
            connections: &racing,
            facts: &FACTS,
        };
        let (first, second) = tokio::join!(
            approve_with(&seams, ORG, RUN, BOB, "A", PLAN_FP),
            approve_with(&seams, ORG, RUN, ADA, "B", PLAN_FP),
        );
        let results = [first, second];
        assert_eq!(
            results.iter().filter(|r| r.is_ok()).count(),
            1,
            "{results:?}"
        );
        assert!(
            results
                .iter()
                .any(|r| matches!(r, Err(ApproveError::NotWaiting))),
            "{results:?}"
        );
        let executed = turns.executed.lock().unwrap().clone();
        assert_eq!(executed.len(), 1, "exactly one execute turn");
        let mut approved: Vec<String> = step_rows(&db)
            .await
            .into_iter()
            .filter(|(_, (state, _))| state == "approved")
            .map(|(id, _)| id)
            .collect();
        approved.sort();
        assert_eq!(
            approved, executed[0],
            "only the winner's steps are approved"
        );
        assert_eq!(run_state(&db).await, "proceeding");
    }

    #[tokio::test]
    async fn approve_refuses_without_permission_and_names_approvers() {
        // (OpenFGA on, cloud switch answering every check allowed)
        const ON: (bool, bool) = (true, false);
        const OFF: (bool, bool) = (false, false);
        const BYPASSED: (bool, bool) = (true, true);
        #[rustfmt::skip]
        let cases: [(&str, &str, (bool, bool), bool); 12] = [
            ("eve@example.com", "B", ON, false), // holds no role
            (BOB, "B", ON, false),               // dba holds c1 only; B also needs c2
            ("BOB@Example.com", "A", ON, true),  // dba holds c1, any case
            ("gus@example.com", "B", ON, true),  // sre through its group holds both
            ("olga@example.com", "A", ON, false), // ops holds c1 but not AutoResolve access
            (ADA, "B", ON, true),
            ("root@example.com", "B", ON, true),
            ("gus@example.com", "B", OFF, false), // role grants count for nothing with RBAC off
            (BOB, "A", OFF, false),
            (ADA, "B", OFF, true),
            ("gus@example.com", "B", BYPASSED, false), // a passed check proves no grant
            (ADA, "B", BYPASSED, true),
        ];
        let named_roles = vec![
            (ApproverKind::Role, "sre".to_string()),
            (ApproverKind::Role, "dba".to_string()),
            (ApproverKind::Group, "platform".to_string()),
            (ApproverKind::OrgAdmins, String::new()),
        ];
        let admins_only = vec![(ApproverKind::OrgAdmins, String::new())];
        for (email, option, (rbac, bypassed), allowed) in cases {
            let db = waiting_run().await;
            let turns = RecordingTurns::default();
            let facts = Facts { rbac, bypassed };
            let seams = Seams {
                db: &db,
                turns: &turns,
                connections: &BOTH,
                facts: &facts,
            };
            let res = approve_with(&seams, ORG, RUN, email, option, PLAN_FP).await;
            let executed = turns.executed.lock().unwrap().len();
            if allowed {
                assert!(res.is_ok(), "{email} {option}: {res:?}");
                assert_eq!(executed, 1, "{email} {option}");
                continue;
            }
            let Err(ApproveError::NoPermission { approvers }) = res else {
                panic!("{email} {option}: {res:?}");
            };
            let named: Vec<(ApproverKind, String)> = approvers
                .into_iter()
                .map(|a| match a.kind {
                    ApproverKind::OrgAdmins => (a.kind, String::new()),
                    _ => (a.kind, a.name),
                })
                .collect();
            let want = if (rbac, bypassed) == ON {
                &named_roles
            } else {
                &admins_only
            };
            assert_eq!(
                &named, want,
                "{email} {option} rbac {rbac} bypassed {bypassed}"
            );
            assert_eq!(run_state(&db).await, "waiting_approval", "{email} {option}");
            assert_eq!(executed, 0, "{email} {option}");
        }
    }

    #[tokio::test]
    async fn approve_pins_only_the_chosen_option() {
        let partial = Connections(&[("c1", "github")]);
        let renamed = Connections(&[("c1", "github"), ("c2", "kube")]);
        let removed: Check = |r| {
            matches!(r, Err(ApproveError::ConnectionRemoved { connection })
                if connection.id == "c2" && connection.name == "k8s" && connection.removed)
        };
        let moved: Check =
            |r| matches!(r, Err(ApproveError::ConnectionRenamed { name }) if name == "k8s");
        let (open, lapsed) = (i64::MAX, 1);
        let cases: [(&str, &Connections, &str, i64, Check); 5] = [
            ("chosen", &BOTH, PLAN_FP, open, |r| r.is_ok()),
            ("stale_fingerprint", &BOTH, "plan-fp-0", open, |r| {
                matches!(r, Err(ApproveError::PlanChanged))
            }),
            ("connection_deleted", &partial, PLAN_FP, open, removed),
            ("connection_renamed", &renamed, PLAN_FP, open, moved),
            ("past_deadline", &BOTH, PLAN_FP, lapsed, |r| {
                matches!(r, Err(ApproveError::NotWaiting))
            }),
        ];
        for (case, connections, fingerprint, deadline, check) in cases {
            let db = waiting_until(deadline).await;
            let turns = RecordingTurns::default();
            let seams = Seams {
                db: &db,
                turns: &turns,
                connections,
                facts: &FACTS,
            };
            let res = approve_with(&seams, ORG, RUN, ADA, "B", fingerprint).await;
            assert!(check(&res), "{case}: {res:?}");
            if fingerprint != PLAN_FP {
                let declined = decline_with(&seams, ORG, RUN, ADA, Some(fingerprint)).await;
                assert!(check(&declined), "{case} decline: {declined:?}");
            }
            if deadline < now_micros() {
                let declined = decline_with(&seams, ORG, RUN, ADA, Some(fingerprint)).await;
                let replanned = replan_with(&seams, ORG, RUN, ADA, ReplanInput::default()).await;
                for other in [declined, replanned] {
                    assert!(matches!(other, Err(ApproveError::NotWaiting)), "{case}");
                }
            }
            let rows = step_rows(&db).await;
            let executed = turns.executed.lock().unwrap().clone();
            if res.is_err() {
                assert!(
                    rows.values().all(|(s, fp)| s == "proposed" && fp.is_none()),
                    "{case}: {rows:?}"
                );
                assert_eq!(run_state(&db).await, "waiting_approval", "{case}");
                assert!(executed.is_empty(), "{case}");
                continue;
            }
            let row = |id: &str| rows.get(id).cloned();
            let pinned = |fp: &str| Some(("approved".to_string(), Some(fp.to_string())));
            assert_eq!(row("b1"), pinned("conn-fp-c2"), "{case}");
            assert_eq!(row("b2"), pinned("conn-fp-c1"), "{case}");
            assert_eq!(row("a1"), Some(("superseded".to_string(), None)), "{case}");
            assert_eq!(
                executed,
                vec![vec!["b1".to_string(), "b2".to_string()]],
                "{case}"
            );
            let run = autoresolve_runs::get_with(&db, ORG, RUN)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(run.state, "proceeding", "{case}");
            assert_eq!(run.chosen_option_id.as_deref(), Some("B"), "{case}");
            assert_eq!(run.approved_by.as_deref(), Some(ADA), "{case}");
            assert!(run.turn_deadline_us.is_some(), "{case}");
            assert_eq!(run.approval_deadline_us, None, "{case}");

            let worse = RunPatch {
                outcome_verdict: Some(Some("worse".into())),
                updated_at_us: now_micros(),
                ..Default::default()
            };
            let (from, to) = ([RunState::Proceeding], RunState::Worse);
            autoresolve_runs::set_state_with(&db, ORG, RUN, &from, to, worse)
                .await
                .unwrap();
            let revert = ReplanInput {
                note: "revert it".into(),
                ..Default::default()
            };
            replan_with(&seams, ORG, RUN, ADA, revert).await.unwrap();
            let run = autoresolve_runs::get_with(&db, ORG, RUN)
                .await
                .unwrap()
                .unwrap();
            let approval = (
                run.chosen_option_id,
                run.approved_by,
                run.approved_at_us,
                run.approval_deadline_us,
            );
            assert_eq!(
                approval,
                (None, None, None, None),
                "{case}: replan drops it"
            );
            assert_eq!(run.state, "investigating", "{case}");
            assert_eq!(run.prior_verdict.as_deref(), Some("worse"), "{case}");
        }
    }

    /// RUN in `state` at revision 1 over options A "restart" = [c1] and B "roll back" = [c2, c1],
    /// A chosen once it ended; `flow` makes it a saved AutoResolve's run.
    async fn run_in(state: RunState, flow: Option<&str>) -> DatabaseConnection {
        let db = memory_db().await;
        let run = autoresolve_runs::NewRun {
            autoresolve_id: flow.map(String::from),
            ..new_run(RUN)
        };
        autoresolve_runs::insert_with(&db, run).await.unwrap();
        let option = |title: &str| {
            serde_json::json!({"title": title, "recommended": false, "changes_production_directly": false,
                "tradeoffs": "", "reason": "", "steps": []})
        };
        let plan = serde_json::json!({"options": [option("restart"), option("roll back")],
            "omitted_count": 0, "omitted_reason": null, "missing_capability": null});
        let ended = state != RunState::WaitingApproval;
        let patch = RunPatch {
            plan: Some(plan.to_string()),
            plan_fingerprint: Some(PLAN_FP.into()),
            approval_deadline_us: Some(Some(i64::MAX)),
            chosen_option_id: Some(ended.then(|| "A".to_string())),
            outcome_verdict: Some((state == RunState::Worked).then(|| "worked".to_string())),
            ended_at_us: Some(ended.then_some(5)),
            updated_at_us: 2,
            ..Default::default()
        };
        let from = [RunState::Investigating];
        assert!(
            autoresolve_runs::set_state_with(&db, ORG, RUN, &from, state, patch)
                .await
                .unwrap()
        );
        let steps = vec![
            new_step(RUN, "a1", "A", 1, "c1", "github"),
            new_step(RUN, "b1", "B", 1, "c2", "k8s"),
            new_step(RUN, "b2", "B", 2, "c1", "github"),
        ];
        autoresolve_steps::insert_many(&db, steps).await.unwrap();
        db
    }

    #[tokio::test]
    async fn replan_with_a_kind_records_a_correction() {
        use CorrectionKind::*;
        use RunState::{OutcomeUnknown, WaitingApproval as Waiting, Worked};
        let saved = Some("f1");
        // (case, state, flow, kind, remember, note, refused, (active, option title))
        type Case = (
            &'static str,
            RunState,
            Option<&'static str>,
            CorrectionKind,
            bool,
            &'static str,
            Option<fn(&ApproveError) -> bool>,
            (bool, Option<&'static str>),
        );
        #[rustfmt::skip]
        let cases: [Case; 9] = [
            ("saved wrong fix", Waiting, saved, WrongFix, true, "use the canary", None, (true, Some("roll back"))),
            ("ad-hoc run", Waiting, None, WrongCause, true, "it is the cache", None, (false, Some("roll back"))),
            ("not remembered", Waiting, saved, OutOfScope, false, "leave billing alone", None, (false, Some("roll back"))),
            ("not fixed after it worked", Worked, saved, NotFixed, true, "still firing", None, (true, Some("restart"))),
            ("not fixed after an unknown outcome", OutcomeUnknown, saved, NotFixed, true, "still firing", None, (true, Some("restart"))),
            ("not fixed while waiting", Waiting, saved, NotFixed, true, "x", Some(|e| matches!(e, ApproveError::WrongState(m) if m.contains("ended after making its change"))), (false, None)),
            ("wrong fix after it worked", Worked, saved, WrongFix, true, "x", Some(|e| matches!(e, ApproveError::NotWaiting)), (false, None)),
            ("another run of it is live", Worked, saved, NotFixed, true, "still firing", Some(|e| matches!(e, ApproveError::AnotherRunLive)), (false, None)),
            ("empty note", Waiting, saved, WrongFix, true, "  ", Some(|e| matches!(e, ApproveError::NoteRequired)), (false, None)),
        ];
        for (case, state, flow, kind, remember, note, refused, (active, title)) in cases {
            let db = run_in(state, flow).await;
            if case == "another run of it is live" {
                let other = autoresolve_runs::NewRun {
                    autoresolve_id: flow.map(String::from),
                    ..new_run("run2")
                };
                autoresolve_runs::insert_with(&db, other).await.unwrap();
            }
            let turns = RecordingTurns::default();
            let seams = Seams {
                db: &db,
                turns: &turns,
                connections: &BOTH,
                facts: &FACTS,
            };
            let input = ReplanInput {
                note: note.into(),
                kind: Some(kind),
                remember,
                option_id: Some("B".into()),
            };
            let got = replan_with(&seams, ORG, RUN, ADA, input).await;
            let rows = autoresolve_corrections::for_run_with(&db, ORG, RUN)
                .await
                .unwrap();
            let run = autoresolve_runs::get_with(&db, ORG, RUN)
                .await
                .unwrap()
                .unwrap();
            if let Some(is_expected) = refused {
                assert!(got.as_ref().is_err_and(is_expected), "{case}: {got:?}");
                assert!(rows.is_empty(), "{case}: nothing stored");
                assert_eq!(run.state, state.as_str(), "{case}");
                continue;
            }
            got.unwrap();
            assert_eq!(rows.len(), 1, "{case}");
            assert_eq!(
                (rows[0].active, rows[0].option_title.as_deref()),
                (active, title),
                "{case}"
            );
            assert_eq!(
                (rows[0].note.as_str(), rows[0].kind.as_str()),
                (note, kind.as_str()),
                "{case}"
            );
            assert_eq!(run.state, "investigating", "{case}");
            assert_eq!(*turns.planned.lock().unwrap(), 1, "{case}");
            let verdict: Option<AutoResolvePersonVerdict> = run
                .person_verdict
                .as_deref()
                .map(|v| serde_json::from_str(v).unwrap());
            let shown = verdict.as_ref().map(|v| {
                let agent = v.agent_verdict.as_deref();
                (v.verdict.as_str(), agent, v.note.as_deref(), v.revision)
            });
            let want =
                (kind == NotFixed).then_some(("not_fixed", Some(state.as_str()), Some(note), 1));
            assert_eq!(
                shown, want,
                "{case}: the agent's verdict is kept beside the person's"
            );
        }
    }
}
