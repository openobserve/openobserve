// Copyright 2025 OpenObserve Inc.
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

use infra::errors::Result;
use o2_enterprise::enterprise::super_cluster::queue::{DestinationMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let event_key = msg.key.to_owned();
    let dest_msg: DestinationMessage = msg.try_into()?;
    match dest_msg {
        DestinationMessage::Put { dest } => {
            infra::table::destinations::put(dest).await?;
            infra::coordinator::destinations::emit_put_event(&event_key).await?;
        }
        DestinationMessage::Delete { org_id, dest_name } => {
            infra::table::destinations::delete(&org_id, &dest_name).await?;
            infra::coordinator::destinations::emit_delete_event(&event_key).await?;
        }
    }
    Ok(())
}
