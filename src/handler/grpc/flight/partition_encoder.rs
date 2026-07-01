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
use flight::encoder::{ChunkCoalescer, FlightDataEncoder};
use futures::{Stream, StreamExt};

/// Coalesces and ZSTD-encodes one datafusion output partition into FlightData. do_get runs one
/// per partition on its own tokio task, so partitions execute and encode in parallel.
pub(super) struct PartitionEncoderStream {
    inner: SendableRecordBatchStream,
    coalescer: ChunkCoalescer,
    encoder: FlightDataEncoder,
    /// Encoded FlightData awaiting yield.
    out: VecDeque<FlightData>,
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
            coalescer: ChunkCoalescer::new(),
            encoder: FlightDataEncoder::new(options, max_flight_data_size),
            out: VecDeque::new(),
            inner_done: false,
        }
    }

    /// Encode each coalesced chunk and queue the resulting FlightData for yield.
    fn encode_chunks(&mut self, chunks: Vec<RecordBatch>) -> Result<(), FlightError> {
        for chunk in chunks {
            let fds = self.encoder.encode_chunk(chunk)?;
            self.out.extend(fds);
        }
        Ok(())
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
            if this.inner_done {
                return Poll::Ready(None);
            }
            // pull the next record batch, coalesce, and encode any completed chunks inline
            match this.inner.poll_next_unpin(cx) {
                Poll::Ready(Some(Ok(batch))) => {
                    let chunks = match this.coalescer.push_batch(batch) {
                        Ok(chunks) => chunks,
                        Err(e) => return Poll::Ready(Some(Err(e))),
                    };
                    if let Err(e) = this.encode_chunks(chunks) {
                        return Poll::Ready(Some(Err(e)));
                    }
                    continue;
                }
                Poll::Ready(Some(Err(e))) => {
                    return Poll::Ready(Some(Err(FlightError::ExternalError(Box::new(e)))));
                }
                Poll::Ready(None) => {
                    // stream ended: flush the coalescer's final partial chunk
                    let chunks = match this.coalescer.finish() {
                        Ok(chunks) => chunks,
                        Err(e) => return Poll::Ready(Some(Err(e))),
                    };
                    if let Err(e) = this.encode_chunks(chunks) {
                        return Poll::Ready(Some(Err(e)));
                    }
                    this.inner_done = true;
                    continue;
                }
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}
