// Copyright 2026 OpenObserve Inc.

use std::collections::BTreeSet;

use config::meta::system_settings::{SettingScope, SystemSetting};
use infra::secrets::{self, SecretMaterial, SecretOwnerKind, SecretPurpose, WrittenSecret};
use serde::{Deserialize, Serialize};

use crate::system_settings;

pub const PROMPT_SETTINGS_PREFIX: &str = "prompt_settings/";

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptWebhookEvent {
    VersionCreated,
    LabelMoved,
    LabelDeleted,
    Archived,
}

impl PromptWebhookEvent {
    pub fn as_event_type(&self) -> &'static str {
        match self {
            Self::VersionCreated => "prompt.version.created",
            Self::LabelMoved => "prompt.label.moved",
            Self::LabelDeleted => "prompt.label.deleted",
            Self::Archived => "prompt.archived",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptWebhookSettings {
    pub endpoint: String,
    #[serde(default)]
    pub events: BTreeSet<PromptWebhookEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSettings {
    #[serde(default = "default_protected_labels")]
    pub protected_labels: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook: Option<PromptWebhookSettings>,
}

fn default_protected_labels() -> BTreeSet<String> {
    BTreeSet::from(["production".to_string()])
}

impl Default for PromptSettings {
    fn default() -> Self {
        Self {
            protected_labels: default_protected_labels(),
            webhook: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PromptSettingsError {
    #[error("prompt settings storage failed: {0}")]
    Storage(#[from] infra::errors::Error),
    #[error("prompt settings are malformed: {0}")]
    Malformed(#[from] serde_json::Error),
    #[error("prompt webhook secret operation failed: {0}")]
    Secret(#[from] secrets::SecretError),
    #[error("prompt webhook signing material is not a token")]
    InvalidSecretMaterial,
    #[error("prompt webhook has no signing secret configured")]
    SecretNotConfigured,
}

pub fn key(org_id: &str) -> String {
    format!("{PROMPT_SETTINGS_PREFIX}{org_id}")
}

pub async fn get(org_id: &str) -> Result<PromptSettings, PromptSettingsError> {
    let Some(setting) =
        system_settings::get(&SettingScope::Org, Some(org_id), None, &key(org_id)).await?
    else {
        return Ok(PromptSettings::default());
    };
    Ok(serde_json::from_value(setting.setting_value)?)
}

pub async fn set(
    org_id: &str,
    actor: &str,
    mut settings: PromptSettings,
) -> Result<PromptSettings, PromptSettingsError> {
    settings.protected_labels = settings
        .protected_labels
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty() && label != "latest")
        .collect();
    if settings.protected_labels.is_empty() {
        settings.protected_labels = default_protected_labels();
    }
    if let Some(webhook) = settings.webhook.as_mut() {
        webhook.endpoint = webhook.endpoint.trim().to_string();
    }

    let mut setting = SystemSetting::new_org(org_id, key(org_id), serde_json::to_value(&settings)?);
    setting.setting_category = Some("prompts".to_string());
    setting.description = Some("Prompt registry label and webhook settings".to_string());
    setting.created_by = Some(actor.to_string());
    setting.updated_by = Some(actor.to_string());
    system_settings::set(&setting).await?;
    Ok(settings)
}

pub async fn set_webhook_secret(
    org_id: &str,
    actor: &str,
    value: String,
) -> Result<WrittenSecret, PromptSettingsError> {
    let material = SecretMaterial::Token { value };
    let mut settings = get(org_id).await?;
    let webhook = settings
        .webhook
        .as_mut()
        .ok_or(PromptSettingsError::SecretNotConfigured)?;

    if let Some(secret_ref) = webhook.secret_ref.as_deref() {
        let metadata = secrets::replace_current(
            org_id,
            SecretOwnerKind::PromptWebhook,
            org_id,
            secret_ref,
            SecretPurpose::SigningToken,
            material.clone(),
        )
        .await?;
        return Ok(WrittenSecret { metadata, material });
    }

    let written = secrets::create(
        org_id,
        SecretOwnerKind::PromptWebhook,
        org_id,
        SecretPurpose::SigningToken,
        None,
        material,
    )
    .await?;
    webhook.secret_ref = Some(written.metadata.secret_ref.clone());
    if let Err(error) = set(org_id, actor, settings).await {
        let _ = secrets::revoke(
            org_id,
            SecretOwnerKind::PromptWebhook,
            org_id,
            &written.metadata.secret_ref,
        )
        .await;
        return Err(error);
    }
    Ok(written)
}

pub async fn resolve_webhook_secret(org_id: &str) -> Result<Vec<u8>, PromptSettingsError> {
    let settings = get(org_id).await?;
    let secret_ref = settings
        .webhook
        .and_then(|webhook| webhook.secret_ref)
        .ok_or(PromptSettingsError::SecretNotConfigured)?;
    let (_, material) = secrets::resolve_record(
        org_id,
        &secret_ref,
        SecretOwnerKind::PromptWebhook,
        org_id,
        secrets::CURRENT,
    )
    .await?;
    match material {
        SecretMaterial::Token { value } => Ok(value.into_bytes()),
        SecretMaterial::Basic { .. } => Err(PromptSettingsError::InvalidSecretMaterial),
    }
}

pub async fn delete_webhook_secret(org_id: &str) -> Result<u64, PromptSettingsError> {
    Ok(secrets::delete_for_owner(org_id, SecretOwnerKind::PromptWebhook, org_id).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_protect_production_but_latest_is_not_configurable() {
        let settings = PromptSettings::default();
        assert!(settings.protected_labels.contains("production"));
        assert!(!settings.protected_labels.contains("latest"));
        assert_eq!(key("acme"), "prompt_settings/acme");
    }

    #[test]
    fn webhook_event_names_are_stable() {
        assert_eq!(
            PromptWebhookEvent::VersionCreated.as_event_type(),
            "prompt.version.created"
        );
        assert_eq!(
            PromptWebhookEvent::LabelMoved.as_event_type(),
            "prompt.label.moved"
        );
        assert_eq!(
            PromptWebhookEvent::LabelDeleted.as_event_type(),
            "prompt.label.deleted"
        );
        assert_eq!(
            PromptWebhookEvent::Archived.as_event_type(),
            "prompt.archived"
        );
    }
}
