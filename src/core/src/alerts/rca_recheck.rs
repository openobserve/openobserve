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

//! A recurring incident whose earlier analyses agree, with nothing changed since, is re-checked
//! against them instead of being analysed again.

use std::{collections::HashMap, str::FromStr};

use async_trait::async_trait;
use config::{
    meta::{
        alerts::{
            incidents::AlertKind,
            rca_runs::{RunMode, RunState, RunStats, RunTrigger},
        },
        oncall::{
            Confidence,
            rca_run::{RcaOutcome, RcaRunRecord},
        },
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::table::{
    entity::alert_incidents::Model as Incident,
    rca_runs::{self as runs_table, RunSummaryPatch, RunUpdate},
};
use o2_enterprise::enterprise::{
    alerts::rca_service,
    autoobserve::{
        context::{ChangeAsk, ChangeRecord, Checked, IssueRef},
        contract::EntityRef,
    },
    common::config::get_config as get_o2_config,
};

use super::{
    incidents::{
        AutoStart, FINDING_STREAM_NAME_DIMENSION, FINDING_STREAM_TYPE_DIMENSION, incident_page_url,
    },
    rca_runs::{
        ERROR_SAVE_FAILED, RunSubject, SAVE_FAILED_REASON, StartOutcome, StartRun, complete_run,
        count_run_end, fail_run, start_first_run,
    },
};

/// Full runs read past the agreeing ones: runs of other recurrences the same alert opened sit among
/// them.
const OTHER_RUNS: u64 = 20;
/// Matched investigations the report links one by one; the rest are counted.
const LINKS_SHOWN: usize = 5;
const HOUR_US: i64 = 3_600_000_000;

/// When a recurring incident may be re-checked, from `O2_INCIDENTS_RCA_RECHECK_*`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Policy {
    pub runs: usize,
    pub max_age_us: i64,
}

impl Policy {
    fn configured() -> Self {
        let cfg = &get_o2_config().incidents;
        Self {
            runs: cfg.rca_recheck_agreeing_runs,
            max_age_us: i64::try_from(cfg.rca_recheck_max_age_hours)
                .map_or(i64::MAX, |h| h.saturating_mul(HOUR_US)),
        }
    }
}

/// An earlier full run of the same recurrence; an unreadable result never agrees.
#[derive(Clone, Debug)]
pub(crate) struct PriorRun {
    pub run_id: String,
    pub incident_id: String,
    pub started_at: i64,
    pub record: Option<RcaRunRecord>,
}

/// What makes two incidents one recurrence: how they correlated, how severe, and what opened them.
#[derive(Debug, PartialEq)]
struct Fingerprint {
    key_type: String,
    group_values: serde_json::Value,
    severity: String,
    opener: String,
}

impl Fingerprint {
    fn of(incident: &Incident, opener: &str) -> Self {
        Self {
            key_type: incident.key_type.clone(),
            group_values: incident.group_values.clone(),
            severity: incident.severity.clone(),
            opener: opener.to_string(),
        }
    }
}

/// The change reads since a time over the stream the incident's opening alert reads.
#[async_trait]
pub(crate) trait ChangeReads: Send + Sync {
    /// `None` when the opening alert names no stream, so no change can be ruled out.
    async fn since(
        &self,
        org_id: &str,
        incident: &Incident,
        opener: &(String, String),
        from: i64,
    ) -> Option<Vec<(Checked, Vec<ChangeRecord>)>>;
}

/// The deploy (service versions) and audit-trail reads AutoObserve's issue context uses.
pub(crate) struct LiveChangeReads;

#[async_trait]
impl ChangeReads for LiveChangeReads {
    async fn since(
        &self,
        org_id: &str,
        incident: &Incident,
        opener: &(String, String),
        from: i64,
    ) -> Option<Vec<(Checked, Vec<ChangeRecord>)>> {
        let subject = opener_stream(org_id, incident, opener).await?;
        let to = now_micros();
        let ask = ChangeAsk {
            org: org_id.to_string(),
            from,
            to,
            issues: vec![IssueRef {
                org: org_id.to_string(),
                decision_kind: String::new(),
                subject,
                decision_id: incident.id.clone(),
                onset_us: from,
                detected_us: to,
                recovered_us: None,
                shadow: false,
                source: None,
            }],
        };
        let primary = infra::db::get_orm_client_rw().await;
        let deploys = crate::autoobserve::causes::deploy::read_on(primary, &ask).await;
        let audit = crate::autoobserve::causes::audit::read(&ask).await;
        Some(vec![deploys, audit])
    }
}

/// Writes a re-check for a new incident that recurs unchanged; `None` leaves it to a full run.
pub(crate) async fn try_recheck(org_id: &str, incident_id: &str) -> Option<AutoStart> {
    let policy = Policy::configured();
    if policy.runs == 0 || rca_service::l0_off_for_incident(org_id, incident_id).await {
        return None;
    }
    let plan = plan_with(org_id, incident_id, policy, now_micros(), &LiveChangeReads).await;
    let same_as = match plan {
        Ok(same_as) => same_as?,
        Err(e) => {
            log::warn!("[INCIDENTS::RCA] recurrence check of {org_id}/{incident_id}: {e:#}");
            return None;
        }
    };
    match write(org_id, incident_id, &same_as).await {
        Ok(started) => Some(started),
        Err(e) => {
            log::warn!("[INCIDENTS::RCA] re-check of {org_id}/{incident_id}: {e:#}");
            None
        }
    }
}

/// The agreeing runs, newest first, when the incident recurs and nothing changed since them.
pub(crate) async fn plan_with(
    org_id: &str,
    incident_id: &str,
    policy: Policy,
    now: i64,
    changes: &dyn ChangeReads,
) -> anyhow::Result<Option<Vec<PriorRun>>> {
    let Some(incident) = infra::table::alert_incidents::get_rw(org_id, incident_id).await? else {
        return Ok(None);
    };
    // Only a first analysis: an un-muted incident that was analysed before runs in full.
    if incident.rca_run_id.is_some() {
        return Ok(None);
    }
    let Some(opener) = infra::table::alert_incidents::opening_alert(incident_id).await? else {
        return Ok(None);
    };
    let want = Fingerprint::of(&incident, &opener.0);
    let limit = u64::try_from(policy.runs)
        .unwrap_or(u64::MAX)
        .saturating_add(OTHER_RUNS);
    let rows = runs_table::full_runs_for_alert(org_id, &opener.0, limit).await?;
    let mut matched: HashMap<String, bool> = HashMap::new();
    let mut prior = Vec::new();
    for row in rows {
        let Some(id) = row.incident_id.clone().filter(|id| id != incident_id) else {
            continue;
        };
        let same = match matched.get(&id) {
            Some(same) => *same,
            None => {
                let same = same_fingerprint(org_id, &id, &want).await?;
                matched.insert(id.clone(), same);
                same
            }
        };
        if !same {
            continue;
        }
        prior.push(PriorRun {
            record: runs_table::decode(row.result.as_deref()),
            run_id: row.run_id,
            incident_id: id,
            started_at: row.started_at,
        });
        if prior.len() >= policy.runs {
            break;
        }
    }
    let Some(agreed) = agreeing(prior, policy, now) else {
        return Ok(None);
    };
    let answers = changes
        .since(org_id, &incident, &opener, agreed[0].started_at)
        .await;
    Ok(answers.filter(|a| unchanged(a)).map(|_| agreed))
}

/// Starts and completes the re-check run, then delivers its verdict as a finished run would.
pub(crate) async fn write(
    org_id: &str,
    incident_id: &str,
    same_as: &[PriorRun],
) -> anyhow::Result<AutoStart> {
    let newest = same_as
        .first()
        .and_then(|p| p.record.as_ref())
        .ok_or_else(|| anyhow::anyhow!("no agreeing run to reuse"))?;
    let cause = newest
        .verdict
        .as_ref()
        .map(|v| v.probable_cause.clone())
        .unwrap_or_default();
    let mut record = reused(newest, same_as.len());
    let report = report(org_id, same_as, &cause);
    let trigger = RunTrigger::AutoNewIncident;
    let ids: Vec<&str> = same_as.iter().map(|p| p.run_id.as_str()).collect();
    // First-run only, checked under the incident's lock: an analysis that started since the plan
    // wins.
    let started = start_first_run(StartRun {
        org_id: org_id.to_string(),
        subject: RunSubject::Incident(incident_id.to_string()),
        trigger,
        mode: RunMode::Recheck,
        started_by: "system".to_string(),
        guidance: None,
        skip_cooldown: true,
        oncall_subjects: None,
        context_used: Some(serde_json::json!({ "same_as": ids })),
    })
    .await?;
    let run_id = match started {
        StartOutcome::Started { run_id } => run_id,
        StartOutcome::InFlight | StartOutcome::CoolingDown => {
            return Ok(AutoStart::NotStarted(None));
        }
    };
    if let Some(verdict) = record.verdict.as_mut() {
        verdict.report_ref = format!("{incident_id}/rca/{run_id}");
    }
    let patch = RunUpdate {
        outcome: record.outcome.as_ref().map(|o| o.as_str().to_string()),
        confidence: record.grade.as_ref().map(|g| g.band.as_str().to_string()),
        result: Some(serde_json::to_value(&record)?),
        stats: Some(RunStats {
            steps: Some(0),
            tool_calls: Some(0),
            credits: Some(0.0),
            ..Default::default()
        }),
        summary: Some(RunSummaryPatch {
            steps: Some(0),
            tool_calls: Some(0),
            ..Default::default()
        }),
        ..Default::default()
    };
    match complete_run(org_id, &run_id, &report, patch).await {
        Ok(true) => {}
        // Ended meanwhile (a cancel wins), so there is nothing to deliver.
        Ok(false) => return Ok(AutoStart::Started),
        Err(e) => {
            let details = Some(format!("{e:#}"));
            fail_run(
                org_id,
                &run_id,
                trigger,
                ERROR_SAVE_FAILED,
                SAVE_FAILED_REASON,
                details,
            )
            .await?;
            return Err(e);
        }
    }
    count_run_end(org_id, trigger, RunState::Completed, "");
    let verdict = record.verdict.as_ref();
    rca_service::deliver_incident_result(
        org_id,
        incident_id,
        &report,
        verdict,
        record.grade.as_ref(),
    )
    .await;
    crate::autoobserve::next_step::on_run_finished(org_id, incident_id, &run_id, verdict).await;
    Ok(AutoStart::Started)
}

async fn same_fingerprint(
    org_id: &str,
    incident_id: &str,
    want: &Fingerprint,
) -> anyhow::Result<bool> {
    let Some(incident) = infra::table::alert_incidents::get_rw(org_id, incident_id).await? else {
        return Ok(false);
    };
    let opener = infra::table::alert_incidents::opening_alert(incident_id).await?;
    Ok(opener.is_some_and(|(alert, _)| Fingerprint::of(&incident, &alert) == *want))
}

/// The opening alert's stream: a finding's from the incident's dimensions, an alert's from its
/// definition; an external event has none.
async fn opener_stream(
    org_id: &str,
    incident: &Incident,
    (alert_id, kind): &(String, String),
) -> Option<EntityRef> {
    let (stream_type, stream_name) = match AlertKind::from_stored(kind) {
        AlertKind::AutoObserve => {
            let dim = |k: &str| incident.group_values.get(k)?.as_str().map(str::to_string);
            (
                dim(FINDING_STREAM_TYPE_DIMENSION)?,
                dim(FINDING_STREAM_NAME_DIMENSION)?,
            )
        }
        AlertKind::Internal => {
            let id = svix_ksuid::Ksuid::from_str(alert_id).ok()?;
            let primary = infra::db::get_orm_client_rw().await;
            match crate::alerts::alert::get_by_id(primary, org_id, id).await {
                Ok((_, alert)) => (alert.stream_type.to_string(), alert.stream_name),
                Err(e) => {
                    log::warn!("[INCIDENTS::RCA] reading alert {org_id}/{alert_id}: {e}");
                    return None;
                }
            }
        }
        AlertKind::External => return None,
    };
    let stream_type = StreamType::from(stream_type.as_str());
    Some(crate::autoobserve::causes::stream_ref(
        stream_type,
        &stream_name,
    ))
}

/// The newest `policy.runs` runs when each found one confident root cause with no suspect change,
/// all gave the same paging advice, and the newest is recent enough.
fn agreeing(prior: Vec<PriorRun>, policy: Policy, now: i64) -> Option<Vec<PriorRun>> {
    let newest = prior.first()?;
    if prior.len() < policy.runs || now - newest.started_at > policy.max_age_us {
        return None;
    }
    // Free text cannot be compared: contradictory causes share most of their words.
    let advice = |p: &PriorRun| {
        let record = p.record.as_ref()?;
        let verdict = record.verdict.as_ref()?;
        let confident = record
            .grade
            .as_ref()
            .is_some_and(|g| matches!(g.band, Confidence::High | Confidence::Medium));
        let found = record.outcome == Some(RcaOutcome::RootCauseIdentified);
        (found && confident && verdict.suspect_change.is_none())
            .then_some(verdict.page_recommendation.action)
    };
    let first = advice(newest)?;
    prior
        .iter()
        .all(|p| advice(p) == Some(first))
        .then_some(prior)
}

/// Only a source that answered in full with no change rules a change out.
fn unchanged(answers: &[(Checked, Vec<ChangeRecord>)]) -> bool {
    answers
        .iter()
        .all(|(checked, records)| *checked == Checked::Ok && records.is_empty())
}

/// The newest agreeing run's conclusion, without the ledger and evidence of a run that did not
/// happen here.
fn reused(newest: &RcaRunRecord, runs: usize) -> RcaRunRecord {
    let mut verdict = newest.verdict.clone();
    if let Some(v) = verdict.as_mut() {
        v.probable_cause = format!("{}: {}", same_as_title(runs), v.probable_cause);
        v.evidence.clear();
        v.next_step = None;
    }
    RcaRunRecord {
        verdict,
        answer_deadline_need: None,
        ledger: Default::default(),
        blind_spots: Vec::new(),
        timeline: Vec::new(),
        evidence: Vec::new(),
        unverified: Vec::new(),
        leading_history: Vec::new(),
        cited_calls: Vec::new(),
        steer_authors: Default::default(),
        ..newest.clone()
    }
}

fn same_as_title(runs: usize) -> String {
    match runs {
        1 => "Same as the last investigation".to_string(),
        n => format!("Same as the last {n} investigations"),
    }
}

fn report(org_id: &str, same_as: &[PriorRun], cause: &str) -> String {
    let cfg = config::get_config();
    let n = same_as.len();
    let (earlier, them) = match n {
        1 => (
            "The last investigation of this recurring incident found this cause".to_string(),
            "it",
        ),
        n => (
            format!("The last {n} investigations of this recurring incident agreed on this cause"),
            "them",
        ),
    };
    let mut out = format!(
        "## {}\n\n{earlier}, and nothing changed since: no deploy or service-version change and \
         no config edit to the alert or its streams. This incident was re-checked against {them} \
         instead of being investigated again.\n\n**Cause:** {cause}\n\n**Matched \
         investigations:**\n\n",
        same_as_title(n)
    );
    for p in same_as.iter().take(LINKS_SHOWN) {
        let url = incident_page_url(
            &cfg.common.web_url,
            &cfg.common.base_uri,
            org_id,
            &p.incident_id,
        );
        let at = chrono::DateTime::from_timestamp_micros(p.started_at)
            .map(|t| t.format("%Y-%m-%d %H:%M UTC").to_string())
            .unwrap_or_default();
        out.push_str(&format!("- [Investigation of {at}]({url})\n"));
    }
    if n > LINKS_SHOWN {
        out.push_str(&format!("- and {} more\n", n - LINKS_SHOWN));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use config::meta::alerts::rca_runs::RcaRun;
    use infra::table::entity::{alert_incident_alerts, alert_incidents, rca_runs as run_rows};
    use o2_enterprise::enterprise::autoobserve::{
        context::ChangeKind,
        contract::Confidence as Link,
        names::{dims, kinds},
    };
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};

    use super::*;
    use crate::alerts::rca_runs::tests::{add_incident, db, start, stored};

    const ALERT: &str = "3LYSx90T0LLqP44UicC1TFuwbTU";
    const POLICY: Policy = Policy {
        runs: 3,
        max_age_us: 24 * HOUR_US,
    };

    struct Changes(Option<Vec<(Checked, Vec<ChangeRecord>)>>);

    #[async_trait]
    impl ChangeReads for Changes {
        async fn since(
            &self,
            _: &str,
            _: &Incident,
            _: &(String, String),
            _: i64,
        ) -> Option<Vec<(Checked, Vec<ChangeRecord>)>> {
            self.0.clone()
        }
    }

    fn deploy() -> ChangeRecord {
        ChangeRecord {
            provider: String::new(),
            kind: ChangeKind::Deploy,
            at: 1,
            until: None,
            actor: None,
            subject: EntityRef::new(kinds::STREAM, &[(dims::STREAM_NAME, "vpc_flow")]),
            subject_name: "vpc_flow".to_string(),
            affects: Vec::new(),
            link: Link::Exact,
            count: None,
            facts: BTreeMap::new(),
            needs: None,
            open: None,
        }
    }

    async fn opened_by_alert(org: &str) -> String {
        let id = add_incident(org, None).await;
        let now = now_micros();
        let link: alert_incident_alerts::ActiveModel = alert_incident_alerts::Model {
            incident_id: id.clone(),
            alert_id: ALERT.to_string(),
            alert_fired_at: now,
            alert_name: "vpc_flow_rejected".to_string(),
            alert_kind: "internal".to_string(),
            correlation_reason: None,
            created_at: now,
            resolved_at: None,
            labels: None,
            severity: None,
        }
        .into();
        alert_incident_alerts::Entity::insert(link.reset_all())
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        id
    }

    /// A completed first analysis of `incident` that started `hours` ago.
    async fn analysed(org: &str, incident: &str, advice: &str, hours: i64) -> String {
        let run_id = start(org, incident, RunTrigger::AutoNewIncident).await;
        let record: RcaRunRecord = serde_json::from_value(serde_json::json!({
            "schema_version": 1,
            "verdict": {
                "probable_cause": "Internet scanners probing admin ports",
                "confidence": "medium",
                "page_recommendation": {"action": advice, "reason": "baseline"},
                "report_ref": "",
            },
            "grade": {"band": "medium", "claimed": "medium", "graded": "medium"},
            "outcome": "root_cause_identified",
        }))
        .unwrap();
        let patch = RunUpdate {
            outcome: Some("root_cause_identified".to_string()),
            confidence: Some("medium".to_string()),
            result: Some(serde_json::to_value(&record).unwrap()),
            ..Default::default()
        };
        assert!(
            complete_run(org, &run_id, "## Root cause", patch)
                .await
                .unwrap()
        );
        run_rows::Entity::update_many()
            .col_expr(
                run_rows::Column::StartedAt,
                Expr::value(now_micros() - hours * HOUR_US),
            )
            .filter(run_rows::Column::RunId.eq(&run_id))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        run_id
    }

    #[tokio::test]
    async fn a_recurrence_is_rechecked_only_when_its_last_runs_agree_and_nothing_changed() {
        let _db = db().await;
        let nothing = || Some(vec![(Checked::Ok, vec![]), (Checked::Ok, vec![])]);
        let down = ["downgrade"; 3];
        let cases = [
            (
                "three agree, nothing changed",
                down,
                1,
                false,
                nothing(),
                true,
            ),
            (
                "one advises paging",
                ["downgrade", "page", "downgrade"],
                1,
                false,
                nothing(),
                false,
            ),
            (
                "a deploy since",
                down,
                1,
                false,
                Some(vec![(Checked::Ok, vec![deploy()]), (Checked::Ok, vec![])]),
                false,
            ),
            (
                "the audit trail is off",
                down,
                1,
                false,
                Some(vec![(Checked::Ok, vec![]), (Checked::Off, vec![])]),
                false,
            ),
            ("no stream to check", down, 1, false, None, false),
            ("the newest is a day old", down, 25, false, nothing(), false),
            ("one is another recurrence", down, 1, true, nothing(), false),
            (
                "its newest run has no result",
                down,
                1,
                false,
                nothing(),
                false,
            ),
            (
                "the incident was analysed before",
                down,
                1,
                false,
                nothing(),
                false,
            ),
        ];
        for (name, advice, newest_hours, other, answers, rechecked) in cases {
            let org = format!("rck_{}", runs_table::new_run_id().to_lowercase());
            let mut prior = Vec::new();
            for (i, advice) in advice.iter().enumerate() {
                let incident = opened_by_alert(&org).await;
                prior.push(incident.clone());
                analysed(&org, &incident, advice, newest_hours + i as i64).await;
            }
            if other {
                alert_incidents::Entity::update_many()
                    .col_expr(
                        alert_incidents::Column::GroupValues,
                        Expr::value(serde_json::json!({"service": "other"})),
                    )
                    .filter(alert_incidents::Column::Id.eq(&prior[1]))
                    .exec(infra::db::get_orm_client_rw().await)
                    .await
                    .unwrap();
            }
            if name == "its newest run has no result" {
                let newest = analysed(&org, &opened_by_alert(&org).await, "downgrade", 0).await;
                run_rows::Entity::update_many()
                    .col_expr(
                        run_rows::Column::Result,
                        Expr::value(Option::<String>::None),
                    )
                    .filter(run_rows::Column::RunId.eq(&newest))
                    .exec(infra::db::get_orm_client_rw().await)
                    .await
                    .unwrap();
            }
            let incident = opened_by_alert(&org).await;
            if name == "the incident was analysed before" {
                analysed(&org, &incident, "downgrade", 0).await;
            }
            let plan = plan_with(&org, &incident, POLICY, now_micros(), &Changes(answers))
                .await
                .unwrap();
            assert_eq!(plan.is_some(), rechecked, "{name}");
            if name == "the incident was analysed before" {
                // An analysis that lands between the plan and the write wins.
                let fresh = opened_by_alert(&org).await;
                let unchanged = Changes(nothing());
                let plan = plan_with(&org, &fresh, POLICY, now_micros(), &unchanged);
                let plan = plan.await.unwrap().unwrap();
                let wrote = write(&org, &incident, &plan).await.unwrap();
                assert_eq!(wrote, AutoStart::NotStarted(None), "{name}");
            }
            let Some(same_as) = plan else {
                continue;
            };
            assert_eq!(
                write(&org, &incident, &same_as).await.unwrap(),
                AutoStart::Started
            );
            let row = infra::table::alert_incidents::get(&org, &incident)
                .await
                .unwrap()
                .unwrap();
            let run: RcaRun = stored(&org, &row.rca_run_id.unwrap()).await;
            assert_eq!(
                (run.state, run.mode),
                (RunState::Completed, RunMode::Recheck)
            );
            assert_eq!(run.stats.and_then(|s| s.credits), Some(0.0), "free");
            let report = run.report.unwrap_or_default();
            assert!(
                prior.iter().all(|id| report.contains(id.as_str())),
                "{report}"
            );
            let record: RcaRunRecord = serde_json::from_value(run.result.unwrap()).unwrap();
            let cause = record.verdict.unwrap().probable_cause;
            assert!(
                cause.starts_with("Same as the last 3 investigations: Internet scanners"),
                "{cause}"
            );
        }
    }
}
