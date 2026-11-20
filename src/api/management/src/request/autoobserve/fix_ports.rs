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

//! The reads and writes AutoObserve's built-in fixes make, through each route's own service.

use std::{str::FromStr, sync::Arc};

use async_trait::async_trait;
use config::{
    meta::{
        destinations::{DestinationType, Module},
        downtimes::{AlertMuteConflict, AlertMuteRequest, Downtime, MuteSource},
        oncall::SubjectType,
        triggers::{ScheduledTriggerData, TriggerModule, TriggerStatus},
    },
    utils::time::now_micros,
};
use infra::table::{entity::oncall_responses, incident_membership};
use o2_enterprise::enterprise::{
    alert_calibration_service::applied::{Fence, Patched},
    autoobserve::{
        alert_findings::{AlertFindingsRead, DigestRun},
        decisions::{Permission, RefusalReason, Source},
        fixes::builtin,
        insight::FieldPatch,
        ports::{
            AlertRow, AlertWrite, DestinationRow, Evaluation, FixPort, MuteAnswer, MuteRow, PageRow,
        },
    },
    downtimes::schedule,
};
use openobserve_core::alerts::{
    ack::{self, AckError, Act},
    alert::{self, AlertError},
    alert_calibration::applied::{self, LiveAlerts},
    destinations,
    mute::{self, MuteError},
};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};
use svix_ksuid::Ksuid;

use super::LiveDigest;
use crate::request::security;

/// Bounds one page read; a month of one org's pages stays far below it.
const MAX_PAGES: u64 = 20_000;
const SECOND_US: i64 = 1_000_000;
const MINUTE_US: i64 = 60 * SECOND_US;
const INCIDENTS_PER_READ: usize = 200;

pub struct LiveFixPort;

/// Installs the built-in fix executors with the live alert, mute and on-call services.
pub fn install() {
    builtin::install(Arc::new(LiveFixPort), Arc::new(LiveAlerts));
}

