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

use std::io::Error;
use std::time::Instant;

use actix_web::{HttpRequest, HttpResponse, post, web};
use bytes::Bytes as BytesImpl;
use chrono::Utc;
use config::utils::json;
use futures::channel::mpsc;
use futures::stream::StreamExt;
use futures::SinkExt;
use log;
use serde_json::json;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
use crate::common::utils::http::get_or_create_trace_id;
use crate::service::self_reporting::http_report_metrics;

/// Test HTTP2 streaming endpoint
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "TestSearchStreamHttp2",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Search query", content_type = "application/json", example = json!({
        "sql": "select * from logs LIMIT 10",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/x-ndjson"),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_test_http2_stream")]
pub async fn test_http2_stream(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = Instant::now();
    let org_id = org_id.into_inner();
    
    // Create a tracing span
    let http_span = tracing::info_span!("/api/{org_id}/_test_http2_stream", org_id = org_id.clone());
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    
    // Log the request
    log::info!("[trace_id: {}] Received test HTTP/2 stream request for org_id: {}", trace_id, org_id);
    
    // Validate the request body (though we won't use it for this test)
    match json::from_slice::<serde_json::Value>(&body) {
        Ok(request_data) => {
            log::debug!("[trace_id: {}] Request data: {:?}", trace_id, request_data);
        },
        Err(e) => {
            log::warn!("[trace_id: {}] Invalid request body: {}", trace_id, e);
            return Ok(MetaHttpResponse::bad_request(format!("Invalid request body: {}", e)));
        }
    }
    
    // Create a channel for streaming results
    let (tx, rx) = mpsc::channel::<Result<BytesImpl, actix_web::Error>>(100);
    let sender = tx.clone();
    
    // Clone required values for the async task
    let trace_id_clone = trace_id.clone();
    let org_id_clone = org_id.clone();
    
    // Spawn the test data generation in a separate task
    actix_web::rt::spawn(async move {
        log::info!("[trace_id: {}] Starting to generate test data", trace_id_clone);
        
        // First, send a header/info message
        let header_data = json!({
            "event": "info",
            "data": {
                "message": "Test HTTP/2 stream starting",
                "org_id": org_id_clone,
                "trace_id": trace_id_clone,
                "timestamp": Utc::now().timestamp_millis(),
                "content_type": "application/x-ndjson"
            }
        });
        
        send_message(&sender, "info", header_data).await;
        
        // Generate some sample data responses
        for i in 0..10 {
            // Create a sample hit
            let sample_data = json!({
                "record_id": i,
                "message": format!("Test message {}", i),
                "_timestamp": Utc::now().timestamp_micros() + i * 1000000,
                "org_id": org_id_clone,
                "level": match i % 4 {
                    0 => "INFO",
                    1 => "WARN",
                    2 => "ERROR", 
                    _ => "DEBUG"
                },
                "source": "test_http2_stream",
                "host": "test-host",
                "service": "test-service"
            });
            
            // Create search results structure
            let event_data = json!({
                "hits": [sample_data],
                "total": 10,
                "from": i,
                "size": 1,
                "scan_size": 100,
                "idx_scan_size": 0,
                "scan_records": 1,
                "is_partial": false,
                "cached_ratio": 0,
                "result_cache_ratio": 0,
                "took": 5,
            });
            
            // Send the sample data
            send_message(&sender, "search_result", event_data).await;
            
            // Send progress update
            let progress_data = json!({
                "percent": (i + 1) * 10,
                "event_type": "search"
            });
            send_message(&sender, "progress", progress_data).await;
            
            // Simulate some processing time
            actix_web::rt::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        
        // Send statistics message
        let stats_data = json!({
            "total_records": 10,
            "scan_size_bytes": 1000,
            "processing_time_ms": 2000,
            "cache_hits": 0
        });
        send_message(&sender, "stats", stats_data).await;
        
        // Send end event
        let end_data = json!({
            "message": "Search completed",
            "timestamp": Utc::now().timestamp_millis()
        });
        send_message(&sender, "end", end_data).await;
        
        log::info!("[trace_id: {}] Finished generating test data", trace_id_clone);
        
        // Report metrics
        http_report_metrics(
            start,
            &org_id_clone,
            config::meta::stream::StreamType::Logs,
            "200",
            "_test_http2_stream",
            "",
            "",
        );
    });
    
    // Return streaming response
    let stream = rx.map(|result| result);
    
    Ok(HttpResponse::Ok()
        .content_type("application/x-ndjson")
        .streaming(stream))
}

// Helper function to send a message to the client
async fn send_message(
    sender: &mpsc::Sender<Result<BytesImpl, actix_web::Error>>, 
    event_type: &str, 
    payload: serde_json::Value
) {
    let mut sender = sender.clone();
    let message = json!({
        "event": event_type,
        "data": payload,
        "timestamp": Utc::now().timestamp_millis(),
    });
    
    match json::to_vec(&message) {
        Ok(json_bytes) => {
            // Add newline to each JSON message for ndjson format
            let mut bytes_with_newline = json_bytes;
            bytes_with_newline.push(b'\n');
            
            if let Err(e) = sender.send(Ok(BytesImpl::from(bytes_with_newline))).await {
                log::error!("Failed to send message: {}", e);
            }
        },
        Err(e) => {
            log::error!("Failed to serialize message: {}", e);
        }
    }
} 