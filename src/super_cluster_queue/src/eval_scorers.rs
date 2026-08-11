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

use infra::{
    errors::{Error, Result},
    table::scorers,
};
use o2_enterprise::enterprise::super_cluster::queue::{EvalScorerMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalScorerPut => {
            let EvalScorerMessage::Put { scorer } = msg.try_into()?;
            scorers::delete(&scorer.entity_id, &scorer.org_id).await?;
            if scorers::exists(&scorer.id).await? {
                scorers::update(&scorer).await?;
            } else {
                scorers::add(&scorer).await?;
            }
        }
        MessageType::EvalScorerDelete => {
            let (org_id, entity_id) =
                crate::parse_eval_key(&msg.key, "scorers", "Invalid eval scorers key")?;
            scorers::delete(&entity_id, &org_id).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_SCORER] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}
