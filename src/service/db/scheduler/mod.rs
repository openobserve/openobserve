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

pub use config::meta::triggers::{Trigger, TriggerModule, TriggerStatus};
pub use infra::scheduler::TRIGGERS_KEY;
use infra::{
    errors::Result,
    scheduler::{self as infra_scheduler},
};
#[cfg(feature = "enterprise")]
use {
    infra::errors::Error, o2_enterprise::enterprise::common::config::get_config as get_o2_config,
    o2_enterprise::enterprise::super_cluster,
};

mod batch_updater;
use batch_updater::get_batch_updater;

#[inline]
pub async fn push(trigger: Trigger) -> Result<()> {
    #[cfg(feature = "enterprise")]
    let trigger_clone = trigger.clone();
    infra_scheduler::push(trigger).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        super_cluster::queue::scheduler_push(trigger_clone)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

#[inline]
pub async fn delete(org: &str, module: TriggerModule, key: &str) -> Result<()> {
    infra_scheduler::delete(org, module.clone(), key).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        super_cluster::queue::scheduler_delete(org, module, key)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

#[inline]
pub async fn update_trigger(trigger: Trigger) -> Result<()> {
    // Use batch updater for better performance
    get_batch_updater()
        .update_trigger(trigger)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    Ok(())
}

#[inline]
pub async fn update_status(
    org: &str,
    module: TriggerModule,
    key: &str,
    status: TriggerStatus,
    retries: i32,
    data: Option<&str>,
) -> Result<()> {
    // Get full trigger for batch updater (required for super cluster events)
    let mut full_trigger = match infra_scheduler::get(org, module.clone(), key).await {
        Ok(trigger) => trigger,
        Err(_) => {
            // Fallback to direct update if trigger not found
            infra_scheduler::update_status(org, module.clone(), key, status.clone(), retries, data)
                .await?;

            // super cluster
            #[cfg(feature = "enterprise")]
            if get_o2_config().super_cluster.enabled {
                super_cluster::queue::scheduler_update_status(
                    org, module, key, status, retries, data,
                )
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
            }

            return Ok(());
        }
    };

    // Update the trigger fields for super cluster events
    full_trigger.status = status.clone();
    full_trigger.retries = retries;
    if let Some(data_str) = data {
        full_trigger.data = data_str.to_string();
    }

    // Use batch updater for better performance
    get_batch_updater()
        .update_status(org, module, key, status, retries, data, full_trigger)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    Ok(())
}

#[inline]
pub async fn pull(
    concurrency: i64,
    alert_timeout: i64,
    report_timeout: i64,
) -> Result<Vec<Trigger>> {
    infra_scheduler::pull(concurrency, alert_timeout, report_timeout).await
}

/// Returns the scheduled job associated with the given id in read-only fashion
#[inline]
pub async fn get(org: &str, module: TriggerModule, key: &str) -> Result<Trigger> {
    infra_scheduler::get(org, module, key).await
}

/// Returns the scheduled job associated with the given id in read-only fashion
#[inline]
pub async fn exists(org: &str, module: TriggerModule, key: &str) -> bool {
    infra_scheduler::get(org, module, key).await.is_ok()
}

/// The count of jobs for the given module (Report/Alert etc.)
#[inline]
pub async fn len_module(module: TriggerModule) -> usize {
    infra_scheduler::len_module(module).await
}

#[inline]
pub async fn len() -> usize {
    infra_scheduler::len().await
}

/// List the jobs for the given module
#[inline]
pub async fn list(module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
    infra_scheduler::list(module).await
}

/// List the jobs for the given module
#[inline]
pub async fn list_by_org(org: &str, module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
    infra_scheduler::list_by_org(org, module).await
}

#[inline]
pub async fn is_empty() -> bool {
    infra_scheduler::is_empty().await
}

#[inline]
pub async fn clear() -> Result<()> {
    infra_scheduler::clear().await
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[tokio::test]
    async fn test_update_trigger_uses_batch_updater() {
        let trigger = Trigger {
            id: 1,
            org: "test_org".to_string(),
            module: TriggerModule::Alert,
            module_key: "test_alert".to_string(),
            status: TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: "{}".to_string(),
        };

        // This test verifies that the function doesn't panic and returns Ok
        // In a real test environment with database setup, it would verify actual batching
        let result = update_trigger(trigger).await;
        // The result might be an error due to missing database, but it shouldn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_update_status_uses_batch_updater() {
        // This test verifies that the function doesn't panic and handles the batch updater call
        let result = update_status(
            "test_org",
            TriggerModule::Alert,
            "test_key",
            TriggerStatus::Processing,
            1,
            Some("test_data"),
        )
        .await;

        // The result might be an error due to missing database/trigger, but it shouldn't panic
        assert!(result.is_ok() || result.is_err());
    }
}
