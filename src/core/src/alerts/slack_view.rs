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

//! What an alert message shows, read from the current truth at render time (§5.7, R-126).

use std::{collections::BTreeMap, str::FromStr};

#[cfg(feature = "enterprise")]
use config::meta::oncall::{
    policy::LadderStep,
    response::{ResponseEvent, ResponseEventKind},
};
use config::meta::{
    alerts::{
        ack::AlertAck,
        alert::Alert,
        level::AlertLevel,
        state::{AlertState, ROLLUP_GROUP_KEY},
    },
    slack::{
        AlertMessagePhase, AlertMessageView, GoneKind, MessageIncident, MessagePage, MuteView,
    },
};
use sea_orm::ConnectionTrait;
use svix_ksuid::Ksuid;

/// Everything the view is built from, so the decision is a pure function.
#[derive(Debug, Default)]
pub struct ViewInputs {
    pub alert: Option<Alert>,
    pub state: Option<AlertState>,
    pub ack: Option<AlertAck>,
    pub mute: Option<MuteView>,
    pub incident: Option<MessageIncident>,
    pub page: Option<MessagePage>,
    pub other_groups_unacked: u32,
    pub downtimes_enabled: bool,
}

/// The view of one firing's message; `None` only when the alert id is not an alert id.
pub async fn alert_message_view(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
) -> anyhow::Result<Option<AlertMessageView>> {
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Ok(None);
    };
    let conn = infra::db::get_orm_client_ro().await;
    let (folder_id, alert) = alert_or_composite(conn, org_id, id).await?;
    let state = infra::table::alert_states::get(alert_id, group_key).await?;
    let ack = infra::table::alert_acks::get(org_id, alert_id, group_key).await?;
    let now = config::utils::time::now_micros();
    let mute = live_mute(org_id, alert_id, &folder_id, group_key, now);
    let other_groups_unacked = other_groups_unacked(org_id, alert_id, group_key).await;
    let incident = live_incident(org_id, alert_id).await;
    let page = live_page(org_id, alert_id).await;
    let inputs = ViewInputs {
        alert,
        state,
        ack,
        mute,
        incident,
        page,
        other_groups_unacked,
        downtimes_enabled: crate::alerts::downtimes::enabled(),
    };
    Ok(Some(view_from(
        org_id,
        alert_id,
        group_key,
        firing_started_at,
        inputs,
    )))
}

/// The pure half of [`alert_message_view`].
pub fn view_from(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    inputs: ViewInputs,
) -> AlertMessageView {
    let ViewInputs {
        alert,
        state,
        ack,
        mute,
        incident,
        page,
        other_groups_unacked,
        downtimes_enabled,
    } = inputs;
    let still_firing = state
        .as_ref()
        .is_some_and(|s| s.firing_started_at == Some(firing_started_at));
    let phase = match (&alert, &state) {
        (None, _) => AlertMessagePhase::Gone(GoneKind::AlertDeleted),
        (Some(_), None) if group_key != ROLLUP_GROUP_KEY => {
            AlertMessagePhase::Gone(GoneKind::GroupUntracked)
        }
        (Some(a), _) if !a.enabled && still_firing => AlertMessagePhase::Disabled {
            by: a.last_edited_by.clone().unwrap_or_default(),
            at: a
                .updated_at
                .map(|t| t.timestamp_micros())
                .unwrap_or_default(),
        },
        _ if still_firing => AlertMessagePhase::Firing,
        _ => AlertMessagePhase::Cleared,
    };
    let level = state
        .as_ref()
        .and_then(|s| s.level.filter(|l| l.is_firing()).or(s.last_notified_level))
        .unwrap_or(AlertLevel::Critical);
    let group_labels = state
        .as_ref()
        .and_then(|s| s.group_labels.as_deref())
        .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(raw).ok())
        .map(|labels| labels.into_iter().collect())
        .unwrap_or_default();
    let ack = ack
        .filter(|a| a.in_force_for(Some(firing_started_at)))
        .map(|a| a.view());
    AlertMessageView {
        org_id: org_id.to_string(),
        alert_id: alert_id.to_string(),
        alert_name: alert.as_ref().map(|a| a.name.clone()).unwrap_or_default(),
        group_labels,
        firing_started_at,
        level,
        phase,
        ack,
        mute,
        incident,
        page,
        other_groups_unacked,
        alert_enabled: alert.as_ref().is_some_and(|a| a.enabled),
        downtimes_enabled,
        runbook_url: alert.as_ref().and_then(|a| a.runbook_url.clone()),
        open_url: open_url(org_id, alert_id),
    }
}

