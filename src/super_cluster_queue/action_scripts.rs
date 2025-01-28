// Copyright (c) 2025. OpenObserve Inc.
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
use o2_enterprise::enterprise::super_cluster::queue::{ActionScriptsMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let action_scripts_message: ActionScriptsMessage = msg.try_into()?;
    match action_scripts_message {
        ActionScriptsMessage::Put { action } => {
            // TODO Cleanup the zip file from s3 if it exists
            if crate::table::action_scripts::contains(&action.id.unwrap().to_string()).await? {
                crate::table::action_scripts::update(&action).await?;
            } else {
                crate::table::action_scripts::add(&action).await?;
            }
        }
        ActionScriptsMessage::Delete { org_id, action_id } => {
            // TODO Cleanup the zip file from s3 if it exists
            crate::table::action_scripts::remove(&org_id, &action_id).await?;
        }
    }
    Ok(())
}
