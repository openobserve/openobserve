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

//! The Incidents v2 columns an incident gets at creation (owner team, impact onset), the
//! owner-block edits a person makes, the first qualifying open and the assignee's notice.

use std::{collections::HashMap, time::Duration};

use config::meta::{
    alerts::{
        AggFunction, Operator, QueryType,
        alert::Alert,
        incident_fields::{self, OnsetDirection},
        incidents::Incident,
    },
    cluster::RoleGroup,
    oncall::Response,
};
use infra::table::{
    alert_incidents::{self as table, FieldEdit},
    entity::alert_incidents::Model,
};

use super::{IncidentSend, model_to_incident};

const ASSIGNEE_CHANGED_EVENT: &str = "assignee_changed";
/// The sentence's variable for a custom template; the notice's own value replaces an author's.
const NOTICE_MESSAGE_KEY: &str = "incident_message";
/// The onset search runs after the commit and never holds up the first page (I4).
const ONSET_TIMEOUT: Duration = Duration::from_secs(30);
const ONSET_LOOKBACK_MICROS: i64 = 3_600 * 1_000_000;
const MINUTE_MICROS: i64 = 60 * 1_000_000;
/// Searches an alert storm may run at once; the rest wait inside their own timeout.
const ONSET_SEARCH_SLOTS: usize = 4;

static ONSET_SEARCHES: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(ONSET_SEARCH_SLOTS);

/// Applies a person's owner-block or impact edit; `None` when the incident does not exist.
pub async fn update_fields(
    org_id: &str,
    incident_id: &str,
    edit: FieldEdit,
    user_id: &str,
) -> Result<Option<Incident>, anyhow::Error> {
    let Some(edited) = table::edit_fields(org_id, incident_id, edit, user_id).await? else {
        return Ok(None);
    };
    if let Some(event) = edited.event
        && let Err(e) =
            crate::incidents::send_incident_event_trigger(org_id, incident_id, event).await
    {
        log::error!("[incidents] workflows of the edit of {org_id}/{incident_id}: {e}");
    }
    Ok(Some(model_to_incident(edited.row).await?))
}

/// Stamps `first_opened_at` for a qualifying responder (PB-22) and returns the stored value;
/// `None` when the incident does not exist.
pub async fn mark_opened(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
) -> Result<Option<Option<i64>>, anyhow::Error> {
    let Some(row) = table::get_rw(org_id, incident_id).await? else {
        return Ok(None);
    };
    if row.first_opened_at.is_some() {
        return Ok(Some(row.first_opened_at));
    }
    let paged = paged_recipients(org_id, incident_id).await?;
    let members = match row.owner_team_id.as_deref() {
        Some(team) => infra::table::oncall_teams::list_members_cached(team)
            .await?
            .into_iter()
            .map(|m| m.user_email)
            .collect(),
        None => Vec::new(),
    };
    if !qualifies(user_id, row.assigned_to.as_deref(), &paged, &members) {
        return Ok(Some(None));
    }
    let now = config::utils::time::now_micros();
    Ok(table::mark_first_opened(org_id, incident_id, now).await?)
}

/// Records the owner team at creation (I-22): the team the opening record paged, else the team
/// routing names now; a team a person set already wins.
pub(super) async fn record_owner_team(
    org_id: &str,
    incident_id: &str,
    record: Option<&Response>,
    explicit_team: Option<&str>,
    dimensions: &HashMap<String, String>,
) {
    let paged = paged_team(record);
    let routed = match paged {
        Some(_) => None,
        None => {
            o2_enterprise::enterprise::oncall::routing::decide(org_id, explicit_team, dimensions)
                .await
                .inspect_err(|e| {
                    log::warn!("[incidents] owner team of {org_id}/{incident_id}: {e}");
                })
                .ok()
                .and_then(|routed| routed.team_id().map(str::to_string))
        }
    };
    let Some(team) = owner_team(paged, routed) else {
        return;
    };
    if let Err(e) = table::set_owner_team_if_unset(org_id, incident_id, &team).await {
        log::error!("[incidents] could not store the owner team of {org_id}/{incident_id}: {e}");
    }
}

