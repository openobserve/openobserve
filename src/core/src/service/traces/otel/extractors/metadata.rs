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

//! Metadata extraction (user ID, session ID, environment, tags)

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{
    GenAiAttributes, LangfuseAttributes, OtelAttributes, VercelAiSdkAttributes,
};

pub struct MetadataExtractor;

impl MetadataExtractor {
    /// Extract user ID
    pub fn extract_user_id(
        &self,
        attributes: &HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
    ) -> Option<String> {
        let user_id_keys = [
            OtelAttributes::USER_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_USER_ID,
            "service_user.id",
        ];

        for key in &user_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }

        for key in &user_id_keys {
            if let Some(value) = resource_attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }

        None
    }

    /// Extract session ID
    pub fn extract_session_id(
        &self,
        attributes: &HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
    ) -> Option<String> {
        let session_id_keys = [
            OtelAttributes::SESSION_ID,
            GenAiAttributes::CONVERSATION_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_SESSION_ID,
            LangfuseAttributes::METADATA_LANGFUSE_SESSION_ID,
            LangfuseAttributes::METADATA_SESSION_ID,
            "service_session.id",
        ];

        for key in &session_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }

        for key in &session_id_keys {
            if let Some(value) = resource_attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_extract_user_id_from_span_attributes() {
        let mut attrs = HashMap::new();
        attrs.insert("user.id".to_string(), json::json!("user_123"));
        let result = MetadataExtractor.extract_user_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("user_123".to_string()));
    }

    #[test]
    fn test_extract_user_id_falls_back_to_resource_attributes() {
        let mut resource = HashMap::new();
        resource.insert("user.id".to_string(), json::json!("res_user"));
        let result = MetadataExtractor.extract_user_id(&HashMap::new(), &resource);
        assert_eq!(result, Some("res_user".to_string()));
    }

    #[test]
    fn test_extract_user_id_span_takes_priority_over_resource() {
        let mut attrs = HashMap::new();
        attrs.insert("user.id".to_string(), json::json!("span_user"));
        let mut resource = HashMap::new();
        resource.insert("user.id".to_string(), json::json!("res_user"));
        let result = MetadataExtractor.extract_user_id(&attrs, &resource);
        assert_eq!(result, Some("span_user".to_string()));
    }

    #[test]
    fn test_extract_user_id_returns_none_when_absent() {
        let result = MetadataExtractor.extract_user_id(&HashMap::new(), &HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_session_id_from_span_attributes() {
        let mut attrs = HashMap::new();
        attrs.insert("session.id".to_string(), json::json!("session_abc"));
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("session_abc".to_string()));
    }

    #[test]
    fn test_extract_session_id_falls_back_to_resource_attributes() {
        let mut resource = HashMap::new();
        resource.insert("session.id".to_string(), json::json!("res_session"));
        let result = MetadataExtractor.extract_session_id(&HashMap::new(), &resource);
        assert_eq!(result, Some("res_session".to_string()));
    }

    #[test]
    fn test_extract_session_id_returns_none_when_absent() {
        let result = MetadataExtractor.extract_session_id(&HashMap::new(), &HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_user_id_from_vercel_metadata() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "ai.telemetry.metadata.userId".to_string(),
            json::json!("vercel_user"),
        );
        let result = MetadataExtractor.extract_user_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("vercel_user".to_string()));
    }

    #[test]
    fn test_extract_user_id_non_string_returns_none() {
        let mut attrs = HashMap::new();
        attrs.insert("user.id".to_string(), json::json!(42));
        let result = MetadataExtractor.extract_user_id(&attrs, &HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_session_id_from_gen_ai_conversation_id() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.conversation.id".to_string(),
            json::json!("conv_456"),
        );
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("conv_456".to_string()));
    }

    #[test]
    fn test_extract_session_id_from_vercel_metadata() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "ai.telemetry.metadata.sessionId".to_string(),
            json::json!("vercel_session"),
        );
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("vercel_session".to_string()));
    }

    #[test]
    fn test_extract_session_id_from_langfuse_metadata_session_id() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.session_id".to_string(),
            json::json!("lf_session"),
        );
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("lf_session".to_string()));
    }

    #[test]
    fn test_extract_session_id_span_takes_priority_over_resource() {
        let mut attrs = HashMap::new();
        attrs.insert("session.id".to_string(), json::json!("span_session"));
        let mut resource = HashMap::new();
        resource.insert("session.id".to_string(), json::json!("res_session"));
        let result = MetadataExtractor.extract_session_id(&attrs, &resource);
        assert_eq!(result, Some("span_session".to_string()));
    }

    #[test]
    fn test_extract_user_id_from_service_user_id() {
        let mut attrs = HashMap::new();
        attrs.insert("service_user.id".to_string(), json::json!("svc_user"));
        let result = MetadataExtractor.extract_user_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("svc_user".to_string()));
    }

    #[test]
    fn test_extract_session_id_from_langfuse_metadata_langfuse_session_id() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.langfuse_session_id".to_string(),
            json::json!("lf_meta_session"),
        );
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("lf_meta_session".to_string()));
    }

    #[test]
    fn test_extract_session_id_from_service_session_id() {
        let mut attrs = HashMap::new();
        attrs.insert("service_session.id".to_string(), json::json!("svc_session"));
        let result = MetadataExtractor.extract_session_id(&attrs, &HashMap::new());
        assert_eq!(result, Some("svc_session".to_string()));
    }
}
