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

//! Applies AI toolset writes from another region; the newest write wins and secrets stay local.

use config::utils::time::now_micros;
use db::ai_toolsets::Applied;
use infra::errors::{Error, Result};
use o2_enterprise::enterprise::{
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
    super_cluster::queue::{AiToolsetMessage, Message, MessageType},
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::AiToolsetsTable {
        log::error!(
            "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
            msg.message_type,
            msg.key
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }
    let msg = AiToolsetMessage::try_from(msg)?;
    let org = match &msg {
        AiToolsetMessage::Put { org, .. } | AiToolsetMessage::Delete { org, .. } => org.clone(),
    };
    if let Some(entry) = audit_entry(&org, db::ai_toolsets::apply_replicated(msg).await?)
        && get_o2_config().common.audit_enabled
    {
        audit::audit(entry).await;
    }
    Ok(())
}

/// The receiving region's record that another region's write replaced or removed a local row.
fn audit_entry(org: &str, applied: Applied) -> Option<AuditMessage> {
    let (method, name, region) = match applied {
        Applied::Replaced { name, region } => ("PUT", name, region),
        Applied::Deleted { name, region } => ("DELETE", name, region),
        Applied::Ignored | Applied::Created => return None,
    };
    let body = serde_json::json!({"toolset": name, "replaced_by_region": region});
    Some(AuditMessage {
        login_ip: None,
        user_agent: None,
        user_email: "system".to_string(),
        org_id: org.to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: method.to_string(),
            http_path: format!("/api/{org}/ai/toolsets"),
            http_query_params: String::new(),
            http_body: body.to_string(),
            http_response_code: 200,
            error_msg: None,
            trace_id: None,
        },
        delegated: None,
        fleet_id: None,
        target: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_message_of_another_table_is_rejected_before_it_is_decoded() {
        let msg = Message::new(
            "/ai_toolsets/acme/dd".to_string(),
            Some(bytes::Bytes::from_static(b"{}")),
            None,
            false,
            MessageType::SystemSettingsTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[test]
    fn only_a_replaced_or_removed_local_row_is_audited() {
        let replaced = Applied::Replaced {
            name: "datadog-prod".into(),
            region: "us-1".into(),
        };
        let entry = audit_entry("acme", replaced).unwrap();
        assert_eq!(entry.response_meta.http_method, "PUT");
        assert!(entry.response_meta.http_body.contains("us-1"));
        assert!(audit_entry("acme", Applied::Created).is_none());
        assert!(audit_entry("acme", Applied::Ignored).is_none());
    }
}
