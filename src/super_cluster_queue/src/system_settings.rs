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

//! Applies replicated org-scope system settings, never publishing them back.

use bytes::Bytes;
use common::infra::config::SYSTEM_SETTINGS;
use config::meta::system_settings::{SettingScope, SystemSetting};
use infra::{errors::Result, table::system_settings as db};
use o2_enterprise::enterprise::super_cluster::queue::Message;

const SYSTEM_SETTINGS_WATCHER_PREFIX: &str = "/system_settings/";
// Must match db::system_settings::REPLICATED_SYSTEM_SETTING_KEYS.
const REPLICATED_SYSTEM_SETTING_KEYS: [&str; 2] =
    ["default_alert_destination", "default_alert_template"];

fn is_replicated_setting_key(key: &str) -> bool {
    REPLICATED_SYSTEM_SETTING_KEYS.contains(&key)
}

fn payload_matches_routing_key(org_id: &str, setting_key: &str, setting: &SystemSetting) -> bool {
    setting.scope == SettingScope::Org
        && setting.org_id.as_deref() == Some(org_id)
        && setting.setting_key == setting_key
}

fn cache_key(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> String {
    let org = org_id.unwrap_or("_");
    let user = user_id.unwrap_or("_");
    format!("{}:{}:{}:{}", scope.as_str(), org, user, key)
}

fn parse_key(key: &str) -> Result<(String, String)> {
    let rest = key
        .strip_prefix(SYSTEM_SETTINGS_WATCHER_PREFIX)
        .ok_or_else(|| {
            infra::errors::Error::Message(format!("invalid system_settings key: {key}"))
        })?;
    let (org_id, setting_key) = rest.split_once('/').ok_or_else(|| {
        infra::errors::Error::Message(format!("invalid system_settings key: {key}"))
    })?;
    if org_id.is_empty() || setting_key.is_empty() {
        return Err(infra::errors::Error::Message(format!(
            "invalid system_settings key: {key}"
        )));
    }
    Ok((org_id.to_string(), setting_key.to_string()))
}

pub(crate) async fn process(msg: Message) -> Result<()> {
    let (org_id, setting_key) = parse_key(&msg.key)?;
    if !is_replicated_setting_key(&setting_key) {
        log::debug!("[SUPER_CLUSTER:system_settings] ignoring non-replicated key {setting_key}");
        return Ok(());
    }
    match msg.value {
        Some(value) => apply_put(value, &org_id, &setting_key).await,
        None => apply_delete(&org_id, &setting_key).await,
    }
}

async fn apply_put(value: Bytes, org_id: &str, setting_key: &str) -> Result<()> {
    let setting: SystemSetting = serde_json::from_slice(&value).map_err(|e| {
        infra::errors::Error::Message(format!(
            "failed to deserialize replicated system setting: {e}"
        ))
    })?;
    if !payload_matches_routing_key(org_id, setting_key, &setting) {
        log::error!(
            "[SUPER_CLUSTER:system_settings] rejecting mismatched put: routed /{org_id}/{setting_key}, payload scope={} org={:?} key={}",
            setting.scope.as_str(),
            setting.org_id,
            setting.setting_key
        );
        return Ok(());
    }
    let written = db::set(&setting)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    let cache_k = cache_key(
        &written.scope,
        written.org_id.as_deref(),
        written.user_id.as_deref(),
        &written.setting_key,
    );
    SYSTEM_SETTINGS
        .write()
        .await
        .insert(cache_k.clone(), written);
    let event_key = format!("{SYSTEM_SETTINGS_WATCHER_PREFIX}{cache_k}");
    if let Err(e) = infra::coordinator::emit_put(&event_key).await {
        log::error!("Failed to emit replicated system settings put event: {e}");
    }
    Ok(())
}

async fn apply_delete(org_id: &str, setting_key: &str) -> Result<()> {
    db::delete(&SettingScope::Org, Some(org_id), None, setting_key)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    let cache_k = cache_key(&SettingScope::Org, Some(org_id), None, setting_key);
    SYSTEM_SETTINGS.write().await.remove(&cache_k);
    let event_key = format!("{SYSTEM_SETTINGS_WATCHER_PREFIX}{cache_k}");
    if let Err(e) = infra::coordinator::emit_delete(&event_key).await {
        log::error!("Failed to emit replicated system settings delete event: {e}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::MessageType;

    use super::*;

    #[test]
    fn replicated_setting_key_allow_list() {
        assert!(is_replicated_setting_key("default_alert_destination"));
        assert!(is_replicated_setting_key("default_alert_template"));
        assert!(!is_replicated_setting_key("semantic_field_groups"));
        assert!(!is_replicated_setting_key("theme"));
        assert!(!is_replicated_setting_key(""));
    }

    #[test]
    fn parses_system_settings_key() {
        assert_eq!(
            parse_key("/system_settings/org-1/default_alert_destination").unwrap(),
            ("org-1".to_string(), "default_alert_destination".to_string())
        );
        assert!(parse_key("/system_settings/org-1").is_err());
        assert!(parse_key("/other/org-1/key").is_err());
        assert!(parse_key("/system_settings/org-1/").is_err());
    }

    #[test]
    fn put_payload_must_match_routing_key() {
        let matching =
            SystemSetting::new_org("org-1", "default_alert_destination", serde_json::json!({}));
        assert!(payload_matches_routing_key(
            "org-1",
            "default_alert_destination",
            &matching
        ));
        assert!(!payload_matches_routing_key(
            "org-1",
            "default_alert_destination",
            &SystemSetting::new_system("default_alert_destination", serde_json::json!({}))
        ));
        assert!(!payload_matches_routing_key(
            "org-1",
            "default_alert_destination",
            &SystemSetting::new_org("org-2", "default_alert_destination", serde_json::json!({}))
        ));
        assert!(!payload_matches_routing_key(
            "org-1",
            "default_alert_destination",
            &SystemSetting::new_org("org-1", "password_policy", serde_json::json!({}))
        ));
    }

    #[tokio::test]
    async fn ignores_keys_outside_the_allow_list() {
        let msg = Message::new(
            "/system_settings/org-1/semantic_field_groups".to_string(),
            Some(Bytes::from_static(br#"{}"#)),
            None,
            false,
            MessageType::SystemSettingsTable,
        );
        assert!(process(msg).await.is_ok());
    }
}
