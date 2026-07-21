// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#[cfg(feature = "enterprise")]
mod enterprise {
    use std::{future::Future, pin::Pin, sync::OnceLock};

    use config::{META_ORG_ID, spawn_pausable_job};
    pub use o2_enterprise::enterprise::common::auditor;
    use proto::cluster_rpc;

    pub type AuditPublishFuture = Pin<
        Box<
            dyn Future<Output = Result<cluster_rpc::IngestionResponse, anyhow::Error>>
                + Send
                + 'static,
        >,
    >;
    pub type AuditPublisher = fn(cluster_rpc::IngestionRequest) -> AuditPublishFuture;

    static AUDIT_PUBLISHER: OnceLock<AuditPublisher> = OnceLock::new();

    pub fn set_audit_publisher(publisher: AuditPublisher) {
        if AUDIT_PUBLISHER.set(publisher).is_err() {
            log::warn!("[AUDIT-SERVICE] audit publisher was already initialized");
        }
    }

    async fn publish_audit(
        request: cluster_rpc::IngestionRequest,
    ) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
        let publisher = AUDIT_PUBLISHER
            .get()
            .ok_or_else(|| anyhow::anyhow!("audit publisher is not initialized"))?;
        publisher(request).await
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
}

#[cfg(feature = "enterprise")]
pub use enterprise::*;
