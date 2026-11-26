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

//! Alert leases: a temporary alert, or `creates_incident` held at a value for a window.
//!
//! Every write to the alert is guarded by its `updated_at`, so a person's edit always wins.

use std::{future::Future, str::FromStr};

use config::{
    meta::{
        alerts::{
            alert::Alert,
            lease::{
                AlertLease, CreatesIncidentRequest, CreatesIncidentResponse, LeaseConflict,
                LeaseKind, LeaseSpec, LeaseState, LeaseView, check_window,
            },
        },
        triggers::{TriggerModule, TriggerStatus},
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    table::{
        alert_leases,
        alerts::{CreateStamp, WriteGuard},
    },
};
use svix_ksuid::{Ksuid, KsuidLike};

use crate::alerts::alert::{self, AlertError};

/// Rows one sweep pass claims; the pass repeats every minute.
const SWEEP_BATCH: u64 = 100;
const LIST_LIMIT: u64 = 500;

#[derive(Debug, thiserror::Error)]
pub enum LeaseError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{}", .0.message)]
    Conflict(LeaseConflict),
    /// The change was saved but other nodes could not be told; the sweep undoes it.
    #[error("{0}")]
    NotAnnounced(String),
    #[error(transparent)]
    Alert(#[from] AlertError),
    #[error(transparent)]
    Infra(#[from] infra::errors::Error),
}

/// What one sweep pass did, for the log.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepCount {
    pub ended: usize,
    pub removed: usize,
    pub superseded: usize,
    /// Changes whose request never finished, undone and dropped.
    pub undone: usize,
    pub failed: usize,
}

/// How a claimed lease was finished.
#[derive(Debug, PartialEq, Eq)]
enum Finished {
    Recorded(LeaseState),
    /// A pending lease: its unfinished change was undone and its row dropped.
    Undone,
}

/// How a guarded write that was meant to land went.
#[derive(Debug)]
enum Written {
    Landed,
    /// Someone saved the alert first; nothing was written.
    Refused,
    /// Nothing was written.
    Failed(LeaseError),
}

/// How a lease's end meets the alert as it is now.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    /// The alert still holds the version this lease expects: write.
    Write,
    /// The alert holds the version this lease's own end write stamps: an earlier try landed.
    Done,
    Gone,
    Edited,
}

/// Checks a create request's lease before the alert is created.
pub fn check_spec(spec: &LeaseSpec) -> Result<(), LeaseError> {
    refuse_multi_region()?;
    check_window(spec.ends_at_us, &spec.reason, now_micros()).map_err(LeaseError::BadRequest)
}

/// Creates the alert with its lease. A create that fails is undone, at once or by the sweep.
pub async fn create_leased(
    org_id: &str,
    folder_id: &str,
    alert: Alert,
    overwrite: bool,
    spec: &LeaseSpec,
    set_by: &str,
) -> Result<(Alert, AlertLease), LeaseError> {
    let conn = get_orm_client_rw().await;
    create_leased_with(org_id, alert, spec, set_by, |new, stamp| {
        alert::create_stamped(conn, org_id, folder_id, new, overwrite, Some(stamp))
    })
    .await
}

/// The lease row goes in first, pending and naming the alert's id and first version, so a create
/// that dies part-way is found and undone; `create` must insert the alert with the given stamp.
async fn create_leased_with<F, Fut>(
    org_id: &str,
    mut alert: Alert,
    spec: &LeaseSpec,
    set_by: &str,
    create: F,
) -> Result<(Alert, AlertLease), LeaseError>
where
    F: FnOnce(Alert, CreateStamp) -> Fut,
    Fut: Future<Output = Result<Alert, AlertError>>,
{
    check_spec(spec)?;
    let now = now_micros();
    let id = Ksuid::new(None, None);
    alert.id = Some(id);
    let lease = AlertLease {
        kind: LeaseKind::Created,
        set_value: true,
        prior_enabled: Some(false),
        alert_version_us: now,
        state: LeaseState::Pending,
        ..new_lease(org_id, &id.to_string(), spec, set_by, now)
    };
    alert_leases::insert(&lease).await?;
    let stamp = CreateStamp {
        writes_us: now,
        pending_lease: Some(lease.id.clone()),
    };
    let created = match create(alert, stamp).await {
        Ok(created) => created,
        Err(e) => {
            undo_pending(&lease).await;
            return Err(e.into());
        }
    };
    match alert_leases::activate(org_id, &lease.id, now_micros()).await {
        Ok(true) => {}
        // A sweeper took the row; if it already deleted the alert, this request's later events,
        // trigger and workflow links outlived that cleanup, so they are cleared here.
        Ok(false) => {
            if matches!(
                load(org_id, &lease.alert_id).await,
                Err(LeaseError::NotFound(_))
            ) && let Err(e) = alert::forget_deleted(org_id, id).await
            {
                log::error!("[ALERT LEASE] alert {id}: could not clear a late create: {e}");
            }
            return Err(not_finished());
        }
        Err(e) => {
            undo_pending(&lease).await;
            return Err(e.into());
        }
    }
    evaluate_now(org_id, &lease.alert_id, now_micros()).await;
    Ok((
        created,
        AlertLease {
            state: LeaseState::Active,
            ..lease
        },
    ))
}