#[async_trait]
impl FixPort for LiveFixPort {
    async fn alert(&self, org: &str, alert_id: &str) -> anyhow::Result<Option<AlertRow>> {
        let Ok(id) = Ksuid::from_str(alert_id) else {
            return Ok(None);
        };
        let conn = infra::db::get_orm_client_rw().await;
        let alert = match alert::get_by_id(conn, org, id).await {
            Ok((_, alert)) => alert,
            Err(AlertError::AlertNotFound) => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let trigger = &alert.trigger_condition;
        Ok(Some(AlertRow {
            id: alert_id.to_string(),
            name: alert.name.clone(),
            fingerprint: applied::fingerprint(&alert)?,
            destinations: alert.destinations.clone(),
            frequency_us: trigger.frequency.max(1).saturating_mul(SECOND_US),
            silence_us: trigger.silence.max(0).saturating_mul(MINUTE_US),
            detection: security::is_siem_alert(org, alert_id).await,
        }))
    }

    async fn mute(
        &self,
        org: &str,
        alert_id: &str,
        actor: &str,
        via: Source,
    ) -> anyhow::Result<MuteAnswer> {
        let target = match ack::resolve_target(org, alert_id).await {
            Ok(target) => target,
            Err(e) => return ack_answer(e),
        };
        // No end on the first clear: a flapping alert would page again (ENT ends it when quiet).
        let req = AlertMuteRequest {
            ends_at: Some(now_micros() + mute::UNTIL_CLEAR_MICROS),
            all_groups: true,
            ..Default::default()
        };
        match mute::mute(&target, &req, actor, mute_source(via)).await {
            Ok(done) => Ok(MuteAnswer::Done(MuteRow {
                downtime_id: done.downtime_id,
                version: done.version,
                created_by: actor.to_string(),
                created_at: now_micros(),
                ends_at: done.ends_at,
            })),
            Err(MuteError::Conflict(AlertMuteConflict::AlreadyMuted {
                downtime_id,
                version,
                ends_at,
            })) => {
                let by = live_mutes(org, alert_id)
                    .await?
                    .into_iter()
                    .find(|m| m.downtime_id == downtime_id)
                    .map(|m| m.created_by)
                    .unwrap_or_default();
                Ok(MuteAnswer::AlreadyMuted(MuteRow {
                    downtime_id,
                    version,
                    created_by: by,
                    created_at: 0,
                    ends_at,
                }))
            }
            Err(e) => mute_answer(e),
        }
    }

    async fn unmute(
        &self,
        org: &str,
        alert_id: &str,
        (downtime_id, version): (&str, i64),
        actor: &str,
    ) -> anyhow::Result<MuteAnswer> {
        let target = match ack::resolve_target(org, alert_id).await {
            Ok(target) => target,
            Err(e) => return ack_answer(e),
        };
        match mute::unmute(&target, downtime_id, Some(version), actor).await {
            Ok(row) => Ok(MuteAnswer::Done(mute_row(&row))),
            Err(e) => mute_answer(e),
        }
    }

    async fn patch_alert(
        &self,
        org: &str,
        alert_id: &str,
        actor: &str,
        patch: &[FieldPatch],
        guard: (&Fence, &str),
    ) -> anyhow::Result<AlertWrite> {
        let (patched, after) = LiveAlerts
            .patch_if(org, alert_id, actor, patch, guard)
            .await?;
        Ok(match (patched, after) {
            (Patched::Written { .. }, Some(after_fp)) => AlertWrite::Written { after_fp },
            (Patched::Written { .. }, None) => {
                anyhow::bail!("the written alert has no fingerprint")
            }
            (Patched::Changed, _) => AlertWrite::Changed,
            (Patched::Fenced, _) => AlertWrite::Fenced,
        })
    }

    async fn patched_fingerprint(
        &self,
        org: &str,
        alert_id: &str,
        patch: &[FieldPatch],
    ) -> anyhow::Result<Option<(String, String)>> {
        let Ok(id) = Ksuid::from_str(alert_id) else {
            return Ok(None);
        };
        let conn = infra::db::get_orm_client_rw().await;
        match alert::get_by_id(conn, org, id).await {
            Ok((_, alert)) => Ok(Some((
                applied::fingerprint(&alert)?,
                applied::patched_fingerprint(&alert, patch)?,
            ))),
            Err(AlertError::AlertNotFound) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    async fn mutes(&self, org: &str, alert_id: &str) -> anyhow::Result<Vec<MuteRow>> {
        live_mutes(org, alert_id).await
    }

    async fn evaluation(&self, org: &str, alert_id: &str) -> anyhow::Result<Option<Evaluation>> {
        // The scheduler read answers a failed read like a missing row; both, like a row it can't
        // decode, keep the snooze.
        let Ok(trigger) = infra::scheduler::get(org, TriggerModule::Alert, alert_id).await else {
            return Ok(None);
        };
        let Ok(data) = ScheduledTriggerData::from_json_string(&trigger.data) else {
            return Ok(None);
        };
        Ok(Some(Evaluation {
            last_fired_us: data.last_satisfied_at,
            next_run_us: trigger.next_run_at,
            running: trigger.status == TriggerStatus::Processing,
            realtime: trigger.is_realtime,
        }))
    }

    async fn pages(
        &self,
        org: &str,
        since_us: i64,
        alert_id: Option<&str>,
    ) -> anyhow::Result<Vec<PageRow>> {
        pages_with(
            infra::db::get_orm_client_rw().await,
            org,
            since_us,
            alert_id,
        )
        .await
    }

    async fn destinations(&self, org: &str) -> anyhow::Result<Vec<DestinationRow>> {
        Ok(destinations::list(org, Some("alert"), None)
            .await?
            .into_iter()
            .filter_map(|d| match d.module {
                Module::Alert {
                    destination_type, ..
                } => Some(DestinationRow {
                    name: d.name,
                    kind: kind_of(&destination_type),
                }),
                Module::Pipeline { .. } => None,
            })
            .collect())
    }

    async fn team_destinations(&self, org: &str, team_id: &str) -> anyhow::Result<Vec<String>> {
        Ok(infra::table::oncall_teams::get(org, team_id)
            .await?
            .and_then(|team| team.channel_destinations)
            .unwrap_or_default())
    }

    async fn latest_digest(&self, org: &str, now: i64) -> anyhow::Result<Option<DigestRun>> {
        LiveDigest
            .latest(org, now)
            .await
            .map_err(|e| anyhow::anyhow!("reading the calibration digest failed: {e:?}"))
    }
}

/// Snoozing is the mute route's own rule; a security detection also needs Security (D-C3).
pub async fn may_snooze(org_id: &str, user_id: &str, alert_id: &str) -> Permission {
    let Ok(target) = ack::resolve_target(org_id, alert_id).await else {
        return Permission::Denied(RefusalReason::Folder);
    };
    if ack::authorize(&target, user_id, Act::Mute).await.is_err() {
        return Permission::Denied(RefusalReason::Folder);
    }
    security_permission(org_id, user_id, alert_id).await
}

pub async fn security_permission(org_id: &str, user_id: &str, alert_id: &str) -> Permission {
    let detection = security::is_siem_alert(org_id, alert_id).await;
    match security::guard_siem(org_id, user_id, "POST", detection).await {
        Ok(()) => Permission::Allowed,
        Err(_) => Permission::Denied(RefusalReason::Security),
    }
}

/// An alert's own pages, and the pages of the incidents its firing opened, newest first.
async fn pages_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    since_us: i64,
    alert_id: Option<&str>,
) -> anyhow::Result<Vec<PageRow>> {
    use oncall_responses::Column;
    let alert = Column::SubjectType.eq(SubjectType::Alert.to_i32());
    let own =
        alert_id.map(|id| Condition::all().add(Column::SubjectId.starts_with(format!("{id}#"))));
    let mut out: Vec<PageRow> = pages_of(conn, org, since_us, alert, own)
        .await?
        .into_iter()
        .map(|r| page_row(source_of(&r.subject_id).to_string(), r))
        .collect();
    let incident = || Column::SubjectType.eq(SubjectType::Incident.to_i32());
    let incident_pages = match alert_id {
        None => pages_of(conn, org, since_us, incident(), None).await?,
        // One alert's read never counts other alerts' incident pages against its bound.
        Some(id) => {
            let candidates =
                incident_membership::incidents_open_since_with(conn, org, id, since_us).await?;
            let openers = incident_membership::openers_with(conn, &candidates).await?;
            let ids: Vec<&String> = candidates
                .iter()
                .filter(|i| openers.get(*i).is_some_and(|o| o == id))
                .collect();
            let mut pages = Vec::new();
            for chunk in ids.chunks(INCIDENTS_PER_READ) {
                let any = chunk.iter().fold(Condition::any(), |c, i| {
                    c.add(Column::SubjectId.starts_with(format!("{i}#")))
                });
                pages.extend(pages_of(conn, org, since_us, incident(), Some(any)).await?);
            }
            pages
        }
    };
    let ids: Vec<String> = incident_pages
        .iter()
        .map(|r| source_of(&r.subject_id).to_string())
        .collect();
    let openers = incident_membership::openers_with(conn, &ids).await?;
    for r in incident_pages {
        let Some(opener) = openers.get(source_of(&r.subject_id)) else {
            continue;
        };
        if alert_id.is_none_or(|id| id == opener) {
            out.push(page_row(opener.clone(), r));
        }
    }
    out.sort_by_key(|p| std::cmp::Reverse(p.opened_at));
    Ok(out)
}

async fn pages_of<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    since_us: i64,
    subject: sea_orm::sea_query::SimpleExpr,
    narrow: Option<Condition>,
) -> anyhow::Result<Vec<oncall_responses::Model>> {
    use oncall_responses::{Column, Entity};
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(subject)
        .filter(Column::OpenedAt.gte(since_us));
    if let Some(narrow) = narrow {
        query = query.filter(narrow);
    }
    let rows = query
        .order_by_desc(Column::OpenedAt)
        .limit(MAX_PAGES + 1)
        .all(conn)
        .await?;
    // A cut list could hide an acknowledgement or a page, so it is refused, not used.
    anyhow::ensure!(
        rows.len() as u64 <= MAX_PAGES,
        "more than {MAX_PAGES} pages since {since_us}; the read is refused as incomplete"
    );
    Ok(rows)
}

/// `<source>#<firing>`: the alert or incident a page stands for.
fn source_of(subject_id: &str) -> &str {
    subject_id
        .rsplit_once('#')
        .map_or(subject_id, |(source, _)| source)
}

fn page_row(alert_id: String, r: oncall_responses::Model) -> PageRow {
    PageRow {
        alert_id,
        opened_at: r.opened_at,
        acked: r.acked_at.is_some(),
        team_id: r.team_id,
    }
}

async fn live_mutes(org: &str, alert_id: &str) -> anyhow::Result<Vec<MuteRow>> {
    let now = now_micros();
    let conn = infra::db::get_orm_client_rw().await;
    Ok(infra::table::downtimes::list_with(conn, org, None)
        .await?
        .iter()
        .filter(|row| {
            mute::is_quick_mute(row, alert_id)
                && row.cancelled_at.is_none_or(|at| at > now)
                && schedule::window_at(&row.schedule, now).is_some()
        })
        .map(mute_row)
        .collect())
}

fn mute_row(row: &Downtime) -> MuteRow {
    MuteRow {
        downtime_id: row.id.clone(),
        version: row.version,
        created_by: row.created_by.clone(),
        created_at: row.created_at,
        ends_at: row.schedule.ends_at.unwrap_or_default(),
    }
}

/// A refusal or a moved mute is an answer; only a store failure is an error.
fn mute_answer(e: MuteError) -> anyhow::Result<MuteAnswer> {
    use o2_enterprise::enterprise::autoobserve::ports::MuteAnswer::{Changed, Refused};
    match e {
        MuteError::Refused(refusal) => Ok(Refused(refusal.message)),
        MuteError::Conflict(AlertMuteConflict::DowntimeCap { message }) => Ok(Refused(message)),
        MuteError::Conflict(c) => Ok(Changed(format!("{c:?}"))),
        MuteError::Downtime(openobserve_core::downtimes::DowntimeError::NotFound) => {
            Ok(Changed("the snooze is gone".into()))
        }
        MuteError::Downtime(e) => anyhow::bail!("the mute failed: {e:?}"),
    }
}

fn ack_answer(e: AckError) -> anyhow::Result<MuteAnswer> {
    match e {
        AckError::Refused(refusal) => Ok(MuteAnswer::Refused(refusal.message)),
        AckError::NotFound => Ok(MuteAnswer::Changed("the alert is gone".into())),
        e => anyhow::bail!("reading the alert failed: {e:?}"),
    }
}

fn mute_source(via: Source) -> MuteSource {
    match via {
        Source::Slack => MuteSource::Slack,
        Source::Ui => MuteSource::Openobserve,
        Source::Api => MuteSource::Api,
    }
}

/// The kind a replacement must share: a webhook's prebuilt type (slack, msteams, ...) counts.
fn kind_of(t: &DestinationType) -> String {
    match t {
        DestinationType::Http(endpoint) => {
            let typed = endpoint.destination_type.as_deref().map(str::trim);
            let name = typed.filter(|t| !t.is_empty()).unwrap_or("custom");
            format!("http:{}", name.to_lowercase())
        }
        DestinationType::Email(_) => "email".into(),
        DestinationType::Sns(_) => "sns".into(),
        DestinationType::SlackApp(_) => "slack_app".into(),
    }
}

#[cfg(test)]
mod tests {
    use infra::table::entity::{alert_incident_alerts, alert_incidents};
    use sea_orm::{ActiveModelTrait, Database, IntoActiveModel, Schema};

