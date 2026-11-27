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

//! What the run page reads: the summary, the run list, one run's detail and its live stream.

use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
};

use config::{
    meta::{
        autoresolve::{
            PlanInput, PlanRevision, RunState, StepKind, StepRef, mcp_short_description,
            result_text,
        },
        oncall::{
            agent::Confidence,
            confidence::{ConfidenceBreakdown, ToolCallRecord, UnverifiedCitation},
            rca_run::{EvidenceEntry, SummaryHypothesis},
        },
    },
    utils::time::now_micros,
};
use infra::table::{
    ai_chat_sessions::{self, Model as SessionRow},
    ai_chat_turns, autoresolve as flows_table, autoresolve_corrections,
    autoresolve_runs::{self, RunFilter},
    autoresolve_steps,
    entity::{autoresolve_runs::Model as RunRow, autoresolve_steps::Model as StepRow},
    org_ai_toolsets,
};
use o2_enterprise::enterprise::{
    ai::toolsets::push::normalize_tool_name, common::config::get_config as get_o2_config,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::{
    AutoResolveError,
    approve::{self, Approver, Seams},
    changed_since, corrections, distinct_ids, evidence,
    grading::{grade_cause, option_band, plan_claim},
    json_or_text,
    plan::{OPTION_IDS, parse_missing_connection},
    trigger_by, trigger_label,
    turn::{Listed, not_connected},
};
use crate::{
    ai_chat::{
        rca_ledger::{decode_run_with, org_tool_classes},
        rca_thread::{self, RcaThread, Transcript},
        read_committed_prefix,
    },
    alerts::rca_live::{LIVE_STREAM_MAX, LiveFrame},
};

pub(super) const MCP_KIND: &str = "mcp";
const HEARTBEAT_AFTER_US: i64 = 15_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveConnectionRef {
    pub id: String,
    /// The connection's name, or the last one OpenObserve knew once it was removed.
    pub name: String,
    pub removed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveSummaryConnection {
    pub id: String,
    pub name: String,
    pub can_approve: bool,
}

/// `GET …/autoresolve/summary`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveSummary {
    pub connections: Vec<AutoResolveSummaryConnection>,
    /// The most connections a person may choose for one run or saved AutoResolve.
    pub max_connections: usize,
    pub region: String,
    pub triggers_fire_here: bool,
    /// False where Slack is off (a super cluster, or the Slack flag), so triggers cannot be on.
    pub slack_approval_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveTrigger {
    /// `person`, `alert` or `incident`.
    pub kind: String,
    /// Who or what started the run, as a noun phrase: "the alert X", "the incident Y" or the
    /// person; `label` is the sentence "Started by " + `by`.
    pub by: String,
    pub label: String,
    /// The alert that started the run, or whose incident did.
    pub alert_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveRunRow {
    pub id: String,
    pub goal: String,
    pub state: String,
    pub trigger: AutoResolveTrigger,
    pub requester: String,
    /// The connections the run was started with, in the order chosen.
    pub connections: Vec<AutoResolveConnectionRef>,
    pub created_at_us: i64,
    pub ended_at_us: Option<i64>,
    /// The run ended because no MCP of the run can make the fix its plan needs.
    pub cant_fix: bool,
    /// The run's re-read before its first approved step found the change no longer needed.
    pub no_longer_needed: bool,
}

/// `GET …/autoresolve/runs`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveRunList {
    pub runs: Vec<AutoResolveRunRow>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolveStep {
    pub id: String,
    pub seq: i32,
    /// `dry_run` or `change`.
    pub kind: String,
    pub connection: AutoResolveConnectionRef,
    pub tool: String,
    pub arguments: Value,
    pub refs: Vec<StepRef>,
    pub reason: String,
    pub preview: Option<String>,
    /// A dry run with no verified preview runs first after approval.
    pub dry_run_after_approval: bool,
    pub state: String,
    pub result_summary: Option<String>,
    pub error: Option<String>,
    pub consumed_at_us: Option<i64>,
    pub finished_at_us: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolveOption {
    pub id: String,
    pub title: String,
    pub recommended: bool,
    pub changes_production_directly: bool,
    pub tradeoffs: String,
    pub reason: String,
    pub steps: Vec<AutoResolveStep>,
    /// A step uses a removed connection, so approving this option is refused.
    pub uses_removed_connection: bool,
    /// What the option leaves undone or costs; such an option is never recommended.
    pub partial_fix: Option<String>,
    /// The live MCPs its steps use, once each in step order; approving changes these.
    pub changes: Vec<AutoResolveChangedMcp>,
    /// The agent's claim lowered to what the cause's evidence allows; null when the plan has no
    /// graded cause.
    pub band: Option<Confidence>,
    /// What the agent claimed for this option.
    pub claimed: Option<Confidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveChangedMcp {
    pub name: String,
    /// The first clause of the MCP's description when it is short (`mcp_short_description`).
    pub short_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolvePlan {
    pub fingerprint: String,
    pub options: Vec<AutoResolveOption>,
    pub omitted_count: u32,
    pub omitted_reason: Option<String>,
    pub missing_capability: Option<String>,
    /// Set when `missing_capability` reads `needs <name>: <action>` for an org connection the
    /// run lacks.
    pub missing_connection: Option<AutoResolveMissingConnection>,
    /// The cause the agent's reads confirmed; null on plans made before it was asked for.
    pub cause: Option<String>,
    /// The cause's band, graded from the cited evidence as incidents grade a verdict; null
    /// without a cause or once the transcript is gone.
    pub band: Option<Confidence>,
    pub confidence: Option<ConfidenceBreakdown>,
    /// The cited reads that verified, numbered in citation order.
    pub evidence: Vec<EvidenceEntry>,
    pub unverified: Vec<UnverifiedCitation>,
    /// The cause first, then each alternative a read ruled out.
    pub hypotheses: Vec<SummaryHypothesis>,
}

/// One plan the agent proposed, as the run's timeline shows it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolvePlanRevision {
    pub revision: i32,
    pub planned_at_us: i64,
    pub cause: Option<String>,
    pub band: Option<Confidence>,
    pub missing_capability: Option<String>,
    pub options: Vec<AutoResolvePlanRevisionOption>,
    /// Who approved which option, the steps that ran and how the agent's check ended; set once
    /// a replan moved the run past this plan.
    pub attempt: Option<AutoResolvePlanAttempt>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolvePlanAttempt {
    pub option_id: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at_us: Option<i64>,
    /// The approved option's steps in that revision, as they ran.
    pub steps: Vec<AutoResolveStep>,
    /// The state the run left, such as `worked`.
    pub state: String,
    pub verdict: Option<String>,
    pub explanation: Option<String>,
    pub ended_at_us: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolvePlanRevisionOption {
    pub id: String,
    pub title: String,
    pub band: Option<Confidence>,
    pub partial_fix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveMissingConnection {
    pub name: String,
    pub connection_id: String,
    pub action: String,
    /// The caller may add it and plan again now.
    pub can_add: bool,
    /// Why not, in one sentence; null when `can_add`.
    pub cannot_add_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveOutcome {
    /// `worked`, `no_change` or `worse`; null when the run ended without the model's verdict.
    pub verdict: Option<String>,
    pub system_summary: String,
    /// The model's own words; never the run's error, which is `error`.
    pub explanation: Option<String>,
    /// Why the run failed, in OpenObserve's words.
    pub error: Option<String>,
    /// `worse` when an earlier attempt in this run made things worse, whatever the run ended as.
    pub prior_verdict: Option<String>,
}

/// A change another run sent to one of this run's MCPs after this run's plan was made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveChangedBy {
    /// The MCP's name.
    pub connection: String,
    pub run_id: String,
    pub at_us: i64,
}

/// The saved AutoResolve a run belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveRunOf {
    pub id: String,
    pub name: String,
}

/// A correction the current plan's turn read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveCorrectionUsed {
    pub kind: String,
    pub note: String,
    pub created_by: String,
    pub created_at_us: i64,
    pub run_id: String,
    pub this_run: bool,
}

/// A correction sent on this run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveRunCorrection {
    pub id: String,
    pub kind: String,
    pub note: String,
    pub option_title: Option<String>,
    /// The plan revision it was sent on.
    pub revision: i32,
    pub created_by: String,
    pub created_at_us: i64,
    /// Still read by the saved AutoResolve's later runs.
    pub remembered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AutoResolveAddedConnection {
    pub name: String,
    pub by: String,
    pub at_us: i64,
    /// Adding it turned the saved AutoResolve's trigger off until someone approves it again.
    #[serde(default)]
    pub trigger_off: bool,
}

/// The person's verdict on the run's outcome, with the agent's verdict as it stood then.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AutoResolvePersonVerdict {
    /// `fixed` or `not_fixed`.
    pub verdict: String,
    pub note: Option<String>,
    pub by: String,
    pub at_us: i64,
    pub revision: i32,
    pub agent_verdict: Option<String>,
    pub agent_explanation: Option<String>,
    pub agent_checked_at_us: Option<i64>,
}

/// The run's live turn, so the page can say how long it has run and when the model last spoke.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveTurnStatus {
    pub started_at_us: i64,
    /// When the sweeper ends the turn.
    pub deadline_us: i64,
    /// The newest output the turn committed to the transcript, else `started_at_us`.
    pub last_output_us: i64,
    /// The turn is the run's one retry of its check.
    pub check_retry: bool,
}

/// `GET …/autoresolve/runs/{run_id}` and each `snapshot` of its live stream.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AutoResolveRunDetail {
    pub id: String,
    pub goal: String,
    pub state: String,
    pub trigger: AutoResolveTrigger,
    pub requester: String,
    /// The connections the run was started with, in the order chosen; every turn loads only
    /// those that are not `removed`.
    pub connections: Vec<AutoResolveConnectionRef>,
    pub created_at_us: i64,
    pub ended_at_us: Option<i64>,
    /// The run ended because no MCP of the run can make the fix its plan needs.
    pub cant_fix: bool,
    /// The run's re-read before its first approved step found the change no longer needed.
    pub no_longer_needed: bool,
    /// While it waits for approval: other runs' changes to its MCPs since its plan, newest first.
    pub changed_since_plan: Vec<AutoResolveChangedBy>,
    pub approval_deadline_us: Option<i64>,
    pub revision: i32,
    /// When the current revision's steps were written: the plan's acceptance, or the hold that
    /// rebuilt it (then calls of the approved steps come before it).
    pub planned_at_us: Option<i64>,
    pub plan: Option<AutoResolvePlan>,
    /// Every plan the agent proposed, oldest first; the current one is last.
    pub plan_history: Vec<AutoResolvePlanRevision>,
    pub chosen_option_id: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at_us: Option<i64>,
    pub approvers: Vec<Approver>,
    /// The caller may approve every connection of at least one option.
    pub can_approve: bool,
    /// The chosen option's steps in the current revision; empty until an option is approved.
    pub steps: Vec<AutoResolveStep>,
    pub outcome: Option<AutoResolveOutcome>,
    pub thread: RcaThread,
    pub autoresolve: Option<AutoResolveRunOf>,
    /// Names of the org's MCP connections the run does not have, one per key, sorted by key.
    pub not_connected: Vec<String>,
    pub corrections_used: Vec<AutoResolveCorrectionUsed>,
    pub corrections: Vec<AutoResolveRunCorrection>,
    pub added_connections: Vec<AutoResolveAddedConnection>,
    pub person_verdict: Option<AutoResolvePersonVerdict>,
    /// Set only while a turn runs.
    pub turn: Option<AutoResolveTurnStatus>,
}

/// What a run's Slack card is drawn from: the row, its plan and, once it ended, its outcome.
pub(crate) struct CardView {
    pub run: RunRow,
    pub plan: Option<AutoResolvePlan>,
    pub outcome: Option<AutoResolveOutcome>,
}

/// One live stream of a run: a snapshot whenever the run changes, then `end` once it ended.
pub struct LiveRun {
    org: String,
    run_id: String,
    email: String,
    rights: Rights,
    sent: Option<u64>,
    last_output_us: i64,
    closes_at_us: i64,
    done: bool,
}

impl LiveRun {
    pub fn new(org: &str, run_id: &str, email: &str, now_us: i64) -> Self {
        let max_us = i64::try_from(LIVE_STREAM_MAX.as_micros()).unwrap_or(i64::MAX);
        Self {
            org: org.to_string(),
            run_id: run_id.to_string(),
            email: email.to_string(),
            rights: Rights::default(),
            sent: None,
            last_output_us: now_us,
            closes_at_us: now_us.saturating_add(max_us),
            done: false,
        }
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub async fn tick(&mut self, now_us: i64) -> Vec<LiveFrame> {
        if now_us >= self.closes_at_us {
            self.done = true;
            return Vec::new();
        }
        let fetched = fetch(
            &self.org,
            &self.run_id,
            &self.email,
            &mut self.rights,
            self.sent,
        )
        .await;
        let mut frames = Vec::new();
        let ended = match fetched {
            Fetched::Gone => Some(None),
            Fetched::Failed => None,
            Fetched::Same { ended } => ended.map(Some),
            Fetched::Changed {
                version,
                data,
                ended,
            } => {
                frames.push(LiveFrame::Event {
                    name: "snapshot",
                    data,
                });
                self.sent = Some(version);
                ended.map(Some)
            }
        };
        if let Some(state) = ended {
            frames.push(end_frame(state));
            self.done = true;
        }
        if frames.is_empty() && now_us - self.last_output_us >= HEARTBEAT_AFTER_US {
            frames.push(LiveFrame::Ping);
        }
        if !frames.is_empty() {
            self.last_output_us = now_us;
        }
        frames
    }
}

/// What one probe of a live run found; `ended` is the terminal state once the run ended.
enum Fetched {
    Gone,
    Failed,
    Same {
        ended: Option<RunState>,
    },
    Changed {
        version: u64,
        data: String,
        ended: Option<RunState>,
    },
}

/// The caller's approvers and approve right for one plan revision, and the toolsets they may
/// list, kept for a stream's lifetime so a step or transcript change does not ask OpenFGA again.
#[derive(Default)]
struct Rights {
    plan: Option<(i32, Option<String>)>,
    rights: (Vec<Approver>, bool),
    add: Option<(AddKey, (bool, Option<String>))>,
    listable: Option<Option<Vec<String>>>,
}

impl Rights {
    async fn of(
        &mut self,
        run: &RunRow,
        email: &str,
        plan: &AutoResolvePlan,
    ) -> (Vec<Approver>, bool) {
        let key = (run.revision, run.plan_fingerprint.clone());
        if self.plan.as_ref() != Some(&key) {
            self.rights = decision_rights(&run.org, email, plan).await;
            self.plan = Some(key);
        }
        self.rights.clone()
    }

    async fn can_add(
        &mut self,
        run: &RunRow,
        from: Option<RunState>,
        email: &str,
        missing: &AutoResolveMissingConnection,
    ) -> (bool, Option<String>) {
        let key = (
            run.revision,
            run.plan_fingerprint.clone(),
            from,
            run.connection_ids.clone(),
        );
        if self.add.as_ref().map(|(k, _)| k) != Some(&key) {
            let right = match from {
                Some(_) => add_right(run, email, missing).await,
                None => (false, Some(corrections::add_closed_reason(&missing.name))),
            };
            self.add = Some((key, right));
        }
        self.add
            .as_ref()
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    }

    async fn listable(&mut self, org: &str, email: &str) -> Option<Vec<String>> {
        match &self.listable {
            Some(listable) => listable.clone(),
            None => {
                let fetched = approve::permitted_connections(org, email, "LIST").await;
                self.keep_listable(fetched)
            }
        }
    }

    /// A failed lookup hides every MCP instead of failing the page, and is asked again next time.
    fn keep_listable(
        &mut self,
        fetched: anyhow::Result<Option<Vec<String>>>,
    ) -> Option<Vec<String>> {
        match fetched {
            Ok(listable) => {
                self.listable = Some(listable.clone());
                listable
            }
            Err(e) => {
                log::error!("[autoresolve] MCPs the viewer may list are unknown, none named: {e}");
                Some(Vec::new())
            }
        }
    }
}

/// What the add right depends on: the plan revision, the state it may be added from (which
/// lapses with the approval deadline) and the run's connections.
type AddKey = (i32, Option<String>, Option<RunState>, String);

/// A run with its step rows and chat session, read once per snapshot; `changed` holds other runs'
/// changes to its MCPs since its plan, read only while it waits for approval.
struct Loaded {
    run: RunRow,
    steps: Vec<StepRow>,
    session: Option<SessionRow>,
    changed: Vec<StepRow>,
}

impl Loaded {
    async fn read(org: &str, run_id: &str) -> Result<Option<Self>, AutoResolveError> {
        let Some(run) = autoresolve_runs::get(org, run_id).await? else {
            return Ok(None);
        };
        let steps = autoresolve_steps::list_for_run(org, run_id).await?;
        let session = ai_chat_sessions::get(org, &run.session_id).await?;
        let mut loaded = Self {
            run,
            steps,
            session,
            changed: Vec::new(),
        };
        if loaded.state() == Some(RunState::WaitingApproval)
            && let Some(since) = loaded.planned_at_us()
        {
            loaded.changed = changed_since(&loaded.run, since).await?;
        }
        Ok(Some(loaded))
    }

    fn state(&self) -> Option<RunState> {
        RunState::parse(&self.run.state)
    }

    /// Changes whenever the run, a step or the transcript does; a step can move alone.
    fn version(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        (self.run.updated_at_us, &self.run.state).hash(&mut hasher);
        if let Some(session) = &self.session {
            let committed = (session.last_committed_seq, session.last_event_at);
            (committed, session.updated_at).hash(&mut hasher);
        }
        for step in self.steps.iter().chain(&self.changed) {
            (
                &step.id,
                &step.state,
                step.consumed_at_us,
                step.finished_at_us,
            )
                .hash(&mut hasher);
        }
        hasher.finish()
    }

    async fn detail(
        &self,
        email: &str,
        rights: &mut Rights,
    ) -> Result<AutoResolveRunDetail, AutoResolveError> {
        let run = &self.run;
        let names = self.names().await?;
        let listable = rights.listable(&run.org, email).await;
        let (thread, tool_log) = self.thread(&names.current).await;
        let mut plan = self.plan(&names, &tool_log);
        let mut outcome = self.outcome();
        if let Some(plan) = plan.as_mut() {
            self.hide_unlisted_missing(plan, outcome.as_mut(), &names, listable.as_deref());
        }
        let (approvers, can_approve) = match &plan {
            Some(plan) => rights.of(run, email, plan).await,
            None => (Vec::new(), false),
        };
        if let Some(missing) = plan.as_mut().and_then(|p| p.missing_connection.as_mut()) {
            let from = corrections::add_from(run, &self.steps, now_micros());
            (missing.can_add, missing.cannot_add_reason) =
                rights.can_add(run, from, email, missing).await;
        }
        let steps = match &run.chosen_option_id {
            Some(chosen) => self.option_steps(chosen, &names),
            None => Vec::new(),
        };
        Ok(AutoResolveRunDetail {
            id: run.id.clone(),
            goal: run.goal.clone(),
            state: run.state.clone(),
            trigger: trigger_of(run),
            requester: run.requester.clone(),
            connections: run_connections(run, &names.current),
            created_at_us: run.created_at_us,
            ended_at_us: run.ended_at_us,
            cant_fix: evidence::cannot_act(&run.state, run.plan.as_deref()),
            no_longer_needed: evidence::no_longer_needed(
                &run.state,
                run.chosen_option_id.as_deref(),
                evidence::plan_sent(run, &self.steps),
            ),
            changed_since_plan: self.changed_by(&names),
            approval_deadline_us: run.approval_deadline_us,
            revision: run.revision,
            planned_at_us: self.planned_at_us(),
            plan_history: self.plan_history(&tool_log, &names),
            plan,
            chosen_option_id: run.chosen_option_id.clone(),
            approved_by: run.approved_by.clone(),
            approved_at_us: run.approved_at_us,
            approvers,
            can_approve,
            steps,
            outcome,
            thread,
            autoresolve: self.autoresolve().await?,
            not_connected: self.not_connected(&names, listable.as_deref()),
            corrections_used: self.corrections_used().await?,
            corrections: self.corrections().await?,
            added_connections: stored_json(run.added_connections.as_deref()).unwrap_or_default(),
            person_verdict: stored_json(run.person_verdict.as_deref()),
            turn: self.turn(),
        })
    }

    fn changed_by(&self, names: &ConnectionNames) -> Vec<AutoResolveChangedBy> {
        self.changed
            .iter()
            .map(|s| AutoResolveChangedBy {
                connection: names.connection(&s.connection_id, &s.connection_name).name,
                run_id: s.run_id.clone(),
                at_us: s.consumed_at_us.unwrap_or_default(),
            })
            .collect()
    }

    /// The transcript's last commit stands for the model's output; each commit already changes
    /// [Self::version], so the page sees it in the next snapshot.
    fn turn(&self) -> Option<AutoResolveTurnStatus> {
        let run = &self.run;
        self.state().filter(RunState::is_live)?;
        let (started_at_us, deadline_us) = (run.turn_started_at_us?, run.turn_deadline_us?);
        let committed = self.session.as_ref().and_then(|s| s.last_event_at);
        Some(AutoResolveTurnStatus {
            started_at_us,
            deadline_us,
            last_output_us: committed.map_or(started_at_us, |at| at.max(started_at_us)),
            check_retry: run.check_retried_at_us.is_some(),
        })
    }

    async fn autoresolve(&self) -> Result<Option<AutoResolveRunOf>, AutoResolveError> {
        let Some(id) = &self.run.autoresolve_id else {
            return Ok(None);
        };
        let flow = flows_table::get(&self.run.org, id).await?;
        Ok(flow.map(|f| AutoResolveRunOf {
            id: f.id,
            name: f.name,
        }))
    }

    fn not_connected(&self, names: &ConnectionNames, listable: Option<&[String]>) -> Vec<String> {
        let listed: Vec<Listed> = names
            .current
            .iter()
            .filter(|(id, _)| approve::is_permitted(&self.run.org, id, listable))
            .map(|(id, name)| (id.clone(), name.clone(), None))
            .collect();
        let cap = get_o2_config().autoresolve.max_connections;
        not_connected(&listed, &self.run_ids(), cap)
            .into_iter()
            .map(|(_, (_, name, _))| name.clone())
            .collect()
    }

    async fn corrections_used(&self) -> Result<Vec<AutoResolveCorrectionUsed>, AutoResolveError> {
        let ids: Vec<String> =
            stored_json(self.run.plan_corrections.as_deref()).unwrap_or_default();
        let rows = autoresolve_corrections::by_ids(&self.run.org, &ids).await?;
        Ok(rows
            .into_iter()
            .map(|c| AutoResolveCorrectionUsed {
                this_run: c.run_id == self.run.id,
                kind: c.kind,
                note: c.note,
                created_by: c.created_by,
                created_at_us: c.created_at_us,
                run_id: c.run_id,
            })
            .collect())
    }

    async fn corrections(&self) -> Result<Vec<AutoResolveRunCorrection>, AutoResolveError> {
        let rows = autoresolve_corrections::for_run(&self.run.org, &self.run.id).await?;
        Ok(rows
            .into_iter()
            .map(|c| AutoResolveRunCorrection {
                id: c.id,
                kind: c.kind,
                note: c.note,
                option_title: c.option_title,
                revision: c.revision,
                created_by: c.created_by,
                created_at_us: c.created_at_us,
                remembered: c.active,
            })
            .collect())
    }

    fn run_ids(&self) -> Vec<String> {
        serde_json::from_str(&self.run.connection_ids).unwrap_or_default()
    }

    async fn names(&self) -> Result<ConnectionNames, AutoResolveError> {
        let listed = org_ai_toolsets::list_described(&self.run.org, MCP_KIND).await?;
        let short = listed
            .iter()
            .filter_map(|(id, _, description)| {
                Some((id.clone(), mcp_short_description(description.as_deref()?)?))
            })
            .collect();
        Ok(ConnectionNames {
            current: listed.into_iter().map(|(id, name, _)| (id, name)).collect(),
            short,
            stored: stored_names(&self.run),
        })
    }

    /// `tool_log` grades the cause; an empty one (the Slack card) leaves every band null.
    fn plan(
        &self,
        names: &ConnectionNames,
        tool_log: &[ToolCallRecord],
    ) -> Option<AutoResolvePlan> {
        let run = &self.run;
        let stored: PlanInput = match serde_json::from_str(run.plan.as_deref()?) {
            Ok(plan) => plan,
            Err(e) => {
                log::error!(
                    "[autoresolve] stored plan of run {} is unreadable: {e}",
                    run.id
                );
                return None;
            }
        };
        let claim = plan_claim(stored.options.iter().map(|o| (o.recommended, o.confidence)));
        let graded = grade_cause(stored.cause.as_deref(), &stored.evidence, claim, tool_log);
        let options = stored
            .options
            .into_iter()
            .zip(OPTION_IDS)
            .map(|(option, id)| {
                let steps = self.option_steps(id, names);
                AutoResolveOption {
                    id: id.to_string(),
                    title: option.title,
                    recommended: option.recommended,
                    changes_production_directly: option.changes_production_directly,
                    tradeoffs: option.tradeoffs,
                    reason: option.reason,
                    uses_removed_connection: steps.iter().any(|s| s.connection.removed),
                    changes: changed_mcps(&steps, names),
                    steps,
                    band: option_band(
                        option.confidence,
                        graded.as_ref().map(|g| g.graded),
                        option.partial_fix.is_some(),
                    ),
                    claimed: option.confidence,
                    partial_fix: option.partial_fix,
                }
            })
            .collect();
        let (band, confidence, evidence, unverified, hypotheses) = match graded {
            Some(g) => (
                Some(g.band),
                Some(g.breakdown),
                g.evidence,
                g.unverified,
                g.hypotheses,
            ),
            None => (None, None, Vec::new(), Vec::new(), Vec::new()),
        };
        Some(AutoResolvePlan {
            fingerprint: run.plan_fingerprint.clone().unwrap_or_default(),
            options,
            omitted_count: stored.omitted_count,
            omitted_reason: stored.omitted_reason,
            missing_connection: self
                .missing_connection(stored.missing_capability.as_deref(), names),
            missing_capability: stored.missing_capability,
            cause: stored.cause,
            band,
            confidence,
            evidence,
            unverified,
            hypotheses,
        })
    }

    /// The stored history, each plan graded on the run's tool log. A run planned before the
    /// history existed shows its current plan as the only entry.
    fn plan_history(
        &self,
        tool_log: &[ToolCallRecord],
        names: &ConnectionNames,
    ) -> Vec<AutoResolvePlanRevision> {
        let run = &self.run;
        let mut revisions: Vec<PlanRevision> =
            stored_json(run.plan_history.as_deref()).unwrap_or_default();
        let current = run
            .plan
            .as_deref()
            .and_then(|p| serde_json::from_str::<PlanInput>(p).ok());
        if let (Some(plan), Some(at)) = (current, self.planned_at_us())
            && !revisions.iter().any(|r| r.revision == run.revision)
        {
            revisions.push(PlanRevision::of(&plan, run.revision, at));
        }
        revisions
            .into_iter()
            .map(|r| {
                let claim = plan_claim(r.options.iter().map(|o| (o.recommended, o.confidence)));
                let graded = grade_cause(r.cause.as_deref(), &r.evidence, claim, tool_log);
                let cause_graded = graded.as_ref().map(|g| g.graded);
                let attempt = r.attempt.map(|a| AutoResolvePlanAttempt {
                    steps: a
                        .option_id
                        .as_deref()
                        .map(|id| self.revision_steps(r.revision, id, names))
                        .unwrap_or_default(),
                    option_id: a.option_id,
                    approved_by: a.approved_by,
                    approved_at_us: a.approved_at_us,
                    state: a.state,
                    verdict: a.verdict,
                    explanation: a.explanation,
                    ended_at_us: a.ended_at_us,
                });
                AutoResolvePlanRevision {
                    attempt,
                    revision: r.revision,
                    planned_at_us: r.planned_at_us,
                    band: graded.map(|g| g.band),
                    cause: r.cause,
                    missing_capability: r.missing_capability,
                    options: r
                        .options
                        .into_iter()
                        .zip(OPTION_IDS)
                        .map(|(o, id)| AutoResolvePlanRevisionOption {
                            id: id.to_string(),
                            band: option_band(o.confidence, cause_graded, o.partial_fix.is_some()),
                            title: o.title,
                            partial_fix: o.partial_fix,
                        })
                        .collect(),
                }
            })
            .collect()
    }

    /// The org connection the plan names in `needs <name>: <action>`, when the run lacks it;
    /// whether the caller may add it is filled in later.
    fn missing_connection(
        &self,
        missing: Option<&str>,
        names: &ConnectionNames,
    ) -> Option<AutoResolveMissingConnection> {
        let (key, action) = parse_missing_connection(missing?)?;
        let run_ids = self.run_ids();
        let mut found = names
            .current
            .iter()
            .filter(|(_, name)| normalize_tool_name(name) == key);
        let (id, name) = found.next()?;
        if found.next().is_some() || run_ids.contains(id) {
            return None;
        }
        Some(AutoResolveMissingConnection {
            name: name.clone(),
            connection_id: id.clone(),
            action,
            can_add: false,
            cannot_add_reason: None,
        })
    }

    /// The planner may name an MCP the viewer cannot list; then neither the card, the raw hint
    /// nor the outcome that repeats it names it.
    fn hide_unlisted_missing(
        &self,
        plan: &mut AutoResolvePlan,
        outcome: Option<&mut AutoResolveOutcome>,
        names: &ConnectionNames,
        listable: Option<&[String]>,
    ) {
        let Some((key, _)) = plan
            .missing_capability
            .as_deref()
            .and_then(parse_missing_connection)
        else {
            return;
        };
        let unlisted = names.current.iter().any(|(id, name)| {
            normalize_tool_name(name) == key && !approve::is_permitted(&self.run.org, id, listable)
        });
        if unlisted {
            if let Some(outcome) =
                outcome.filter(|o| o.explanation.as_deref() == plan.missing_capability.as_deref())
            {
                outcome.explanation = None;
            }
            plan.missing_connection = None;
            plan.missing_capability = None;
        }
    }

    /// A plan's acceptance and a hold both write the current revision's step rows.
    fn planned_at_us(&self) -> Option<i64> {
        self.steps
            .iter()
            .filter(|s| s.revision == self.run.revision && s.option_id.is_some())
            .map(|s| s.created_at_us)
            .min()
    }

    fn option_steps(&self, option_id: &str, names: &ConnectionNames) -> Vec<AutoResolveStep> {
        self.revision_steps(self.run.revision, option_id, names)
    }

    fn revision_steps(
        &self,
        revision: i32,
        option_id: &str,
        names: &ConnectionNames,
    ) -> Vec<AutoResolveStep> {
        let mut rows: Vec<&StepRow> = self
            .steps
            .iter()
            .filter(|s| s.revision == revision && s.option_id.as_deref() == Some(option_id))
            .collect();
        rows.sort_by_key(|s| s.seq);
        rows.into_iter().map(|s| step_view(s, names)).collect()
    }

    fn outcome(&self) -> Option<AutoResolveOutcome> {
        let run = &self.run;
        self.state().filter(RunState::is_terminal)?;
        Some(AutoResolveOutcome {
            verdict: run.outcome_verdict.clone(),
            system_summary: evidence::system_summary(
                &self.steps,
                run.prior_verdict.as_deref(),
                evidence::cannot_act(&run.state, run.plan.as_deref()),
            ),
            explanation: run.outcome_explanation.clone(),
            error: run.error.clone(),
            prior_verdict: run.prior_verdict.clone(),
        })
    }

    /// The thread and the tool log the cause is graded on, from one read of the transcript. A
    /// transcript that cannot be read leaves both empty; the plan and steps still show.
    async fn thread(&self, names: &HashMap<String, String>) -> (RcaThread, Vec<ToolCallRecord>) {
        let run = &self.run;
        let active = self.state().is_some_and(|s| s.is_live());
        let version = self.version().to_string();
        let empty = |version| {
            let thread = RcaThread::without_transcript(&run.id, version, active, Transcript::None);
            (thread, Vec::new())
        };
        let Some(session) = &self.session else {
            return empty(version);
        };
        let prefix = match read_committed_prefix(session, -1).await {
            Ok(prefix) => prefix,
            Err(e) => {
                log::warn!("[autoresolve] transcript of run {}: {e}", run.id);
                return empty(version);
            }
        };
        let classes = org_tool_classes(&run.org).await;
        let tool_log = decode_run_with(&prefix.events, &classes).tool_log;
        let turns = ai_chat_turns::list_for_session(&run.org, &session.session_id)
            .await
            .unwrap_or_else(|e| {
                log::warn!("[autoresolve] turns of run {}: {e}", run.id);
                Vec::new()
            });
        // Raw tool output is unredacted; the step cards show the redacted result instead.
        let keys = names
            .values()
            .map(|name| (normalize_tool_name(name), name.clone()))
            .collect();
        let mut thread =
            rca_thread::project_autoresolve_thread(&prefix.events, &turns, active, keys);
        thread.run_id = run.id.clone();
        thread.state_version = version;
        if let Some(lost_from) = prefix.lost_from.filter(|_| !active) {
            thread.truncated = true;
            thread.saved_through_seq = Some(lost_from - 1);
        }
        (thread, tool_log)
    }
}

/// Display names by connection id: the org's current ones, then those the run stored at launch.
struct ConnectionNames {
    current: HashMap<String, String>,
    /// Short descriptions of the current ones that have one.
    short: HashMap<String, String>,
    stored: HashMap<String, String>,
}

impl ConnectionNames {
    /// A removed connection keeps the name the run stored, else its step's key.
    fn connection(&self, id: &str, key: &str) -> AutoResolveConnectionRef {
        connection_ref(id.to_string(), &self.current, || {
            self.stored
                .get(id)
                .cloned()
                .unwrap_or_else(|| key.to_string())
        })
    }
}

/// The page header: the connections the caller may list and a run can use, and which of them
/// the caller may approve.
pub async fn summary(org: &str, email: &str) -> Result<AutoResolveSummary, AutoResolveError> {
    let listable = approve::permitted_connections(org, email, "LIST").await?;
    let usable: Vec<(String, String)> = usable_connections(org)
        .await?
        .into_iter()
        .filter(|(id, _)| approve::is_permitted(org, id, listable.as_deref()))
        .collect();
    let ids: Vec<String> = usable.iter().map(|(id, _)| id.clone()).collect();
    let allowed = approve::may_approve_each(org, email, &ids).await;
    let connections = usable
        .into_iter()
        .zip(allowed)
        .map(|((id, name), can_approve)| AutoResolveSummaryConnection {
            id,
            name,
            can_approve,
        })
        .collect();
    Ok(AutoResolveSummary {
        connections,
        max_connections: get_o2_config().autoresolve.max_connections,
        region: crate::downtimes::notify::this_region(),
        triggers_fire_here: super::saved::triggers_fire_here().await,
        slack_approval_available: super::saved::slack_approval_available(org),
    })
}

/// One page of the org's runs, newest first; `page` is zero-based.
pub async fn list_runs(
    org: &str,
    filter: &RunFilter,
    page: u64,
    page_size: u64,
) -> Result<AutoResolveRunList, AutoResolveError> {
    let (rows, total) = autoresolve_runs::list(org, filter, page, page_size).await?;
    let current = connection_names(org).await?;
    let approved_no_change: Vec<String> = rows
        .iter()
        .filter(|r| r.state == RunState::NoChange.as_str() && r.chosen_option_id.is_some())
        .map(|r| r.id.clone())
        .collect();
    let sent = autoresolve_steps::sent_revisions(org, &approved_no_change).await?;
    let runs = rows
        .into_iter()
        .map(|run| run_row(run, &current, &sent))
        .collect();
    Ok(AutoResolveRunList { runs, total })
}

/// The run as its page shows it to `email`; `None` when the org has no such run.
pub async fn snapshot(
    org: &str,
    run_id: &str,
    email: &str,
) -> Result<Option<AutoResolveRunDetail>, AutoResolveError> {
    match Loaded::read(org, run_id).await? {
        Some(loaded) => Ok(Some(loaded.detail(email, &mut Rights::default()).await?)),
        None => Ok(None),
    }
}

/// The run as its Slack card shows it, without the transcript the run page reads.
pub(crate) async fn card_view(
    org: &str,
    run_id: &str,
) -> Result<Option<CardView>, AutoResolveError> {
    let Some(loaded) = Loaded::read(org, run_id).await? else {
        return Ok(None);
    };
    let names = loaded.names().await?;
    Ok(Some(CardView {
        plan: loaded.plan(&names, &[]),
        outcome: loaded.outcome(),
        run: loaded.run,
    }))
}

/// The connection under its current name, or marked removed under `last_known`.
pub(crate) fn connection_ref(
    id: String,
    names: &HashMap<String, String>,
    last_known: impl FnOnce() -> String,
) -> AutoResolveConnectionRef {
    match names.get(&id) {
        Some(name) => AutoResolveConnectionRef {
            name: name.clone(),
            id,
            removed: false,
        },
        None => AutoResolveConnectionRef {
            name: last_known(),
            id,
            removed: true,
        },
    }
}

/// The org's MCP connections a run can use: a key two toolsets share reaches neither.
async fn usable_connections(org: &str) -> Result<Vec<(String, String)>, AutoResolveError> {
    let all = org_ai_toolsets::list_kind_names(org, MCP_KIND).await?;
    let mut per_key: HashMap<String, usize> = HashMap::new();
    for (_, name) in &all {
        *per_key.entry(normalize_tool_name(name)).or_default() += 1;
    }
    Ok(all
        .into_iter()
        .filter(|(_, name)| per_key.get(&normalize_tool_name(name)) == Some(&1))
        .collect())
}

/// The org's MCP connection names by id.
async fn connection_names(org: &str) -> Result<HashMap<String, String>, AutoResolveError> {
    Ok(org_ai_toolsets::list_kind_names(org, MCP_KIND)
        .await?
        .into_iter()
        .collect())
}

/// One probe: the snapshot is built only when the run changed since the `sent` version.
async fn fetch(
    org: &str,
    run_id: &str,
    email: &str,
    rights: &mut Rights,
    sent: Option<u64>,
) -> Fetched {
    let loaded = match Loaded::read(org, run_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return Fetched::Gone,
        Err(e) => {
            log::warn!("[autoresolve] live stream of run {run_id}: {e}");
            return Fetched::Failed;
        }
    };
    let ended = loaded.state().filter(RunState::is_terminal);
    let version = loaded.version();
    if sent == Some(version) {
        return Fetched::Same { ended };
    }
    let data = match loaded.detail(email, rights).await {
        Ok(detail) => serde_json::to_string(&detail).map_err(anyhow::Error::from),
        Err(e) => Err(anyhow::anyhow!(e)),
    };
    match data {
        Ok(data) => Fetched::Changed {
            version,
            data,
            ended,
        },
        Err(e) => {
            log::warn!("[autoresolve] live snapshot of run {run_id}: {e}");
            Fetched::Failed
        }
    }
}

/// Whether the caller may add the missing connection to a run that can take one, and why not.
async fn add_right(
    run: &RunRow,
    email: &str,
    missing: &AutoResolveMissingConnection,
) -> (bool, Option<String>) {
    let connection = AutoResolveConnectionRef {
        id: missing.connection_id.clone(),
        name: missing.name.clone(),
        removed: false,
    };
    let seams = Seams::live().await;
    match corrections::add_refusal_with(&seams, run, email, &connection).await {
        Ok(None) => (true, None),
        Ok(Some(refused)) => (false, Some(refused.to_string())),
        Err(e) => {
            log::warn!("[autoresolve] add right on run {} unknown: {e}", run.id);
            (
                false,
                Some("Your permission could not be checked; try again.".to_string()),
            )
        }
    }
}

async fn decision_rights(org: &str, email: &str, plan: &AutoResolvePlan) -> (Vec<Approver>, bool) {
    let steps = plan.options.iter().flat_map(|o| &o.steps);
    let ids = distinct_ids(steps.map(|s| s.connection.id.as_str()));
    let allowed = approve::may_approve_each(org, email, &ids).await;
    let may: HashMap<&str, bool> = ids.iter().map(String::as_str).zip(allowed).collect();
    let can_approve = plan.options.iter().any(|o| {
        !o.steps.is_empty()
            && o.steps
                .iter()
                .all(|s| may.get(s.connection.id.as_str()) == Some(&true))
    });
    (approve::approvers_for(org, &ids).await, can_approve)
}

/// The run's chosen connections under their current names, or the names stored at launch.
fn run_connections(
    run: &RunRow,
    current: &HashMap<String, String>,
) -> Vec<AutoResolveConnectionRef> {
    let ids: Vec<String> = serde_json::from_str(&run.connection_ids).unwrap_or_default();
    let stored = stored_names(run);
    ids.into_iter()
        .map(|id| {
            let last = stored.get(&id).cloned();
            connection_ref(id, current, || last.unwrap_or_default())
        })
        .collect()
}

/// `sent` holds the (run, revision) pairs that sent a step.
fn run_row(
    run: RunRow,
    current: &HashMap<String, String>,
    sent: &HashSet<(String, i32)>,
) -> AutoResolveRunRow {
    AutoResolveRunRow {
        trigger: trigger_of(&run),
        connections: run_connections(&run, current),
        cant_fix: evidence::cannot_act(&run.state, run.plan.as_deref()),
        no_longer_needed: evidence::no_longer_needed(
            &run.state,
            run.chosen_option_id.as_deref(),
            sent.contains(&(run.id.clone(), run.revision)),
        ),
        id: run.id,
        goal: run.goal,
        state: run.state,
        requester: run.requester,
        created_at_us: run.created_at_us,
        ended_at_us: run.ended_at_us,
    }
}

fn stored_names(run: &RunRow) -> HashMap<String, String> {
    serde_json::from_str(&run.connection_names).unwrap_or_default()
}

/// A JSON column as written by this module's own writers; unreadable text reads as absent.
fn stored_json<T: serde::de::DeserializeOwned>(text: Option<&str>) -> Option<T> {
    serde_json::from_str(text?).ok()
}

fn step_view(row: &StepRow, names: &ConnectionNames) -> AutoResolveStep {
    AutoResolveStep {
        id: row.id.clone(),
        seq: row.seq,
        kind: row.kind.clone(),
        connection: names.connection(&row.connection_id, &row.connection_name),
        tool: row.tool.clone(),
        arguments: serde_json::from_str(&row.arguments).unwrap_or(Value::Null),
        refs: serde_json::from_str(&row.refs).unwrap_or_default(),
        reason: row.reason.clone(),
        preview: row.preview.as_deref().map(preview_text),
        dry_run_after_approval: row.kind == StepKind::DryRun.as_str() && row.preview.is_none(),
        state: row.state.clone(),
        result_summary: row.result.as_deref().map(result_text),
        error: row.error.clone(),
        consumed_at_us: row.consumed_at_us,
        finished_at_us: row.finished_at_us,
    }
}

fn changed_mcps(steps: &[AutoResolveStep], names: &ConnectionNames) -> Vec<AutoResolveChangedMcp> {
    let mut seen = HashSet::new();
    steps
        .iter()
        .filter(|s| !s.connection.removed && seen.insert(s.connection.id.as_str()))
        .map(|s| AutoResolveChangedMcp {
            name: s.connection.name.clone(),
            short_description: names.short.get(&s.connection.id).cloned(),
        })
        .collect()
}

fn preview_text(stored: &str) -> String {
    match json_or_text(stored) {
        Value::String(text) => text,
        _ => stored.to_string(),
    }
}

pub(crate) fn trigger_of(run: &RunRow) -> AutoResolveTrigger {
    AutoResolveTrigger {
        kind: run.trigger_kind.clone(),
        by: trigger_by(run),
        label: trigger_label(run),
        alert_id: trigger_alert_id(run.trigger_context.as_deref()),
    }
}

/// The trigger context names the alert as its subject, or as the alert behind an incident.
fn trigger_alert_id(trigger_context: Option<&str>) -> Option<String> {
    let context: Value = serde_json::from_str(trigger_context?).ok()?;
    let id = match context.get("subject_type").and_then(Value::as_str) {
        Some("alert") => context.get("subject_id"),
        _ => context.get("alert_id"),
    };
    id.and_then(Value::as_str).map(str::to_string)
}

fn end_frame(state: Option<RunState>) -> LiveFrame {
    LiveFrame::Event {
        name: "end",
        data: json!({ "state": state.map(|s| s.as_str()) }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::autoresolve::test_support::{ORG, memory_db, new_run, new_step};

    fn names(current: &[(&str, &str)], stored: &[(&str, &str)]) -> ConnectionNames {
        let map = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(id, name)| (id.to_string(), name.to_string()))
                .collect()
        };
        ConnectionNames {
            current: map(current),
            short: map(&[("c1", "infra repo")]),
            stored: map(stored),
        }
    }

    #[test]
    fn a_connection_is_named_by_the_org_then_the_run_then_the_step() {
        let names = names(
            &[("c1", "Code Host")],
            &[("c1", "Old Code Host"), ("c2", "Checkout Ops")],
        );
        let cases = [
            ("current", "c1", "code-host", "Code Host", false),
            (
                "removed, stored name",
                "c2",
                "checkout-ops",
                "Checkout Ops",
                true,
            ),
            ("removed, no stored name", "c3", "k8s", "k8s", true),
        ];
        for (case, id, key, name, removed) in cases {
            let got = names.connection(id, key);
            let got = (got.id.as_str(), got.name.as_str(), got.removed);
            assert_eq!(got, (id, name, removed), "{case}");
        }
    }

    #[tokio::test]
    async fn plan_marks_removed_connections_partial_fixes_and_the_missing_connection() {
        let db = memory_db().await;
        autoresolve_runs::insert_with(&db, new_run("r1"))
            .await
            .unwrap();
        let steps = vec![
            new_step("r1", "a1", "A", 1, "c1", "github"),
            new_step("r1", "b1", "B", 1, "c2", "k8s"),
            new_step("r1", "b2", "B", 2, "c1", "github"),
        ];
        autoresolve_steps::insert_many(&db, steps).await.unwrap();
        let run = autoresolve_runs::get_with(&db, ORG, "r1")
            .await
            .unwrap()
            .unwrap();
        let steps = autoresolve_steps::list_for_run_with(&db, ORG, "r1")
            .await
            .unwrap();
        let option = |title: &str, partial: Option<&str>| {
            json!({"title": title, "recommended": false, "changes_production_directly": false,
                "tradeoffs": "", "reason": "", "steps": [], "partial_fix": partial})
        };
        let current = [("c1", "GitHub"), ("c9", "Postgres")];
        // (case, missing capability, the missing connection's id and action)
        type Case = (
            &'static str,
            Option<&'static str>,
            Option<(&'static str, &'static str)>,
        );
        #[rustfmt::skip]
        let cases: [Case; 4] = [
            ("org connection off the run", Some("needs postgres: end session 4211"), Some(("c9", "end session 4211"))),
            ("connection already on the run", Some("needs github: merge the fix"), None),
            ("free text", Some("no connected tool can end a session"), None),
            ("nothing missing", None, None),
        ];
        for (case, missing, want) in cases {
            let plan = json!({"options": [option("restart", None), option("roll back", Some("restarts the whole database"))],
                "omitted_count": 0, "omitted_reason": null, "missing_capability": missing});
            let loaded = Loaded {
                steps: steps.clone(),
                run: RunRow {
                    plan: Some(plan.to_string()),
                    ..run.clone()
                },
                session: None,
                changed: Vec::new(),
            };
            let plan = loaded.plan(&names(&current, &[]), &[]).unwrap();
            let flags: Vec<(&str, bool, Option<&str>, Vec<_>)> = plan
                .options
                .iter()
                .map(|o| {
                    let changes = o
                        .changes
                        .iter()
                        .map(|m| (m.name.as_str(), m.short_description.as_deref()));
                    (
                        o.id.as_str(),
                        o.uses_removed_connection,
                        o.partial_fix.as_deref(),
                        changes.collect(),
                    )
                })
                .collect();
            let github = ("GitHub", Some("infra repo"));
            assert_eq!(
                flags,
                [
                    ("A", false, None, vec![github]),
                    ("B", true, Some("restarts the whole database"), vec![github])
                ],
                "{case}"
            );
            let got = plan
                .missing_connection
                .as_ref()
                .map(|m| (m.connection_id.as_str(), m.action.as_str()));
            assert_eq!(got, want, "{case}");
            let off_run = loaded.not_connected(&names(&current, &[]), None);
            assert_eq!(off_run, ["Postgres"], "{case}: shown by name");
        }
        let needs = json!({"options": [], "omitted_count": 0, "omitted_reason": null,
            "missing_capability": "needs postgres: end session 4211"});
        let loaded = Loaded {
            steps,
            run: RunRow {
                plan: Some(needs.to_string()),
                ..run
            },
            session: None,
            changed: Vec::new(),
        };
        let granted = |object: &str| Ok(Some(vec![object.to_string()]));
        let every = format!("ai_toolsets:_all_{ORG}");
        type Listable = (
            &'static str,
            anyhow::Result<Option<Vec<String>>>,
            Vec<&'static str>,
        );
        #[rustfmt::skip]
        let listable: [Listable; 5] = [
            ("every toolset, as for root or RBAC off", Ok(None), vec!["Postgres"]),
            ("granted on the missing MCP", granted("ai_toolsets:c9"), vec!["Postgres"]),
            ("granted only on the run's MCP", granted("ai_toolsets:c1"), vec![]),
            ("granted on every toolset of the org", granted(&every), vec!["Postgres"]),
            ("the list fails in OpenFGA", Err(anyhow::anyhow!("unavailable")), vec![]),
        ];
        for (case, fetched, want) in listable {
            let permitted = Rights::default().keep_listable(fetched);
            let names = names(&current, &[]);
            let off_run = loaded.not_connected(&names, permitted.as_deref());
            assert_eq!(off_run, want, "{case}");
            let mut plan = loaded.plan(&names, &[]).unwrap();
            // A no-option plan ends the run with its missing capability as the explanation.
            let mut outcome = AutoResolveOutcome {
                verdict: Some("no_change".to_string()),
                system_summary: String::new(),
                explanation: plan.missing_capability.clone(),
                error: None,
                prior_verdict: None,
            };
            loaded.hide_unlisted_missing(
                &mut plan,
                Some(&mut outcome),
                &names,
                permitted.as_deref(),
            );
            let missing = plan.missing_connection.map(|m| m.name);
            let shown = (
                missing.as_deref(),
                plan.missing_capability.is_some(),
                outcome.explanation.is_some(),
            );
            let want = match want.is_empty() {
                true => (None, false, false),
                false => (Some("Postgres"), true, true),
            };
            assert_eq!(shown, want, "{case}: the missing MCP");
        }
    }

    #[tokio::test]
    async fn a_run_row_says_when_no_mcp_of_the_run_can_make_the_fix() {
        let db = memory_db().await;
        autoresolve_runs::insert_with(&db, new_run("r1"))
            .await
            .unwrap();
        let run = autoresolve_runs::get_with(&db, ORG, "r1")
            .await
            .unwrap()
            .unwrap();
        let plan = json!({"options": [], "omitted_count": 0, "omitted_reason": null,
            "missing_capability": "VACUUM public.orders"})
        .to_string();
        let cases = [
            ("ended on it", "no_change", true),
            ("still investigating", "investigating", false),
        ];
        for (case, state, want) in cases {
            let run = RunRow {
                state: state.into(),
                plan: Some(plan.clone()),
                ..run.clone()
            };
            let row = run_row(run, &HashMap::new(), &HashSet::new());
            assert_eq!(row.cant_fix, want, "{case}");
        }
    }

    #[test]
    fn trigger_alert_id_names_the_alert_behind_the_run() {
        let alert = json!({"subject_type": "alert", "subject_id": "a1"}).to_string();
        let incident =
            json!({"subject_type": "incident", "subject_id": "i1", "alert_id": "a2"}).to_string();
        let cases = [
            ("alert", Some(alert.as_str()), Some("a1")),
            ("incident", Some(incident.as_str()), Some("a2")),
            ("person", None, None),
        ];
        for (case, context, want) in cases {
            assert_eq!(trigger_alert_id(context).as_deref(), want, "{case}");
        }
    }
}
