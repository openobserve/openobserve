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

//! Subsystems used to decide independently that an alert had got better; they are consumers now.
//! Best effort: the episode is already committed, so a failure costs a message, not the record.

use config::meta::{
    alerts::{alert::Alert, recovery::RecoveryEvent},
    self_reporting::usage::{TriggerData, TriggerDataType},
};

/// Which consumers one recovery reaches.
#[derive(Debug, PartialEq)]
struct RecoveryRoute {
    oncall: bool,
    destinations: bool,
}

/// One clear run's on-call decision in the scheduler.
#[cfg(feature = "enterprise")]
#[derive(Debug, PartialEq)]
struct ClearRunOncall<'a> {
    withheld: bool,
    /// The downtime to record as the alert's mute.
    record: Option<&'a str>,
}

/// Tell every consumer, then return. Never fails.
pub async fn dispatch_recovery(alert: &Alert, event: &RecoveryEvent) {
    log::info!(
        "[RECOVERY] {}/{} episode {} recovered after {}us",
        event.org_id,
        event.alert_id,
        event.episode_id,
        event.duration_micros()
    );

    // A recovery inside a window is dropped, never delayed: the episode is already closed.
    let downtime_id = recovery_downtime(alert, event).await;
    let route = recovery_route(alert, event, downtime_id.is_some());
    if let Some(downtime_id) = downtime_id.as_deref() {
        log::info!(
            "[RECOVERY] {}/{} recovery suppressed by downtime {downtime_id}",
            event.org_id,
            event.alert_id
        );
        // Keeps the scheduler's per-run on-call recovery withheld after the window.
        #[cfg(feature = "enterprise")]
        crate::alerts::scheduler::handlers::record_last_downtime(
            &event.org_id,
            &event.alert_id,
            Some(downtime_id),
        )
        .await;
        usage_reporting::publish_triggers_usage(suppressed_recovery_record(
            alert,
            event,
            downtime_id.to_string(),
        ));
    }

    // Once per episode, not once per evaluation: that is the whole fix.
    #[cfg(feature = "enterprise")]
    if route.oncall
        && o2_enterprise::enterprise::oncall::is_enabled()
        && let Err(e) = o2_enterprise::enterprise::oncall::escalation::recover_for_alert(
            &event.org_id,
            &event.alert_id,
        )
        .await
    {
        log::error!(
            "[RECOVERY] on-call consumer failed for {}: {e}",
            event.alert_id
        );
    }

    // The links close even inside a window; a resolve it causes then pages and notifies nobody.
    #[cfg(feature = "enterprise")]
    if let Err(e) = crate::alerts::incidents::resolve_alert_firing(event, !route.oncall).await {
        log::error!(
            "[RECOVERY] incident consumer failed for {}: {e}",
            event.alert_id
        );
    }

    if route.destinations
        && let Err(e) = crate::alerts::alert::send_recovery_notification(alert, event).await
    {
        log::error!(
            "[RECOVERY] destination consumer failed for {}: {e}",
            event.alert_id
        );
    }

    // TODO: a workflow consumer, once a link can carry AlertResolved (see that variant).
}

/// Whether the scheduler's per-run on-call recovery waits: a recorded mute or a window now.
#[cfg(feature = "enterprise")]
pub(crate) async fn oncall_recovery_withheld(alert: &Alert, folder_id: &str, now: i64) -> bool {
    if !alert_downtimes_in(&alert.org_id) {
        return false;
    }
    let Some(alert_id) = alert.id.map(|id| id.to_string()) else {
        return false;
    };
    let recorded = recorded_downtime(&alert_id).await;
    let muted_now = downtime_at(alert, folder_id, recorded.as_deref(), now).await;
    let episode_open = recorded.is_none() && muted_now.is_some() && episode_open(&alert_id).await;
    let decision = clear_run_oncall(recorded.as_deref(), muted_now.as_deref(), episode_open);
    if let Some(downtime_id) = decision.record {
        crate::alerts::scheduler::handlers::record_last_downtime(
            &alert.org_id,
            &alert_id,
            Some(downtime_id),
        )
        .await;
    }
    decision.withheld
}

/// The first clear run of an open episode records its mute, so a hold past the window stays muted.
#[cfg(feature = "enterprise")]
fn clear_run_oncall<'a>(
    recorded: Option<&str>,
    muted_now: Option<&'a str>,
    episode_open: bool,
) -> ClearRunOncall<'a> {
    ClearRunOncall {
        withheld: recorded.is_some() || muted_now.is_some(),
        record: muted_now.filter(|_| recorded.is_none() && episode_open),
    }
}

/// Correlated alerts: the incident owns the resolve because it sent the trigger.
fn recovery_route(alert: &Alert, event: &RecoveryEvent, muted: bool) -> RecoveryRoute {
    RecoveryRoute {
        oncall: !muted,
        destinations: !muted && alert.notify_on_recovery && event.incident_id.is_none(),
    }
}

/// The history record of a recovery a downtime kept silent.
fn suppressed_recovery_record(
    alert: &Alert,
    event: &RecoveryEvent,
    downtime_id: String,
) -> TriggerData {
    let mut data = TriggerData {
        _timestamp: event.emitted_at,
        org: event.org_id.clone(),
        module: TriggerDataType::Alert,
        key: format!("{}/{}", alert.name, event.alert_id),
        start_time: event.recovered_at,
        end_time: event.emitted_at,
        is_realtime: alert.is_real_time,
        ..Default::default()
    };
    crate::alerts::alert::record_suppressed_run(&mut data, "alerts", downtime_id);
    data
}

#[cfg(feature = "enterprise")]
fn alert_downtimes_in(org: &str) -> bool {
    crate::alerts::downtimes::any_for(org, config::meta::downtimes::TargetModule::Alerts)
}

