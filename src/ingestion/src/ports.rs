// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use async_trait::async_trait;
use config::{
    meta::{self_reporting::usage::RequestStats, stream::StreamType},
    utils::json::{Map, Value},
};
use infra::errors::Result;

use crate::IngestUser;

#[derive(Clone, Debug)]
pub struct IngestionContext {
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: StreamType,
    pub user: IngestUser,
}

#[derive(Clone, Debug)]
pub struct IngestionCommand {
    pub context: IngestionContext,
    pub records: Vec<Map<String, Value>>,
}

#[async_trait]
pub trait OrgIngestionPolicy: Send + Sync {
    async fn authorize(&self, context: &IngestionContext) -> Result<()>;
}

#[async_trait]
pub trait AutomationHook: Send + Sync {
    async fn process(&self, command: &mut IngestionCommand) -> Result<()>;
}

#[async_trait]
pub trait TelemetrySink: Send + Sync {
    async fn report(&self, context: &IngestionContext, stats: &RequestStats) -> Result<()>;
}

#[derive(Clone)]
pub struct IngestionPorts {
    policy: Arc<dyn OrgIngestionPolicy>,
    automation: Arc<dyn AutomationHook>,
    telemetry: Arc<dyn TelemetrySink>,
}

impl IngestionPorts {
    pub fn new(
        policy: Arc<dyn OrgIngestionPolicy>,
        automation: Arc<dyn AutomationHook>,
        telemetry: Arc<dyn TelemetrySink>,
    ) -> Self {
        Self {
            policy,
            automation,
            telemetry,
        }
    }

    pub async fn prepare(&self, command: &mut IngestionCommand) -> Result<()> {
        self.policy.authorize(&command.context).await?;
        self.automation.process(command).await
    }

    pub async fn report(&self, context: &IngestionContext, stats: &RequestStats) -> Result<()> {
        self.telemetry.report(context, stats).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::*;
    use crate::{IngestUser, SystemJobType};

    struct FakePolicy(Arc<AtomicUsize>);

    #[async_trait]
    impl OrgIngestionPolicy for FakePolicy {
        async fn authorize(&self, _context: &IngestionContext) -> Result<()> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    struct FakeAutomation(Arc<AtomicUsize>);

    #[async_trait]
    impl AutomationHook for FakeAutomation {
        async fn process(&self, command: &mut IngestionCommand) -> Result<()> {
            self.0.fetch_add(1, Ordering::Relaxed);
            command.records.push(Map::new());
            Ok(())
        }
    }

    struct FakeTelemetry(Arc<AtomicUsize>);

    #[async_trait]
    impl TelemetrySink for FakeTelemetry {
        async fn report(&self, _context: &IngestionContext, _stats: &RequestStats) -> Result<()> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    #[tokio::test]
    async fn ports_are_injectable() {
        let policy_calls = Arc::new(AtomicUsize::new(0));
        let automation_calls = Arc::new(AtomicUsize::new(0));
        let telemetry_calls = Arc::new(AtomicUsize::new(0));
        let ports = IngestionPorts::new(
            Arc::new(FakePolicy(policy_calls.clone())),
            Arc::new(FakeAutomation(automation_calls.clone())),
            Arc::new(FakeTelemetry(telemetry_calls.clone())),
        );
        let context = IngestionContext {
            org_id: "org".to_string(),
            stream_name: "stream".to_string(),
            stream_type: StreamType::Logs,
            user: IngestUser::SystemJob(SystemJobType::InternalGrpc),
        };
        let mut command = IngestionCommand {
            context: context.clone(),
            records: Vec::new(),
        };

        ports.prepare(&mut command).await.unwrap();
        ports
            .report(&context, &RequestStats::default())
            .await
            .unwrap();

        assert_eq!(policy_calls.load(Ordering::Relaxed), 1);
        assert_eq!(automation_calls.load(Ordering::Relaxed), 1);
        assert_eq!(telemetry_calls.load(Ordering::Relaxed), 1);
        assert_eq!(command.records.len(), 1);
    }
}
