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
    table::providers,
};
use o2_enterprise::enterprise::super_cluster::queue::{EvalProviderMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalProviderPut => {
            let EvalProviderMessage::Put { provider } = msg.try_into()?;
            if providers::exists(&provider.id).await? {
                providers::update(&provider).await?;
            } else {
                providers::add(&provider).await?;
            }
        }
        MessageType::EvalProviderDelete => {
            let provider_id = parse_provider_key(&msg.key)?;
            providers::delete(&provider_id).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_PROVIDER] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

fn parse_provider_key(key: &str) -> Result<String> {
    let key_columns: Vec<&str> = key.split('/').collect();
    if key_columns.len() != 4
        || key_columns[1] != "eval"
        || key_columns[2] != "providers"
        || key_columns[3].is_empty()
    {
        return Err(Error::Message("Invalid eval provider key".to_string()));
    }
    Ok(key_columns[3].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_provider_key_valid() {
        assert_eq!(
            parse_provider_key("/eval/providers/provider-1").unwrap(),
            "provider-1"
        );
    }

    #[test]
    fn test_parse_provider_key_invalid() {
        assert!(parse_provider_key("/eval/providers/").is_err());
        assert!(parse_provider_key("/eval/providers/provider-1/extra").is_err());
        assert!(parse_provider_key("/eval/scorers/provider-1").is_err());
    }
}
