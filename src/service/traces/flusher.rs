use std::{
    io::{Error, ErrorKind},
    time::Duration,
};

use config::{ider, CONFIG};
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

use crate::service::traces::{flusher, handle_trace_request};

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

    pub async fn write(
        &self,
        request: tonic::Request<ExportRequest>,
    ) -> Result<BufferedWriteResult, Error> {
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
                println!("{}", e);
                Err(Error::new(ErrorKind::Other, e))
            }
        }
    }

    pub fn get_shutdown_tx(&self) -> Option<watch::Sender<()>> {
        self.shutdown_tx.clone()
    }
}

pub enum ExportRequest {
    ExportTraceServiceRequest(ExportTraceServiceRequest),
}
pub struct BufferedWrite {
    pub request: tonic::Request<ExportRequest>,
    pub response_tx: oneshot::Sender<BufferedWriteResult>,
}
#[derive(Debug, Clone)]
pub enum BufferedWriteResult {
    Success(()),
    Error(String),
}

type RequestOps = HashMap<String, tonic::Request<ExportRequest>>;
pub static RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().unwrap());

pub fn run_trace_io_flush(
    buffer_rx: CrossbeamReceiver<RequestOps>,
    buffer_notify: CrossbeamSender<Result<(), Error>>,
) {
    loop {
        let request = match buffer_rx.recv() {
            Ok(request) => request,
            Err(e) => {
                // the buffer channel has closed, it's shutdown
                info!("stopping wal io thread: {e}");
                return;
            }
        };

        // let mut state = segment_state.write();

        // write the ops to the segment files, or return on first error
        for (session_id, r) in request {
            let msg = format!(
                "Please specify organization id with header key '{}' ",
                &CONFIG.grpc.org_header_key
            );
            let metadata = r.metadata().clone();
            let in_req = r.into_inner();
            let org_id = metadata.get(&CONFIG.grpc.org_header_key);
            if org_id.is_none() {
                buffer_notify
                    .send(Err(Error::new(std::io::ErrorKind::Other, msg)))
                    .expect("buffer flusher is dead");
                continue;
            }

            let stream_name = metadata.get(&CONFIG.grpc.stream_header_key);
            let mut in_stream_name: Option<&str> = None;
            if let Some(stream_name) = stream_name {
                in_stream_name = Some(stream_name.to_str().unwrap());
            };

            let thread_id = metadata.get("thread_id");
            let mut in_thread_id: usize = 0;
            if let Some(thread_id) = thread_id {
                in_thread_id = thread_id.to_str().unwrap().parse::<usize>().unwrap();
            };

            let resp = RT.block_on(async {
                match in_req {
                    ExportRequest::ExportTraceServiceRequest(r) => {
                        handle_trace_request(
                            org_id.unwrap().to_str().unwrap(),
                            in_thread_id,
                            r,
                            true,
                            in_stream_name,
                            session_id.as_str(),
                        )
                        .await
                    }
                }
            });

            match resp {
                Ok(_) => {
                    buffer_notify.send(Ok(())).expect("buffer flusher is dead");
                    continue;
                }
                Err(_) => {
                    // the buffer channel has closed, it's shutdown
                    info!("stopping wal io thread");
                    return;
                }
            }
        }

        buffer_notify.send(Ok(())).expect("buffer flusher is dead");
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

    loop {
        // select on either buffering an op, ticking the flush interval, or shutting down
        select! {
            Some(buffered_write) = buffer_rx.recv() => {
                let metadata = buffered_write.request.metadata().clone();
                let default_session_id = tonic::metadata::MetadataValue::try_from(ider::uuid()).unwrap();
                let session_id = metadata
                    .get("session_id")
                    .unwrap_or(&default_session_id)
                    .to_str()
                    .unwrap();
                let _ = ops.insert(session_id.to_string(), buffered_write.request);
                notifies.push(buffered_write.response_tx);
            },
            _ = interval.tick() => {
                if ops.is_empty() {
                    continue;
                }

                // send ops into IO flush channel and wait for response
                io_flush_tx.send(ops).expect("wal io thread is dead");

                let res = match io_flush_notify_rx.recv().expect("wal io thread is dead") {
                  Ok(_resp) => {
                       BufferedWriteResult::Success(())
                    },
                    Err(e) => BufferedWriteResult::Error(e.to_string()),
                };

                // notify the watchers of the write response
                for response_tx in notifies {
                    let _ = response_tx.send(res.clone());
                }

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