/// Sets `creates_incident`; with `until_us` the prior value returns then.
///
/// A pending row records every change before its write, so an error always means the change is
/// not made or is undone by the sweep.
pub async fn set_creates_incident(
    org_id: &str,
    alert_id: &str,
    req: &CreatesIncidentRequest,
    set_by: &str,
) -> Result<CreatesIncidentResponse, LeaseError> {
    let now = now_micros();
    let timed = match req.until_us {
        Some(until_us) => {
            refuse_multi_region()?;
            let reason = req.reason.clone().unwrap_or_default();
            check_window(until_us, &reason, now).map_err(LeaseError::BadRequest)?;
            true
        }
        None => false,
    };
    let spec = LeaseSpec {
        ends_at_us: req.until_us.unwrap_or(now),
        reason: req.reason.clone().unwrap_or_default(),
        origin_ref: req.origin_ref.clone(),
    };
    let conn = get_orm_client_rw().await;
    // Read before the alert, so a save after it moves the column and the guard refuses.
    let written = infra::table::alerts::last_written_us(conn, org_id, alert_id).await?;
    let mut current = load(org_id, alert_id).await?;
    if let Some(expected) = req.expected_version
        && Some(expected) != written
    {
        return Err(version_changed(written));
    }
    // Turning incidents off is never refused; turning them on must pass the check a save runs.
    if req.value {
        config::meta::alerts::grouping::validate_multi_alert(
            &current.query_condition,
            &current.trigger_condition,
            true,
        )
        .map_err(|e| LeaseError::BadRequest(AlertError::InvalidMultiAlert(e).to_string()))?;
    }
    if timed {
        refuse_second_lease(org_id, alert_id, written).await?;
    }
    let stamp = now.max(written.unwrap_or_default() + 1);
    let lease = AlertLease {
        kind: LeaseKind::CreatesIncident,
        set_value: req.value,
        prior_creates_incident: Some(current.creates_incident),
        alert_version_us: stamp,
        state: LeaseState::Pending,
        ..new_lease(org_id, alert_id, &spec, set_by, now)
    };
    alert_leases::insert(&lease).await?;
    current.creates_incident = req.value;
    current.last_edited_by = Some(set_by.to_string());
    // An error here may follow a landed write, so the pending row stays for the sweep to undo.
    match write_and_announce(org_id, current, written, stamp, &lease.id).await? {
        Written::Landed => {}
        Written::Refused => {
            drop_pending(&lease).await;
            let now_version = infra::table::alerts::last_written_us(conn, org_id, alert_id).await?;
            // An unmoved version means the refusal was a sweeper's claim on the pending row.
            if now_version == written {
                return Err(not_finished());
            }
            return Err(version_changed(now_version));
        }
        Written::Failed(e) => {
            drop_pending(&lease).await;
            return Err(e);
        }
    }
    let settled = if timed {
        alert_leases::activate(org_id, &lease.id, now_micros()).await?
    } else {
        alert_leases::discard(&lease).await?
    };
    if !settled {
        // The write held the row unclaimed, so the sweeper that took it since undoes the change.
        return Err(not_finished());
    }
    Ok(CreatesIncidentResponse {
        creates_incident: req.value,
        version: stamp,
        lease: timed.then(|| {
            AlertLease {
                state: LeaseState::Active,
                ..lease
            }
            .view()
        }),
    })
}

/// Ends an active lease now, exactly as its expiry would.
pub async fn end_now(
    org_id: &str,
    alert_id: &str,
    lease_id: &str,
) -> Result<LeaseView, LeaseError> {
    let lease = of_alert(org_id, alert_id, lease_id).await?;
    let claimed = alert_leases::claim_one(org_id, &lease.id, LeaseState::Active, now_micros());
    let Some(claimed) = claimed.await? else {
        return Err(not_active());
    };
    finish_claimed(&claimed, now_micros()).await?;
    Ok(of_alert(org_id, alert_id, lease_id).await?.view())
}

/// Moves an active lease's end within the same window rule as at the start.
pub async fn extend(
    org_id: &str,
    alert_id: &str,
    lease_id: &str,
    ends_at_us: i64,
) -> Result<LeaseView, LeaseError> {
    let lease = of_alert(org_id, alert_id, lease_id).await?;
    let now = now_micros();
    check_window(ends_at_us, &lease.reason, now).map_err(LeaseError::BadRequest)?;
    if !alert_leases::extend(org_id, lease_id, ends_at_us, now).await? {
        return Err(not_active());
    }
    Ok(of_alert(org_id, alert_id, lease_id).await?.view())
}

/// Makes an active temporary alert an ordinary one; it is no longer disabled or deleted.
pub async fn keep(
    org_id: &str,
    alert_id: &str,
    lease_id: &str,
    by: &str,
) -> Result<LeaseView, LeaseError> {
    let lease = of_alert(org_id, alert_id, lease_id).await?;
    if lease.kind != LeaseKind::Created {
        return Err(LeaseError::BadRequest(
            "Only a temporary alert can be kept; end a timed change instead.".to_string(),
        ));
    }
    if !alert_leases::keep(org_id, lease_id, by, now_micros()).await? {
        return Err(not_active());
    }
    Ok(of_alert(org_id, alert_id, lease_id).await?.view())
}

/// The newest leases on the given alerts only, so a caller's view is not crowded out by others'.
pub async fn list_for_alerts(
    org_id: &str,
    alert_ids: &[String],
    state: Option<LeaseState>,
) -> Result<Vec<LeaseView>, LeaseError> {
    let leases = alert_leases::list_for_alerts(org_id, alert_ids, state, LIST_LIMIT).await?;
    Ok(leases.iter().map(AlertLease::view).collect())
}

pub async fn list(
    org_id: &str,
    alert_id: Option<&str>,
    state: Option<LeaseState>,
) -> Result<Vec<LeaseView>, LeaseError> {
    let leases = alert_leases::list(org_id, alert_id, state, LIST_LIMIT).await?;
    Ok(leases.iter().map(AlertLease::view).collect())
}

/// One pass of the expiry sweep: ends due leases and deletes temporary alerts past their grace.
pub async fn sweep(now_us: i64) -> Result<SweepCount, LeaseError> {
    let mut count = SweepCount::default();
    for lease in alert_leases::claim_due(now_us, SWEEP_BATCH).await? {
        match finish_claimed(&lease, now_us).await {
            Ok(Finished::Recorded(LeaseState::Ended)) => count.ended += 1,
            Ok(Finished::Recorded(LeaseState::Removed)) => count.removed += 1,
            Ok(Finished::Recorded(_)) => count.superseded += 1,
            Ok(Finished::Undone) => count.undone += 1,
            Err(e) => {
                count.failed += 1;
                log::error!(
                    "[ALERT LEASE] org {} lease {} alert {}: {e}",
                    lease.org_id,
                    lease.id,
                    lease.alert_id
                );
            }
        }
    }
    Ok(count)
}

/// Ends, purges or undoes one claimed lease.
async fn finish_claimed(lease: &AlertLease, now_us: i64) -> Result<Finished, LeaseError> {
    if lease.state == LeaseState::Pending {
        return finish_pending(lease, now_us, false).await;
    }
    let end_version = lease.end_stamp(now_us);
    let (state, why) = if lease.state == LeaseState::Ended {
        purge(lease, end_version).await?
    } else {
        end(lease, end_version).await?
    };
    if !alert_leases::finish(lease, state, why, now_us).await? {
        log::warn!(
            "[ALERT LEASE] lease {} was re-claimed before this end recorded",
            lease.id
        );
    }
    Ok(Finished::Recorded(state))
}