    use super::*;

    fn page(
        subject_type: SubjectType,
        subject_id: &str,
        opened_at: i64,
    ) -> oncall_responses::Model {
        oncall_responses::Model {
            id: format!("p-{subject_id}"),
            org_id: "o".into(),
            subject_type: subject_type.to_i32(),
            subject_id: subject_id.into(),
            team_id: None,
            title: None,
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: Some(1),
            responder_role: 0,
            origin_response_id: None,
            priority: 2,
            state: 0,
            opened_at,
            acked_by: None,
            acked_at: (opened_at == 600).then_some(601),
            closed_at: None,
            incident_id: None,
            runbook_url: None,
            exhausted_at: None,
            updated_at: opened_at,
        }
    }

    fn firing(incident: &str, alert: &str, kind: &str, at: i64) -> alert_incident_alerts::Model {
        alert_incident_alerts::Model {
            incident_id: incident.into(),
            alert_id: alert.into(),
            alert_fired_at: at,
            alert_name: alert.into(),
            alert_kind: kind.into(),
            correlation_reason: None,
            created_at: at,
            resolved_at: None,
            labels: None,
            severity: None,
        }
    }

    fn incident(id: &str, resolved_at: Option<i64>) -> alert_incidents::Model {
        alert_incidents::Model {
            id: id.into(),
            org_id: "o".into(),
            status: "open".into(),
            severity: "P3".into(),
            group_values: serde_json::json!({}),
            key_type: "service".into(),
            topology_context: None,
            first_alert_at: 0,
            last_alert_at: 0,
            resolved_at,
            alert_count: 1,
            title: None,
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 0,
            updated_at: 0,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
            security_case: false,
            historical: false,
            last_detection_at: None,
        }
    }