/// Asked at `recovered_at`, so a `keep_firing_for` hold that outlasts the window still mutes.
#[cfg(feature = "enterprise")]
async fn recovery_downtime(alert: &Alert, event: &RecoveryEvent) -> Option<String> {
    if !alert_downtimes_in(&event.org_id) {
        return None;
    }
    let alert_id = alert.id?;
    let conn = infra::db::get_orm_client_ro().await;
    let folder_id = match crate::alerts::alert::get_by_id(conn, &event.org_id, alert_id).await {
        Ok((folder, _)) => folder.folder_id,
        Err(e) => {
            log::warn!(
                "[RECOVERY] folder of {}/{} unreadable for the downtime check: {e}",
                event.org_id,
                event.alert_id
            );
            return None;
        }
    };
    let recorded = recorded_downtime(&event.alert_id).await;
    downtime_at(alert, &folder_id, recorded.as_deref(), event.recovered_at).await
}

#[cfg(not(feature = "enterprise"))]
async fn recovery_downtime(_alert: &Alert, _event: &RecoveryEvent) -> Option<String> {
    None
}

/// The muted firing's downtime carries its row identity; the clear run has no rows of its own.
#[cfg(feature = "enterprise")]
async fn downtime_at(
    alert: &Alert,
    folder_id: &str,
    recorded: Option<&str>,
    at: i64,
) -> Option<String> {
    if let Some(downtime) =
        recorded.and_then(|id| crate::alerts::downtimes::active_by_id(&alert.org_id, id, at))
    {
        return Some(downtime.id);
    }
    crate::alerts::scheduler::handlers::downtime_decision(alert, folder_id, Some(&[]), at)
        .await
        .map(|downtime| downtime.id)
}

/// A delivered firing whose recovery is still due, possibly held by `keep_firing_for`.
#[cfg(feature = "enterprise")]
async fn episode_open(alert_id: &str) -> bool {
    match infra::table::alert_states::get(alert_id, config::meta::alerts::state::ROLLUP_GROUP_KEY)
        .await
    {
        Ok(state) => state.is_some_and(|state| state.episode_id.is_some()),
        Err(e) => {
            log::warn!("[RECOVERY] state of {alert_id} unreadable for the mute record: {e}");
            false
        }
    }
}

/// The downtime the alert's last muted firing recorded, until a delivered firing clears it.
#[cfg(feature = "enterprise")]
async fn recorded_downtime(alert_id: &str) -> Option<String> {
    match infra::table::alert_states::last_downtime_ids(&[alert_id.to_string()]).await {
        Ok(mut recorded) => recorded.remove(alert_id),
        Err(e) => {
            log::warn!("[RECOVERY] recorded downtime of {alert_id} unreadable: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{
            recovery::{EpisodeInput, apply_episode, recovery_event},
            state::AlertState,
        },
        self_reporting::usage::RunOutcome,
    };

    use super::*;

    fn delivered() -> EpisodeInput {
        EpisodeInput {
            delivered: true,
            incident_id: None,
            keep_firing_for_secs: 0,
            episode_id: None,
        }
    }

    #[test]
    fn a_recovery_inside_a_window_sends_nothing_then_or_later() {
        let mut alert = Alert::default();
        alert.notify_on_recovery = true;
        let mut state = AlertState::empty("a1", "");
        apply_episode(&mut state, true, &delivered(), 10, || "ep_1".into());
        let closed = apply_episode(&mut state, false, &EpisodeInput::undelivered(0), 20, || {
            "x".into()
        })
        .expect("the delivered episode recovers inside the window");
        let event = recovery_event("default", &state, closed, 20);

        let muted = recovery_route(&alert, &event, true);
        assert_eq!(
            muted,
            RecoveryRoute {
                oncall: false,
                destinations: false
            }
        );
        let record = suppressed_recovery_record(&alert, &event, "dt-1".to_string());
        assert_eq!(record.status, RunOutcome::Suppressed);
        assert_eq!(record.downtime_id.as_deref(), Some("dt-1"));
        // The episode closed when it recovered, so no later run re-emits it.
        for at in [30, 40] {
            assert!(
                apply_episode(&mut state, false, &EpisodeInput::undelivered(0), at, || {
                    "x".into()
                })
                .is_none()
            );
        }
    }

    #[test]
    fn the_next_firing_after_the_window_notifies_its_recovery() {
        let mut alert = Alert::default();
        alert.notify_on_recovery = true;
        let mut state = AlertState::empty("a1", "");
        apply_episode(&mut state, true, &delivered(), 50, || "ep_2".into());
        let closed = apply_episode(&mut state, false, &EpisodeInput::undelivered(0), 60, || {
            "x".into()
        })
        .expect("the next episode recovers");
        let event = recovery_event("default", &state, closed, 60);
        assert_eq!(
            recovery_route(&alert, &event, false),
            RecoveryRoute {
                oncall: true,
                destinations: true
            }
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_hold_that_outlasts_the_window_keeps_the_oncall_recovery_withheld() {
        // Delivered before the window; the first clear run falls inside it and starts the hold.
        let first = clear_run_oncall(None, Some("dt-1"), true);
        assert_eq!(
            first,
            ClearRunOncall {
                withheld: true,
                record: Some("dt-1")
            }
        );
        // After the window, still inside the hold: the recorded mute keeps it withheld.
        let after = clear_run_oncall(first.record, None, true);
        assert!(after.withheld);
        assert_eq!(after.record, None, "recorded once");
        // No open episode: withheld inside the window, nothing recorded.
        assert_eq!(
            clear_run_oncall(None, Some("dt-1"), false),
            ClearRunOncall {
                withheld: true,
                record: None
            }
        );
        assert!(!clear_run_oncall(None, None, true).withheld);
    }
}