/// Undoes a pending lease's change and drops its row. A create's request may still add effects,
/// whatever its alert is now, so its row waits one claim period and that pass undoes it again.
async fn finish_pending(
    lease: &AlertLease,
    now_us: i64,
    request_over: bool,
) -> Result<Finished, LeaseError> {
    undo_unfinished(lease, lease.end_stamp(now_us)).await?;
    if lease.kind == LeaseKind::Created && !request_over && lease.ended_at_us.is_none() {
        if !alert_leases::hold_for_recheck(lease, now_us).await? {
            log::warn!(
                "[ALERT LEASE] lease {} was re-claimed before it was held",
                lease.id
            );
        }
        return Ok(Finished::Undone);
    }
    if !alert_leases::discard(lease).await? {
        log::warn!(
            "[ALERT LEASE] lease {} was re-claimed before it was dropped",
            lease.id
        );
    }
    Ok(Finished::Undone)
}

async fn end(
    lease: &AlertLease,
    end_version: i64,
) -> Result<(LeaseState, Option<String>), LeaseError> {
    for _ in 0..3 {
        let (step, alert, version) = step_now(lease, lease.alert_version_us, end_version).await?;
        match (step, alert) {
            (Step::Write, Some(mut alert)) => {
                let disables = lease.kind == LeaseKind::Created;
                match lease.kind {
                    LeaseKind::Created => alert.enabled = false,
                    LeaseKind::CreatesIncident => {
                        alert.creates_incident =
                            lease.prior_creates_incident.unwrap_or(!lease.set_value)
                    }
                }
                alert.last_edited_by = Some(lease.set_by.clone());
                let written = Some(lease.alert_version_us);
                if guarded_write(&lease.org_id, alert, written, end_version, disables).await? {
                    return Ok((LeaseState::Ended, None));
                }
            }
            (Step::Done, Some(alert)) => {
                // An earlier try's row write landed; its announcement or hook may not have.
                let disables = lease.kind == LeaseKind::Created;
                let written = Some(end_version);
                if guarded_write(&lease.org_id, alert, written, end_version, disables).await? {
                    return Ok((LeaseState::Ended, None));
                }
            }
            (Step::Gone, _) => return Ok(gone()),
            (_, None) => return Ok(edited(None)),
            (_, Some(alert)) => {
                let why = edited(Some(&alert));
                if settle(lease, alert, version).await? {
                    return Ok(why);
                }
            }
        }
    }
    // It changed under every try: the claim stays and a later pass ends it.
    Err(LeaseError::Infra(infra::errors::Error::Message(format!(
        "alert {} changed during each try to end lease {}",
        lease.alert_id, lease.id
    ))))
}

async fn purge(
    lease: &AlertLease,
    end_version: i64,
) -> Result<(LeaseState, Option<String>), LeaseError> {
    let (step, alert, _) = step_now(lease, end_version, end_version).await?;
    let Some(id) = alert.as_ref().and_then(|a| a.id) else {
        // Gone: an earlier try's delete may have stopped before its by-id cleanup.
        if let Ok(id) = Ksuid::from_str(&lease.alert_id) {
            alert::forget_deleted(&lease.org_id, id).await?;
        }
        return Ok((LeaseState::Removed, None));
    };
    if step != Step::Write {
        return Ok(edited(alert.as_ref()));
    }
    let conn = get_orm_client_rw().await;
    match alert::delete_by_id_user_where(conn, &lease.org_id, id, end_version).await {
        Ok(true) => Ok((LeaseState::Removed, None)),
        Ok(false) => Ok(edited(None)),
        Err(e @ AlertError::InfraError(_)) => Err(e.into()),
        Err(e) => Ok((
            LeaseState::Superseded,
            Some(format!("Kept, because it is still in use: {e}")),
        )),
    }
}

/// One timed change per alert: a second would read the first's write as a person's edit.
async fn refuse_second_lease(
    org_id: &str,
    alert_id: &str,
    written: Option<i64>,
) -> Result<(), LeaseError> {
    let now = now_micros();
    if let Some(pending) = alert_leases::pending_for(org_id, alert_id).await? {
        return Err(LeaseError::Conflict(LeaseConflict {
            lease_id: Some(pending.id),
            ..LeaseConflict::new(
                "change_in_progress",
                "Another change to this alert is still being applied; try again in a few minutes.",
            )
        }));
    }
    for kind in [LeaseKind::Created, LeaseKind::CreatesIncident] {
        let Some(active) = alert_leases::active_for(org_id, alert_id, kind).await? else {
            continue;
        };
        // Its own write no longer stands, so its end would change nothing: let it go now.
        if kind == LeaseKind::CreatesIncident
            && written != Some(active.alert_version_us)
            && let Some(claimed) =
                alert_leases::claim_one(org_id, &active.id, LeaseState::Active, now).await?
        {
            let (state, why) = edited(None);
            alert_leases::finish(&claimed, state, why, now).await?;
            continue;
        }
        let message = match kind {
            LeaseKind::Created => {
                "This alert is temporary; keep it first, or set incident creation when creating it."
            }
            LeaseKind::CreatesIncident => {
                "Incident creation is already held for a window on this alert; extend or end that one."
            }
        };
        return Err(LeaseError::Conflict(LeaseConflict {
            lease_id: Some(active.id),
            ..LeaseConflict::new("lease_active", message)
        }));
    }
    Ok(())
}

/// Undoes a pending lease's change now; when that fails, the sweep does it later.
async fn undo_pending(lease: &AlertLease) {
    let claim =
        alert_leases::claim_one(&lease.org_id, &lease.id, LeaseState::Pending, now_micros());
    let claimed = match claim.await {
        Ok(Some(claimed)) => claimed,
        Ok(None) => return,
        Err(e) => {
            log::error!("[ALERT LEASE] lease {}: left to the sweep: {e}", lease.id);
            return;
        }
    };
    if let Err(e) = finish_pending(&claimed, now_micros(), true).await {
        log::error!("[ALERT LEASE] lease {}: left to the sweep: {e}", lease.id);
    }
}

/// Drops a pending lease whose change is known not to have landed; the sweep drops it otherwise.
async fn drop_pending(lease: &AlertLease) {
    if let Err(e) = alert_leases::discard(lease).await {
        log::warn!("[ALERT LEASE] lease {}: left to the sweep: {e}", lease.id);
    }
}

