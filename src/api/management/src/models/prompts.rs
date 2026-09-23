// Copyright 2026 OpenObserve Inc.

use std::collections::BTreeSet;

use openobserve_core::prompts as core;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePromptRequestBody {
    pub name: String,
    #[serde(default)]
    pub folder_id: String,
    #[schema(value_type = String)]
    pub r#type: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub payload: Value,
    #[serde(default = "default_prompt_config")]
    #[schema(value_type = core::PromptConfig)]
    pub config: Value,
    pub commit_message: String,
    #[serde(default = "default_ui_source")]
    #[schema(value_type = String)]
    pub source: String,
}

fn default_ui_source() -> String {
    "ui".to_string()
}

fn default_prompt_config() -> Value {
    serde_json::json!({})
}

impl TryFrom<CreatePromptRequestBody> for core::CreatePrompt {
    type Error = core::PromptError;

    fn try_from(value: CreatePromptRequestBody) -> Result<Self, Self::Error> {
        Ok(Self {
            name: value.name,
            folder_id: value.folder_id,
            prompt_type: core::PromptType::try_from(value.r#type.as_str())?,
            description: value.description,
            tags: value.tags,
            payload: value.payload,
            config: core::config_from_request_value(value.config)?,
            commit_message: value.commit_message,
            source: core::PromptSource::try_from(value.source.as_str())?,
        })
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePromptVersionRequestBody {
    pub payload: Value,
    #[serde(default = "default_prompt_config")]
    #[schema(value_type = core::PromptConfig)]
    pub config: Value,
    pub commit_message: String,
    #[serde(default = "default_ui_source")]
    #[schema(value_type = String)]
    pub source: String,
    pub base_version: Option<i32>,
    pub base_hash: Option<String>,
}

impl CreatePromptVersionRequestBody {
    pub fn into_core(
        self,
        if_head: Option<i32>,
    ) -> Result<core::CreatePromptVersion, core::PromptError> {
        Ok(core::CreatePromptVersion {
            payload: self.payload,
            config: core::config_from_request_value(self.config)?,
            commit_message: self.commit_message,
            source: core::PromptSource::try_from(self.source.as_str())?,
            base_version: self.base_version,
            base_hash: self.base_hash,
            if_head,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePromptRequestBody {
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub folder_id: Option<String>,
}

impl From<UpdatePromptRequestBody> for core::UpdatePromptHead {
    fn from(value: UpdatePromptRequestBody) -> Self {
        Self {
            description: value.description,
            tags: value.tags,
            folder_id: value.folder_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovePromptLabelRequestBody {
    pub version: i32,
    pub if_version: Option<i32>,
}

impl From<MovePromptLabelRequestBody> for core::MovePromptLabel {
    fn from(value: MovePromptLabelRequestBody) -> Self {
        Self {
            version: value.version,
            if_version: value.if_version,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletePromptLabelRequestBody {
    pub if_version: Option<i32>,
}

impl From<DeletePromptLabelRequestBody> for core::DeletePromptLabel {
    fn from(value: DeletePromptLabelRequestBody) -> Self {
        Self {
            if_version: value.if_version,
        }
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchPromptsRequestBody {
    #[schema(value_type = String)]
    pub r#type: String,
    pub payload: Value,
    #[serde(default = "default_prompt_config")]
    #[schema(value_type = core::PromptConfig)]
    pub config: Value,
}

impl MatchPromptsRequestBody {
    pub fn into_core(
        self,
    ) -> Result<(core::PromptType, Value, core::PromptConfig), core::PromptError> {
        Ok((
            core::PromptType::try_from(self.r#type.as_str())?,
            self.payload,
            core::config_from_request_value(self.config)?,
        ))
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptLabelResponseBody {
    pub name: String,
    pub version: Option<i32>,
    pub deleted_at: Option<i64>,
    pub updated_by: String,
    pub updated_at: i64,
}

impl From<core::PromptLabel> for PromptLabelResponseBody {
    fn from(value: core::PromptLabel) -> Self {
        Self {
            name: value.name,
            version: value.version,
            deleted_at: value.deleted_at,
            updated_by: value.updated_by,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponseBody {
    pub entity_id: String,
    pub name: String,
    pub folder_id: String,
    #[schema(value_type = String)]
    pub r#type: core::PromptType,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub status: String,
    pub latest_version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
    pub labels: Vec<PromptLabelResponseBody>,
}

impl From<core::Prompt> for PromptResponseBody {
    fn from(value: core::Prompt) -> Self {
        Self {
            entity_id: value.entity_id,
            name: value.name,
            folder_id: value.folder_id,
            r#type: value.prompt_type,
            description: value.description,
            tags: value.tags,
            status: value.status.as_str().to_string(),
            latest_version: value.latest_version,
            created_by: value.created_by,
            created_at: value.created_at,
            updated_by: value.updated_by,
            updated_at: value.updated_at,
            labels: value.labels.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptVersionResponseBody {
    pub id: String,
    pub entity_id: String,
    pub version: i32,
    pub payload: Value,
    pub config: core::PromptConfig,
    pub commit_message: String,
    #[schema(value_type = String)]
    pub source: core::PromptSource,
    pub base_version: Option<i32>,
    pub content_hash: String,
    pub created_by: String,
    pub created_at: i64,
}

impl From<core::PromptVersion> for PromptVersionResponseBody {
    fn from(value: core::PromptVersion) -> Self {
        Self {
            id: value.id,
            entity_id: value.entity_id,
            version: value.version,
            payload: value.payload,
            config: value.config,
            commit_message: value.commit_message,
            source: value.source,
            base_version: value.base_version,
            content_hash: value.content_hash,
            created_by: value.created_by,
            created_at: value.created_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptMutationResponseBody {
    pub prompt: PromptResponseBody,
    pub version: PromptVersionResponseBody,
    pub created: bool,
    pub replayed: bool,
}

impl From<core::PromptMutationResult> for PromptMutationResponseBody {
    fn from(value: core::PromptMutationResult) -> Self {
        Self {
            prompt: value.prompt.into(),
            version: value.version.into(),
            created: value.created,
            replayed: value.replayed,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPromptResponseBody {
    pub prompt: PromptResponseBody,
    pub version: PromptVersionResponseBody,
    pub label: Option<String>,
}

impl From<core::ResolvedPrompt> for ResolvedPromptResponseBody {
    fn from(value: core::ResolvedPrompt) -> Self {
        Self {
            prompt: value.prompt.into(),
            version: value.version.into(),
            label: value.label,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptActivityResponseBody {
    pub id: String,
    pub entity_id: String,
    pub label: String,
    pub from_version: Option<i32>,
    pub to_version: Option<i32>,
    pub actor: String,
    #[schema(value_type = String)]
    pub via: core::PromptSource,
    pub created_at: i64,
}

impl From<core::PromptActivity> for PromptActivityResponseBody {
    fn from(value: core::PromptActivity) -> Self {
        Self {
            id: value.id,
            entity_id: value.entity_id,
            label: value.label,
            from_version: value.from_version,
            to_version: value.to_version,
            actor: value.actor,
            via: value.via,
            created_at: value.created_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptsResponseBody {
    pub list: Vec<PromptResponseBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptVersionsResponseBody {
    pub versions: Vec<PromptVersionResponseBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptActivityResponseBody {
    pub activity: Vec<PromptActivityResponseBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptMatchResponseBody {
    pub id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchPromptsResponseBody {
    pub matches: Vec<PromptMatchResponseBody>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptWebhookSettingsRequestBody {
    pub endpoint: String,
    #[serde(default)]
    #[schema(value_type = Vec<String>)]
    pub events: BTreeSet<db::prompt_settings::PromptWebhookEvent>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptSettingsRequestBody {
    #[serde(default)]
    pub protected_labels: BTreeSet<String>,
    pub webhook: Option<PromptWebhookSettingsRequestBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptWebhookSettingsResponseBody {
    pub endpoint: String,
    #[schema(value_type = Vec<String>)]
    pub events: BTreeSet<db::prompt_settings::PromptWebhookEvent>,
    pub secret_configured: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSettingsResponseBody {
    pub protected_labels: BTreeSet<String>,
    pub webhook: Option<PromptWebhookSettingsResponseBody>,
}

impl From<db::prompt_settings::PromptSettings> for PromptSettingsResponseBody {
    fn from(value: db::prompt_settings::PromptSettings) -> Self {
        Self {
            protected_labels: value.protected_labels,
            webhook: value
                .webhook
                .map(|webhook| PromptWebhookSettingsResponseBody {
                    endpoint: webhook.endpoint,
                    events: webhook.events,
                    secret_configured: webhook.secret_ref.is_some(),
                }),
        }
    }
}

impl PromptSettingsRequestBody {
    pub fn into_settings(self, secret_ref: Option<String>) -> db::prompt_settings::PromptSettings {
        db::prompt_settings::PromptSettings {
            protected_labels: self.protected_labels,
            webhook: self
                .webhook
                .map(|webhook| db::prompt_settings::PromptWebhookSettings {
                    endpoint: webhook.endpoint,
                    events: webhook.events,
                    secret_ref,
                }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PromptSecretRequestBody {
    pub secret: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSecretResponseBody {
    pub secret_configured: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PromptErrorResponseBody {
    pub code: String,
    pub message: String,
}

#[cfg(test)]
mod request_deserialization_tests {
    use serde_json::json;

    use super::{CreatePromptRequestBody, CreatePromptVersionRequestBody, core};

    fn create_body(overrides: serde_json::Value) -> serde_json::Value {
        let mut body = json!({
            "name": "qa_prompt",
            "folderId": "default",
            "type": "text",
            "payload": "hello",
            "config": {},
            "commitMessage": "initial",
            "source": "ui"
        });
        body.as_object_mut()
            .unwrap()
            .extend(overrides.as_object().unwrap().clone());
        body
    }

    #[test]
    fn invalid_prompt_enums_reach_handler_validation() {
        for (overrides, expected) in [
            (json!({"type": "unknown"}), "type"),
            (json!({"source": "unknown"}), "source"),
        ] {
            let body = serde_json::from_value::<CreatePromptRequestBody>(create_body(overrides))
                .expect("unknown string values must reach Prompt validation");
            let error = core::CreatePrompt::try_from(body).unwrap_err();
            match expected {
                "type" => assert!(matches!(error, core::PromptError::InvalidPromptType)),
                "source" => assert!(matches!(error, core::PromptError::InvalidPromptSource)),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn forbidden_provider_fields_reach_handler_validation() {
        for field in ["providerId", "provider_id"] {
            let body = create_body(json!({"config": {field: "provider-1"}}));
            let body = serde_json::from_value::<CreatePromptRequestBody>(body)
                .expect("forbidden provider fields must reach Prompt validation");
            assert!(matches!(
                core::CreatePrompt::try_from(body),
                Err(core::PromptError::ProviderNotAllowed)
            ));

            let version = json!({
                "payload": "changed",
                "config": {field: "provider-1"},
                "commitMessage": "change",
                "source": "ui"
            });
            let version = serde_json::from_value::<CreatePromptVersionRequestBody>(version)
                .expect("forbidden provider fields must reach version validation");
            assert!(matches!(
                version.into_core(None),
                Err(core::PromptError::ProviderNotAllowed)
            ));
        }
    }
}
