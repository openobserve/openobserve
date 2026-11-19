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

//! Applies AI memory changes from another region; the newest head wins and the loser stays in
//! history. Neither logs nor audit entries carry a user id or memory text.

use config::{meta::ai::memory::MemoryScope, utils::time::now_micros};
use infra::{
    errors::{Error, Result},
    table::ai_memory::Replicated,
};
use o2_enterprise::enterprise::{
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
    super_cluster::queue::{AiMemoryMessage, Message, MessageType},
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::AiMemoryTable {
        log::error!(
            "[SUPER_CLUSTER:DB] Invalid message for ai_memory: type: {:?}",
            msg.message_type
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }
    let msg = AiMemoryMessage::try_from(msg)?;
    let (org, scope, scope_key) = match &msg {
        AiMemoryMessage::Put(r) => (r.org.clone(), r.scope, r.scope_key.clone()),
        AiMemoryMessage::Delete(t) => (t.org.clone(), t.scope, t.scope_key.clone()),
    };
    let applied = db::ai_memory_replication::apply_replicated(msg).await?;
    if let Some(entry) = audit_entry(&org, scope, &scope_key, applied)
        && get_o2_config().common.audit_enabled
    {
        audit::audit(entry).await;
    }
    Ok(())
}

/// The receiving region's record that another region's change replaced or removed its memory;
/// a toolset memory is named by its toolset, a user memory not at all.
fn audit_entry(
    org: &str,
    scope: MemoryScope,
    scope_key: &str,
    applied: Replicated,
) -> Option<AuditMessage> {
    let (method, region) = match applied {
        Replicated::Replaced { region } => ("PUT", region),
        Replicated::Deleted { region } => ("DELETE", region),
        Replicated::Ignored | Replicated::Recorded => return None,
    };
    let (path, body) = match scope {
        MemoryScope::Org => (
            "memory/org",
            serde_json::json!({"memory": "org", "replaced_by_region": region}),
        ),
        MemoryScope::Toolset => (
            "memory",
            serde_json::json!({"memory": "toolset", "toolset": scope_key, "replaced_by_region": region}),
        ),
        MemoryScope::User => (
            "memory",
            serde_json::json!({"memory": "user", "replaced_by_region": region}),
        ),
    };
    Some(AuditMessage {
        login_ip: None,
        user_agent: None,
        user_email: "system".to_string(),
        org_id: org.to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: method.to_string(),
            http_path: format!("/api/{org}/ai/{path}"),
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
            "/ai_memory/acme/org/".to_string(),
            Some(bytes::Bytes::from_static(b"{}")),
            None,
            false,
            MessageType::SystemSettingsTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[test]
    fn only_a_replaced_or_removed_memory_is_audited_and_never_by_user_id() {
        let replaced = || Replicated::Replaced {
            region: "us-1".into(),
        };
        let org = audit_entry("acme", MemoryScope::Org, "", replaced()).unwrap();
        assert_eq!(org.response_meta.http_method, "PUT");
        assert_eq!(org.response_meta.http_path, "/api/acme/ai/memory/org");
        assert!(org.response_meta.http_body.contains("us-1"));
        let user = audit_entry("acme", MemoryScope::User, "2fZk9user", replaced()).unwrap();
        assert!(!user.response_meta.http_body.contains("2fZk9user"));
        let deleted = Replicated::Deleted {
            region: "eu-1".into(),
        };
        let toolset = audit_entry("acme", MemoryScope::Toolset, "datadog", deleted).unwrap();
        assert_eq!(toolset.response_meta.http_method, "DELETE");
        assert!(toolset.response_meta.http_body.contains("datadog"));
        assert!(audit_entry("acme", MemoryScope::Org, "", Replicated::Recorded).is_none());
        assert!(audit_entry("acme", MemoryScope::Org, "", Replicated::Ignored).is_none());
    }
}
