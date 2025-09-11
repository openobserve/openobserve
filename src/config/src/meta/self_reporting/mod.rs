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

use error::ErrorData;
use tokio::{
    sync::{mpsc, oneshot},
    time,
};
use usage::{TriggerData, UsageData};

pub mod error;
pub mod usage;

#[derive(Debug)]
pub struct ReportingQueue {
    pub msg_sender: mpsc::Sender<ReportingMessage>,
}

#[derive(Debug)]
pub enum ReportingMessage {
    Data(ReportingData),
    Shutdown(oneshot::Sender<()>),
    Start(oneshot::Sender<()>),
}

#[derive(Debug)]
pub enum ReportingData {
    Usage(Box<UsageData>),
    Trigger(Box<TriggerData>),
    Error(Box<ErrorData>),
}

#[derive(Debug)]
pub struct ReportingRunner {
    pub pending: Vec<ReportingData>,
    pub batch_size: usize,
    pub timeout: time::Duration,
    pub last_processed: time::Instant,
}

impl ReportingQueue {
    pub fn new(msg_sender: mpsc::Sender<ReportingMessage>) -> Self {
        Self { msg_sender }
    }

    pub async fn enqueue(
        &self,
        reporting_data: ReportingData,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Data(reporting_data))
            .await
    }

    pub async fn start(
        &self,
        start_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Start(start_sender))
            .await
    }

    pub async fn shutdown(
        &self,
        res_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Shutdown(res_sender))
            .await
    }
}

impl ReportingRunner {
    pub fn new(batch_size: usize, timeout: time::Duration) -> Self {
        Self {
            pending: vec![],
            batch_size,
            timeout,
            last_processed: time::Instant::now(),
        }
    }

    pub fn push(&mut self, data: ReportingData) {
        self.pending.push(data);
    }

    pub fn should_process(&self) -> bool {
        self.pending.len() >= self.batch_size
            || (!self.pending.is_empty() && self.last_processed.elapsed() >= self.timeout)
    }

    pub fn take_batch(&mut self) -> Vec<ReportingData> {
        self.last_processed = time::Instant::now();
        std::mem::take(&mut self.pending)
    }
}

#[cfg(test)]
mod tests {
    use tokio::time::Duration;
    use usage::{TriggerData, TriggerDataStatus, TriggerDataType, UsageData, UsageEvent};

    use super::*;

