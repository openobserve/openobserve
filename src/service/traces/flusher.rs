use std::{
    io::{Error, ErrorKind},
    time::Duration,
};

use config::ider;
use crossbeam_channel::{Receiver as CrossbeamReceiver, Sender as CrossbeamSender};
use hashbrown::HashMap;
use infra::errors::BufferWriteError;
use log::{info, warn};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tokio::{
    runtime::Runtime,
    select,
    sync::{mpsc, oneshot, watch},
    time::MissedTickBehavior,
};

use crate::{
    common::meta::{
        stream::SchemaRecords,
        traces::{ExportTracePartialSuccess, ExportTraceServiceResponse},
    },
    service::{
        ingestion::TriggerAlertData,
        metadata::MetadataItem,
        traces::{flusher, handle_trace_request},
    },
};

const BUFFER_FLUSH_INTERVAL: Duration = Duration::from_millis(10);
// The maximum number of buffered writes that can be queued up before backpressure is applied
const BUFFER_CHANNEL_LIMIT: usize = 10_000;

#[derive(Debug, Clone)]
pub enum ExportRequest {
    // Entry((org_id, thread_id, stream_name, entry, trigger, distinct_value, trace_index,
    // partical_success))
    TraceEntry(ExportRequestInnerEntry),
}
#[derive(Debug)]
pub struct BufferedWrite {
    pub request: ExportRequest,
    pub response_tx: oneshot::Sender<BufferedWriteResult>,
}
#[derive(Debug, Clone)]
pub enum BufferedWriteResult {
    Success(ExportTraceServiceResponse),
    Error(BufferWriteError),
}

type RequestOps = HashMap<String, ExportRequest>;
pub type ExportRequestInnerEntry = (
    String,
    usize,
    String,
    std::collections::HashMap<String, SchemaRecords>,
    Option<TriggerAlertData>,
    Vec<MetadataItem>,
    Vec<MetadataItem>,
    ExportTracePartialSuccess,
    bool,
);
pub struct TraceServiceResponse {
    // org_id: String,
    // stream_name: String,
    response: Result<(ExportTraceServiceResponse, Vec<Option<(String, String)>>), BufferWriteError>,
}
type NotifyResult = HashMap<String, TraceServiceResponse>;
type IoFlushNotifyResult = Result<NotifyResult, BufferWriteError>;
pub static SYNC_RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().unwrap());

#[derive(Debug)]
pub struct WriteBufferFlusher {
    join_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    wal_io_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    pub shutdown_tx: Option<watch::Sender<()>>,
    buffer_tx: mpsc::Sender<BufferedWrite>,
}

impl Default for WriteBufferFlusher {
    fn default() -> Self {
        Self::new()
    }
}

impl WriteBufferFlusher {
    pub fn new() -> Self {
        let (trace_shutdown_tx, trace_shutdown_rx) = watch::channel(());
        let (buffer_tx, buffer_rx) = mpsc::channel::<BufferedWrite>(flusher::BUFFER_CHANNEL_LIMIT);
        let (io_flush_tx, io_flush_rx) = crossbeam_channel::bounded(1);
        let (io_flush_notify_tx, io_flush_notify_rx) = crossbeam_channel::bounded(1);

        let flusher = Self {
            join_handle: Default::default(),
            wal_io_handle: Default::default(),
            shutdown_tx: Some(trace_shutdown_tx),
            buffer_tx,
        };

        *flusher.wal_io_handle.lock() = Some(
            std::thread::Builder::new()
                .name("write buffer io flusher".to_string())
                .spawn(move || {
                    run_trace_io_flush(io_flush_rx, io_flush_notify_tx);
                })
                .expect("failed to spawn write buffer io flusher thread"),
        );

        *flusher.join_handle.lock() = Some(tokio::task::spawn(async move {
            run_trace_op_buffer(
                buffer_rx,
                io_flush_tx,
                io_flush_notify_rx,
                trace_shutdown_rx,
            )
            .await
        }));

        flusher
    }

    pub async fn write(&self, request: ExportRequest) -> Result<BufferedWriteResult, Error> {
        let (response_tx, response_rx) = oneshot::channel();

        match self
            .buffer_tx
            .send(BufferedWrite {
                request,
                response_tx,
            })
            .await
        {
            Ok(_) => {
                let resp = response_rx.await.expect("wal op buffer thread is dead");
                match resp {
                    BufferedWriteResult::Success(_) => Ok(resp),
                    BufferedWriteResult::Error(e) => {
                        log::error!("flusher inside write resp error {e}");
                        Err(Error::new(ErrorKind::Other, e))
                    }
                }
            }
            Err(e) => {
                log::error!("flusher inside write error {e}");
                Err(Error::new(ErrorKind::Other, e))
            }
        }
    }

