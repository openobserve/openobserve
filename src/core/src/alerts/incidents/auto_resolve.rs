// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! The core side of the one guarded close: [infra]'s locked write, then the Live follow-up steps.

use infra::table::{
    alert_incidents::{CloseCaller, GuardedClose, KeptReason, resolve_guarded},
    entity::alert_incidents as incident_rows,
};

use super::{Repairs, SYSTEM_USER_EMAIL, TurnFence, finish_status_change};

/// What [auto_resolve_guarded] did; a close carries what its follow-up steps did.
#[derive(Debug)]
pub(super) enum AutoResolved {
    Closed(Repairs),
    AlreadyResolved(Box<incident_rows::Model>),
    Kept(KeptReason),
}

/// Closes through the guarded path, then runs the resolve's follow-up steps while `fence` holds.
pub(super) async fn auto_resolve_guarded(
    org_id: &str,
    incident_id: &str,
    cause: CloseCaller,
    quiet: bool,
    fence: &dyn TurnFence,
) -> Result<AutoResolved, anyhow::Error> {
    // The row lock is released at the commit, before any follow-up step, notification or publish.
    let (before, after) = match resolve_guarded(org_id, incident_id, cause).await? {
        GuardedClose::Closed { before, after, .. } => (before, after),
        GuardedClose::AlreadyResolved(model) => return Ok(AutoResolved::AlreadyResolved(model)),
        GuardedClose::Kept(reason) => return Ok(AutoResolved::Kept(reason)),
    };
    // Read before the resolve cleared it, so resolving a muted incident still notifies nobody.
    let muted_before = before.muted_by_downtime_id.is_some()
        && o2_enterprise::enterprise::common::config::get_config()
            .downtimes
            .enabled;
    let quiet = quiet || muted_before;
    let user = SYSTEM_USER_EMAIL;
    let (_, repairs) =
        finish_status_change(org_id, incident_id, user, quiet, *after, fence, None).await?;
    Ok(AutoResolved::Closed(repairs))
}
