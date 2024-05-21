use std::{
    io::{Error, ErrorKind},
    time::Duration,
};

use actix_web::{http, HttpResponse, web};
use config::ider;
use crossbeam_channel::{Receiver as CrossbeamReceiver, Sender as CrossbeamSender};
use hashbrown::HashMap;
use log::info;
use once_cell::sync::Lazy;
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use parking_lot::Mutex;
use tokio::{
    runtime::Runtime,
    select,
    sync::{mpsc, oneshot, watch},
    time::MissedTickBehavior,
};

use crate::service::traces::{flusher, handle_trace_json_request, handle_trace_request};

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
        info!("WriteBufferFlusher new start");
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
                info!("flusher success ,start to response_rx.await");
                let resp = response_rx.await.expect("wal op buffer thread is dead");
                info!(
                    "flusher success ,response_rx.await done , resp : {:?}",
                    resp
                );
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
    Success(()),
    Error(String),
}

type RequestOps = HashMap<String, ExportRequest>;
pub static RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().unwrap());

pub fn run_trace_io_flush(
    io_flush_rx: CrossbeamReceiver<RequestOps>,
    io_flush_notify_tx: CrossbeamSender<Result<(), Error>>,
) {
    'IOLOOP: loop {
        info!(
            "run_trace_io_flush loop start, buffer_rx len : {}",
            io_flush_rx.len()
        );
        let request = match io_flush_rx.recv() {
            Ok(request) => request,
            Err(e) => {
                // the buffer channel has closed, it's shutdown
                info!("stopping wal io thread: {e}");
                return;
            }
        };

        // let mut state = segment_state.write();
        info!(
            "run_trace_io_flush request for start, buffer_rx len : {}, request len: {}",
            io_flush_rx.len(),
            request.len()
        );
        // write the ops to the segment files, or return on first error
        for (session_id, request) in request {
            info!("[{session_id}]run_trace_io_flush start request handle");
            let resp = match request {
                ExportRequest::GrpcExportTraceServiceRequest(r) => {
                    info!(
                        "[{session_id}]run_trace_io_flush ExportRequest::GrpcExportTraceServiceRequest RT.block_on start"
                    );
                    let req = r.2.into_inner();
                    let in_stream_name = r.3.unwrap_or("".to_string());
                    // RT.block_on(async {
                    //     handle_trace_request(
                    //         r.0.as_str(),
                    //         r.1,
                    //         req,
                    //         true,
                    //         Some(in_stream_name.as_str()),
                    //         session_id.as_str(),
                    //     )
                    //     .await
                    // })
                    Ok(HttpResponse::Ok()
                        .status(http::StatusCode::OK)
                        .content_type("application/x-protobuf"))
                }
                ExportRequest::HttpJsonExportTraceServiceRequest(r) => {
                    let in_stream_name = r.3.unwrap_or("".to_string());
                    info!(
                        "[{session_id}]run_trace_io_flush ExportRequest::HttpJsonExportTraceServiceRequest RT.block_on start"
                    );
                    // RT.block_on(async {
                    //     handle_trace_json_request(
                    //         r.0.as_str(),
                    //         r.1,
                    //         r.2,
                    //         Some(in_stream_name.as_str()),
                    //     )
                    //     .await
                    // })
                    Ok(HttpResponse::Ok()
                        .status(http::StatusCode::OK)
                        .content_type("application/x-protobuf"))
                }
            };

            info!(
                "[{session_id}]run_trace_io_flush match resp: {:?}, io_flush_notify_tx len: {}",
                resp,
                io_flush_notify_tx.len()
            );

            if let Err(e) = resp {
                io_flush_notify_tx
                    .send(Err(Error::new(ErrorKind::Other, e.to_string())))
                    .expect("buffer flusher is dead");
                continue 'IOLOOP;
            }
        }

        info!(
            "run_trace_io_flush for request done, io_flush_notify_tx len: {} ",
            io_flush_notify_tx.len()
        );
        io_flush_notify_tx
            .send(Ok(()))
            .expect("buffer flusher is dead");
    }
}

pub async fn run_trace_op_buffer(
    mut buffer_rx: mpsc::Receiver<BufferedWrite>,
    io_flush_tx: CrossbeamSender<RequestOps>,
    io_flush_notify_rx: CrossbeamReceiver<Result<(), Error>>,
    mut shutdown: tokio::sync::watch::Receiver<()>,
) {
    let mut ops = RequestOps::new();
    let mut notifies = Vec::new();
    let mut interval = tokio::time::interval(BUFFER_FLUSH_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!("run_trace_op_buffer start");
    loop {
        // select on either buffering an op, ticking the flush interval, or shutting down
        select! {
            Some(buffered_write) = buffer_rx.recv() => {
                info!("buffer_rx.recv success");
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
                        notifies.push(buffered_write.response_tx);
                        info!("GrpcExportTraceServiceRequest push done");
                    }

                    ExportRequest::HttpJsonExportTraceServiceRequest(r) => {
                        let session_id = ider::uuid();
                        let _ = ops.insert(session_id.to_string(), ExportRequest::HttpJsonExportTraceServiceRequest(r));
                        notifies.push(buffered_write.response_tx);
                        info!("HttpJsonExportTraceServiceRequest push done");
                    }
                }
            },
            _ = interval.tick() => {
                if ops.is_empty() {
                    continue;
                }
                info!("io_flush_tx send start, io_flush_tx len: {}", io_flush_tx.len());
                // send ops into IO flush channel and wait for response
                if let Err(e) = io_flush_tx.send(ops) {
                    info!("io_flush_tx send e : {}, len: {}", e, io_flush_tx.len());
                }
                info!("io_flush_tx send done len: {}", io_flush_tx.len());
                let res = match io_flush_notify_rx.recv().expect("wal io thread is dead") {
                    Ok(_resp) => {
                       BufferedWriteResult::Success(())
                    },
                    Err(e) => BufferedWriteResult::Error(e.to_string()),
                };
                info!("io_flush_tx get buffer write result done, notifies len : {}, res: {:?}", notifies.len(), res);
                // notify the watchers of the write response
                for response_tx in notifies {
                    info!("io_flush_tx response_tx, res: {:?}", res);
                    let _ = response_tx.send(res.clone());
                }
                info!("io_flush_tx response_tx send done");
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