/// Undoes the change of a lease whose request never finished; anything a person saved since stays.
async fn undo_unfinished(lease: &AlertLease, end_version: i64) -> Result<(), LeaseError> {
    let (step, alert, _) = step_now(lease, lease.alert_version_us, end_version).await?;
    let Some(mut alert) = alert else {
        // An earlier try's delete may have stopped before its by-id cleanup.
        if lease.kind == LeaseKind::Created
            && let Ok(id) = Ksuid::from_str(&lease.alert_id)
        {
            alert::forget_deleted(&lease.org_id, id).await?;
        }
        return Ok(());
    };
    match (lease.kind, step) {
        (LeaseKind::Created, Step::Write) => {
            let id = alert
                .id
                .ok_or_else(|| LeaseError::BadRequest("no id".to_string()))?;
            let conn = get_orm_client_rw().await;
            match alert::delete_by_id_user_where(conn, &lease.org_id, id, lease.alert_version_us)
                .await
            {
                Err(e @ AlertError::InfraError(_)) => return Err(e.into()),
                Err(e) => log::warn!("[ALERT LEASE] alert {id} kept, it is in use: {e}"),
                Ok(_) => {}
            }
        }
        (LeaseKind::CreatesIncident, Step::Write) => {
            alert.creates_incident = lease.prior_creates_incident.unwrap_or(!lease.set_value);
            let written = Some(lease.alert_version_us);
            guarded_write(&lease.org_id, alert, written, end_version, false).await?;
        }
        (LeaseKind::CreatesIncident, Step::Done) => {
            let written = Some(end_version);
            guarded_write(&lease.org_id, alert, written, end_version, false).await?;
        }
        // Never landed, or a person saved since: left as it is.
        _ => {}
    }
    Ok(())
}

/// Completes what an earlier try of this end may owe after a person's save: announce the alert as
/// it stands, and the disable hook. False when another save landed meanwhile.
async fn settle(
    lease: &AlertLease,
    alert: Alert,
    version: Option<i64>,
) -> Result<bool, LeaseError> {
    let disabled = lease.kind == LeaseKind::Created && !alert.enabled;
    if let Some(version) = version {
        let guard = WriteGuard {
            written_us: Some(version),
            writes_us: Some(version),
            ..Default::default()
        };
        if !write_guarded(&lease.org_id, alert, guard, false).await? {
            return Ok(false);
        }
    }
    if disabled {
        crate::alerts::lifecycle::on_alert_enabled_changed(
            &lease.org_id,
            &lease.alert_id,
            &lease.set_by,
            false,
        )
        .await;
    }
    Ok(true)
}

/// A guarded write, held to its unclaimed pending lease, whose announcement failed after its row
/// landed is replayed once at the same version; an error means the row may hold the change.
async fn write_and_announce(
    org_id: &str,
    alert: Alert,
    written: Option<i64>,
    stamp: i64,
    pending_lease: &str,
) -> Result<Written, LeaseError> {
    let alert_id = alert.id.map(|id| id.to_string()).unwrap_or_default();
    let guard = WriteGuard {
        written_us: written,
        writes_us: Some(stamp),
        pending_lease: Some(pending_lease.to_string()),
        ..Default::default()
    };
    let first = match write_guarded(org_id, alert, guard, false).await {
        Ok(true) => return Ok(Written::Landed),
        Ok(false) => return Ok(Written::Refused),
        Err(e) => e,
    };
    let conn = get_orm_client_rw().await;
    if infra::table::alerts::last_written_us(conn, org_id, &alert_id).await? != Some(stamp) {
        return Ok(Written::Failed(first));
    }
    log::warn!("[ALERT LEASE] alert {alert_id}: saved, announcing it again: {first}");
    let replay = match load(org_id, &alert_id).await {
        Ok(saved) => guarded_write(org_id, saved, Some(stamp), stamp, false).await,
        Err(e) => Err(e),
    };
    match replay {
        Ok(true) => Ok(Written::Landed),
        Ok(false) => Ok(Written::Refused),
        Err(e) => {
            log::error!("[ALERT LEASE] alert {alert_id}: saved, but not announced: {e}");
            Err(LeaseError::NotAnnounced(
                "The change was saved, but the other nodes could not be told, so it will be undone \
                 within a few minutes. Try again."
                    .to_string(),
            ))
        }
    }
}

/// Reads the alert's version and body, and how this end meets them.
async fn step_now(
    lease: &AlertLease,
    expected: i64,
    own_end: i64,
) -> Result<(Step, Option<Alert>, Option<i64>), LeaseError> {
    let conn = get_orm_client_rw().await;
    let written =
        infra::table::alerts::last_written_us(conn, &lease.org_id, &lease.alert_id).await?;
    let alert = match load(&lease.org_id, &lease.alert_id).await {
        Ok(alert) => Some(alert),
        Err(LeaseError::NotFound(_)) => None,
        Err(e) => return Err(e),
    };
    let current = alert.as_ref().map(|_| written);
    Ok((step(current, expected, own_end), alert, written))
}

fn step(current: Option<Option<i64>>, expected: i64, own_end: i64) -> Step {
    match current {
        None => Step::Gone,
        Some(Some(v)) if v == expected => Step::Write,
        Some(Some(v)) if v == own_end => Step::Done,
        Some(_) => Step::Edited,
    }
}

/// Writes the alert only while its `updated_at` holds `written`, stamping `stamp`.
///
/// Skips the editor's validation: a stream or destination removed since must never block an end.
async fn guarded_write(
    org_id: &str,
    alert: Alert,
    written: Option<i64>,
    stamp: i64,
    disables: bool,
) -> Result<bool, LeaseError> {
    let guard = WriteGuard {
        written_us: written,
        writes_us: Some(stamp),
        ..Default::default()
    };
    write_guarded(org_id, alert, guard, disables).await
}

async fn write_guarded(
    org_id: &str,
    alert: Alert,
    guard: WriteGuard,
    disables: bool,
) -> Result<bool, LeaseError> {
    let id = alert.id.map(|id| id.to_string()).unwrap_or_default();
    let by = alert.last_edited_by.clone().unwrap_or_default();
    let conn = get_orm_client_rw().await;
    let saved = db::alerts::alert::update_where(conn, org_id, None, alert, Some(guard)).await?;
    if saved.is_some() && disables {
        crate::alerts::lifecycle::on_alert_enabled_changed(org_id, &id, &by, false).await;
    }
    Ok(saved.is_some())
}

