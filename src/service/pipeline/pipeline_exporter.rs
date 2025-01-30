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

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use config::Config;
use infra::errors::Result;
use ingester::Entry;
use reqwest::ClientBuilder;
use wal::FilePosition;

use crate::service::pipeline::{
    pipeline_entry::{PipelineEntry, PipelineEntryBuilder},
    pipeline_http_exporter_client::PipelineHttpExporterClient,
    pipeline_offset_manager::get_pipeline_offset_manager,
    pipeline_receiver::PipelineReceiver,
};

const INITIAL_RETRY_DELAY_MS: u64 = 100; // 100 ms
const MAX_RETRY_TIME_LIMIT: u64 = 3600000; // 1 hour

#[async_trait]
pub trait PipelineRouter: Sync + Send {
    async fn export(&self, entry: PipelineEntry) -> Result<()>;
}

pub struct PipelineExporterClientBuilder {}

impl PipelineExporterClientBuilder {
    pub fn build(skip_tls_verify: bool) -> Result<Box<dyn PipelineRouter>> {
        let cfg = &config::get_config();
        // todo: each stream has own protocal in the futrue, we should use specif base on each
        // stream setting
        Ok(Self::build_http(cfg, skip_tls_verify))
    }

    fn build_http(cfg: &Arc<Config>, skip_tls_verify: bool) -> Box<PipelineHttpExporterClient> {
        let builder = ClientBuilder::new()
            .timeout(Duration::from_secs(cfg.pipeline.remote_request_timeout))
            .pool_max_idle_per_host(cfg.pipeline.max_connections)
            .danger_accept_invalid_certs(skip_tls_verify);

        Box::new(PipelineHttpExporterClient::new(builder.build().unwrap()))
    }
}

pub struct PipelineExporter {
    router: Box<dyn PipelineRouter>,
}

impl PipelineExporter {
    fn new(router: Box<dyn PipelineRouter>) -> Self {
        Self { router }
    }

    pub fn init(skip_tls_verify: bool) -> Result<Self> {
        let client = PipelineExporterClientBuilder::build(skip_tls_verify)?;
        Ok(Self::new(client))
    }

    pub async fn export_entry(
        &self,
        entry: Entry,
        max_retry_time: u64,
        file_position: FilePosition,
        pr: &PipelineReceiver,
    ) -> Result<()> {
        let mut attempts = 0;
        let mut delay = INITIAL_RETRY_DELAY_MS;
        loop {
            log::debug!(
                "Read entry from file, endpoint: {:?}, endpoint_header: {:?}, data: {:?}, path: {}",
                pr.get_stream_endpoint().await,
                pr.get_stream_endpoint_header().await,
                entry.data,
                pr.path.display(),
            );
            let endpoint = pr.get_stream_endpoint().await?;
            let header = pr.get_stream_endpoint_header().await;
            let entry = PipelineEntryBuilder::new()
                .stream_path(pr.path.clone())
                .stream_endpoint(endpoint)
                .stream_header(header)
                .set_entry_position_of_file(file_position)
                .entry(entry.clone())
                .build();
            // todo: if endpoint reponse partial success, we need to resovle the issue?
            // we assume that all the data is received successfully when the endpoint response 200.
            match self.router.export(entry.clone()).await {
                Ok(_) => {
                    if attempts > 0 {
                        log::info!("Successfully exported entry after {} retries", attempts);
                    }

                    // update file position
                    let manager = get_pipeline_offset_manager().await;
                    manager
                        .write()
                        .await
                        .save(
                            entry.get_stream_path().to_str().unwrap(),
                            entry.get_entry_position(),
                        )
                        .await;
                    break;
                }
                Err(e) => {
                    attempts += 1;
                    if delay >= max_retry_time {
                        log::error!(
                            "Failed to export pipeline entry after {max_retry_time} min , giving up: {:?}",
                            e
                        );

                        // return err will break the read_entry loop, so we do not read this file
                        // again no need to send
                        // WatcherEvent::StopWatchFileAndWait(path) to file watcher
                        return Err(e);
                    }

                    log::warn!(
                        "Export pipeline entry attempt {} failed, retrying in {}ms: {:?}",
                        attempts,
                        delay,
                        e
                    );

                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    delay = Self::retry_backoff(delay);
                }
            }
        }

        Ok(())
    }

    fn retry_backoff(delay: u64) -> u64 {
        let mut new_delay = delay * 5;
        if new_delay >= MAX_RETRY_TIME_LIMIT {
            new_delay = MAX_RETRY_TIME_LIMIT;
        }

        new_delay
    }
}

#[cfg(test)]
mod tests {
    use crate::service::pipeline::pipeline_exporter::PipelineExporterClientBuilder;

    #[test]
    fn test_pipeline_exporter_client_builder() {
        PipelineExporterClientBuilder::build(false).unwrap();
    }

    #[test]
    fn test_retry_backoff() {
        let mut delay = 100;
        for i in 0..10 {
            let new_delay = super::PipelineExporter::retry_backoff(delay);
            println!("retry_backoff: {i} {} -> {}", delay, new_delay);
            delay = new_delay;
            match i {
                v if v <= 5 => assert!(delay < 3600000),
                _ => assert_eq!(delay, 3600000),
            }
        }
    }
}
