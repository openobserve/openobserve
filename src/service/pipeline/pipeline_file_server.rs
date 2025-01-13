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

use tokio::sync::mpsc;

use crate::service::pipeline::{
    pipeline_entry::PipelineEntry, pipeline_exporter::PipelineExporter, pipeline_watcher::PipelineWatcher,
};

pub struct PipelineFileServerBuilder {}

impl PipelineFileServerBuilder {
    pub async fn build() -> PipelineFileServer {
        let cfg = &config::get_config();

        // build pipeline_watcher
        let (s, r) = mpsc::channel(cfg.pipeline.remote_stream_wal_concurrent_count);
        let pipeline_watcher =
            PipelineWatcher::init(s, r, cfg.pipeline.remote_stream_wal_concurrent_count).await;

        // build pipeline_exporter
        let (stop_pipeline_expoter_tx, stop_pipleline_exporter_rx) = mpsc::channel(1);
        let (stop_pipeline_watcher_tx, stop_pipleline_watcher_rx) = mpsc::channel(1);
        let (pipeline_exporter_tx, pipeline_exporter_rx) = mpsc::channel::<PipelineEntry>(1024);
        let pipelins_exporter = PipelineExporter::init(pipeline_exporter_rx, stop_pipleline_exporter_rx).unwrap();

        PipelineFileServer::new(
            pipeline_watcher,
            pipelins_exporter,
            pipeline_exporter_tx,
            stop_pipeline_expoter_tx,
            stop_pipeline_watcher_tx,
            stop_pipleline_watcher_rx,
        )
    }
}

pub struct PipelineFileServer {
    pub pipeline_watcher: PipelineWatcher,
    pub pipeline_exporter: PipelineExporter,
    pipeline_exporter_sender: mpsc::Sender<PipelineEntry>,
    stop_pipeline_expoter_tx: mpsc::Sender<()>,
    stop_pipeline_watcher_tx: mpsc::Sender<()>,
    stop_pipeline_watcher_rx: mpsc::Receiver<()>,
}

impl PipelineFileServer {
    pub fn new(
        pipeline_watcher: PipelineWatcher,
        pipeline_exporter: PipelineExporter,
        pipeline_exporter_sender: mpsc::Sender<PipelineEntry>,
        stop_pipeline_expoter_tx: mpsc::Sender<()>,
        stop_pipeline_watcher_tx: mpsc::Sender<()>,
        stop_pipeline_watcher_rx: mpsc::Receiver<()>,
    ) -> Self {
        Self {
            pipeline_watcher,
            pipeline_exporter,
            stop_pipeline_expoter_tx,
            pipeline_exporter_sender,
            stop_pipeline_watcher_tx,
            stop_pipeline_watcher_rx,
        }
    }

    pub fn destructure(
        self,
    ) -> (
        PipelineWatcher,
        PipelineExporter,
        mpsc::Sender<PipelineEntry>,
        mpsc::Sender<()>,
        mpsc::Sender<()>,
        mpsc::Receiver<()>
    ) {
        (
            self.pipeline_watcher,
            self.pipeline_exporter,
            self.pipeline_exporter_sender,
            self.stop_pipeline_expoter_tx,
            self.stop_pipeline_watcher_tx,
            self.stop_pipeline_watcher_rx,
        )
    }

    pub async fn run(mut outside_shutdown_rx: mpsc::Receiver<()>) {
        log::info!("PipelineFileServer started");
        let (
            mut pipeline_watcher,
            mut pipeline_exporter,
            pipeline_exporter_sender,
            stop_pipeline_exporter_sender,
            stop_pipeline_watcher_sender,
            stop_pipeline_watcher_rx,
        ) = PipelineFileServerBuilder::build().await.destructure();

        log::info!("PipelineWatcher started");
        tokio::spawn(async move {
            let _ = pipeline_watcher.run(pipeline_exporter_sender, stop_pipeline_watcher_rx).await;
        });

        log::info!("PipelineExporter started");
        tokio::spawn(async move {
            let _ = pipeline_exporter.export().await;
        });

        log::info!("PipelineFileServer running and waiting for shutdown signal");
        loop {
            let _ = outside_shutdown_rx.recv().await;
            println!("PipelineExporter begin to shutdown");
            log::info!("PipelineExporter begin to shutdown");
            let _ = stop_pipeline_exporter_sender.send(()).await;

            log::info!("PipelineWatcher begin to shutdown");
            let _ = stop_pipeline_watcher_sender.send(()).await;

            break;
        }
    }
}



#[cfg(test)]
mod tests {
    use crate::service::pipeline::pipeline_file_server::PipelineFileServer;

    #[tokio::test]
    async fn test_pipeline_file_server() {
        let (stop_tx, stop_rx) = tokio::sync::mpsc::channel(1);
        tokio::spawn(PipelineFileServer::run(stop_rx));
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        stop_tx.send(()).await.unwrap();
    }
}