/// The alert's page in OpenObserve, the message's Open button.
pub fn open_url(org_id: &str, alert_id: &str) -> String {
    let cfg = config::get_config();
    format!(
        "{}{}/web/alerts?org_identifier={org_id}&alert_id={alert_id}",
        cfg.common.web_url, cfg.common.base_uri
    )
}

/// The scheduled alert with this id, else the composite, with the folder its mutes match on.
async fn alert_or_composite<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: Ksuid,
) -> anyhow::Result<(String, Option<Alert>)> {
    if let Some((folder, alert)) = db::alerts::alert::get_by_id(conn, org_id, id).await? {
        return Ok((folder.folder_id, Some(alert)));
    }
    let composite =
        infra::table::alert_composites::get_by_id(conn, org_id, &id.to_string()).await?;
    Ok(composite.map_or_else(
        || (String::new(), None),
        |c| {
            let alert = crate::alerts::composite::notification_alert(&c.definition);
            (c.definition.folder_id, Some(alert))
        },
    ))
}

#[cfg(feature = "enterprise")]
fn live_mute(
    org_id: &str,
    alert_id: &str,
    folder_id: &str,
    group_key: &str,
    now: i64,
) -> Option<MuteView> {
    let key = (group_key != ROLLUP_GROUP_KEY).then_some(group_key);
    let active = crate::alerts::downtimes::active_for_alert_key(
        org_id,
        alert_id,
        folder_id,
        &Default::default(),
        key,
        now,
    )?;
    let row = db::downtimes::list_cached(org_id)
        .iter()
        .find(|d| d.id == active.id)
        .cloned();
    let by = row
        .as_ref()
        .map(|d| d.created_by.clone())
        .unwrap_or_default();
    let extended_by = row
        .as_ref()
        .map(|d| d.updated_by.clone())
        .filter(|u| !u.is_empty() && *u != by);
    let groups = active
        .alert_groups
        .unwrap_or_default()
        .into_iter()
        .filter(|g| g.alert_id == alert_id)
        .map(|g| g.group_key)
        .collect();
    Some(MuteView {
        downtime_id: active.id,
        version: active.version,
        ends_at: active.ends_at,
        until_clear: active.end_on_clear.is_some(),
        by,
        extended_by,
        groups,
    })
}

/// Step N of M on the page's current ladder run, and when the next rung goes out.
#[cfg(feature = "enterprise")]
fn ladder_position(
    steps: &[LadderStep],
    timeline: &[ResponseEvent],
    run: i32,
    ladder_start: i64,
    escalating: bool,
) -> (u32, u32, Option<i64>) {
    let mut rungs: Vec<i64> = steps.iter().map(|s| s.after_micros).collect();
    rungs.sort_unstable();
    rungs.dedup();
    let reached = timeline
        .iter()
        .filter(|e| e.kind == ResponseEventKind::Page && e.run() == run)
        .filter_map(|e| e.rung_micros)
        .filter_map(|rung| rungs.iter().position(|r| *r == rung))
        .max();
    // The first rung goes out inline with the open, so a fresh page is already on step 1.
    let step = reached.map_or(usize::from(!rungs.is_empty()), |i| i + 1);
    let escalates_at = rungs
        .get(step)
        .filter(|_| escalating)
        .map(|after| ladder_start + after);
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    (count(step), count(rungs.len()), escalates_at)
}

/// The open incident the firing belongs to; the title labels it, the id when there is none.
#[cfg(feature = "enterprise")]
async fn live_incident(org_id: &str, alert_id: &str) -> Option<MessageIncident> {
    let id = crate::alerts::ack::firing_incident(org_id, alert_id).await?;
    let model = infra::table::alert_incidents::get(org_id, &id)
        .await
        .ok()
        .flatten()?;
    Some(MessageIncident {
        label: model
            .title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| model.id.clone()),
        id: model.id,
        status: model.status.parse().unwrap_or_default(),
    })
}

