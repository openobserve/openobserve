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

//! Per-partition Flight encoder — see [`PartitionEncoderStream`].

use std::{collections::VecDeque, pin::Pin, task::Poll};

use arrow::{array::RecordBatch, ipc::writer::IpcWriteOptions};
use arrow_flight::{FlightData, error::FlightError};
use datafusion::execution::SendableRecordBatchStream;
use flight::encoder::{FlightDataEncoder, encode_chunk};
use futures::{FutureExt, Stream, StreamExt};
use tokio::task::JoinHandle;

/// Result of encoding one coalesced chunk on a worker thread.
type EncodeResult = Result<Vec<FlightData>, FlightError>;

/// Encodes one datafusion output partition into FlightData: coalesce to 8192-row chunks,
/// then ZSTD-encode each chunk on a blocking worker thread. The do_get stream runs one per
/// partition, each on its own task, so partitions encode in parallel.
pub(super) struct PartitionEncoderStream {
    inner: SendableRecordBatchStream,
    encoder: FlightDataEncoder,
    options: IpcWriteOptions,
    max_flight_data_size: usize,
    /// Coalesced chunks awaiting encode.
    pending: VecDeque<RecordBatch>,
    /// Encoded FlightData awaiting yield.
    out: VecDeque<FlightData>,
    /// The chunk currently being encoded on a blocking worker thread.
    current: Option<JoinHandle<EncodeResult>>,
    inner_done: bool,
}

impl PartitionEncoderStream {
    pub(super) fn new(
        inner: SendableRecordBatchStream,
        options: IpcWriteOptions,
        max_flight_data_size: usize,
    ) -> Self {
        Self {
            inner,
            encoder: FlightDataEncoder::new(options.clone(), max_flight_data_size),
            options,
            max_flight_data_size,
            pending: VecDeque::new(),
            out: VecDeque::new(),
            current: None,
            inner_done: false,
        }
    }
}

impl Stream for PartitionEncoderStream {
    type Item = Result<FlightData, FlightError>;

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        loop {
            if let Some(fd) = this.out.pop_front() {
                return Poll::Ready(Some(Ok(fd)));
            }
            // an encode is in flight -> wait for it
            if let Some(handle) = this.current.as_mut() {
                match handle.poll_unpin(cx) {
                    Poll::Ready(Ok(Ok(fds))) => {
                        this.current = None;
                        this.out.extend(fds);
                        continue;
                    }
                    Poll::Ready(Ok(Err(e))) => {
                        this.current = None;
                        return Poll::Ready(Some(Err(e)));
                    }
                    Poll::Ready(Err(join_err)) => {
                        this.current = None;
                        return Poll::Ready(Some(Err(FlightError::ExternalError(Box::new(
                            join_err,
                        )))));
                    }
                    Poll::Pending => return Poll::Pending,
                }
            }
            // start encoding the next coalesced chunk on a blocking worker
            if let Some(chunk) = this.pending.pop_front() {
                let options = this.options.clone();
                let max = this.max_flight_data_size;
                this.current = Some(tokio::task::spawn_blocking(move || {
                    encode_chunk(chunk, &options, max)
                }));
                continue;
            }
            // need more chunks: pull from the partition's record-batch stream
            if this.inner_done {
                return Poll::Ready(None);
            }
            match this.inner.poll_next_unpin(cx) {
                Poll::Ready(Some(Ok(batch))) => match this.encoder.push_batch(batch) {
                    Ok(chunks) => {
                        this.pending.extend(chunks);
                        continue;
                    }
                    Err(e) => return Poll::Ready(Some(Err(e))),
                },
                Poll::Ready(Some(Err(e))) => {
                    return Poll::Ready(Some(Err(FlightError::ExternalError(Box::new(e)))));
                }
                Poll::Ready(None) => match this.encoder.finish() {
                    Ok(chunks) => {
                        this.pending.extend(chunks);
                        this.inner_done = true;
                        continue;
                    }
                    Err(e) => return Poll::Ready(Some(Err(e))),
                },
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}