    #[tokio::test]
    async fn test_reporting_queue_new() {
        let (tx, _rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        assert!(queue.msg_sender.capacity() >= 10);
    }

    #[tokio::test]
    async fn test_reporting_queue_enqueue_usage() {
        let (tx, mut rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        let result = queue
            .enqueue(ReportingData::Usage(Box::new(usage_data)))
            .await;
        assert!(result.is_ok());

        let received = rx.recv().await;
        assert!(received.is_some());

        match received.unwrap() {
            ReportingMessage::Data(ReportingData::Usage(data)) => {
                assert_eq!(data.event, UsageEvent::Search);
                assert_eq!(data.org_id, "test_org");
                assert_eq!(data.stream_name, "test_stream");
            }
            _ => panic!("Expected Usage data"),
        }
    }

    #[tokio::test]
    async fn test_reporting_queue_enqueue_trigger() {
        let (tx, mut rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        let trigger_data = TriggerData {
            _timestamp: 1234567890,
            org: "test_org".to_string(),
            module: TriggerDataType::Alert,
            key: "test_key".to_string(),
            next_run_at: 1234567890,
            is_realtime: true,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 1234567890,
            end_time: 1234567890,
            retries: 0,
            skipped_alerts_count: None,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
            scheduler_trace_id: None,
            time_in_queue_ms: None,
        };

        let result = queue
            .enqueue(ReportingData::Trigger(Box::new(trigger_data)))
            .await;
        assert!(result.is_ok());

        let received = rx.recv().await;
        assert!(received.is_some());

        match received.unwrap() {
            ReportingMessage::Data(ReportingData::Trigger(data)) => {
                assert_eq!(data.org, "test_org");
                assert_eq!(data.module, TriggerDataType::Alert);
                assert_eq!(data.key, "test_key");
                assert_eq!(data.status, TriggerDataStatus::Completed);
            }
            _ => panic!("Expected Trigger data"),
        }
    }

    #[tokio::test]
    async fn test_reporting_queue_enqueue_error() {
        let (tx, mut rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        let error_data = error::ErrorData {
            _timestamp: 1234567890,
            stream_params: crate::meta::stream::StreamParams::default(),
            error_source: error::ErrorSource::Alert,
        };

        let result = queue
            .enqueue(ReportingData::Error(Box::new(error_data)))
            .await;
        assert!(result.is_ok());

        let received = rx.recv().await;
        assert!(received.is_some());

        match received.unwrap() {
            ReportingMessage::Data(ReportingData::Error(_data)) => {
                // Error data received successfully
            }
            _ => panic!("Expected Error data"),
        }
    }

    #[tokio::test]
    async fn test_reporting_queue_start() {
        let (tx, mut rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        let (start_tx, start_rx) = oneshot::channel();
        let result = queue.start(start_tx).await;
        assert!(result.is_ok());

        let received = rx.recv().await;
        assert!(received.is_some());

        match received.unwrap() {
            ReportingMessage::Start(sender) => {
                let _ = sender.send(());
                let result = start_rx.await;
                assert!(result.is_ok());
            }
            _ => panic!("Expected Start message"),
        }
    }

    #[tokio::test]
    async fn test_reporting_queue_shutdown() {
        let (tx, mut rx) = mpsc::channel(10);
        let queue = ReportingQueue::new(tx);

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let result = queue.shutdown(shutdown_tx).await;
        assert!(result.is_ok());

        let received = rx.recv().await;
        assert!(received.is_some());

        match received.unwrap() {
            ReportingMessage::Shutdown(sender) => {
                let _ = sender.send(());
                let result = shutdown_rx.await;
                assert!(result.is_ok());
            }
            _ => panic!("Expected Shutdown message"),
        }
    }

    #[test]
    fn test_reporting_runner_new() {
        let batch_size = 100;
        let timeout = Duration::from_secs(30);
        let runner = ReportingRunner::new(batch_size, timeout);

        assert_eq!(runner.batch_size, batch_size);
        assert_eq!(runner.timeout, timeout);
        assert!(runner.pending.is_empty());
        assert!(runner.last_processed.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn test_reporting_runner_push() {
        let mut runner = ReportingRunner::new(10, Duration::from_secs(30));

        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        runner.push(ReportingData::Usage(Box::new(usage_data)));
        assert_eq!(runner.pending.len(), 1);

        match &runner.pending[0] {
            ReportingData::Usage(data) => {
                assert_eq!(data.event, UsageEvent::Search);
                assert_eq!(data.org_id, "test_org");
            }
            _ => panic!("Expected Usage data"),
        }
    }

    #[test]
    fn test_reporting_runner_should_process_batch_size() {
        let mut runner = ReportingRunner::new(3, Duration::from_secs(30));

        // Should not process when below batch size
        assert!(!runner.should_process());

        // Add data up to batch size
        for i in 0..3 {
            let usage_data = UsageData {
                _timestamp: 1234567890 + i,
                event: UsageEvent::Search,
                year: 2024,
                month: 1,
                day: 1,
                hour: 12,
                event_time_hour: "2024-01-01T12:00:00Z".to_string(),
                org_id: "test_org".to_string(),
                request_body: "test_request".to_string(),
                size: 1.5,
                unit: "MB".to_string(),
                user_email: "test@example.com".to_string(),
                response_time: 0.5,
                stream_type: crate::meta::stream::StreamType::Logs,
                num_records: 100,
                dropped_records: 0,
                stream_name: "test_stream".to_string(),
                trace_id: None,
                cached_ratio: None,
                scan_files: None,
                compressed_size: None,
                min_ts: None,
                max_ts: None,
                search_type: None,
                search_event_context: None,
                took_wait_in_queue: None,
                result_cache_ratio: None,
                function: None,
                is_partial: false,
                work_group: None,
                node_name: None,
                dashboard_info: None,
            };
            runner.push(ReportingData::Usage(Box::new(usage_data)));
        }

        // Should process when batch size is reached
        assert!(runner.should_process());
    }

    #[test]
    fn test_reporting_runner_should_process_timeout() {
        let mut runner = ReportingRunner::new(100, Duration::from_millis(100));

        // Add one item
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };
        runner.push(ReportingData::Usage(Box::new(usage_data)));

        // Should not process immediately
        assert!(!runner.should_process());

        // Wait for timeout
        std::thread::sleep(Duration::from_millis(150));

        // Should process after timeout
        assert!(runner.should_process());
    }

    #[test]
    fn test_reporting_runner_take_batch() {
        let mut runner = ReportingRunner::new(10, Duration::from_secs(30));

        // Add some data
        for i in 0..3 {
            let usage_data = UsageData {
                _timestamp: 1234567890 + i,
                event: UsageEvent::Search,
                year: 2024,
                month: 1,
                day: 1,
                hour: 12,
                event_time_hour: "2024-01-01T12:00:00Z".to_string(),
                org_id: "test_org".to_string(),
                request_body: "test_request".to_string(),
                size: 1.5,
                unit: "MB".to_string(),
                user_email: "test@example.com".to_string(),
                response_time: 0.5,
                stream_type: crate::meta::stream::StreamType::Logs,
                num_records: 100,
                dropped_records: 0,
                stream_name: "test_stream".to_string(),
                trace_id: None,
                cached_ratio: None,
                scan_files: None,
                compressed_size: None,
                min_ts: None,
                max_ts: None,
                search_type: None,
                search_event_context: None,
                took_wait_in_queue: None,
                result_cache_ratio: None,
                function: None,
                is_partial: false,
                work_group: None,
                node_name: None,
                dashboard_info: None,
            };
            runner.push(ReportingData::Usage(Box::new(usage_data)));
        }

        assert_eq!(runner.pending.len(), 3);

        let batch = runner.take_batch();
        assert_eq!(batch.len(), 3);
        assert!(runner.pending.is_empty());

        // Verify last_processed was updated
        assert!(runner.last_processed.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn test_reporting_runner_take_batch_empty() {
        let mut runner = ReportingRunner::new(10, Duration::from_secs(30));

        let batch = runner.take_batch();
        assert!(batch.is_empty());
        assert!(runner.pending.is_empty());
    }

    #[test]
    fn test_reporting_message_debug() {
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        let message = ReportingMessage::Data(ReportingData::Usage(Box::new(usage_data)));
        let debug_str = format!("{:?}", message);
        assert!(!debug_str.is_empty());
        assert!(debug_str.contains("Data"));
    }

    #[test]
    fn test_reporting_data_debug() {
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        let data = ReportingData::Usage(Box::new(usage_data));
        let debug_str = format!("{:?}", data);
        assert!(!debug_str.is_empty());
        assert!(debug_str.contains("Usage"));
    }

    #[ignore]
    #[tokio::test]
    async fn test_reporting_queue_channel_full() {
        let (tx, _rx) = mpsc::channel(1);
        let queue = ReportingQueue::new(tx);

        // Fill the channel
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        // First message should succeed
        let result1 = queue
            .enqueue(ReportingData::Usage(Box::new(usage_data.clone())))
            .await;
        assert!(result1.is_ok());

        // Second message should fail (channel full)
        let result2 = queue
            .enqueue(ReportingData::Usage(Box::new(usage_data)))
            .await;
        assert!(result2.is_err());
    }

    #[test]
    fn test_reporting_runner_mixed_data_types() {
        let mut runner = ReportingRunner::new(10, Duration::from_secs(30));

        // Add different types of data
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: crate::meta::stream::StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
        };

        let trigger_data = TriggerData {
            _timestamp: 1234567890,
            org: "test_org".to_string(),
            module: TriggerDataType::Alert,
            key: "test_key".to_string(),
            next_run_at: 1234567890,
            is_realtime: true,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 1234567890,
            end_time: 1234567890,
            retries: 0,
            skipped_alerts_count: None,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
            scheduler_trace_id: None,
            time_in_queue_ms: None,
        };

        let error_data = error::ErrorData {
            _timestamp: 1234567890,
            stream_params: crate::meta::stream::StreamParams::default(),
            error_source: error::ErrorSource::Alert,
        };

        runner.push(ReportingData::Usage(Box::new(usage_data)));
        runner.push(ReportingData::Trigger(Box::new(trigger_data)));
        runner.push(ReportingData::Error(Box::new(error_data)));

        assert_eq!(runner.pending.len(), 3);

        let batch = runner.take_batch();
        assert_eq!(batch.len(), 3);

        // Verify we have all three types
        let mut usage_count = 0;
        let mut trigger_count = 0;
        let mut error_count = 0;

        for data in batch {
            match data {
                ReportingData::Usage(_) => usage_count += 1,
                ReportingData::Trigger(_) => trigger_count += 1,
                ReportingData::Error(_) => error_count += 1,
            }
        }

        assert_eq!(usage_count, 1);
        assert_eq!(trigger_count, 1);
        assert_eq!(error_count, 1);
    }
}
