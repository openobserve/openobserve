// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use async_trait::async_trait;
use infra::errors::Result;
use ingestion::{AutomationHook, IngestionCommand};

#[async_trait]
pub trait AutomationProcessor: Send + Sync {
    async fn process(&self, command: &mut IngestionCommand) -> Result<()>;
}

pub struct AutomationHookAdapter<P> {
    processor: Arc<P>,
}

impl<P> AutomationHookAdapter<P> {
    pub fn new(processor: Arc<P>) -> Self {
        Self { processor }
    }
}

#[async_trait]
impl<P> AutomationHook for AutomationHookAdapter<P>
where
    P: AutomationProcessor,
{
    async fn process(&self, command: &mut IngestionCommand) -> Result<()> {
        self.processor.process(command).await
    }
}

#[cfg(test)]
mod tests {
    use config::{meta::stream::StreamType, utils::json::Map};
    use ingestion::{IngestUser, IngestionContext, SystemJobType};

    use super::*;

    struct FakeProcessor;

    #[async_trait]
    impl AutomationProcessor for FakeProcessor {
        async fn process(&self, command: &mut IngestionCommand) -> Result<()> {
            command.records.push(Map::new());
            Ok(())
        }
    }

    #[tokio::test]
    async fn adapter_implements_ingestion_hook() {
        let adapter = AutomationHookAdapter::new(Arc::new(FakeProcessor));
        let mut command = IngestionCommand {
            context: IngestionContext {
                org_id: "org".to_string(),
                stream_name: "stream".to_string(),
                stream_type: StreamType::Logs,
                user: IngestUser::SystemJob(SystemJobType::InternalGrpc),
            },
            records: Vec::new(),
        };

        AutomationHook::process(&adapter, &mut command)
            .await
            .unwrap();
        assert_eq!(command.records.len(), 1);
    }
}