/// Moves `impact_start_at` to the onset the alert's own series shows, after the create commits.
pub(super) fn spawn_onset(alert: &Alert, incident_id: &str) {
    if !common::meta::incidents_v2::incidents_v2_enabled() {
        return;
    }
    let (alert, incident_id) = (alert.clone(), incident_id.to_string());
    tokio::spawn(async move {
        let org_id = alert.org_id.clone();
        let bounded = async {
            let _slot = ONSET_SEARCHES.acquire().await?;
            detect_onset(&alert, &incident_id).await
        };
        match tokio::time::timeout(ONSET_TIMEOUT, bounded).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log::warn!("[incidents] onset of {org_id}/{incident_id}: {e}"),
            Err(_) => log::warn!("[incidents] onset of {org_id}/{incident_id} timed out"),
        }
    });
}

/// Tells the incident's destinations who now leads it; a muted incident or no change, nobody.
pub(super) async fn notify_assignment(
    before: Option<&str>,
    updated: &Model,
    actor: &str,
) -> Option<String> {
    let assignee = assignee_to_notify(
        before,
        updated.assigned_to.as_deref(),
        updated.muted_by_downtime_id.is_some(),
    )?;
    let title = updated.title.as_deref().unwrap_or(&updated.id);
    let text = assignment_text(actor, title, assignee);
    let (org_id, incident_id) = (updated.org_id.as_str(), updated.id.as_str());
    let now = config::utils::time::now_micros();
    let mut send = assignment_send(org_id, incident_id, title, now).await;
    carry_notice(&mut send.ctx, &text);
    super::send_incident_notices(
        org_id,
        incident_id,
        ASSIGNEE_CHANGED_EVENT,
        Some(text),
        vec![send],
    )
    .await
}

/// Every channel's body reads the description, so the sentence names the assignee everywhere.
pub(super) fn carry_notice(
    ctx: &mut crate::alerts::notifications::NotificationContext,
    text: &str,
) {
    ctx.alert_description = text.to_string();
    ctx.context_attributes
        .retain(|(key, _)| key != NOTICE_MESSAGE_KEY);
    ctx.context_attributes
        .push((NOTICE_MESSAGE_KEY.to_string(), text.to_string()));
}

/// The rendering a severity change uses: the first alert's context, or the incident's own.
async fn assignment_send(
    org_id: &str,
    incident_id: &str,
    title: &str,
    now: i64,
) -> IncidentSend<'static> {
    let first = match infra::table::alert_incidents::get_incident_alerts(incident_id).await {
        Ok(alerts) => alerts.into_iter().next(),
        Err(e) => {
            log::warn!("[incidents] alerts of {org_id}/{incident_id} for a notice: {e}");
            None
        }
    };
    let cached = match first {
        Some(first) => crate::db::alerts::alert::get_alert_from_cache(org_id, &first.alert_id)
            .await
            .map(|(_, alert)| alert),
        None => None,
    };
    let Some(alert) = cached else {
        return IncidentSend {
            ctx: super::subject_notification_context(org_id, title, now).await,
            dest_names: super::collect_incident_destinations(org_id, incident_id, &[]).await,
            alert_template: None,
        };
    };
    let ctx = crate::alerts::alert::build_send_context(
        &alert,
        &[],
        now,
        None,
        now,
        None,
        None,
        None,
        None,
        false,
    )
    .await;
    IncidentSend {
        ctx,
        dest_names: super::collect_incident_destinations(org_id, incident_id, &alert.destinations)
            .await,
        alert_template: None,
    }
}

/// Everyone a delivery of a record linked to the incident was addressed to.
async fn paged_recipients(org_id: &str, incident_id: &str) -> Result<Vec<String>, anyhow::Error> {
    let mut paged = Vec::new();
    for record in infra::table::oncall_responses::list_for_incident(org_id, incident_id).await? {
        let deliveries = infra::table::oncall_responses::list_deliveries(&record.id).await?;
        paged.extend(deliveries.into_iter().filter_map(|d| d.recipient));
    }
    Ok(paged)
}

