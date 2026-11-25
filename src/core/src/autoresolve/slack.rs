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

//! A run approved in Slack: its card in the insights channel, redrawn after every state change.

use config::meta::autoresolve::{ApprovalChannel, RunState, named_mcp};
use infra::table::{autoresolve, autoresolve_runs};
use o2_enterprise::enterprise::slack::{
    self as ent_slack,
    autoresolve::{
        self as card, Approver as CardApprover, ApproverKind as CardApproverKind, AutoResolveCard,
        CardOption, CardOutcome, SlackRef,
    },
    links::LinkEnv,
};

use super::{
    AutoResolveError,
    approve::{self, Approver, ApproverKind},
    distinct_ids,
    live::{self, AutoResolveOption, AutoResolvePlan, AutoResolveStep, CardView},
    trigger_label,
};

/// Posts or redraws the run's card after a committed move to `to`; Slack never holds it up.
pub(crate) async fn run_changed(org: &str, run_id: &str, to: RunState) {
    if !ent_slack::enabled_for(org) || !approved_in_slack(org, run_id).await {
        return;
    }
    let (org, run_id) = (org.to_string(), run_id.to_string());
    tokio::spawn(async move {
        let lock = card::lock_run(&run_id).await;
        if let Err(e) = sync(&org, &run_id, to).await {
            log::warn!("[autoresolve] Slack card of run {run_id}: {e}");
        }
        if let Some(lock) = lock {
            lock.release().await;
        }
    });
}

/// A run's channel is fixed when it starts, so screen runs skip the lock and the card reads.
async fn approved_in_slack(org: &str, run_id: &str) -> bool {
    match autoresolve_runs::get(org, run_id).await {
        Ok(run) => run.is_some_and(|r| r.approval_channel == ApprovalChannel::Slack.as_str()),
        Err(e) => {
            log::warn!("[autoresolve] Slack card of run {run_id}: {e}");
            false
        }
    }
}

/// The first plan posts the card; a run that ends before one posts a single notice instead.
async fn sync(org: &str, run_id: &str, to: RunState) -> Result<(), AutoResolveError> {
    let Some(view) = live::card_view(org, run_id).await? else {
        return Ok(());
    };
    let state = RunState::parse(&view.run.state);
    let stored: Option<SlackRef> = view
        .run
        .slack_ref
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    let planned = view.plan.as_ref().is_some_and(|p| !p.options.is_empty());
    let asks = state == Some(RunState::WaitingApproval);
    let ended_unplanned = state.is_some_and(|s| s.is_terminal()) && !planned;
    if stored.is_none() && !asks && !ended_unplanned {
        return Ok(());
    }
    let built = build(&view, to).await?;
    let posted = match stored {
        Some(at) => {
            card::on_run_changed(&built, &at).await;
            return Ok(());
        }
        None if asks => card::post_request(&built).await?,
        None => card::post_notice(&built).await?,
    };
    let at = serde_json::to_string(&posted).map_err(anyhow::Error::from)?;
    if !autoresolve_runs::set_slack_ref(org, run_id, &at).await? {
        // Another post of this run was stored first; only that card is kept in step.
        card::retract(org, &posted).await;
    }
    Ok(())
}

/// R5: OpenObserve maps its rows into the card the enterprise Slack code draws.
async fn build(view: &CardView, to: RunState) -> Result<AutoResolveCard, AutoResolveError> {
    let run = &view.run;
    let name = match run.autoresolve_id.as_deref() {
        Some(id) => autoresolve::get(&run.org, id).await?.map(|f| f.name),
        None => None,
    };
    let approvers = match &view.plan {
        Some(plan) => approve::approvers_for(&run.org, &connection_ids(plan)).await,
        None => Vec::new(),
    };
    let state = RunState::parse(&run.state);
    let ended = state.is_some_and(|s| s.is_terminal()) && to.is_terminal();
    let replies = ended && !matches!(state, Some(RunState::Declined | RunState::Lapsed));
    let outcome = view
        .outcome
        .as_ref()
        .filter(|_| replies)
        .map(|o| CardOutcome {
            verdict: o.verdict.clone(),
            system_summary: o.system_summary.clone(),
            explanation: o.explanation.clone(),
            error: o.error.clone(),
        });
    Ok(AutoResolveCard {
        org: run.org.clone(),
        run_id: run.id.clone(),
        name,
        goal: run.goal.clone(),
        trigger_line: trigger_label(run),
        state: run.state.clone(),
        plan_fingerprint: run.plan_fingerprint.clone().unwrap_or_default(),
        options: view.plan.as_ref().map(options).unwrap_or_default(),
        approvers: approvers.into_iter().map(card_approver).collect(),
        run_url: card::run_url(&LinkEnv::live(), &run.org, &run.id),
        chosen_option_id: run.chosen_option_id.clone(),
        approved_by: run.approved_by.clone(),
        decided_at_us: run.approved_at_us.or(run.ended_at_us),
        approval_deadline_us: run.approval_deadline_us,
        error: run.error.clone(),
        outcome,
    })
}

fn options(plan: &AutoResolvePlan) -> Vec<CardOption> {
    plan.options
        .iter()
        .map(|o| CardOption {
            id: o.id.clone(),
            title: o.title.clone(),
            recommended: o.recommended,
            changed_mcps: o
                .changes
                .iter()
                .map(|m| (m.name.clone(), m.short_description.clone()))
                .collect(),
            removed_connections: removed_connections(o),
            step_lines: o.steps.iter().map(step_line).collect(),
        })
        .collect()
}

fn step_line(s: &AutoResolveStep) -> String {
    let removed = if s.connection.removed {
        " (removed)"
    } else {
        ""
    };
    let on = named_mcp(&s.connection.name);
    format!("{} on {on}{removed}: {}", s.tool, s.reason)
}

fn removed_connections(option: &AutoResolveOption) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for s in option.steps.iter().filter(|s| s.connection.removed) {
        if !names.contains(&s.connection.name) {
            names.push(s.connection.name.clone());
        }
    }
    names
}

fn connection_ids(plan: &AutoResolvePlan) -> Vec<String> {
    let steps = plan.options.iter().flat_map(|o| &o.steps);
    distinct_ids(steps.map(|s| s.connection.id.as_str()))
}

fn card_approver(a: Approver) -> CardApprover {
    let kind = match a.kind {
        ApproverKind::Role => CardApproverKind::Role,
        ApproverKind::Group => CardApproverKind::Group,
        ApproverKind::OrgAdmins => CardApproverKind::OrgAdmins,
    };
    CardApprover { kind, name: a.name }
}
