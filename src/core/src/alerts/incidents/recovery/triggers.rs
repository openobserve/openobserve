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

use common::meta::incidents_v2::{RecoverySettings, incidents_v2_enabled, recovery_settings};
use config::{
    meta::triggers::{Trigger, TriggerModule, TriggerStatus},
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    scheduler,
    table::{
        alert_incidents, entity::alert_incidents as incident, incident_recovery_checks as checks,
    },
};
use sea_orm::DatabaseConnection;

use super::{Check, TriggerKind, next_grid, trigger_kind};

const MODULE: TriggerModule = TriggerModule::IncidentRecovery;

pub(in crate::alerts::incidents) async fn sync_best_effort(org: &str, id: &str) {
    if incidents_v2_enabled()
        && let Err(error) = sync_incident(org, id).await
    {
        log::warn!("[INCIDENT RECOVERY] Trigger update for {org}/{id}: {error:#}");
    }
}

pub(super) async fn load(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
) -> anyhow::Result<Option<(incident::Model, Check)>> {
    let Some(check) = checks::get(db, org, id).await? else {
        return Ok(None);
    };
    let incident = alert_incidents::get_with(db, org, &check.incident_id).await?;
    Ok(incident.map(|incident| (incident, check)))
}

pub(super) async fn reconcile(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    now: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let mut kind = load(db, org, id)
        .await?
        .and_then(|(row, check)| trigger_kind(&row, &check));
    for _ in 0..4 {
        if let Some(kind) = kind {
            let trigger = make_trigger(org, id, kind, now, settings);
            scheduler::push(trigger.clone()).await?;
            if scheduler::get(org, MODULE, &trigger.module_key)
                .await
                .is_ok_and(|stored| stored.status == TriggerStatus::Completed)
            {
                scheduler::update_trigger(trigger, false).await?;
            }
        }
        for unwanted in [TriggerKind::Grid, TriggerKind::Held] {
            if Some(unwanted) != kind {
                scheduler::delete(org, MODULE, &unwanted.key(id)).await?;
            }
        }
        // A later committed check transition may have raced these scheduler writes.
        let current = load(db, org, id)
            .await?
            .and_then(|(row, check)| trigger_kind(&row, &check));
        if current == kind {
            return Ok(());
        }
        kind = current;
    }
    anyhow::bail!("Recovery trigger kind kept changing for {org}/{id}")
}

pub(super) async fn retire_claim(db: &DatabaseConnection, trigger: &Trigger) -> anyhow::Result<()> {
    scheduler::delete_claim_in_transaction(db, trigger.id, trigger.claim_epoch).await?;
    Ok(())
}

async fn sync_incident(org: &str, id: &str) -> anyhow::Result<()> {
    let db = get_orm_client_rw().await;
    let settings = recovery_settings();
    let now = now_micros();
    for check in checks::list(db, org, id).await? {
        reconcile(db, org, &check.id, now, &settings).await?;
    }
    Ok(())
}

fn make_trigger(
    org: &str,
    id: &str,
    kind: TriggerKind,
    now: i64,
    settings: &RecoverySettings,
) -> Trigger {
    Trigger {
        org: org.to_owned(),
        module: MODULE,
        module_key: kind.key(id),
        next_run_at: next_grid(now, kind.interval(settings)),
        is_realtime: true,
        status: TriggerStatus::Waiting,
        ..Default::default()
    }
}