async fn detect_onset(alert: &Alert, incident_id: &str) -> Result<(), anyhow::Error> {
    let org_id = alert.org_id.as_str();
    let Some(row) = table::get_rw(org_id, incident_id).await? else {
        return Ok(());
    };
    let first = row.first_alert_at;
    // Whole minutes only: a partial last minute would read as a drop of a count.
    let end = first - first.rem_euclid(MINUTE_MICROS);
    let Some((series, direction)) = alert_series(alert, end - ONSET_LOOKBACK_MICROS, end).await?
    else {
        return Ok(());
    };
    let Some(onset) = incident_fields::impact_onset(&series, direction).filter(|at| *at < first)
    else {
        return Ok(());
    };
    table::move_impact_start_to_onset(org_id, incident_id, first, onset).await?;
    Ok(())
}

/// Every minute of `[start, end)` of the alert's own signal, with its bad direction.
async fn alert_series(
    alert: &Alert,
    start: i64,
    end: i64,
) -> Result<Option<(Vec<(i64, f64)>, OnsetDirection)>, anyhow::Error> {
    let condition = &alert.query_condition;
    match condition.query_type {
        QueryType::PromQL => {
            let (Some(query), Some(direction)) = (
                condition.promql.as_deref().filter(|q| !q.trim().is_empty()),
                condition
                    .promql_condition
                    .as_ref()
                    .and_then(|c| direction_of(c.operator)),
            ) else {
                return Ok(None);
            };
            let series = promql_series(&alert.org_id, query, start, end).await?;
            let filled = incident_fields::fill_steps(&series, start, end, MINUTE_MICROS, f64::NAN);
            Ok(Some((filled, direction)))
        }
        QueryType::Custom => {
            let operator = match &condition.aggregation {
                Some(agg) => agg.having.operator,
                None => alert.trigger_condition.operator,
            };
            let Some(direction) = direction_of(operator) else {
                return Ok(None);
            };
            let series = sql_series(alert, start, end).await?;
            let empty = empty_minute(condition.aggregation.as_ref().map(|agg| &agg.function));
            let filled = incident_fields::fill_steps(&series, start, end, MINUTE_MICROS, empty);
            Ok(Some((filled, direction)))
        }
        _ => Ok(None),
    }
}

async fn promql_series(
    org_id: &str,
    query: &str,
    start: i64,
    end: i64,
) -> Result<Vec<(i64, f64)>, anyhow::Error> {
    let req = promql_service::MetricsQueryRequest {
        query: query.to_string(),
        start,
        end,
        step: MINUTE_MICROS,
        query_exemplars: false,
        use_cache: None,
        search_type: Some(config::meta::search::SearchEventType::Alerts),
        regions: vec![],
        clusters: vec![],
        search_event_context: None,
    };
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let trace_id = config::ider::generate_trace_id();
    let resp =
        promql_service::search::search(&trace_id, org_id, &req, "", 0, super_cluster).await?;
    let config::meta::promql::value::Value::Matrix(matrix) = resp.value else {
        return Ok(Vec::new());
    };
    let mut sums = std::collections::BTreeMap::new();
    for sample in matrix.iter().flat_map(|series| series.samples.iter()) {
        let minute = sample.timestamp - sample.timestamp.rem_euclid(MINUTE_MICROS);
        *sums.entry(minute).or_insert(0.0) += sample.value;
    }
    Ok(sums.into_iter().collect())
}

