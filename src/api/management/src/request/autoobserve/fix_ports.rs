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
    },
    utils::time::now_micros,
};
use infra::table::entity::oncall_responses;
use o2_enterprise::enterprise::{
    alert_calibration_service::applied::{Fence, Patched},
    autoobserve::{
        alert_findings::{AlertFindingsRead, DigestRun},
        decisions::{Permission, RefusalReason, Source},
        fixes::builtin,
        insight::FieldPatch,
        ports::{AlertRow, AlertWrite, DestinationRow, FixPort, MuteAnswer, MuteRow, PageRow},
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
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use svix_ksuid::Ksuid;

use super::LiveDigest;
use crate::request::security;

/// Bounds one page read; a month of one org's pages stays far below it.
const MAX_PAGES: u64 = 20_000;
const SECOND_US: i64 = 1_000_000;
const MINUTE_US: i64 = 60 * SECOND_US;

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
        let req = AlertMuteRequest {
            until_clear: true,
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

    async fn pages(
        &self,
        org: &str,
        since_us: i64,
        alert_id: Option<&str>,
    ) -> anyhow::Result<Vec<PageRow>> {
        use oncall_responses::{Column, Entity};
        let mut query = Entity::find()
            .filter(Column::OrgId.eq(org))
            .filter(Column::SubjectType.eq(SubjectType::Alert.to_i32()))
            .filter(Column::OpenedAt.gte(since_us));
        if let Some(id) = alert_id {
            query = query.filter(Column::SubjectId.starts_with(format!("{id}#")));
        }
        let rows = query
            .order_by_desc(Column::OpenedAt)
            .limit(MAX_PAGES + 1)
            .all(infra::db::get_orm_client_rw().await)
            .await?;
        // A cut list could hide an acknowledgement or a page, so it is refused, not used.
        anyhow::ensure!(
            rows.len() as u64 <= MAX_PAGES,
            "more than {MAX_PAGES} pages since {since_us}; the read is refused as incomplete"
        );
        Ok(rows
            .into_iter()
            .map(|r| PageRow {
                alert_id: r
                    .subject_id
                    .rsplit_once('#')
                    .map_or(r.subject_id.as_str(), |(source, _)| source)
                    .to_string(),
                opened_at: r.opened_at,
                acked: r.acked_at.is_some(),
                team_id: r.team_id,
            })
            .collect())
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
                    kind: kind_of(&destination_type).to_string(),
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

fn kind_of(t: &DestinationType) -> &'static str {
    match t {
        DestinationType::Http(_) => "http",
        DestinationType::Email(_) => "email",
        DestinationType::Sns(_) => "sns",
        DestinationType::SlackApp(_) => "slack_app",
    }
}