#[cfg(not(feature = "enterprise"))]
async fn live_incident(_org_id: &str, _alert_id: &str) -> Option<MessageIncident> {
    None
}

/// The open pages for the alert or its incident; resolve and snooze act on their ids.
#[cfg(feature = "enterprise")]
async fn live_page(org_id: &str, alert_id: &str) -> Option<MessagePage> {
    use config::meta::alerts::priority::AlertPriority;

    let open: Vec<_> = crate::alerts::ack::open_responses(org_id, alert_id)
        .await
        .into_iter()
        .filter(|r| !r.state.is_terminal())
        .collect();
    let first = open.first()?;
    let team_id = first.team();
    let team = infra::table::oncall_teams::get_cached(org_id, team_id)
        .await
        .ok()
        .flatten()
        .map_or_else(|| team_id.to_string(), |t| t.name);
    let priority = AlertPriority::from_i32(first.priority)
        .unwrap_or(config::meta::oncall::DEFAULT_PAGING_PRIORITY);
    // A teamless page has no ladder, and reading one would create a policy for team "".
    let steps = if team_id.is_empty() {
        vec![]
    } else {
        infra::table::oncall_policies::get_or_create_cached(org_id, team_id)
            .await
            .ok()
            .and_then(|p| p.rung(priority).map(|r| r.steps.clone()))
            .unwrap_or_default()
    };
    let timeline = infra::table::oncall_responses::list_events(&first.id)
        .await
        .unwrap_or_default();
    let (step, of, escalates_at) = ladder_position(
        &steps,
        &timeline,
        first.current_run(),
        first.ladder_start(),
        first.is_escalating(),
    );
    Some(MessagePage {
        response_ids: open.iter().map(|r| r.id.clone()).collect(),
        team,
        step,
        of,
        escalates_at,
    })
}

#[cfg(not(feature = "enterprise"))]
async fn live_page(_org_id: &str, _alert_id: &str) -> Option<MessagePage> {
    None
}

#[cfg(not(feature = "enterprise"))]
fn live_mute(
    _org_id: &str,
    _alert_id: &str,
    _folder_id: &str,
    _group_key: &str,
    _now: i64,
) -> Option<MuteView> {
    None
}

