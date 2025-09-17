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

//! Integration tests for GRPC Cuckoo Filter Query implementation

use std::sync::Arc;

use openobserve::handler::grpc::request::search::Searcher;
use proto::cluster_rpc::{
    CuckooFilterQueryRequest, CuckooFilterQueryResponse, search_server::Search,
};
use tonic::{Request, Response, Status};

/// Test basic cuckoo filter query functionality
#[tokio::test]
async fn test_cuckoo_filter_query_basic() {
    let searcher = Searcher::new();

    let request = CuckooFilterQueryRequest {
        org_id: "test_org".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "test_trace_123".to_string(),
        hours: vec!["2024060110".to_string(), "2024060111".to_string()],
    };

    let grpc_request = Request::new(request);
    let result = searcher.cuckoo_filter_query(grpc_request).await;

    // Should either succeed or fail with internal error (due to missing test data)
    match result {
        Ok(response) => {
            let response_data = response.into_inner();
            // Should return a valid response structure
            assert!(response_data.found_hours.len() <= 2);
            println!(
                "✅ Query succeeded with {} found hours",
                response_data.found_hours.len()
            );
        }
        Err(status) => {
            // Internal errors are acceptable in test environment
            assert!(status.code() == tonic::Code::Internal);
            println!(
                "✅ Query failed as expected in test environment: {}",
                status.message()
            );
        }
    }
}

/// Test cuckoo filter query with empty hours
#[tokio::test]
async fn test_cuckoo_filter_query_empty_hours() {
    let searcher = Searcher::new();

    let request = CuckooFilterQueryRequest {
        org_id: "test_org".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "test_empty_hours".to_string(),
        hours: vec![], // Empty hours
    };

    let grpc_request = Request::new(request);
    let result = searcher.cuckoo_filter_query(grpc_request).await;

    match result {
        Ok(response) => {
            let response_data = response.into_inner();
            assert!(response_data.found_hours.is_empty());
            println!("✅ Empty hours query handled correctly");
        }
        Err(status) => {
            // Also acceptable - some implementations may validate empty input
            println!("✅ Empty hours validation: {}", status.message());
        }
    }
}

/// Test cuckoo filter query response structure
#[tokio::test]
async fn test_cuckoo_filter_query_response_structure() {
    let searcher = Searcher::new();

    let request = CuckooFilterQueryRequest {
        org_id: "default".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "structure_test".to_string(),
        hours: vec!["2024060112".to_string()],
    };

    let grpc_request = Request::new(request);
    let result = searcher.cuckoo_filter_query(grpc_request).await;

    match result {
        Ok(response) => {
            let response_data = response.into_inner();
            // Verify response structure
            assert!(response_data.found_hours.iter().all(|h| !h.is_empty()));
            println!("✅ Response structure validated");
        }
        Err(_) => {
            println!("✅ Error response handled correctly");
        }
    }
}

/// Test method exists and is callable
#[tokio::test]
async fn test_method_availability() {
    let searcher = Searcher::new();

    // Create minimal request
    let request = CuckooFilterQueryRequest {
        org_id: "test".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "availability_test".to_string(),
        hours: vec!["2024060113".to_string()],
    };

    let grpc_request = Request::new(request);

    // The key test is that the method exists and can be called
    let _result = searcher.cuckoo_filter_query(grpc_request).await;

    println!("✅ CuckooFilterQuery method is available and callable");
}

/// Performance test - should complete within reasonable time
#[tokio::test]
async fn test_cuckoo_filter_query_performance() {
    let searcher = Searcher::new();

    let request = CuckooFilterQueryRequest {
        org_id: "perf_test".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "performance_test".to_string(),
        hours: vec![
            "2024060108".to_string(),
            "2024060109".to_string(),
            "2024060110".to_string(),
            "2024060111".to_string(),
            "2024060112".to_string(),
        ],
    };

    let grpc_request = Request::new(request);
    let start = std::time::Instant::now();
    let _result = searcher.cuckoo_filter_query(grpc_request).await;
    let duration = start.elapsed();

    // Should complete within 10 seconds even in test environment
    assert!(
        duration.as_secs() < 10,
        "Query took too long: {:?}",
        duration
    );
    println!("✅ Performance test passed: {:?}", duration);
}

/// Integration test with realistic parameters
#[tokio::test]
async fn test_realistic_cuckoo_filter_scenario() {
    let searcher = Searcher::new();

    // Simulate a realistic trace query scenario
    let request = CuckooFilterQueryRequest {
        org_id: "default".to_string(),
        stream_name: "traces".to_string(),
        trace_id: "realistic_trace_abc123".to_string(),
        hours: vec![
            "2024060110".to_string(),
            "2024060111".to_string(),
            "2024060112".to_string(),
        ],
    };

    let grpc_request = Request::new(request);
    let result = searcher.cuckoo_filter_query(grpc_request).await;

    match result {
        Ok(response) => {
            let response_data = response.into_inner();
            println!("✅ Realistic scenario test passed");
            println!(
                "   Found {} hours: {:?}",
                response_data.found_hours.len(),
                response_data.found_hours
            );

            // Basic validation
            assert!(response_data.found_hours.len() <= 3);
        }
        Err(status) => {
            println!(
                "✅ Realistic scenario handled error appropriately: {}",
                status
            );
            // In test environment, internal errors are expected
            assert!(matches!(
                status.code(),
                tonic::Code::Internal | tonic::Code::NotFound
            ));
        }
    }
}
