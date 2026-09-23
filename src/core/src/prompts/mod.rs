// Copyright 2026 OpenObserve Inc.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;
mod cache;
mod service;

pub use cache::watch_invalidation;
pub use service::{
    append_version, archive, create_prompt, delete_label, find_content_matches, get_prompt,
    get_version, list_label_activity, list_prompts, list_versions, move_label, resolve_by_name,
    resolve_prompt, update_head,
};

pub const LATEST_LABEL: &str = "latest";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptType {
    Text,
    Chat,
}

impl PromptType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Chat => "chat",
        }
    }
}

impl TryFrom<&str> for PromptType {
    type Error = PromptError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "text" => Ok(Self::Text),
            "chat" => Ok(Self::Chat),
            _ => Err(PromptError::InvalidPromptType),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptStatus {
    Active,
    Archived,
}

impl PromptStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptSource {
    Ui,
    Sdk,
    Playground,
    Ci,
    Agent,
}

impl PromptSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ui => "ui",
            Self::Sdk => "sdk",
            Self::Playground => "playground",
            Self::Ci => "ci",
            Self::Agent => "agent",
        }
    }
}

impl TryFrom<&str> for PromptSource {
    type Error = PromptError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "ui" => Ok(Self::Ui),
            "sdk" => Ok(Self::Sdk),
            "playground" => Ok(Self::Playground),
            "ci" => Ok(Self::Ci),
            "agent" => Ok(Self::Agent),
            _ => Err(PromptError::InvalidPromptSource),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PromptSelector {
    Label(String),
    Version(i32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvePurpose {
    Runtime,
    NewReference,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MutationContext {
    pub actor: String,
    pub via: PromptSource,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptConfig {
    pub model: Option<String>,
    pub params: Option<Value>,
    pub tools: Option<Value>,
    pub response_format: Option<Value>,
}

impl PromptConfig {
    pub fn normalized_value(&self) -> Value {
        json!({
            "model": self.model,
            "params": self.params,
            "tools": self.tools,
            "responseFormat": self.response_format,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrompt {
    pub name: String,
    pub folder_id: String,
    pub prompt_type: PromptType,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub payload: Value,
    #[serde(default)]
    pub config: PromptConfig,
    pub commit_message: String,
    pub source: PromptSource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePromptVersion {
    pub payload: Value,
    #[serde(default)]
    pub config: PromptConfig,
    pub commit_message: String,
    pub source: PromptSource,
    pub base_version: Option<i32>,
    pub base_hash: Option<String>,
    #[serde(skip)]
    pub if_head: Option<i32>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePromptHead {
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub folder_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePromptLabel {
    pub version: i32,
    pub if_version: Option<i32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePromptLabel {
    pub if_version: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptVersion {
    pub id: String,
    pub entity_id: String,
    pub version: i32,
    pub payload: Value,
    pub config: PromptConfig,
    pub commit_message: String,
    pub source: PromptSource,
    pub base_version: Option<i32>,
    pub content_hash: String,
    pub created_by: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLabel {
    pub name: String,
    pub version: Option<i32>,
    pub deleted_at: Option<i64>,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub entity_id: String,
    pub name: String,
    pub folder_id: String,
    pub prompt_type: PromptType,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub status: PromptStatus,
    pub latest_version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
    #[serde(default)]
    pub labels: Vec<PromptLabel>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptMutationResult {
    pub prompt: Prompt,
    pub version: PromptVersion,
    pub created: bool,
    pub replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPrompt {
    pub prompt: Prompt,
    pub version: PromptVersion,
    pub label: Option<String>,
    pub folder_assertion_mismatch: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptActivity {
    pub id: String,
    pub entity_id: String,
    pub label: String,
    pub from_version: Option<i32>,
    pub to_version: Option<i32>,
    pub actor: String,
    pub via: PromptSource,
    pub created_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum PromptError {
    #[error("prompt name must match ^[a-z0-9_-]+$")]
    InvalidPromptName,
    #[error("prompt selector is invalid")]
    InvalidSelector,
    #[error("prompt not found")]
    PromptNotFound,
    #[error("prompt version not found")]
    VersionNotFound,
    #[error("prompt label not found")]
    LabelNotFound,
    #[error("prompt label was deleted")]
    LabelGone,
    #[error("prompt head advanced")]
    HeadAdvanced,
    #[error("idempotency key is associated with another request")]
    IdempotencyConflict,
    #[error("protected prompt label requires elevated permission")]
    ProtectedLabelForbidden,
    #[error("the latest label is managed by version creation")]
    LatestLabelImmutable,
    #[error("prompt is archived")]
    ArchivedPrompt,
    #[error("prompt folder not found")]
    FolderNotFound,
    #[error("prompt name already exists")]
    DuplicateName,
    #[error("prompt payload does not match its immutable type: {0}")]
    InvalidPayload(String),
    #[error("prompt type is invalid")]
    InvalidPromptType,
    #[error("prompt source is invalid")]
    InvalidPromptSource,
    #[error("prompt config is invalid: {0}")]
    InvalidConfig(String),
    #[error("prompt config cannot contain provider_id")]
    ProviderNotAllowed,
    #[error("commit message is required")]
    MissingCommitMessage,
    #[error("prompt label is invalid")]
    InvalidLabel,
    #[error("baseVersion and baseHash are mutually exclusive")]
    InvalidBase,
    #[error("stored prompt data is invalid: {0}")]
    InvalidStoredData(String),
    #[error("stored idempotent response is malformed: {0}")]
    MalformedReplay(String),
    #[error("prompt storage failed: {0}")]
    Storage(#[from] sea_orm::DbErr),
    #[error("prompt infrastructure failed: {0}")]
    Infrastructure(#[from] infra::errors::Error),
    #[error("prompt folder operation failed: {0}")]
    Folder(#[from] db::folders::FolderError),
    #[error("prompt settings operation failed: {0}")]
    Settings(#[from] db::prompt_settings::PromptSettingsError),
    #[error("prompt idempotency failed: {0}")]
    Idempotency(#[from] infra::idempotency::IdempotencyError),
}

pub fn validate_prompt_name(name: &str) -> Result<String, PromptError> {
    let name = name.trim();
    if name.is_empty()
        || name.contains('/')
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
    {
        return Err(PromptError::InvalidPromptName);
    }
    Ok(name.to_string())
}

pub fn validate_label(label: &str) -> Result<String, PromptError> {
    let label = label.trim();
    if label.is_empty()
        || label.len() > 128
        || label.contains('/')
        || label.chars().any(char::is_control)
    {
        return Err(PromptError::InvalidLabel);
    }
    Ok(label.to_string())
}

pub fn validate_commit_message(message: &str) -> Result<String, PromptError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(PromptError::MissingCommitMessage);
    }
    Ok(message.to_string())
}

pub fn validate_payload(prompt_type: PromptType, payload: &Value) -> Result<(), PromptError> {
    match prompt_type {
        PromptType::Text if payload.is_string() => Ok(()),
        PromptType::Text => Err(PromptError::InvalidPayload(
            "text payload must be a JSON string".to_string(),
        )),
        PromptType::Chat => validate_chat_payload(payload),
    }
}

fn validate_chat_payload(payload: &Value) -> Result<(), PromptError> {
    let Some(messages) = payload.as_array() else {
        return Err(PromptError::InvalidPayload(
            "chat payload must be an array".to_string(),
        ));
    };
    if messages.is_empty() {
        return Err(PromptError::InvalidPayload(
            "chat payload must contain at least one message".to_string(),
        ));
    }
    for message in messages {
        let Some(message) = message.as_object() else {
            return Err(PromptError::InvalidPayload(
                "chat messages must be objects".to_string(),
            ));
        };
        if message.len() != 2
            || message
                .get("role")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            || message
                .get("content")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
        {
            return Err(PromptError::InvalidPayload(
                "chat messages require exactly non-empty role and content strings".to_string(),
            ));
        }
    }
    Ok(())
}

pub fn content_hash(payload: &Value, config: &PromptConfig) -> String {
    infra::idempotency::canonical_sha256(&json!({
        "payload": payload,
        "config": config.normalized_value(),
    }))
}

pub fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn config_from_request_value(value: Value) -> Result<PromptConfig, PromptError> {
    if contains_provider(&value) {
        return Err(PromptError::ProviderNotAllowed);
    }
    serde_json::from_value(value).map_err(|error| PromptError::InvalidConfig(error.to_string()))
}

pub fn config_from_value(value: Value) -> Result<PromptConfig, PromptError> {
    if contains_provider(&value) {
        return Err(PromptError::ProviderNotAllowed);
    }
    serde_json::from_value(value).map_err(|error| PromptError::InvalidStoredData(error.to_string()))
}

fn contains_provider(value: &Value) -> bool {
    value.as_object().is_some_and(|config| {
        config.contains_key("provider_id") || config.contains_key("providerId")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_content_hash_excludes_metadata_and_normalizes_config_nulls() {
        let config = PromptConfig {
            model: Some("gpt".to_string()),
            params: Some(json!({"temperature": 0.2, "top_p": 1})),
            ..Default::default()
        };
        let left = content_hash(&json!("Hello {{name}}"), &config);
        let reordered = PromptConfig {
            params: Some(json!({"top_p": 1, "temperature": 0.2})),
            model: Some("gpt".to_string()),
            tools: None,
            response_format: None,
        };
        assert_eq!(left, content_hash(&json!("Hello {{name}}"), &reordered));
        assert_ne!(left, content_hash(&json!("Goodbye {{name}}"), &config));
    }

    #[test]
    fn normalized_config_round_trips_through_storage() {
        let config = PromptConfig {
            model: Some("gpt".to_string()),
            params: Some(json!({"temperature": 0.2})),
            tools: Some(json!([{"type": "function"}])),
            response_format: Some(json!({"type": "json_object"})),
        };

        assert_eq!(
            config_from_value(config.normalized_value()).unwrap(),
            config
        );
    }

    #[test]
    fn payload_type_and_provider_are_enforced_at_the_boundary() {
        assert!(validate_payload(PromptType::Text, &json!("hello")).is_ok());
        assert!(validate_payload(PromptType::Text, &json!(["hello"])).is_err());
        assert!(
            validate_payload(
                PromptType::Chat,
                &json!([{"role": "user", "content": "hello"}])
            )
            .is_ok()
        );
        assert!(
            config_from_value(json!({
                "model": "gpt",
                "provider_id": "must-not-persist"
            }))
            .is_err()
        );
    }

    #[test]
    fn names_labels_and_commits_follow_registry_contract() {
        assert_eq!(validate_prompt_name("support_bot").unwrap(), "support_bot");
        assert!(validate_prompt_name("Support/Bot").is_err());
        assert_eq!(validate_label(" candidate ").unwrap(), "candidate");
        assert!(validate_label("bad/label").is_err());
        assert_eq!(validate_commit_message(" initial ").unwrap(), "initial");
        assert!(validate_commit_message("  ").is_err());
    }
}
