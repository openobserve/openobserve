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
use o2_enterprise::enterprise::super_cluster::queue::{Message, TemplateMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let event_key = msg.key.to_owned();
    let temp_msg: TemplateMessage = msg.try_into()?;
    match temp_msg {
        TemplateMessage::Put { temp } => {
            infra::table::templates::put(temp).await?;
            infra::coordinator::destinations::emit_put_event(&event_key).await?;
        }
        TemplateMessage::Delete { org_id, dest_name } => {
            infra::table::templates::delete(&org_id, &dest_name).await?;
            infra::coordinator::destinations::emit_delete_event(&event_key).await?;
        }
    }
    Ok(())
}