async fn sql_series(alert: &Alert, start: i64, end: i64) -> Result<Vec<(i64, f64)>, anyhow::Error> {
    let schema = infra::schema::get(&alert.org_id, &alert.stream_name, alert.stream_type).await?;
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: crate::alerts::alert_series_sql(
                alert,
                &schema,
                60,
                crate::alerts::AlertSeries::Onset,
            )
            .await?,
            from: 0,
            size: 120,
            start_time: start,
            end_time: end,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: ONSET_TIMEOUT.as_secs() as i64,
        search_type: Some(config::meta::search::SearchEventType::Alerts),
        search_event_context: None,
        use_cache: false,
        use_index: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
        raw_streams: None,
    };
    let trace_id = config::ider::generate();
    let background = Some(RoleGroup::Background);
    let stream_type = alert.stream_type;
    let resp = crate::search::grpc_search::grpc_search(
        &trace_id,
        &alert.org_id,
        stream_type,
        None,
        &req,
        background,
    )
    .await?;
    complete_buckets(resp)
}

/// A partial answer lacks minutes that would read as zeros, so it detects nothing; alert
/// evaluation's `complete_response` lets some partial answers through, so it is not reused.
fn complete_buckets(
    resp: config::meta::search::Response,
) -> Result<Vec<(i64, f64)>, anyhow::Error> {
    if resp.is_partial {
        anyhow::bail!("partial onset search: {}", resp.function_error.join(", "));
    }
    Ok(resp.hits.iter().filter_map(bucket_of).collect())
}

fn bucket_of(hit: &serde_json::Value) -> Option<(i64, f64)> {
    let at = hit.get("zo_onset_at")?.as_i64()?;
    let value = hit.get("zo_onset_value")?.as_f64()?;
    Some((at - at.rem_euclid(MINUTE_MICROS), value))
}

/// A minute without rows counts zero, while an average or percentile of no rows has no value.
fn empty_minute(function: Option<&AggFunction>) -> f64 {
    match function {
        None | Some(AggFunction::Count | AggFunction::Sum) => 0.0,
        Some(_) => f64::NAN,
    }
}

/// Only an ordering threshold has a bad direction; `=` and `!=` have none.
fn direction_of(operator: Operator) -> Option<OnsetDirection> {
    match operator {
        Operator::GreaterThan | Operator::GreaterThanEquals => Some(OnsetDirection::Up),
        Operator::LessThan | Operator::LessThanEquals => Some(OnsetDirection::Down),
        _ => None,
    }
}

/// `Some(team)` when an opening record exists (its team, even none); `None` means route now.
fn paged_team(record: Option<&Response>) -> Option<Option<String>> {
    record.map(|r| r.team_id.clone())
}

fn owner_team(paged: Option<Option<String>>, routed: Option<String>) -> Option<String> {
    match paged {
        Some(team) => team,
        None => routed,
    }
}

/// PB-22: a paged responder, the lead or an owner-team member; a declarer alone never counts.
fn qualifies(user: &str, lead: Option<&str>, paged: &[String], members: &[String]) -> bool {
    let is = |other: &str| other.eq_ignore_ascii_case(user);
    lead.is_some_and(is) || paged.iter().any(|p| is(p)) || members.iter().any(|m| is(m))
}

fn assignee_to_notify<'a>(
    before: Option<&str>,
    after: Option<&'a str>,
    muted: bool,
) -> Option<&'a str> {
    if muted || before == after {
        return None;
    }
    after
}

