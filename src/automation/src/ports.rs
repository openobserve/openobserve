// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use async_trait::async_trait;
use config::{meta::stream::StreamType, utils::json::Value};
use infra::errors::Result;

#[async_trait]
pub trait QueryExecutor: Send + Sync {
    async fn execute(
        &self,
        org_id: &str,
        stream_type: StreamType,
        query: &str,
    ) -> Result<Vec<Value>>;
}

#[async_trait]
pub trait DerivedStreamWriter: Send + Sync {
    async fn write(&self, org_id: &str, stream_name: &str, records: Vec<Value>) -> Result<()>;
}

#[async_trait]
pub trait OrganizationPolicy: Send + Sync {
    async fn can_run(&self, org_id: &str) -> Result<bool>;
}

#[derive(Clone)]
pub struct AutomationRuntime {
    pub query: Arc<dyn QueryExecutor>,
    pub writer: Arc<dyn DerivedStreamWriter>,
    pub organization: Arc<dyn OrganizationPolicy>,
}

impl AutomationRuntime {
    pub fn new(
        query: Arc<dyn QueryExecutor>,
        writer: Arc<dyn DerivedStreamWriter>,
        organization: Arc<dyn OrganizationPolicy>,
    ) -> Self {
        Self {
            query,
            writer,
            organization,
        }
    }

    pub async fn execute_derived_stream(
        &self,
        org_id: &str,
        stream_type: StreamType,
        query: &str,
        destination: &str,
    ) -> Result<bool> {
        if !self.organization.can_run(org_id).await? {
            return Ok(false);
        }
        let records = self.query.execute(org_id, stream_type, query).await?;
        self.writer.write(org_id, destination, records).await?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeQuery;

    #[async_trait]
    impl QueryExecutor for FakeQuery {
        async fn execute(
            &self,
            _org_id: &str,
            _stream_type: StreamType,
            _query: &str,
        ) -> Result<Vec<Value>> {
            Ok(vec![Value::Null])
        }
    }

    struct FakeWriter(AtomicUsize);

    #[async_trait]
    impl DerivedStreamWriter for FakeWriter {
        async fn write(
            &self,
            _org_id: &str,
            _stream_name: &str,
            records: Vec<Value>,
        ) -> Result<()> {
            self.0.fetch_add(records.len(), Ordering::Relaxed);
            Ok(())
        }
    }

    struct FakeOrganization(bool);

    #[async_trait]
    impl OrganizationPolicy for FakeOrganization {
        async fn can_run(&self, _org_id: &str) -> Result<bool> {
            Ok(self.0)
        }
    }

    #[tokio::test]
    async fn derived_stream_uses_injected_ports() {
        let writer = Arc::new(FakeWriter(AtomicUsize::new(0)));
        let runtime = AutomationRuntime::new(
            Arc::new(FakeQuery),
            writer.clone(),
            Arc::new(FakeOrganization(true)),
        );

        assert!(
            runtime
                .execute_derived_stream("org", StreamType::Logs, "select 1", "derived")
                .await
                .unwrap()
        );
        assert_eq!(writer.0.load(Ordering::Relaxed), 1);
    }
}
