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
use hashbrown::HashMap;
use infra::errors::Result;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

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
        let mut header = hashmap_to_header_map(
            entry
                .get_stream_endpoint_header()
                .unwrap_or(&HashMap::new()),
        );
        if header.get("Content-Type").is_none() {
            header.insert(
                HeaderName::from_static("content-type"),
                HeaderValue::from_static("application/json"),
            );
        }
        log::debug!(
            "Request endpoint: {}, header: {:?} data: {:?}",
            endpoint,
            header,
            entry.get_entry_data()
        );
        let response = self
            .client
            .post(endpoint)
            .headers(header)
            .json(entry.get_entry_data())
            .send()
            .await?;

        if response.status().is_success() {
            log::debug!(
                "Request sent successfully! data: {:?}",
                entry.get_entry_data()
            );
            let header = response.headers().clone();
            let body = response.text().await;
            log::debug!("response_header {:?}, response_body: {:?}", header, body);
        } else {
            log::info!("Failed to send request: {:?}, retry later", response);
            return Err(infra::errors::Error::Message(
                "Failed to send request".to_string(),
            ));
        }

        Ok(())
    }
}

fn hashmap_to_header_map(headers: &HashMap<String, String>) -> HeaderMap {
    let mut header_map = HeaderMap::new();

    for (key, value) in headers {
        if let (Ok(header_name), Ok(header_value)) = (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            header_map.insert(header_name, header_value);
        } else {
            log::warn!("Invalid header: {}: {}", key, value);
        }
    }

    header_map
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::Arc,
        thread,
        time::Duration,
    };

    use hashbrown::HashMap;
    use ingester::Entry;
    use reqwest::ClientBuilder;
    use serde_json::json;

    use crate::service::pipeline::{
        pipeline_entry::PipelineEntryBuilder, pipeline_exporter::PipelineRouter,
        pipeline_http_exporter_client::PipelineHttpExporterClient,
    };
    fn handle_client(mut stream: TcpStream) {
        let mut buffer = [0; 1024];
        stream.read(&mut buffer).unwrap();

        let request = String::from_utf8_lossy(&buffer);
        println!("Request: {}", request);

        let response = json!(request);

        let response_body = serde_json::to_string(&response).unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            response_body.len(),
            response_body
        );

        stream.write(response.as_bytes()).unwrap();
        stream.flush().unwrap();
    }

    fn start_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:50800").unwrap();
        println!("Mock server running on http://127.0.0.1:50800");

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    thread::spawn(|| handle_client(stream));
                }
                Err(e) => {
                    println!("Error: {}", e);
                }
            }
        }
    }
    #[tokio::test]
    async fn test_http_client() {
        thread::spawn(|| {
            start_mock_server();
        });
        thread::sleep(Duration::from_millis(100));

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

        let mut header = HashMap::new();
        header.insert(
            "Authorization".to_string(),
            "Basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM=".to_string(),
        );
        let data = PipelineEntryBuilder::new()
            .stream_path("path-to-stream-wal-file".into())
            .stream_endpoint("http://127.0.0.1:50800/api/default/default/_json".to_string())
            .stream_header(Some(header))
            .entry(entry)
            .build();

        client.export(data).await.expect("Failed to export data");
    }
}
