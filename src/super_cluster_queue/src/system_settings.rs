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

//! Applies org settings v2 writes from another region; the newer `updated_at` wins.

use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, SystemSettingMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::SystemSettingsTable {
        log::error!(
            "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
            msg.message_type,
            msg.key
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }
    match SystemSettingMessage::try_from(msg)? {
        SystemSettingMessage::Put { setting } => {
            db::system_settings::apply_replicated_put(&setting).await?;
        }
        SystemSettingMessage::Delete {
            org_id,
            setting_key,
        } => {
            db::system_settings::apply_replicated_delete(&org_id, &setting_key).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::system_settings::SystemSetting;

    use super::*;

    fn put() -> SystemSettingMessage {
        let mut setting = SystemSetting::new_org(
            "acme",
            "auto_investigate_gate",
            serde_json::json!({"mode": "p1"}),
        );
        setting.created_at = 100;
        setting.updated_at = 105;
        SystemSettingMessage::Put {
            setting: Box::new(setting),
        }
    }

    fn wire(msg: &SystemSettingMessage, message_type: MessageType) -> Message {
        let payload = config::utils::json::to_vec(msg).unwrap();
        Message::new(msg.key(), Some(payload.into()), None, false, message_type)
    }

    #[tokio::test]
    async fn a_message_of_another_table_is_rejected_before_it_is_decoded() {
        assert!(
            process(wire(&put(), MessageType::AlertAcksTable))
                .await
                .is_err()
        );
    }

    #[test]
    fn a_settings_write_survives_the_wire_round_trip() {
        let delete = SystemSettingMessage::Delete {
            org_id: "acme".into(),
            setting_key: "auto_investigate_gate".into(),
        };
        for msg in [put(), delete] {
            let bytes =
                bytes::Bytes::try_from(&wire(&msg, MessageType::SystemSettingsTable)).unwrap();
            let decoded = Message::try_from(&bytes).unwrap();
            assert_eq!(decoded.message_type, MessageType::SystemSettingsTable);
            assert_eq!(decoded.key, "/system_settings/acme/auto_investigate_gate");
            assert_eq!(decoded.key.split('/').nth(1), Some("system_settings"));
            let back = SystemSettingMessage::try_from(decoded).unwrap();
            assert_eq!(
                serde_json::to_value(&back).unwrap(),
                serde_json::to_value(&msg).unwrap()
            );
        }
    }
}
