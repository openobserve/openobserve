// Copyright 2026 OpenObserve Inc.
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

use std::sync::{Arc, atomic::AtomicUsize};

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::meta::{cluster::NodeInfo, search::ScanStats};
use datafusion::{
    common::Result, execution::SendableRecordBatchStream,
    physical_plan::stream::RecordBatchStreamAdapter,
};
use flight::common::Metrics;
use parking_lot::Mutex;

#[derive(Debug)]
pub struct QueryContext {
    pub trace_id: String,
    pub node: Arc<dyn NodeInfo>,
    pub is_super: bool,
    pub is_querier: bool,
    pub scan_stats: Arc<Mutex<ScanStats>>,
    pub partial_err: Arc<Mutex<String>>,
    pub cluster_metrics: Arc<Mutex<Vec<Metrics>>>,
    pub peak_memory: Arc<AtomicUsize>,
    pub start: std::time::Instant,
    pub num_rows: usize,
    pub req_id: u64,
    pub req_last_time: std::time::Instant,
    pub print_key_event: bool,
}

impl QueryContext {
    pub fn new(node: Arc<dyn NodeInfo>) -> Self {
        Self {
            node,
            is_super: false,
            is_querier: false,
            scan_stats: Arc::new(Mutex::new(ScanStats::new())),
            partial_err: Arc::new(Mutex::new(String::new())),
            cluster_metrics: Arc::new(Mutex::new(Vec::new())),
            peak_memory: Arc::new(AtomicUsize::new(0)),
            trace_id: String::new(),
            start: std::time::Instant::now(),
            num_rows: 0,
            req_id: 0,
            req_last_time: std::time::Instant::now(),
            print_key_event: config::get_config().common.print_key_event,
        }
    }

    pub fn with_trace_id(mut self, trace_id: &str) -> Self {
        self.trace_id = trace_id.to_string();
        self
    }

    pub fn with_is_super(mut self, is_super: bool) -> Self {
        self.is_super = is_super;
        self
    }

    pub fn with_is_querier(mut self, is_querier: bool) -> Self {
        self.is_querier = is_querier;
        self
    }

    pub fn with_scan_stats(mut self, scan_stats: Arc<Mutex<ScanStats>>) -> Self {
        self.scan_stats = scan_stats;
        self
    }

    pub fn with_partial_err(mut self, partial_err: Arc<Mutex<String>>) -> Self {
        self.partial_err = partial_err;
        self
    }

    pub fn with_cluster_metrics(mut self, metrics: Arc<Mutex<Vec<Metrics>>>) -> Self {
        self.cluster_metrics = metrics;
        self
    }

    pub fn with_start_time(mut self, start: std::time::Instant) -> Self {
        self.start = start;
        self
    }

    pub fn with_peak_memory(mut self, peak_memory: Arc<AtomicUsize>) -> Self {
        self.peak_memory = peak_memory;
        self
    }
}

/// EmptyStream is a stream that returns an empty record batch
pub struct EmptyStream {
    trace_id: String,
    schema: SchemaRef,
    grpc_addr: String,
    is_querier: bool,
    partial_err: Arc<Mutex<String>>,
    start: std::time::Instant,
    e: Option<tonic::Status>,
}

impl EmptyStream {
    pub fn new(
        trace_id: &str,
        schema: SchemaRef,
        grpc_addr: &str,
        is_querier: bool,
        partial_err: Arc<Mutex<String>>,
        start: std::time::Instant,
    ) -> Self {
        Self {
            trace_id: trace_id.to_string(),
            schema,
            grpc_addr: grpc_addr.to_string(),
            is_querier,
            partial_err,
            e: None,
            start,
        }
    }

    pub fn with_error(self, e: tonic::Status) -> Self {
        Self { e: Some(e), ..self }
    }
}

pub fn get_empty_stream(empty_stream: EmptyStream) -> SendableRecordBatchStream {
    let EmptyStream {
        trace_id,
        schema,
        grpc_addr,
        is_querier,
        partial_err,
        e,
        start,
    } = empty_stream;
    if let Some(e) = e
        && e.code() != tonic::Code::Ok
    {
        log::error!(
            "[trace_id {trace_id}] flight->search: response node: {grpc_addr}, is_querier: {is_querier}, err: {e:?}, took: {} ms",
            start.elapsed().as_millis(),
        );
        process_partial_err(partial_err, e);
    }
    let stream = futures::stream::empty::<Result<RecordBatch>>();
    Box::pin(RecordBatchStreamAdapter::new(schema, stream))
}