    pub fn get_shutdown_tx(&self) -> Option<watch::Sender<()>> {
        self.shutdown_tx.clone()
    }
}

pub fn run_trace_io_flush(
    io_flush_rx: CrossbeamReceiver<RequestOps>,
    io_flush_notify_tx: CrossbeamSender<IoFlushNotifyResult>,
) {
    loop {
        let request = match io_flush_rx.recv() {
            Ok(request) => request,
            Err(e) => {
                // the buffer channel has closed, it's shutdown
                info!("stopping wal io thread: {e}");
                return;
            }
        };

        let mut res: NotifyResult = HashMap::new();
        // write the ops to the segment files, or return on first error
        for (session_id, request) in request {
            let mut sr = TraceServiceResponse {
                response: Ok(Default::default()),
            };

            sr.response = match request {
                // Entry((org_id, thread_id, stream_name, entry, trigger, distinct_value,
                // trace_index, partical_success, is_grpc))
                ExportRequest::TraceEntry(entry) => SYNC_RT.block_on(handle_trace_request(
                    entry.0.as_str(),
                    entry.1,
                    entry.2.as_str(),
                    entry.3,
                    entry.4,
                    entry.5,
                    entry.6,
                    entry.7,
                    session_id.as_str(),
                    entry.8,
                )),
            };

            // Httpresponse may be partial_success, it must handle every response result
            res.insert(session_id, sr);
        }

        io_flush_notify_tx
            .send(Ok(res))
            .expect("buffer flusher is dead");
    }
}

pub async fn run_trace_op_buffer(
    mut buffer_rx: mpsc::Receiver<BufferedWrite>,
    io_flush_tx: CrossbeamSender<RequestOps>,
    io_flush_notify_rx: CrossbeamReceiver<IoFlushNotifyResult>,
    mut shutdown: tokio::sync::watch::Receiver<()>,
) {
    let mut ops = RequestOps::new();
    let mut notifies = Vec::new();
    let mut interval = tokio::time::interval(BUFFER_FLUSH_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        // select on either buffering an op, ticking the flush interval, or shutting down
        select! {
            Some(buffered_write) = buffer_rx.recv() => {
                let session_id = ider::uuid();
                let _ = ops.insert(session_id.clone(), buffered_write.request);
                notifies.push((session_id, buffered_write.response_tx));
            },
            _ = interval.tick() => {
                if ops.is_empty() {
                    continue;
                }
                // send ops into IO flush channel and wait for response
                if let Err(e) = io_flush_tx.send(ops.clone()) {
                    log::error!("io_flush_tx send e : {}, len: {}", e, io_flush_tx.len());
                }

                match io_flush_notify_rx.recv().expect("wal io thread is dead") {
                    Ok(mut resp) => {
                        for (sid, export_request) in &ops {
                            let ExportRequest::TraceEntry(er) = export_request;
                            let (org_id, thread_id, stream_name, entry, _, _,_, _, _) = er;
                            let trace_resp = resp.get(sid).and_then(|tsr| {tsr.response.as_ref().ok().map(|(_, v)| v)});
                            let _ = crate::service::ingestion::write_memtable(org_id, *thread_id, sid, stream_name, entry.clone(), trace_resp).await;
                        }
                        // notify the watchers of the write response
                        for (sid, response_tx) in notifies {
                            match resp.remove(&sid) {
                                Some(r) => {
                                    let bwr = match r.response {
                                        Ok(ets) => {
                                            BufferedWriteResult::Success(ets.0)
                                        }
                                        Err(e) => {
                                            log::error!("io_flush_notify_rx resp error : {e}");
                                            BufferedWriteResult::Error(e)
                                        }
                                    };

                                    let _ = response_tx.send(bwr);
                                }
                                None => { warn!("[{sid}] ingest not found") }
                            }

                        }
                    },
                    Err(_) => unimplemented!(),
                };

                // reset the buffers
                ops = RequestOps::new();
                notifies = Vec::new();
            },
            _ = shutdown.changed() => {
                // shutdown has been requested
                info!("stopping wal op buffer thread");
                return;
            }
        }
    }
}
