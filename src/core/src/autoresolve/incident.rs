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

//! An incident's AutoResolve: its one run, the saved AutoResolves of its alerts, and the RCA's
//! probable cause as a goal for a new run.

use config::meta::autoresolve::RunState;
use infra::table::{alert_incidents, autoresolve as table, autoresolve_runs, rca_runs};
use serde::Serialize;
use utoipa::ToSchema;

use super::{
    AutoResolveError,
    live::{self, AutoResolveConnectionRef, AutoResolveTrigger},
    saved,
};

/// `GET …/autoresolve/incidents/{incident_id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct IncidentAutoResolve {
    pub incident_id: String,
    /// The incident's live run, else its newest run.
    pub run: Option<IncidentRun>,
    /// The saved AutoResolves whose trigger names an alert of the incident, incident-triggered
    /// first.
    pub related: Vec<IncidentRelated>,
    /// The RCA's probable cause, once an RCA of the incident completed.
    pub suggested_goal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct IncidentRun {
    pub run_id: String,
    pub state: String,
    /// The run has not ended, so the incident takes no other.
    pub live: bool,
    pub autoresolve_id: Option<String>,
    /// The saved AutoResolve's name; `None` for a run without one, or once it was deleted.
    pub name: Option<String>,
    pub goal: String,
    pub trigger: AutoResolveTrigger,
    pub created_at_us: i64,
    pub ended_at_us: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct IncidentRelated {
    pub id: String,
    pub name: String,
    pub goal: String,
    /// `incident`, `alert` or `person`.
    pub trigger_kind: String,
    pub alert_id: Option<String>,
    pub alert_name: Option<String>,
    pub connections: Vec<AutoResolveConnectionRef>,
}

pub async fn view(org: &str, incident_id: &str) -> Result<IncidentAutoResolve, AutoResolveError> {
    alert_incidents::get_rw(org, incident_id)
        .await?
        .ok_or(AutoResolveError::IncidentNotFound)?;
    let run = match autoresolve_runs::current_for_incident(org, incident_id).await? {
        Some(run) => Some(incident_run(org, run).await?),
        None => None,
    };
    let mut alert_ids: Vec<String> = alert_incidents::get_incident_alerts(incident_id)
        .await?
        .into_iter()
        .map(|a| a.alert_id)
        .collect();
    alert_ids.sort();
    alert_ids.dedup();
    let rows = table::list_for_alerts(org, &alert_ids).await?;
    let mut related: Vec<IncidentRelated> = saved::views(org, rows)
        .await
        .map_err(|e| AutoResolveError::Db(anyhow::anyhow!(e)))?
        .into_iter()
        .map(|v| IncidentRelated {
            id: v.id,
            name: v.name,
            goal: v.goal,
            trigger_kind: v.trigger.kind,
            alert_id: v.trigger.alert_id,
            alert_name: v.trigger.alert_name,
            connections: v.connections,
        })
        .collect();
    related.sort_by_key(|r| kind_rank(&r.trigger_kind));
    Ok(IncidentAutoResolve {
        incident_id: incident_id.to_string(),
        run,
        related,
        suggested_goal: suggested_goal(org, incident_id).await,
    })
}

/// Incident-triggered AutoResolves were saved for this, so they come first; the sort is stable,
/// so names stay in order within a kind.
fn kind_rank(kind: &str) -> u8 {
    match kind {
        "incident" => 0,
        "alert" => 1,
        _ => 2,
    }
}

async fn incident_run(
    org: &str,
    run: infra::table::entity::autoresolve_runs::Model,
) -> Result<IncidentRun, AutoResolveError> {
    let name = match &run.autoresolve_id {
        Some(id) => table::get(org, id).await?.map(|row| row.name),
        None => None,
    };
    Ok(IncidentRun {
        trigger: live::trigger_of(&run),
        live: !RunState::parse(&run.state).is_some_and(|s| s.is_terminal()),
        run_id: run.id,
        state: run.state,
        autoresolve_id: run.autoresolve_id,
        name,
        goal: run.goal,
        created_at_us: run.created_at_us,
        ended_at_us: run.ended_at_us,
    })
}

/// The newest completed RCA's `verdict.probable_cause`; an RCA that is still running, failed or
/// stored no verdict suggests nothing.
async fn suggested_goal(org: &str, incident_id: &str) -> Option<String> {
    let run = match rca_runs::newest_completed_for_incident(org, incident_id).await {
        Ok(run) => run?,
        Err(e) => {
            log::warn!("[autoresolve] {org}: RCA of incident {incident_id} not read: {e}");
            return None;
        }
    };
    probable_cause(run.result.as_deref()?)
}

fn probable_cause(result: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(result).ok()?;
    let cause = value.pointer("/verdict/probable_cause")?.as_str()?.trim();
    (!cause.is_empty() && cause != "cause unknown").then(|| cause.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_goal_is_the_rca_cause_when_it_found_one() {
        let cases = [
            (
                r#"{"verdict":{"probable_cause":"v42 lacks PAYMENT_GATEWAY_URL"}}"#,
                Some("v42 lacks PAYMENT_GATEWAY_URL"),
            ),
            (r#"{"verdict":{"probable_cause":"cause unknown"}}"#, None),
            (r#"{"verdict":{"probable_cause":"  "}}"#, None),
            (r#"{"verdict":{}}"#, None),
            ("not json", None),
        ];
        for (result, want) in cases {
            assert_eq!(probable_cause(result).as_deref(), want, "{result}");
        }
    }

    #[test]
    fn incident_triggered_autoresolves_come_first() {
        let mut kinds = vec!["person", "alert", "incident", "alert"];
        kinds.sort_by_key(|k| kind_rank(k));
        assert_eq!(kinds, ["incident", "alert", "alert", "person"]);
    }
}
