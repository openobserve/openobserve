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

use async_trait::async_trait;
use infra::errors::Result;

use crate::service::pipeline::{pipeline_entry::PipelineEntry, pipeline_exporter::PipelineRouter};
pub struct PipelineHttpExporterClient {
    client: reqwest::Client,
}

impl PipelineHttpExporterClient {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl PipelineRouter for PipelineHttpExporterClient {
    async fn export(&self, entry: PipelineEntry) -> Result<()> {
        let endpoint = entry.get_stream_endpoint();
        let response = self
            .client
            .post(endpoint)
            .header("Authorization", entry.get_token())
            .header("Content-Type", "application/json")
            .json(entry.get_entry_data())
            .send()
            .await?;

        if response.status().is_success() {
            println!("Request sent successfully!");
        } else {
            println!("Failed to send request: {:?}", response.status());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use ingester::Entry;
    use reqwest::ClientBuilder;

    use crate::service::pipeline::{
        pipeline_entry::PipelineEntryBuilder, pipeline_exporter::PipelineRouter,
        pipeline_http_exporter_client::PipelineHttpExporterClient,
    };

    #[tokio::test]
    async fn test_http_client() {
        let cfg = &config::get_config();
        let reqwest_client = ClientBuilder::new()
            .timeout(Duration::from_secs(cfg.pipeline.remote_request_timeout))
            .pool_max_idle_per_host(cfg.pipeline.max_connections)
            .build()
            .unwrap();

        let client = PipelineHttpExporterClient::new(reqwest_client);
        let data = serde_json::json!(
          {
            "Athlete": "Alfred",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896
          }
        );
        let entry = Entry {
            stream: Arc::from("default"),
            schema: None, // empty Schema
            schema_key: Arc::from("example_schema_key"),
            partition_key: Arc::from("2023/12/18/00/country=US/state=CA"),
            data: vec![Arc::new(data)],
            data_size: 1,
        };

        let data = PipelineEntryBuilder::new()
            .stream_path("path-to-stream-wal-file".into())
            .stream_endpoint("http://127.0.0.1:5080/api/default/default/_json".to_string())
            .stream_org_id("default".to_string())
            .stream_type("logs".to_string())
            .stream_token(Some(
                "cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM=".to_string(),
            ))
            .entry(entry)
            .build();

        client.export(data).await.expect("Failed to export data");
    }
}
