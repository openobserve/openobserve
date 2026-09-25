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

//! Hand one recovery to everything that cared about the firing.
//!
//! Four subsystems used to decide independently that an alert had got better,
//! from four different inputs, at four different times. They are consumers now:
//! the evaluation that observed the recovery is its only author, and this is
//! the only place that fans it out.
//!
//! Best effort, in a fixed order, each consumer logging its own failure. A
//! consumer that cannot be told must not stop the others, and none of them may
//! fail the evaluation — the episode is already closed in the database by the
//! time this runs, so what a failure costs is one outbound message, not the
//! record that it happened.

use config::meta::alerts::{alert::Alert, recovery::RecoveryEvent};

/// Tell every consumer, then return. Never fails.
pub async fn dispatch_recovery(alert: &Alert, event: &RecoveryEvent) {
    log::info!(
        "[RECOVERY] {}/{} episode {} recovered after {}us",
        event.org_id,
        event.alert_id,
        event.episode_id,
        event.duration_micros()
    );

    // Once per episode, not once per evaluation: that is the whole fix.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::oncall::is_enabled()
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

    #[cfg(feature = "enterprise")]
    if let Err(e) = crate::alerts::incidents::resolve_alert_firing(event).await {
        log::error!(
            "[RECOVERY] incident consumer failed for {}: {e}",
            event.alert_id
        );
    }

    // Correlated alerts: the incident owns the resolve because it sent the trigger.
    if alert.notify_on_recovery
        && event.incident_id.is_none()
        && let Err(e) = crate::alerts::alert::send_recovery_notification(alert, event).await
    {
        log::error!(
            "[RECOVERY] destination consumer failed for {}: {e}",
            event.alert_id
        );
    }

    #[cfg(feature = "enterprise")]
    if let Err(e) = crate::workflows::send_alert_resolved(alert, event).await {
        log::error!(
            "[RECOVERY] workflow consumer failed for {}: {e}",
            event.alert_id
        );
    }
}