    #[tokio::test]
    async fn an_alert_that_pages_through_incidents_has_those_pages() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        // The membership rows' incidents are not what this reads, so their foreign key is off.
        db.execute_unprepared("PRAGMA foreign_keys = OFF")
            .await
            .unwrap();
        for table in [
            schema.create_table_from_entity(oncall_responses::Entity),
            schema.create_table_from_entity(alert_incident_alerts::Entity),
            schema.create_table_from_entity(alert_incidents::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        // Story A on introspect: every page of the alert is its own incident's page.
        let mut pages = vec![page(SubjectType::Alert, "vpc#7", 600)];
        let mut firings = Vec::new();
        for (incident, at) in [("i1", 100), ("i2", 200), ("i3", 300), ("i0", 10)] {
            pages.push(page(SubjectType::Incident, &format!("{incident}#1"), at));
            firings.push(firing(incident, "vpc", "internal", at - 5));
            firings.push(firing(incident, "other", "internal", at + 50));
        }
        pages.push(page(SubjectType::Incident, "i4#1", 400));
        firings.push(firing("i4", "other", "internal", 395));
        firings.push(firing("i4", "vpc", "internal", 410));
        pages.push(page(SubjectType::Incident, "i5#1", 500));
        firings.push(firing("i5", "finding-1", "autoobserve", 495));
        // Opened by the alert two days before the read and paged again inside it.
        pages.push(page(SubjectType::Incident, "i6#2", 700));
        firings.push(firing(
            "i6",
            "vpc",
            "internal",
            50 - 2 * 24 * 60 * MINUTE_US,
        ));
        for id in ["i0", "i1", "i2", "i3", "i4", "i5", "i6"] {
            incident(id, None)
                .into_active_model()
                .insert(&db)
                .await
                .unwrap();
        }
        for p in pages {
            p.into_active_model().insert(&db).await.unwrap();
        }
        for f in firings {
            f.into_active_model().insert(&db).await.unwrap();
        }
        let vpc = pages_with(&db, "o", 50, Some("vpc")).await.unwrap();
        let seen: Vec<(i64, bool)> = vpc.iter().map(|p| (p.opened_at, p.acked)).collect();
        assert_eq!(
            seen,
            [
                (700, false),
                (600, true),
                (300, false),
                (200, false),
                (100, false)
            ]
        );
        let all = pages_with(&db, "o", 50, None).await.unwrap();
        let seen: Vec<(&str, i64)> = all
            .iter()
            .map(|p| (p.alert_id.as_str(), p.opened_at))
            .collect();
        assert_eq!(
            seen,
            [
                ("vpc", 700),
                ("vpc", 600),
                ("other", 400),
                ("vpc", 300),
                ("vpc", 200),
                ("vpc", 100)
            ],
            "an incident's page is its opener's; AutoObserve's own incidents are no alert's"
        );
    }

    #[test]
    fn a_destination_kind_is_its_type_never_just_http() {
        let http = |typed: serde_json::Value| {
            let mut body = serde_json::json!({"url": "https://hooks.test/x"});
            if !typed.is_null() {
                body["destination_type"] = typed;
            }
            DestinationType::Http(serde_json::from_value(body).unwrap())
        };
        let kinds = [
            (serde_json::json!("slack"), "http:slack"),
            (serde_json::json!(" MSTeams "), "http:msteams"),
            (serde_json::json!(""), "http:custom"),
            (serde_json::Value::Null, "http:custom"),
        ];
        for (typed, want) in kinds {
            assert_eq!(kind_of(&http(typed.clone())), want, "{typed}");
        }
    }
}