/// Pulls the alert's scheduled run to now; the scheduler then runs the alert's own query.
async fn evaluate_now(org_id: &str, alert_id: &str, now_us: i64) {
    let mut trigger = match db::scheduler::get(org_id, TriggerModule::Alert, alert_id).await {
        Ok(trigger) => trigger,
        Err(e) => {
            log::warn!("[ALERT LEASE] alert {alert_id}: no scheduled run to pull forward: {e}");
            return;
        }
    };
    if trigger.next_run_at <= now_us || trigger.status != TriggerStatus::Waiting {
        return;
    }
    trigger.next_run_at = now_us;
    if let Err(e) = db::scheduler::update_trigger(trigger, false, "").await {
        log::warn!("[ALERT LEASE] alert {alert_id}: could not pull its run forward: {e}");
    }
}

async fn load(org_id: &str, alert_id: &str) -> Result<Alert, LeaseError> {
    let not_found = || LeaseError::NotFound(format!("Alert {alert_id} not found"));
    let id = Ksuid::from_str(alert_id).map_err(|_| not_found())?;
    let conn = get_orm_client_rw().await;
    match db::alerts::alert::get_by_id(conn, org_id, id).await? {
        Some((_, alert)) => Ok(alert),
        None => Err(not_found()),
    }
}

async fn of_alert(org_id: &str, alert_id: &str, lease_id: &str) -> Result<AlertLease, LeaseError> {
    match alert_leases::get(org_id, lease_id).await? {
        Some(lease) if lease.alert_id == alert_id => Ok(lease),
        _ => Err(LeaseError::NotFound(format!("Lease {lease_id} not found"))),
    }
}

fn new_lease(org_id: &str, alert_id: &str, spec: &LeaseSpec, set_by: &str, now: i64) -> AlertLease {
    AlertLease {
        id: Ksuid::new(None, None).to_string(),
        org_id: org_id.to_string(),
        alert_id: alert_id.to_string(),
        starts_at_us: now,
        ends_at_us: spec.ends_at_us,
        set_by: set_by.to_string(),
        reason: spec.reason.trim().to_string(),
        origin_ref: spec.origin_ref.clone(),
        state: LeaseState::Active,
        region: config::get_cluster_name(),
        created_at_us: now,
        updated_at_us: now,
        ..Default::default()
    }
}

/// Leases follow the scheduler claim of one region; multi-region support is a later phase.
fn refuse_multi_region() -> Result<(), LeaseError> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return Err(LeaseError::Conflict(LeaseConflict::new(
            "multi_region",
            "Temporary alert changes are not available in a multi-region deployment yet.",
        )));
    }
    Ok(())
}

fn version_changed(current: Option<i64>) -> LeaseError {
    LeaseError::Conflict(LeaseConflict {
        version: current,
        ..LeaseConflict::new(
            "version_changed",
            "The alert was changed by someone else; reload it and try again.",
        )
    })
}

fn not_finished() -> LeaseError {
    LeaseError::NotAnnounced(
        "The change took too long and will be undone within a few minutes. Try again.".to_string(),
    )
}

fn not_active() -> LeaseError {
    LeaseError::Conflict(LeaseConflict::new(
        "not_active",
        "This lease is no longer active.",
    ))
}

fn gone() -> (LeaseState, Option<String>) {
    (
        LeaseState::Superseded,
        Some("The alert was deleted.".to_string()),
    )
}