pub fn process_partial_err(partial_err: Arc<Mutex<String>>, e: tonic::Status) {
    let mut guard = partial_err.lock();
    let partial_err = guard.clone();
    if partial_err.is_empty() {
        guard.push_str(e.to_string().as_str());
    } else {
        guard.push_str(format!(" \n {e}").as_str());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use parking_lot::Mutex;

    use super::*;

    #[test]
    fn test_process_partial_err_sets_when_empty() {
        let partial_err = Arc::new(Mutex::new(String::new()));
        let status = tonic::Status::internal("test error");
        process_partial_err(partial_err.clone(), status);
        let result = partial_err.lock().clone();
        assert!(!result.is_empty());
        assert!(result.contains("test error"));
    }

    #[test]
    fn test_process_partial_err_appends_when_not_empty() {
        let partial_err = Arc::new(Mutex::new("first error".to_string()));
        let status = tonic::Status::internal("second error");
        process_partial_err(partial_err.clone(), status);
        let result = partial_err.lock().clone();
        assert!(result.starts_with("first error"));
        assert!(result.contains("second error"));
        assert!(result.contains(" \n "));
    }

    #[test]
    fn test_process_partial_err_does_not_overwrite_existing() {
        let partial_err = Arc::new(Mutex::new("existing".to_string()));
        let status = tonic::Status::not_found("not found");
        process_partial_err(partial_err.clone(), status);
        let result = partial_err.lock().clone();
        assert!(result.starts_with("existing"));
    }

    #[derive(Debug)]
    struct TestNode;

    impl config::meta::cluster::NodeInfo for TestNode {
        fn get_grpc_addr(&self) -> String {
            "localhost:9090".to_string()
        }
        fn get_auth_token(&self) -> String {
            "token".to_string()
        }
        fn get_name(&self) -> String {
            "test-node".to_string()
        }
        fn is_local(&self) -> bool {
            true
        }
    }

    #[test]
    fn test_query_context_builder_methods() {
        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let ctx = QueryContext::new(node)
            .with_trace_id("trace-123")
            .with_is_super(true)
            .with_is_querier(true);

        assert_eq!(ctx.trace_id, "trace-123");
        assert!(ctx.is_super);
        assert!(ctx.is_querier);
    }

    #[test]
    fn test_query_context_default_values() {
        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let ctx = QueryContext::new(node);
        assert!(ctx.trace_id.is_empty());
        assert!(!ctx.is_super);
        assert!(!ctx.is_querier);
        assert_eq!(ctx.num_rows, 0);
        assert_eq!(ctx.req_id, 0);
    }

    #[test]
    fn test_empty_stream_new_and_with_error() {
        use arrow::datatypes::{DataType, Field, Schema};

        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let partial_err = Arc::new(Mutex::new(String::new()));

        let stream = EmptyStream::new(
            "trace-abc",
            schema.clone() as SchemaRef,
            "localhost:9090",
            false,
            partial_err.clone(),
            std::time::Instant::now(),
        );
        assert_eq!(stream.trace_id, "trace-abc");
        assert_eq!(stream.grpc_addr, "localhost:9090");
        assert!(!stream.is_querier);
        assert!(stream.e.is_none());

        let err_stream = stream.with_error(tonic::Status::internal("test"));
        assert!(err_stream.e.is_some());
    }

    #[test]
    fn test_query_context_with_scan_stats() {
        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let stats = Arc::new(Mutex::new(config::meta::search::ScanStats::new()));
        let ctx = QueryContext::new(node).with_scan_stats(stats.clone());
        assert!(Arc::ptr_eq(&ctx.scan_stats, &stats));
    }

    #[test]
    fn test_query_context_with_partial_err() {
        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let err = Arc::new(Mutex::new("pre-err".to_string()));
        let ctx = QueryContext::new(node).with_partial_err(err.clone());
        assert_eq!(*ctx.partial_err.lock(), "pre-err");
    }

    #[test]
    fn test_query_context_with_peak_memory() {
        use std::sync::atomic::Ordering;

        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let mem = Arc::new(std::sync::atomic::AtomicUsize::new(42));
        let ctx = QueryContext::new(node).with_peak_memory(mem.clone());
        assert_eq!(ctx.peak_memory.load(Ordering::Relaxed), 42);
    }

    #[test]
    fn test_query_context_with_start_time() {
        let node: Arc<dyn config::meta::cluster::NodeInfo> = Arc::new(TestNode);
        let t = std::time::Instant::now();
        let ctx = QueryContext::new(node).with_start_time(t);
        assert!(ctx.start.elapsed().as_secs() < 10);
    }
}
