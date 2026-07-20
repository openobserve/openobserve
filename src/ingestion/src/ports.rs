// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use config::meta::self_reporting::usage::TriggerData;

#[async_trait]
pub trait RuntimeServices: Send + Sync + 'static {
    fn publish_trigger_usage(&self, trigger: TriggerData);

    #[cfg(feature = "cloud")]
    async fn is_org_in_free_trial_period(&self, org_id: &str) -> infra::errors::Result<bool>;
}

static RUNTIME_SERVICES: OnceLock<Arc<dyn RuntimeServices>> = OnceLock::new();

pub fn install_runtime_services(
    services: Arc<dyn RuntimeServices>,
) -> Result<(), Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.set(services)
}

pub fn publish_trigger_usage(trigger: TriggerData) {
    if let Some(runtime) = RUNTIME_SERVICES.get() {
        runtime.publish_trigger_usage(trigger);
    } else {
        log::error!("ingestion runtime services are not installed");
    }
}

#[cfg(feature = "cloud")]
pub async fn is_org_in_free_trial_period(org_id: &str) -> infra::errors::Result<bool> {
    match RUNTIME_SERVICES.get() {
        Some(runtime) => runtime.is_org_in_free_trial_period(org_id).await,
        None => Err(infra::errors::Error::Message(
            "ingestion runtime services are not installed".to_string(),
        )),
    }
}