fn edited(alert: Option<&Alert>) -> (LeaseState, Option<String>) {
    let who = alert
        .and_then(|a| a.last_edited_by.clone())
        .filter(|w| !w.is_empty())
        .unwrap_or_else(|| "someone".to_string());
    (
        LeaseState::Superseded,
        Some(format!(
            "Left as it is: {who} changed the alert after this began."
        )),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::OnceLock;

    use config::meta::{
        alerts::{
            AggFunction, Aggregation, Condition, FrequencyType, Operator, QueryCondition,
            QueryType, TriggerCondition,
        },
        stream::StreamType,
    };
    use infra::table::alert_leases::{CLAIM_TTL_US, PENDING_TTL_US};

    use super::*;
    use crate::alerts::lifecycle::recorder::{self, Hook};

    const HOUR_US: i64 = 3_600_000_000;
    const AO: &str = config::meta::alerts::lease::AUTOOBSERVE_ACTOR;
    /// Sweeps act on every org's due leases, so these tests take turns.
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    /// The global meta store pool lives on the runtime that opened it, so every test shares one.
    static RUNTIME: std::sync::LazyLock<tokio::runtime::Runtime> = std::sync::LazyLock::new(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
    });

    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    async fn new_alert(org: &str, frequency_type: FrequencyType) -> Alert {
        alert::create_default_alerts_folder(org).await.unwrap();
        let mut alert = Alert::default();
        alert.name = format!("lease-{}", now_micros());
        alert.stream_type = StreamType::Logs;
        alert.stream_name = "checkout".into();
        alert.enabled = true;
        alert.query_condition = QueryCondition {
            query_type: QueryType::SQL,
            sql: Some("SELECT count(*) AS n FROM checkout".into()),
            ..Default::default()
        };
        alert.trigger_condition = TriggerCondition {
            period: 10,
            frequency: 600,
            frequency_type,
            cron: "0 0 3 * * *".into(),
            ..Default::default()
        };
        alert
    }

    /// A stored alert written through the db layer, so no stream schema is needed.
    async fn stored_alert(org: &str, frequency_type: FrequencyType) -> Alert {
        let alert = new_alert(org, frequency_type).await;
        let conn = get_orm_client_rw().await;
        db::alerts::alert::create(conn, org, "default", alert, false)
            .await
            .unwrap()
    }

    async fn db_create(org: &str, alert: Alert, stamp: CreateStamp) -> Result<Alert, AlertError> {
        let conn = get_orm_client_rw().await;
        Ok(
            db::alerts::alert::create_stamped(conn, org, "default", alert, true, Some(stamp))
                .await?,
        )
    }

    /// A temporary alert through the db layer's create.
    async fn leased(org: &str, frequency_type: FrequencyType, ends: i64) -> (Alert, AlertLease) {
        let alert = new_alert(org, frequency_type).await;
        create_leased_with(org, alert, &spec(ends), AO, |new, stamp| {
            db_create(org, new, stamp)
        })
        .await
        .unwrap()
    }

    fn spec(ends_at_us: i64) -> LeaseSpec {
        LeaseSpec {
            ends_at_us,
            reason: "checkout stopped receiving data".into(),
            origin_ref: None,
        }
    }

    async fn stored(org: &str, alert: &Alert) -> Option<Alert> {
        load(org, &alert.id.unwrap().to_string()).await.ok()
    }

    async fn lease_of(org: &str, id: &str) -> Option<AlertLease> {
        alert_leases::get(org, id).await.unwrap()
    }

    /// A person's save: the editor stamps `updated_at` with the time of the save.
    async fn human_edit(org: &str, alert: &Alert, edit: impl FnOnce(&mut Alert)) {
        let mut current = stored(org, alert).await.unwrap();
        edit(&mut current);
        current.last_edited_by = Some("dana@acme.com".into());
        let conn = get_orm_client_rw().await;
        db::alerts::alert::update(conn, org, None, current)
            .await
            .unwrap();
    }

    /// A row write that lands without the announcement or hook, as a crash right after it leaves.
    async fn bare_write(org: &str, alert: Alert, written: i64, stamp: i64) {
        let guard = WriteGuard {
            written_us: Some(written),
            writes_us: Some(stamp),
            ..Default::default()
        };
        let conn = get_orm_client_rw().await;
        let saved = infra::table::alerts::update_where(conn, org, None, alert, Some(guard)).await;
        assert!(saved.unwrap().is_some());
    }

    /// The sweep deletes a create whose request stalled past the TTL; then that request's trigger
    /// lands.
    async fn swept_then_late_trigger(org: &str, created: &Alert) -> String {
        sweep(now_micros() + PENDING_TTL_US).await.unwrap();
        late_trigger(org, created).await
    }

    async fn late_trigger(org: &str, created: &Alert) -> String {
        let key = created.id.unwrap().to_string();
        let trigger = db::scheduler::Trigger {
            org: org.to_string(),
            module: TriggerModule::Alert,
            module_key: key.clone(),
            next_run_at: now_micros(),
            ..Default::default()
        };
        db::scheduler::push(trigger).await.unwrap();
        key
    }

    #[test]
    fn a_temporary_alert_is_disabled_at_its_end_and_deleted_after_the_grace() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_created_{}", now_micros());
            let ends = now_micros() + HOUR_US;
            let (alert, lease) = leased(&org, FrequencyType::Minutes, ends).await;
            assert_eq!(
                lease_of(&org, &lease.id).await.unwrap().state,
                LeaseState::Active
            );

            let second = CreatesIncidentRequest {
                value: false,
                until_us: Some(ends),
                reason: Some("quiet while it is checked".into()),
                ..Default::default()
            };
            let refused = set_creates_incident(
                &org,
                &alert.id.unwrap().to_string(),
                &second,
                "dana@acme.com",
            )
            .await;
            assert!(
                matches!(refused, Err(LeaseError::Conflict(ref c)) if c.code == "lease_active"),
                "a second timed change would read the first's write as a person's edit: {refused:?}"
            );

            sweep(ends - 1).await.unwrap();
            assert!(
                stored(&org, &alert).await.unwrap().enabled,
                "ends only at its end"
            );

            sweep(ends).await.unwrap();
            let ended = lease_of(&org, &lease.id).await.unwrap();
            assert_eq!(ended.state, LeaseState::Ended);
            assert!(!stored(&org, &alert).await.unwrap().enabled);

            let ended_at = ended.ended_at_us.unwrap();
            sweep(ended_at + config::meta::alerts::lease::PURGE_AFTER_US - 1)
                .await
                .unwrap();
            assert!(
                stored(&org, &alert).await.is_some(),
                "kept through the grace"
            );
            sweep(ended_at + config::meta::alerts::lease::PURGE_AFTER_US)
                .await
                .unwrap();
            let removed = lease_of(&org, &lease.id).await.unwrap();
            assert_eq!(removed.state, LeaseState::Removed);
            assert!(stored(&org, &alert).await.is_none());
        });
    }

    #[test]
    fn a_timed_incident_toggle_restores_exactly_the_prior_alert() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_toggle_{}", now_micros());
            let alert = stored_alert(&org, FrequencyType::Minutes).await;
            let id = alert.id.unwrap().to_string();
            let before = stored(&org, &alert).await.unwrap();
            let until = now_micros() + HOUR_US;
            let req = CreatesIncidentRequest {
                value: true,
                until_us: Some(until),
                reason: Some("the service is failing and nothing pages".into()),
                ..Default::default()
            };
            let set = set_creates_incident(&org, &id, &req, AO).await.unwrap();
            assert!(stored(&org, &alert).await.unwrap().creates_incident);

            sweep(until).await.unwrap();
            let lease = lease_of(&org, &set.lease.unwrap().id).await.unwrap();
            assert_eq!(lease.state, LeaseState::Ended);
            let mut after = stored(&org, &alert).await.unwrap();
            assert!(!after.creates_incident);
            after.last_edited_by = before.last_edited_by.clone();
            assert_eq!(
                serde_json::to_value(&after).unwrap(),
                serde_json::to_value(&before).unwrap(),
                "the end restores the one field and nothing else"
            );
            sweep(until + HOUR_US).await.unwrap();
            assert!(
                !stored(&org, &alert).await.unwrap().creates_incident,
                "a second pass is a no-op"
            );
        });
    }

    #[test]
    fn a_per_group_alert_cannot_be_toggled_to_create_incidents() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_per_group_{}", now_micros());
            let mut per_group = new_alert(&org, FrequencyType::Minutes).await;
            per_group.query_condition.aggregation = Some(Aggregation {
                group_by: Some(vec!["service".into()]),
                function: AggFunction::Count,
                having: Condition {
                    column: "alert_agg_value".into(),
                    operator: Operator::GreaterThan,
                    value: serde_json::json!(5),
                    ignore_case: false,
                    case_insensitive: None,
                },
                warning_value: None,
                multi_alert: true,
            });
            per_group.trigger_condition.operator = Operator::GreaterThanEquals;
            per_group.trigger_condition.threshold = 1;
            let conn = get_orm_client_rw().await;
            let alert = db::alerts::alert::create(conn, &org, "default", per_group, false)
                .await
                .unwrap();
            let id = alert.id.unwrap().to_string();
            let incidents_refused = AlertError::InvalidMultiAlert(
                config::meta::alerts::grouping::MultiAlertError::IncidentsUnsupported,
            )
            .to_string();
            for until_us in [None, Some(now_micros() + HOUR_US)] {
                let req = CreatesIncidentRequest {
                    value: true,
                    until_us,
                    reason: Some("the service is failing and nothing pages".into()),
                    ..Default::default()
                };
                let refused = set_creates_incident(&org, &id, &req, AO).await;
                assert!(
                    matches!(&refused, Err(LeaseError::BadRequest(m)) if *m == incidents_refused),
                    "{until_us:?}: {refused:?}"
                );
                assert!(!stored(&org, &alert).await.unwrap().creates_incident);
                assert!(list(&org, Some(&id), None).await.unwrap().is_empty());
            }
        });
    }

    #[test]
    fn a_persons_edit_is_never_overwritten_or_deleted() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_edit_{}", now_micros());

            let toggled = stored_alert(&org, FrequencyType::Minutes).await;
            let toggled_id = toggled.id.unwrap().to_string();
            let until = now_micros() + HOUR_US;
            let req = CreatesIncidentRequest {
                value: true,
                until_us: Some(until),
                reason: Some("the service is failing".into()),
                ..Default::default()
            };
            let set = set_creates_incident(&org, &toggled_id, &req, AO)
                .await
                .unwrap();
            human_edit(&org, &toggled, |a| {
                a.description = "owned by payments".into()
            })
            .await;
            sweep(until).await.unwrap();
            let lease = lease_of(&org, &set.lease.unwrap().id).await.unwrap();
            assert_eq!(lease.state, LeaseState::Superseded);
            assert!(lease.state_reason.unwrap().contains("dana@acme.com"));
            assert!(stored(&org, &toggled).await.unwrap().creates_incident);

            let ends = now_micros() + HOUR_US;
            let (temporary, lease) = leased(&org, FrequencyType::Minutes, ends).await;
            sweep(ends).await.unwrap();
            human_edit(&org, &temporary, |a| a.enabled = true).await;
            let ended_at = lease_of(&org, &lease.id)
                .await
                .unwrap()
                .ended_at_us
                .unwrap();
            sweep(ended_at + config::meta::alerts::lease::PURGE_AFTER_US)
                .await
                .unwrap();
            let lease = lease_of(&org, &lease.id).await.unwrap();
            assert_eq!(lease.state, LeaseState::Superseded);
            assert!(stored(&org, &temporary).await.unwrap().enabled);

            // An end whose row write landed but whose hook was lost, then a person's save.
            let (crashed, lease) = leased(&org, FrequencyType::Minutes, ends).await;
            let claim = alert_leases::claim_one(&org, &lease.id, LeaseState::Active, ends);
            let claimed = claim.await.unwrap().unwrap();
            let mut disabled = stored(&org, &crashed).await.unwrap();
            disabled.enabled = false;
            let end_version = claimed.end_version_us.unwrap();
            bare_write(&org, disabled, lease.alert_version_us, end_version).await;
            human_edit(&org, &crashed, |a| a.description = "kept off".into()).await;
            recorder::take();
            sweep(ends + CLAIM_TTL_US + 1).await.unwrap();
            let lease = lease_of(&org, &lease.id).await.unwrap();
            assert_eq!(lease.state, LeaseState::Superseded);
            let hook = Hook::EnabledChanged {
                alert_id: lease.alert_id.clone(),
                enabled: false,
            };
            assert!(
                recorder::take().contains(&hook),
                "the lost disable hook still runs"
            );
            assert_eq!(
                stored(&org, &crashed).await.unwrap().description,
                "kept off"
            );

            // A create whose later step fails after a person saved its row.
            let made = OnceLock::new();
            let raced = new_alert(&org, FrequencyType::Minutes).await;
            let failed = create_leased_with(&org, raced, &spec(ends), AO, |new, stamp| {
                let (org, made) = (org.as_str(), &made);
                async move {
                    let created = db_create(org, new, stamp).await?;
                    human_edit(org, &created, |a| a.description = "taken over".into()).await;
                    let _ = made.set(created);
                    Err(AlertError::AlertNotFound)
                }
            })
            .await;
            assert!(failed.is_err());
            let raced = made.get().unwrap();
            assert!(
                stored(&org, raced).await.is_some(),
                "a create's undo never deletes a person's save"
            );

            let stale = CreatesIncidentRequest {
                value: false,
                expected_version: Some(1),
                ..Default::default()
            };
            let refused = set_creates_incident(&org, &toggled_id, &stale, "dana@acme.com").await;
            assert!(
                matches!(refused, Err(LeaseError::Conflict(ref c)) if c.code == "version_changed"),
                "{refused:?}"
            );
            assert!(stored(&org, &toggled).await.unwrap().creates_incident);
        });
    }

    #[test]
    fn a_change_whose_request_did_not_finish_is_undone() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_unfinished_{}", now_micros());
            let ends = now_micros() + HOUR_US;

            let made = OnceLock::new();
            let alert = new_alert(&org, FrequencyType::Minutes).await;
            let failed = create_leased_with(&org, alert, &spec(ends), AO, |new, stamp| {
                let (org, made) = (org.as_str(), &made);
                async move {
                    let _ = made.set(db_create(org, new, stamp).await?);
                    Err(AlertError::AlertNotFound)
                }
            })
            .await;
            assert!(failed.is_err());
            let created = made.get().unwrap();
            assert!(
                stored(&org, created).await.is_none(),
                "a failed create is undone"
            );
            let id = created.id.unwrap().to_string();
            assert!(
                alert_leases::list(&org, Some(&id), None, 10)
                    .await
                    .unwrap()
                    .is_empty()
            );

            // Requests that died after their write: a create, and a timed toggle.
            let start = now_micros();
            let mut died = new_alert(&org, FrequencyType::Minutes).await;
            let id = Ksuid::new(None, None);
            died.id = Some(id);
            let created = AlertLease {
                prior_enabled: Some(false),
                alert_version_us: start,
                state: LeaseState::Pending,
                ..new_lease(&org, &id.to_string(), &spec(ends), AO, start)
            };
            alert_leases::insert(&created).await.unwrap();
            let unfenced = CreateStamp {
                writes_us: start,
                pending_lease: None,
            };
            let died = db_create(&org, died, unfenced).await.unwrap();

            // A request still running when a sweeper let its pending row go.
            let mut slow = new_alert(&org, FrequencyType::Minutes).await;
            let slow_id = Ksuid::new(None, None);
            slow.id = Some(slow_id);
            let late = AlertLease {
                alert_version_us: start,
                state: LeaseState::Pending,
                ..new_lease(&org, &slow_id.to_string(), &spec(ends), AO, start)
            };
            alert_leases::insert(&late).await.unwrap();

            let toggled = stored_alert(&org, FrequencyType::Minutes).await;
            let toggled_id = toggled.id.unwrap().to_string();
            let written =
                infra::table::alerts::last_written_us(get_orm_client_rw().await, &org, &toggled_id);
            let written = written.await.unwrap().unwrap();
            let toggle = AlertLease {
                kind: LeaseKind::CreatesIncident,
                prior_creates_incident: Some(false),
                alert_version_us: written + 1,
                state: LeaseState::Pending,
                ..new_lease(&org, &toggled_id, &spec(ends), AO, start)
            };
            alert_leases::insert(&toggle).await.unwrap();
            let mut on = stored(&org, &toggled).await.unwrap();
            on.creates_incident = true;
            bare_write(&org, on, written, written + 1).await;

            let req = CreatesIncidentRequest {
                value: true,
                until_us: Some(ends),
                reason: Some("the service is failing".into()),
                ..Default::default()
            };
            let busy = set_creates_incident(&org, &toggled_id, &req, AO).await;
            assert!(
                matches!(busy, Err(LeaseError::Conflict(ref c)) if c.code == "change_in_progress"),
                "{busy:?}"
            );

            sweep(start + PENDING_TTL_US - 1).await.unwrap();
            assert!(
                stored(&org, &died).await.is_some(),
                "a request may still be running"
            );
            sweep(start + PENDING_TTL_US).await.unwrap();
            assert!(stored(&org, &died).await.is_none());
            let fenced = CreateStamp {
                writes_us: start,
                pending_lease: Some(late.id.clone()),
            };
            assert!(
                db_create(&org, slow, fenced).await.is_err(),
                "a write after its pending row was let go lands nothing"
            );
            assert!(load(&org, &slow_id.to_string()).await.is_err());

            // A create stalled past the TTL: the sweep deletes it, then its late trigger lands.
            let stalled = new_alert(&org, FrequencyType::Minutes).await;
            let late_key = OnceLock::new();
            let failed = create_leased_with(&org, stalled, &spec(ends), AO, |new, stamp| {
                let (org, late_key) = (org.as_str(), &late_key);
                async move {
                    let created = db_create(org, new, stamp).await?;
                    let _ = late_key.set(swept_then_late_trigger(org, &created).await);
                    Ok(created)
                }
            })
            .await;
            assert!(failed.is_err());
            let key = late_key.get().unwrap();
            let left = db::scheduler::get(&org, TriggerModule::Alert, key).await;
            assert!(left.is_err(), "a late create's trigger is cleared");

            // The same, but the request then fails without clearing it, as a crash would.
            let dying = new_alert(&org, FrequencyType::Minutes).await;
            let dead_key = OnceLock::new();
            let failed = create_leased_with(&org, dying, &spec(ends), AO, |new, stamp| {
                let (org, dead_key) = (org.as_str(), &dead_key);
                async move {
                    let created = db_create(org, new, stamp).await?;
                    let _ = dead_key.set(swept_then_late_trigger(org, &created).await);
                    Err(AlertError::AlertNotFound)
                }
            })
            .await;
            assert!(failed.is_err());

            // A person edits a stalled create before the sweep and deletes it after; then it dies.
            let kept = new_alert(&org, FrequencyType::Minutes).await;
            let kept_key = OnceLock::new();
            let failed = create_leased_with(&org, kept, &spec(ends), AO, |new, stamp| {
                let (org, kept_key) = (org.as_str(), &kept_key);
                async move {
                    let created = db_create(org, new, stamp).await?;
                    human_edit(org, &created, |a| a.description = "mine now".into()).await;
                    sweep(now_micros() + PENDING_TTL_US).await.unwrap();
                    let conn = get_orm_client_rw().await;
                    alert::delete_by_id_user(conn, org, created.id.unwrap()).await?;
                    let _ = kept_key.set(late_trigger(org, &created).await);
                    Err(AlertError::AlertNotFound)
                }
            })
            .await;
            assert!(failed.is_err());
            sweep(now_micros() + PENDING_TTL_US + CLAIM_TTL_US + 1)
                .await
                .unwrap();
            for key in [dead_key.get().unwrap(), kept_key.get().unwrap()] {
                let left = db::scheduler::get(&org, TriggerModule::Alert, key).await;
                assert!(
                    left.is_err(),
                    "a later pass clears what a dead request left"
                );
            }
            assert!(!stored(&org, &toggled).await.unwrap().creates_incident);
            for lease in [&created, &toggle, &late] {
                assert!(
                    lease_of(&org, &lease.id).await.is_none(),
                    "{:?}",
                    lease.kind
                );
            }
        });
    }

    #[test]
    fn a_temporary_alert_is_scheduled_to_run_its_own_query_now() {
        RUNTIME.block_on(async {
            if !meta_store().await {
                return;
            }
            let _serial = SERIAL.lock().await;
            let org = format!("lease_eval_{}", now_micros());
            let plain = stored_alert(&org, FrequencyType::Cron).await;
            let plain_id = plain.id.unwrap().to_string();
            let start = now_micros();
            let waits = db::scheduler::get(&org, TriggerModule::Alert, &plain_id);
            assert!(
                waits.await.unwrap().next_run_at > start,
                "a cron alert waits for its next slot"
            );

            let (alert, _) = leased(&org, FrequencyType::Cron, start + HOUR_US).await;
            let id = alert.id.unwrap().to_string();
            let trigger = db::scheduler::get(&org, TriggerModule::Alert, &id)
                .await
                .unwrap();
            assert!(trigger.next_run_at <= now_micros());
            assert_eq!(trigger.status, TriggerStatus::Waiting);
            assert_eq!(
                trigger.module_key, id,
                "the scheduler's own run, no synthetic row"
            );
        });
    }
}