fn assignment_text(actor: &str, title: &str, assignee: &str) -> String {
    format!("{actor} assigned {title} to {assignee}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_owner_is_the_paged_team_else_the_routed_one_else_none() {
        assert_eq!(
            owner_team(Some(Some("paged".into())), Some("routed".into())),
            Some("paged".into())
        );
        assert_eq!(
            owner_team(None, Some("routed".into())),
            Some("routed".into())
        );
        assert_eq!(owner_team(None, None), None);
        assert_eq!(
            owner_team(Some(None), Some("routed".into())),
            None,
            "a record that paged nobody owns no team; routing is not asked again"
        );
        assert_eq!(paged_team(None), None);
    }

    #[test]
    fn only_a_responder_the_lead_or_an_owner_member_starts_the_clock() {
        let paged = vec!["pager@acme.io".to_string()];
        let members = vec!["member@acme.io".to_string()];
        assert!(qualifies("LEAD@acme.io", Some("lead@acme.io"), &[], &[]));
        assert!(qualifies("pager@acme.io", None, &paged, &members));
        assert!(qualifies("member@acme.io", None, &paged, &members));
        assert!(!qualifies(
            "declarer@acme.io",
            Some("lead@acme.io"),
            &paged,
            &members
        ));
    }

    #[test]
    fn a_new_assignee_is_told_once_and_never_while_muted_or_unchanged() {
        assert_eq!(
            assignee_to_notify(None, Some("a@acme.io"), false),
            Some("a@acme.io")
        );
        assert_eq!(
            assignee_to_notify(Some("b@acme.io"), Some("a@acme.io"), false),
            Some("a@acme.io")
        );
        assert_eq!(assignee_to_notify(None, Some("a@acme.io"), true), None);
        assert_eq!(
            assignee_to_notify(Some("a@acme.io"), Some("a@acme.io"), false),
            None
        );
        assert_eq!(assignee_to_notify(Some("a@acme.io"), None, false), None);
        assert_eq!(
            assignment_text("ana@acme.io", "Checkout errors", "raj@acme.io"),
            "ana@acme.io assigned Checkout errors to raj@acme.io"
        );
    }

    #[test]
    fn the_assignment_sentence_is_in_every_body_and_beats_an_authors_attribute() {
        use crate::alerts::notifications::{
            NotificationContext, default_template::compiled_default_content,
            render::webhook::context_object, resolve::resolve_content,
        };
        let mut ctx = NotificationContext {
            alert_description: "the alert's own text".into(),
            context_attributes: vec![(NOTICE_MESSAGE_KEY.into(), "see runbook".into())],
            ..Default::default()
        };
        let text = assignment_text("ana@acme.io", "Checkout errors", "raj@acme.io");
        carry_notice(&mut ctx, &text);
        let payload = context_object(&ctx);
        assert_eq!(payload[NOTICE_MESSAGE_KEY], text.as_str());
        assert_eq!(payload["alert_description"], text.as_str());
        for family in ["slack", "teams", "pagerduty", "email", "webhook"] {
            let body = resolve_content(&compiled_default_content(), &ctx, family).body_markdown;
            let plain = body.replace('\\', "");
            assert!(plain.contains("raj@acme.io"), "{family}: {body}");
        }
    }

    #[test]
    fn the_onset_search_buckets_the_alerts_own_value_by_minute() {
        assert_eq!(
            crate::alerts::alert_bucket_sql("logs", " WHERE level = 'error'", "COUNT(*)", 60),
            "SELECT histogram(_timestamp, '1 minute') AS zo_onset_bucket, MIN(_timestamp) AS \
             zo_onset_at, COUNT(*) AS zo_onset_value FROM \"logs\" WHERE level = 'error' GROUP \
             BY zo_onset_bucket ORDER BY zo_onset_bucket"
        );
        let hit = serde_json::json!({"zo_onset_at": 3 * MINUTE_MICROS + 5, "zo_onset_value": 7});
        assert_eq!(bucket_of(&hit), Some((3 * MINUTE_MICROS, 7.0)));
        let mut resp = config::meta::search::Response {
            hits: vec![hit],
            ..Default::default()
        };
        assert_eq!(
            complete_buckets(resp.clone()).unwrap(),
            vec![(3 * MINUTE_MICROS, 7.0)]
        );
        resp.is_partial = true;
        assert!(
            complete_buckets(resp).is_err(),
            "a partial answer never becomes an onset"
        );
        assert_eq!(
            direction_of(Operator::GreaterThanEquals),
            Some(OnsetDirection::Up)
        );
        assert_eq!(direction_of(Operator::LessThan), Some(OnsetDirection::Down));
        assert_eq!(direction_of(Operator::EqualTo), None);
        assert_eq!(empty_minute(None), 0.0);
        assert_eq!(empty_minute(Some(&AggFunction::Count)), 0.0);
        assert!(empty_minute(Some(&AggFunction::Avg)).is_nan());
        assert!(empty_minute(Some(&AggFunction::P99)).is_nan());
    }
}