async fn other_groups_unacked(org_id: &str, alert_id: &str, group_key: &str) -> u32 {
    let firing = crate::alerts::lifecycle::firing_rows(alert_id).await;
    let others: Vec<&(String, i64)> = firing
        .iter()
        .filter(|(key, _)| key != group_key && key != ROLLUP_GROUP_KEY)
        .collect();
    if others.is_empty() {
        return 0;
    }
    let acks = infra::table::alert_acks::list_for_alert(org_id, alert_id)
        .await
        .unwrap_or_default();
    let unacked = others
        .iter()
        .filter(|(key, started)| {
            !acks
                .iter()
                .any(|a| &a.group_key == key && a.in_force_for(Some(*started)))
        })
        .count();
    u32::try_from(unacked).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use config::meta::oncall::target::EscalationTarget;
    use infra::table::entity::{alert_composite_children, alert_composites, alerts, folders};
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, EntityTrait, Schema};
    use svix_ksuid::KsuidLike as _;

    use super::*;

    const START: i64 = 1_000_000;

    async fn composite_db(enabled: bool) -> (DatabaseConnection, Ksuid) {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(folders::Entity),
            schema.create_table_from_entity(alerts::Entity),
            schema.create_table_from_entity(alert_composites::Entity),
            schema.create_table_from_entity(alert_composite_children::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        let id = Ksuid::new(None, None);
        let model = alert_composites::Model {
            id: id.to_string(),
            org: "acme".into(),
            folder_id: "f-ops".into(),
            name: "checkout-composite".into(),
            description: None,
            expression: "{a} AND {b}".into(),
            warning_counts_as_firing: false,
            stale_child_policy: 0,
            destinations: serde_json::json!([]),
            template: None,
            context_attributes: None,
            enabled,
            silence_seconds: 0,
            creates_incident: false,
            workflows: serde_json::json!([]),
            priority: None,
            tags: None,
            owner: None,
            last_edited_by: Some("lin@acme.test".into()),
            updated_at: Some(START + 5),
            evaluation_generation: 0,
            pending_period_sec: 0,
        };
        let row: alert_composites::ActiveModel = model.into();
        alert_composites::Entity::insert(row.reset_all())
            .exec(&db)
            .await
            .unwrap();
        (db, id)
    }

    async fn composite_view(enabled: bool, lookup: Option<Ksuid>) -> (String, AlertMessageView) {
        let (db, id) = composite_db(enabled).await;
        let id = lookup.unwrap_or(id);
        let (folder_id, alert) = alert_or_composite(&db, "acme", id).await.unwrap();
        let state = AlertState {
            firing_started_at: Some(START),
            ..AlertState::empty(&id.to_string(), ROLLUP_GROUP_KEY)
        };
        let inputs = ViewInputs {
            alert,
            state: Some(state),
            ..Default::default()
        };
        let view = view_from("acme", &id.to_string(), ROLLUP_GROUP_KEY, START, inputs);
        (folder_id, view)
    }

    #[tokio::test]
    async fn a_composite_id_reads_its_composite_and_an_unknown_id_reads_deleted() {
        let (folder_id, firing) = composite_view(true, None).await;
        assert_eq!(firing.phase, AlertMessagePhase::Firing);
        assert_eq!(firing.alert_name, "checkout-composite");
        assert_eq!(folder_id, "f-ops");

        let (_, disabled) = composite_view(false, None).await;
        assert_eq!(
            disabled.phase,
            AlertMessagePhase::Disabled {
                by: "lin@acme.test".into(),
                at: START + 5,
            }
        );

        let (_, gone) = composite_view(true, Some(Ksuid::new(None, None))).await;
        assert_eq!(gone.phase, AlertMessagePhase::Gone(GoneKind::AlertDeleted));
    }

    #[cfg(feature = "enterprise")]
    fn ladder() -> Vec<LadderStep> {
        [0, 600_000_000, 1_800_000_000]
            .into_iter()
            .map(|after| LadderStep::new(after, vec![EscalationTarget::WholeTeam]))
            .collect()
    }

    #[cfg(feature = "enterprise")]
    fn paged(rung: i64, run: i32) -> ResponseEvent {
        let mut e = ResponseEvent::new(ResponseEventKind::Page, START + rung, "engine", "paged");
        e.rung_micros = Some(rung);
        e.ladder_run = Some(run);
        e
    }

    #[test]
    fn recovered_view_keeps_active_timed_mute() {
        let mute = MuteView {
            downtime_id: "mute-test".into(),
            ends_at: START + 60_000_000,
            ..Default::default()
        };
        let view = view_from(
            "org-test",
            "alert-test",
            ROLLUP_GROUP_KEY,
            START,
            ViewInputs {
                alert: Some(Alert::default()),
                mute: Some(mute.clone()),
                ..Default::default()
            },
        );
        assert_eq!(view.phase, AlertMessagePhase::Cleared);
        assert_eq!(view.mute, Some(mute));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_fresh_page_is_on_step_one_and_names_the_next_rung() {
        assert_eq!(
            ladder_position(&ladder(), &[], 1, START, true),
            (1, 3, Some(START + 600_000_000))
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_deepest_rung_paged_in_the_current_run_sets_the_step() {
        let timeline = [paged(0, 1), paged(600_000_000, 1), paged(1_800_000_000, 0)];
        assert_eq!(
            ladder_position(&ladder(), &timeline, 1, START, true),
            (2, 3, Some(START + 1_800_000_000))
        );
        let last = [paged(0, 1), paged(1_800_000_000, 1)];
        assert_eq!(
            ladder_position(&ladder(), &last, 1, START, true),
            (3, 3, None)
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_acknowledged_or_empty_ladder_escalates_nowhere() {
        assert_eq!(
            ladder_position(&ladder(), &[], 1, START, false),
            (1, 3, None)
        );
        assert_eq!(ladder_position(&[], &[], 1, START, true), (0, 0, None));
    }
}
