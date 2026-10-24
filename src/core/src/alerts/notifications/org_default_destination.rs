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

//! Per-org default alert destination, stored in system_settings v2 as `{"destination": "<name>"}`.

use config::meta::{
    destinations::{Destination, Module},
    system_settings::{SettingScope, SystemSetting},
};
use db::system_settings;

pub const DEFAULT_ALERT_DESTINATION_KEY: &str = "default_alert_destination";
pub const DEFAULT_ALERT_DESTINATION_CATEGORY: &str = "alerts";

/// Extract the destination name from a stored setting value; an empty string is absent.
pub fn pointer_from_value(v: &serde_json::Value) -> Option<String> {
    v.get("destination")
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Only alert destinations can be the default; pipeline destinations never notify.
pub fn is_alert_destination(destination: &Destination) -> bool {
    matches!(destination.module, Module::Alert { .. })
}

/// The org's default destination, or `None` when unset or naming a destination that is gone.
pub async fn get_org_default_destination(org_id: &str) -> Option<String> {
    let name = read_pointer(org_id).await?;
    match db::alerts::destinations::get(org_id, &name).await {
        Ok(destination) if is_alert_destination(&destination) => Some(name),
        _ => None,
    }
}

/// Remove the org's pointer when it names `destination`; `Ok(false)` means it named another one.
pub async fn clear_if_points_to(org_id: &str, destination: &str) -> Result<bool, anyhow::Error> {
    let Some(setting) = read_setting(org_id).await else {
        return Ok(false);
    };
    if pointer_from_value(&setting.setting_value).as_deref() != Some(destination) {
        return Ok(false);
    }
    // Conditional on the row version read here, so a pointer changed meanwhile survives.
    Ok(system_settings::delete_if_unchanged(&setting).await?)
}

async fn read_pointer(org_id: &str) -> Option<String> {
    read_setting(org_id)
        .await
        .and_then(|setting| pointer_from_value(&setting.setting_value))
}

async fn read_setting(org_id: &str) -> Option<SystemSetting> {
    match system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        DEFAULT_ALERT_DESTINATION_KEY,
    )
    .await
    {
        Ok(setting) => setting,
        Err(e) => {
            log::error!(
                "[DESTINATIONS] read default_alert_destination failed for org {org_id}: {e}"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{DestinationType, Endpoint};

    use super::*;

    fn destination(org_id: &str, name: &str, module: Module) -> Destination {
        Destination {
            id: None,
            org_id: org_id.to_string(),
            name: name.to_string(),
            module,
        }
    }

    fn alert_module() -> Module {
        Module::Alert {
            template: None,
            destination_type: DestinationType::Http(Endpoint::default()),
        }
    }

    fn pipeline_module() -> Module {
        Module::Pipeline {
            endpoint: Endpoint::default(),
        }
    }

    fn seed_destination(org_id: &str, name: &str, module: Module) {
        common::infra::config::DESTINATIONS.insert(
            format!("{org_id}/{name}"),
            destination(org_id, name, module),
        );
    }

    async fn seed_pointer(org_id: &str, name: &str) {
        let setting = SystemSetting {
            id: Some(1),
            ..SystemSetting::new_org(
                org_id,
                DEFAULT_ALERT_DESTINATION_KEY,
                serde_json::json!({ "destination": name }),
            )
        };
        common::infra::config::SYSTEM_SETTINGS.write().await.insert(
            format!("org:{org_id}:_:{DEFAULT_ALERT_DESTINATION_KEY}"),
            setting,
        );
    }

    async fn stored_pointer(org_id: &str) -> Option<String> {
        system_settings::get_cached(
            &SettingScope::Org,
            Some(org_id),
            None,
            DEFAULT_ALERT_DESTINATION_KEY,
        )
        .await
        .and_then(|s| pointer_from_value(&s.setting_value))
    }

    #[test]
    fn pointer_from_value_reads_the_destination_name() {
        assert_eq!(
            pointer_from_value(&serde_json::json!({"destination": "ops-slack"})),
            Some("ops-slack".into())
        );
        assert_eq!(
            pointer_from_value(&serde_json::json!({"destination": ""})),
            None
        );
        assert_eq!(
            pointer_from_value(&serde_json::json!({"destination": 3})),
            None
        );
        assert_eq!(pointer_from_value(&serde_json::json!({})), None);
        assert_eq!(pointer_from_value(&serde_json::json!("ops-slack")), None);
    }

    #[test]
    fn only_alert_destinations_qualify() {
        assert!(is_alert_destination(&destination("o", "a", alert_module())));
        assert!(!is_alert_destination(&destination(
            "o",
            "p",
            pipeline_module()
        )));
    }

    #[tokio::test]
    async fn reader_returns_a_pointer_to_an_existing_alert_destination() {
        let org = "default-dest-reader-ok";
        seed_destination(org, "ops-slack", alert_module());
        seed_pointer(org, "ops-slack").await;
        assert_eq!(
            get_org_default_destination(org).await,
            Some("ops-slack".into())
        );
    }

    #[tokio::test]
    async fn reader_treats_a_pipeline_target_as_unset() {
        let org = "default-dest-reader-pipeline";
        seed_destination(org, "to-s3", pipeline_module());
        seed_pointer(org, "to-s3").await;
        assert_eq!(get_org_default_destination(org).await, None);
    }

    #[tokio::test]
    async fn reader_treats_a_missing_destination_as_unset() {
        let org = "default-dest-reader-missing";
        seed_pointer(org, "deleted-dest").await;
        assert_eq!(get_org_default_destination(org).await, None);
    }

    #[tokio::test]
    async fn clear_removes_a_pointer_to_the_deleted_destination() {
        let org = "default-dest-clear-match";
        seed_pointer(org, "ops-slack").await;
        // Unit tests have no metadata DB, so a delete that was attempted surfaces as Err.
        assert!(!matches!(
            clear_if_points_to(org, "ops-slack").await,
            Ok(false)
        ));
    }

    #[tokio::test]
    async fn clear_leaves_a_pointer_to_another_destination_alone() {
        let org = "default-dest-clear-other";
        seed_pointer(org, "ops-slack").await;
        assert!(!clear_if_points_to(org, "ops-email").await.unwrap());
        assert_eq!(stored_pointer(org).await, Some("ops-slack".into()));
    }

    #[tokio::test]
    async fn clear_leaves_another_orgs_pointer_alone() {
        let (org, other) = ("default-dest-clear-org-a", "default-dest-clear-org-b");
        seed_pointer(other, "ops-slack").await;
        assert!(!clear_if_points_to(org, "ops-slack").await.unwrap());
        assert_eq!(stored_pointer(other).await, Some("ops-slack".into()));
    }
}
