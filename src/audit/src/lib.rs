// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#![cfg(feature = "enterprise")]

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use config::{META_ORG_ID, spawn_pausable_job};
pub use o2_enterprise::enterprise::common::auditor;
use proto::cluster_rpc;

#[async_trait]
pub trait AuditPublisher: Send + Sync + 'static {
    async fn publish(
        &self,
        request: cluster_rpc::IngestionRequest,
    ) -> Result<cluster_rpc::IngestionResponse, anyhow::Error>;
}

static AUDIT_PUBLISHER: OnceLock<Arc<dyn AuditPublisher>> = OnceLock::new();

pub fn set_audit_publisher(
    publisher: Arc<dyn AuditPublisher>,
) -> Result<(), Arc<dyn AuditPublisher>> {
    AUDIT_PUBLISHER.set(publisher)
}

async fn publish_audit(
    request: cluster_rpc::IngestionRequest,
) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
    let publisher = AUDIT_PUBLISHER
        .get()
        .ok_or_else(|| anyhow::anyhow!("audit publisher is not initialized"))?;
    publisher.publish(request).await
}

pub async fn audit(message: auditor::AuditMessage) {
    auditor::audit(META_ORG_ID, message, publish_audit).await;
}

pub async fn flush() {
    auditor::flush_audit(META_ORG_ID, publish_audit).await;
}

pub fn run_publish_job() -> Option<tokio::task::JoinHandle<()>> {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    if !cfg.common.audit_enabled {
        return None;
    }

    Some(spawn_pausable_job!(
        "audit_publish",
        cfg.common.audit_publish_interval,
        {
            log::debug!("Audit ingestion loop running");
            auditor::publish_existing_audits(META_ORG_ID, publish_audit).await;
        },
        pause_if: cfg.common.audit_publish_interval == 0
            || !o2_enterprise::enterprise::common::config::get_config()
                .common
                .audit_enabled
    ))
}
