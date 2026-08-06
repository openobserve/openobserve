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
            let (org_id, entity_id) = parse_org_entity_key(&msg.key, "scorers")?;
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

fn parse_org_entity_key(key: &str, module: &str) -> Result<(String, String)> {
    let key_columns: Vec<&str> = key.split('/').collect();
    if key_columns.len() != 5
        || key_columns[1] != "eval"
        || key_columns[2] != module
        || key_columns[3].is_empty()
        || key_columns[4].is_empty()
    {
        return Err(Error::Message(format!("Invalid eval {module} key")));
    }
    Ok((key_columns[3].to_string(), key_columns[4].to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_org_entity_key_valid() {
        assert_eq!(
            parse_org_entity_key("/eval/scorers/org-1/entity-1", "scorers").unwrap(),
            ("org-1".to_string(), "entity-1".to_string())
        );
    }

    #[test]
    fn test_parse_org_entity_key_invalid() {
        assert!(parse_org_entity_key("/eval/scorers/org-1/", "scorers").is_err());
        assert!(parse_org_entity_key("/eval/scorers/org-1/entity-1/x", "scorers").is_err());
        assert!(parse_org_entity_key("/eval/score_configs/org-1/entity-1", "scorers").is_err());
    }
}
