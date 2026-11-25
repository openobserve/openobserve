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
use config::{meta::alerts::alert::Alert, utils::time::now_micros};
use infra::{
    db::get_orm_client_rw,
    table::alerts::{KvFence, WriteGuard},
};
use o2_enterprise::enterprise::{
    alert_calibration_service::applied::{AlertNow, AlertPatcher, Fence, Patched},
    autoobserve::{insight::FieldPatch, marks::read_primary},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use svix_ksuid::Ksuid;

use crate::alerts::alert::{self, AlertError};

/// Writes as the actor through `alert::update_where`, the update the alert editor's Save also runs.
pub struct LiveAlerts;

impl LiveAlerts {
    /// `patch_fenced` only while the definition hashes to `expected`; answers the stored one's.
    pub async fn patch_if(
        &self,
        org: &str,
        alert_id: &str,
        actor: &str,
        patch: &[FieldPatch],
        (fence, expected): (&Fence, &str),
    ) -> anyhow::Result<(Patched, Option<String>)> {
        let kv = KvFence {
            key: fence.key.clone(),
            expected: fence.expected.clone(),
            written: fence.written.clone(),
        };
        let fenced = Some((kv, fence.writes_us));
        let (patched, after) = write(org, alert_id, actor, patch, fenced, Some(expected)).await?;
        Ok((fenced_or(patched, org, fence).await?, after))
    }
}

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
        Ok(write(org, alert_id, actor, patch, None, None).await?.0)
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
        let fenced = Some((kv, fence.writes_us));
        let (patched, _) = write(org, alert_id, actor, patch, fenced, None).await?;
        fenced_or(patched, org, fence).await
    }
}

/// The definition an edit writes, without the stamp and editor every save moves.
pub fn fingerprint(alert: &Alert) -> anyhow::Result<String> {
    let mut value = serde_json::to_value(alert)?;
    if let Some(map) = value.as_object_mut() {
        map.remove("updated_at");
        map.remove("last_edited_by");
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical(&value).as_bytes())
    ))
}

/// The fingerprint `alert` has once `patch` is written, as `patch_if` would answer it.
pub fn patched_fingerprint(alert: &Alert, patch: &[FieldPatch]) -> anyhow::Result<String> {
    let mut after = alert.clone();
    for field in patch {
        set(&mut after, field);
    }
    fingerprint(&after)
}

/// A refused write whose fence row moved was refused for the fence, not for the alert.
async fn fenced_or(patched: Patched, org: &str, fence: &Fence) -> anyhow::Result<Patched> {
    if patched == Patched::Changed
        && read_primary(org, &fence.key).await?.as_deref() != Some(fence.expected.as_slice())
    {
        return Ok(Patched::Fenced);
    }
    Ok(patched)
}

async fn write(
    org: &str,
    alert_id: &str,
    actor: &str,
    patch: &[FieldPatch],
    fence: Option<(KvFence, i64)>,
    expected: Option<&str>,
) -> anyhow::Result<(Patched, Option<String>)> {
    let changed = Ok((Patched::Changed, None));
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return changed;
    };
    let conn = get_orm_client_rw().await;
    // Read before the alert, so a save after it moves the column and the guard refuses.
    let written = infra::table::alerts::last_written_us(conn, org, alert_id).await?;
    let mut alert = match alert::get_by_id(conn, org, id).await {
        Ok((_, alert)) => alert,
        Err(AlertError::AlertNotFound) => return changed,
        Err(e) => return Err(e.into()),
    };
    // The guard below refuses any save after `written`, so this read stands for the whole write.
    if expected.is_some_and(|fp| fingerprint(&alert).ok().as_deref() != Some(fp)) {
        return changed;
    }
    if now_of(None, &alert).drift(patch).is_some() {
        return changed;
    }
    for field in patch {
        set(&mut alert, field);
    }
    alert.last_edited_by = Some(actor.to_string());
    let fence_us = fence.as_ref().map(|(_, us)| *us);
    let Some(stamp) = stamp_of(written, fence_us, now_micros()) else {
        return changed;
    };
    let after = fingerprint(&alert).ok();
    let guard = WriteGuard {
        written_us: written,
        fence: fence.map(|(kv, _)| kv),
        writes_us: Some(stamp),
        pending_lease: None,
        lease: None,
    };
    match alert::update_where(conn, org, None, alert, Some(guard)).await? {
        Some(_) => Ok((
            Patched::Written {
                updated_at: Some(stamp),
            },
            after,
        )),
        None => changed,
    }
}

/// The `updated_at` a write swaps in, always past the row's; None when the fence time is not.
/// The fence row already holds its time, so a fenced write stamps exactly that or nothing.
fn stamp_of(read_us: Option<i64>, fence_us: Option<i64>, now_us: i64) -> Option<i64> {
    let floor = read_us.map_or(0, |us| us + 1);
    match fence_us {
        Some(us) => (us >= floor).then_some(us),
        None => Some(now_us.max(floor)),
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

/// Object keys sorted at every level, so a map's iteration order never moves a fingerprint.
fn canonical(v: &Value) -> String {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let fields: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", Value::String(k.clone()), canonical(&map[k])))
                .collect();
            format!("{{{}}}", fields.join(","))
        }
        Value::Array(items) => {
            let items: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", items.join(","))
        }
        other => other.to_string(),
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
        let fp = fingerprint(&alert).unwrap();
        let back = FieldPatch::PendingPeriodSecs { from: 0, to: 120 };
        assert_ne!(patched_fingerprint(&alert, &[back]).unwrap(), fp);
        let mut saved = alert.clone();
        saved.last_edited_by = Some("someone".into());
        assert_eq!(
            fingerprint(&saved).unwrap(),
            fp,
            "a save stamp is not an edit"
        );
        saved.description = "edited".into();
        assert_ne!(fingerprint(&saved).unwrap(), fp, "any other field is");
        let now = now_of(Some("infra".into()), &alert);
        assert_eq!(now.title, "disk latency");
        assert_eq!(now.folder.as_deref(), Some("infra"));
    }

    #[test]
    fn a_fenced_write_stamps_the_fence_time_and_never_over_a_newer_row() {
        const NOW: i64 = 5_000;
        let cases = [
            ("fenced, row older", Some(1_000), Some(2_000), Some(2_000)),
            ("fenced, row never written", None, Some(2_000), Some(2_000)),
            (
                "fenced, row at the fence time",
                Some(2_000),
                Some(2_000),
                None,
            ),
            ("fenced, row newer", Some(3_000), Some(2_000), None),
            ("unfenced, row older", Some(1_000), None, Some(NOW)),
            ("unfenced, row ahead of now", Some(9_000), None, Some(9_001)),
        ];
        for (what, read_us, fence_us, want) in cases {
            assert_eq!(stamp_of(read_us, fence_us, NOW), want, "{what}");
        }
    }
}
