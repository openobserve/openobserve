// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use async_trait::async_trait;
use config::meta::self_reporting::usage::TriggerData;

pub mod grpc {
    pub use openobserve_ingestion::grpc::*;
}
pub mod ingestion_service;

pub use openobserve_ingestion::service::*;
pub use openobserve_transform::{
    JSRuntimeConfig, apply_js_fn, apply_vrl_fn, compile_js_function, compile_vrl_function,
    init_vrl_runtime as init_functions_runtime,
};

struct CoreIngestionRuntime;

#[async_trait]
impl openobserve_ingestion::ports::RuntimeServices for CoreIngestionRuntime {
    fn publish_trigger_usage(&self, trigger: TriggerData) {
        crate::self_reporting::publish_triggers_usage(trigger);
    }

    #[cfg(feature = "cloud")]
    async fn is_org_in_free_trial_period(&self, org_id: &str) -> infra::errors::Result<bool> {
        crate::organization::is_org_in_free_trial_period(org_id).await
    }
}

pub fn install_runtime_services() {
    let _ = openobserve_ingestion::ports::install_runtime_services(Arc::new(CoreIngestionRuntime));
}
