// Copyright 2025 OpenObserve Inc.
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

use std::sync::Arc;

use config::utils::json;

use crate::{common::infra::config::REALTIME_ALERT_TRIGGERS, service::db};

// Parses the item key from the event key and extracts org_id and module_key
fn parse_item_key(key_prefix: &str, event_key: &str) -> (String, String, String) {
    let item_key = event_key
        .strip_prefix(key_prefix)
        .map_or_else(String::new, |s| s.to_string());
    let (org_id, module_key) = item_key.split_once('/').map_or_else(
        || ("".to_string(), "".to_string()),
        |(org, module)| (org.to_string(), module.to_string()),
    );
    (item_key, org_id, module_key)
}

// Handles old format to new format conversion if needed
async fn handle_format_conversion(
    mut item_key: String,
    org_id: &str,
    module_key: &str,
) -> Result<(String, String), anyhow::Error> {
    if module_key.contains('/') {
        // Old format: extract stream_type, stream_name, alert_name
        let parts = module_key.split('/').collect::<Vec<&str>>();
        if parts.len() >= 3 {
            let stream_type = parts[0];
            let stream_name = parts[1];
            let alert_name = parts[2];

            let alert =
                db::alerts::alert::get_by_name(org_id, stream_type.into(), stream_name, alert_name)
                    .await?;
            if let Some(alert) = alert
                && let Some(id) = alert.id
            {
                let alert_id = id.to_string();
                item_key = format!("{}/{}", org_id, &alert_id);
                return Ok((item_key, alert_id));
            }
            return Err(anyhow::anyhow!("Failed to get alert ID for old format"));
        }
        return Err(anyhow::anyhow!("Invalid module key format"));
    }
    // New format: item key does not need to be changed
    Ok((item_key, module_key.to_string()))
}

// Watches only for realtime alert triggers
pub async fn watch() -> Result<(), anyhow::Error> {
    let key = format!(
        "{}{}/",
        db::scheduler::TRIGGERS_KEY,
        db::scheduler::TriggerModule::Alert
    );
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(&key).await?;
    let events = Arc::get_mut(&mut events)
        .ok_or_else(|| anyhow::anyhow!("Failed to get mutable reference to events"))?;
    log::info!("Start watching alert realtime triggers");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_realtime_triggers: event channel closed");
                break;
            }
        };
        match ev {
            // Cluster coordinator sends put events only for realtime alerts
            db::Event::Put(ev) => {
                // Parse the item key and extract components
                let (mut item_key, org_id, module_key) = parse_item_key(&key, &ev.key);

                // Handle format conversion
                let (updated_item_key, alert_id) =
                    match handle_format_conversion(item_key, &org_id, &module_key).await {
                        Ok(result) => result,
                        Err(e) => {
                            log::error!("Error handling format conversion: {e}");
                            continue;
                        }
                    };
                item_key = updated_item_key;

                // Get or parse the trigger value
                let item_value: db::scheduler::Trigger =
                    if ev.value.is_none() || ev.value.as_ref().unwrap().is_empty() {
                        match db::scheduler::get(
                            &org_id,
                            config::meta::triggers::TriggerModule::Alert,
                            &alert_id,
                        )
                        .await
                        {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {e}");
                                continue;
                            }
                        }
                    } else {
                        match json::from_slice(&ev.value.unwrap()) {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error parsing trigger value: {e}");
                                continue;
                            }
                        }
                    };

                REALTIME_ALERT_TRIGGERS
                    .write()
                    .await
                    .insert(item_key, item_value);
            }
            db::Event::Delete(ev) => {
                // Parse the item key and extract components
                let (item_key, org_id, module_key) = parse_item_key(&key, &ev.key);

                // Handle format conversion
                let (updated_item_key, _) =
                    match handle_format_conversion(item_key, &org_id, &module_key).await {
                        Ok(result) => result,
                        Err(e) => {
                            log::error!("Error handling format conversion: {e}");
                            continue;
                        }
                    };

                REALTIME_ALERT_TRIGGERS
                    .write()
                    .await
                    .remove(&updated_item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let triggers = db::scheduler::list(Some(db::scheduler::TriggerModule::Alert)).await?;
    let mut cache = REALTIME_ALERT_TRIGGERS.write().await;
    for trigger in triggers {
        if trigger.is_realtime {
            cache.insert(format!("{}/{}", trigger.org, trigger.module_key), trigger);
        }
    }
    log::info!("Alert realtime triggers Cached");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_item_key() {
        let key_prefix = "alerts/";
        let event_key = "alerts/123/456";
        let (item_key, org_id, module_key) = parse_item_key(key_prefix, event_key);
        assert_eq!(item_key, "123/456");
        assert_eq!(org_id, "123");
        assert_eq!(module_key, "456");
    }

    #[tokio::test]
    async fn test_handle_format_conversion() {
        let item_key = "alerts/123/456".to_string();
        let org_id = "123".to_string();
        let module_key = "456".to_string();
        let (updated_item_key, alert_id) = handle_format_conversion(item_key, &org_id, &module_key)
            .await
            .unwrap();
        assert_eq!(updated_item_key, "alerts/123/456".to_string());
        assert_eq!(alert_id, "456".to_string());
    }
}
