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

//! The alert reads and writes an AutoObserve apply makes, through the alert editor's own service.

use std::str::FromStr;

use async_trait::async_trait;
use config::meta::alerts::alert::Alert;
use infra::{
    db::get_orm_client_rw,
    table::alerts::{KvFence, WriteGuard},
};
use o2_enterprise::enterprise::{
    alert_calibration_service::applied::{AlertNow, AlertPatcher, Fence, Patched},
    autoobserve::{insight::FieldPatch, marks::read_primary},
};
use svix_ksuid::Ksuid;

use crate::alerts::alert::{self, AlertError};

/// Writes as the actor through `alert::update_where`, the update the alert editor's Save also runs.
pub struct LiveAlerts;

#[async_trait]
impl AlertPatcher for LiveAlerts {
    async fn read(&self, org: &str, alert_id: &str) -> anyhow::Result<Option<AlertNow>> {
        let Ok(id) = Ksuid::from_str(alert_id) else {
            return Ok(None);
        };
        match alert::get_by_id(get_orm_client_rw().await, org, id).await {
            Ok((folder, alert)) => Ok(Some(now_of(Some(folder.name), &alert))),
            Err(AlertError::AlertNotFound) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    async fn patch(
        &self,
        org: &str,
        alert_id: &str,
        actor: &str,
        patch: &[FieldPatch],
    ) -> anyhow::Result<Patched> {
        write(org, alert_id, actor, patch, None).await
    }

    async fn patch_fenced(
        &self,
        org: &str,
        alert_id: &str,
        actor: &str,
        patch: &[FieldPatch],
        fence: &Fence,
    ) -> anyhow::Result<Patched> {
        let kv = KvFence {
            key: fence.key.clone(),
            expected: fence.expected.clone(),
            written: fence.written.clone(),
        };
        let patched = write(org, alert_id, actor, patch, Some(kv)).await?;
        if patched == Patched::Changed
            && read_primary(org, &fence.key).await?.as_deref() != Some(fence.expected.as_slice())
        {
            return Ok(Patched::Fenced);
        }
        Ok(patched)
    }
}

async fn write(
    org: &str,
    alert_id: &str,
    actor: &str,
    patch: &[FieldPatch],
    fence: Option<KvFence>,
) -> anyhow::Result<Patched> {
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Ok(Patched::Changed);
    };
    let conn = get_orm_client_rw().await;
    // Read before the alert, so a save after it moves the column and the guard refuses.
    let written = infra::table::alerts::last_written_us(conn, org, alert_id).await?;
    let mut alert = match alert::get_by_id(conn, org, id).await {
        Ok((_, alert)) => alert,
        Err(AlertError::AlertNotFound) => return Ok(Patched::Changed),
        Err(e) => return Err(e.into()),
    };
    if now_of(None, &alert).drift(patch).is_some() {
        return Ok(Patched::Changed);
    }
    for field in patch {
        set(&mut alert, field);
    }
    alert.last_edited_by = Some(actor.to_string());
    let guard = WriteGuard {
        written_us: written,
        fence,
    };
    match alert::update_where(conn, org, None, alert, Some(guard)).await? {
        Some(_) => Ok(Patched::Written),
        None => Ok(Patched::Changed),
    }
}

fn now_of(folder: Option<String>, alert: &Alert) -> AlertNow {
    AlertNow {
        title: alert.name.clone(),
        folder,
        destinations: alert.destinations.clone(),
        pending_period_secs: alert.pending_period_sec,
    }
}

fn set(alert: &mut Alert, field: &FieldPatch) {
    match field {
        FieldPatch::PendingPeriodSecs { to, .. } => alert.pending_period_sec = *to,
        FieldPatch::Destinations { to, .. } => alert.destinations = to.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_patch_sets_only_its_own_fields() {
        let mut alert = Alert::default();
        alert.name = "disk latency".into();
        alert.destinations = vec!["ops".into()];
        alert.description = "kept".into();
        let before = alert.clone();
        set(
            &mut alert,
            &FieldPatch::PendingPeriodSecs { from: 0, to: 120 },
        );
        assert_eq!(alert.pending_period_sec, 120);
        alert.pending_period_sec = before.pending_period_sec;
        assert_eq!(
            serde_json::to_value(&alert).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
        set(
            &mut alert,
            &FieldPatch::Destinations {
                from: vec!["ops".into()],
                to: vec!["ops".into(), "pager".into()],
            },
        );
        assert_eq!(alert.destinations, ["ops", "pager"]);
        assert_eq!(alert.description, "kept");
        let now = now_of(Some("infra".into()), &alert);
        assert_eq!(now.title, "disk latency");
        assert_eq!(now.folder.as_deref(), Some("infra"));
    }
}
