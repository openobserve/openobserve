use std::{
    io::{Error, ErrorKind},
    sync::Arc,
    time::Duration,
};

use actix_web::web;
use config::ider;
use crossbeam_channel::{Receiver as CrossbeamReceiver, Sender as CrossbeamSender};
use hashbrown::HashMap;
use infra::errors::BufferWriteError;
use ingester::Writer;
use log::{info, warn};
use once_cell::sync::Lazy;
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use parking_lot::Mutex;
use tokio::{
    runtime::Runtime,
    select,
    sync::{mpsc, oneshot, watch},
    time::MissedTickBehavior,
};

use crate::{
    common::meta::{stream::SchemaRecords, traces::ExportTraceServiceResponse},
    service::traces::{flusher, handle_trace_json_request, handle_trace_request},
};

const BUFFER_FLUSH_INTERVAL: Duration = Duration::from_millis(10);
// The maximum number of buffered writes that can be queued up before backpressure is applied
pub const BUFFER_CHANNEL_LIMIT: usize = 10_000;

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
                    BufferedWriteResult::Error(e) => Err(Error::new(ErrorKind::Other, e)),
                }
            }
            Err(e) => {
                info!("flusher write error : {}", e);
                Err(Error::new(ErrorKind::Other, e))
            }
        }
    }

    pub fn get_shutdown_tx(&self) -> Option<watch::Sender<()>> {
        self.shutdown_tx.clone()
    }
}
#[derive(Debug)]
pub enum ExportRequest {
    GrpcExportTraceServiceRequest(
        (
            String,
            usize,
            tonic::Request<ExportTraceServiceRequest>,
            Option<String>,
        ),
    ),
    HttpJsonExportTraceServiceRequest((String, usize, web::Bytes, Option<String>)),
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
type NotifyResult = HashMap<
    String,
    Result<
        (
            ExportTraceServiceResponse,
            Arc<Writer>,
            std::collections::HashMap<String, SchemaRecords>,
            String,
        ),
        BufferWriteError,
    >,
>;
type IoFlushNotifyResult = Result<NotifyResult, BufferWriteError>;
pub static SYNC_RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().unwrap());

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

        let mut res = HashMap::new();
        // write the ops to the segment files, or return on first error
        for (session_id, request) in request {
            let resp = match request {
                ExportRequest::GrpcExportTraceServiceRequest(r) => SYNC_RT.block_on(async {
                    handle_trace_request(
                        r.0.as_str(),
                        r.1,
                        r.2.into_inner(),
                        true,
                        r.3.as_deref(),
                        session_id.as_str(),
                    )
                    .await
                }),
                ExportRequest::HttpJsonExportTraceServiceRequest(r) => {
                    let in_stream_name = r.3.unwrap_or("".to_string());
                    SYNC_RT.block_on(async {
                        handle_trace_json_request(
                            r.0.as_str(),
                            r.1,
                            r.2,
                            Some(in_stream_name.as_str()),
                        )
                        .await
                    })
                }
            };

            // Httpresponse may be partial_success, it must handle every response result
            res.insert(session_id, resp);
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
                match buffered_write.request {
                    ExportRequest::GrpcExportTraceServiceRequest(r) => {
                        let metadata = r.2.metadata().clone();
                        let default_session_id = tonic::metadata::MetadataValue::try_from(ider::uuid()).unwrap();
                        let session_id = metadata
                            .get("session_id")
                            .unwrap_or(&default_session_id)
                            .to_str()
                            .unwrap();
                        let _ = ops.insert(session_id.to_string(), ExportRequest::GrpcExportTraceServiceRequest(r));
                        notifies.push((session_id.to_string(), buffered_write.response_tx));
                    }

                    ExportRequest::HttpJsonExportTraceServiceRequest(r) => {
                        let session_id = ider::uuid();
                        let _ = ops.insert(session_id.to_string(), ExportRequest::HttpJsonExportTraceServiceRequest(r));
                        notifies.push((session_id.to_string(), buffered_write.response_tx));
                    }
                }
            },
            _ = interval.tick() => {
                if ops.is_empty() {
                    continue;
                }
                // send ops into IO flush channel and wait for response
                if let Err(e) = io_flush_tx.send(ops) {
                    info!("io_flush_tx send e : {}, len: {}", e, io_flush_tx.len());
                }
                match io_flush_notify_rx.recv().expect("wal io thread is dead") {
                    Ok(mut resp) => {
                        for (sid, notify) in &resp {
                            if let Ok((_, w, data_buf, service_name)) = notify {
                                // let mut m: std::collections::HashMap<String, SchemaRecords> = Default::default();
                                // m.extend(data_buf.iter().cloned());
                                // todo move memtable logic from wal writer , memtable refresh
                                let _ = crate::service::ingestion::write_memtable(w, sid, data_buf.clone(), service_name).await;
                            }
                        }

                        // notify the watchers of the write response
                        for (sid, response_tx) in notifies {
                            match resp.remove(&sid) {
                                Some(r) => {
                                    let bwr = match r {
                                        Ok(ets) => {
                                            BufferedWriteResult::Success(ets.0)
                                        }
                                        Err(e) => {
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
