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

use config::meta::alerts::incidents::IncidentEvent;

pub async fn append_event(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    infra::table::incident_events::append(org_id, incident_id, event).await?;
    Ok(())
}

// this fn is basically a wrapper over the above with types changed
// the ent streaming analyze fn needs to go through it and the types
// make it so that we cannot have params which are &refs , hence
// a thin wrapper which takes params by ownership and calls the above.
// if found a better way remove this completely.
pub async fn append_event_send(
    org_id: String,
    incident_id: String,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    append_event(&org_id, &incident_id, event).await?;
    Ok(())
}
