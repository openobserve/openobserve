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
    table::score_configs,
};
use o2_enterprise::enterprise::super_cluster::queue::{
    EvalScoreConfigMessage, Message, MessageType,
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalScoreConfigPut => {
            let EvalScoreConfigMessage::Put { config } = msg.try_into()?;
            score_configs::delete(&config.entity_id, &config.org_id).await?;
            if score_configs::exists(&config.id).await? {
                score_configs::update(&config).await?;
            } else {
                score_configs::add(&config).await?;
            }
        }
        MessageType::EvalScoreConfigDelete => {
            let (org_id, entity_id) =
                crate::parse_eval_key(&msg.key, "score_configs", "Invalid eval score_configs key")?;
            score_configs::delete(&entity_id, &org_id).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_SCORE_CONFIG] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}
