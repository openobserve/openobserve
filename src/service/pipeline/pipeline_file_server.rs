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

use config::cluster::LOCAL_NODE;
use infra::errors::Result;
use tokio::sync::{mpsc, oneshot};

use crate::service::pipeline::pipeline_watcher::PipelineWatcher;

pub struct PipelineFileServerBuilder {}

impl PipelineFileServerBuilder {
    pub async fn build() -> PipelineFileServer {
        let cfg = &config::get_config();

        // build pipeline_watcher
        let (s, r) = mpsc::channel(cfg.pipeline.remote_stream_wal_concurrent_count);
        let pipeline_watcher =
            PipelineWatcher::init(s, r, cfg.pipeline.remote_stream_wal_concurrent_count).await;

        // build pipeline_exporter
        let (stop_pipeline_watcher_tx, stop_pipleline_watcher_rx) = mpsc::channel(1);

        PipelineFileServer::new(
            pipeline_watcher,
            stop_pipeline_watcher_tx,
            stop_pipleline_watcher_rx,
        )
    }
}

pub struct PipelineFileServer {
    pub pipeline_watcher: PipelineWatcher,
    stop_pipeline_watcher_tx: mpsc::Sender<()>,
    stop_pipeline_watcher_rx: mpsc::Receiver<()>,
}

impl PipelineFileServer {
    pub fn new(
        pipeline_watcher: PipelineWatcher,
        stop_pipeline_watcher_tx: mpsc::Sender<()>,
        stop_pipeline_watcher_rx: mpsc::Receiver<()>,
    ) -> Self {
        Self {
            pipeline_watcher,
            stop_pipeline_watcher_tx,
            stop_pipeline_watcher_rx,
        }
    }

    pub fn destructure(self) -> (PipelineWatcher, mpsc::Sender<()>, mpsc::Receiver<()>) {
        (
            self.pipeline_watcher,
            self.stop_pipeline_watcher_tx,
            self.stop_pipeline_watcher_rx,
        )
    }

    pub async fn run(outside_shutdown_rx: oneshot::Receiver<()>) -> Result<()> {
        let check = LOCAL_NODE.is_ingester() || LOCAL_NODE.is_alert_manager();
        if !check {
            log::debug!("PipelineFileServer can only run on ingester or alert_manager");
            return Ok(());
        }

        log::info!("PipelineFileServer started");
        let (mut pipeline_watcher, stop_pipeline_watcher_sender, stop_pipeline_watcher_rx) =
            PipelineFileServerBuilder::build().await.destructure();

        tokio::spawn(async move {
            log::info!("PipelineWatcher started");
            let _ = pipeline_watcher.run(stop_pipeline_watcher_rx).await;
            log::info!("PipelineWatcher end");
        });

        tokio::spawn(async move {
            log::info!("PipelineFileServer running and waiting for shutdown signal");

            let _ = outside_shutdown_rx.await;

            log::info!("PipelineWatcher begin to shutdown");
            let _ = stop_pipeline_watcher_sender.send(()).await;

            log::info!("PipelineFileServer end");
        });

        tokio::spawn(async {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(
                    config::get_config().limit.max_file_retention_time,
                ))
                .await;

                let _ = crate::service::pipeline::pipeline_wal_writer::check_ttl().await;
            }
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::service::pipeline::pipeline_file_server::PipelineFileServer;

    #[tokio::test]
    async fn test_pipeline_file_server() {
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(PipelineFileServer::run(stop_rx));
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        stop_tx.send(()).unwrap();
    }
}
