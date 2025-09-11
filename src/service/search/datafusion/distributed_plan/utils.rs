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

use std::{
    fmt,
    sync::Arc,
    task::{Context, Poll},
};

use arrow_flight::{Ticket, flight_service_client::FlightServiceClient};
use config::meta::cluster::NodeInfo;
use datafusion::{
    common::Result,
    error::{DataFusionError, SharedResult},
};
use futures::{
    FutureExt,
    future::{BoxFuture, Shared},
};
use futures_util::ready;
use parking_lot::Mutex;
use prost::Message;
use proto::cluster_rpc;
use tonic::{
    Request, Status,
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    service::interceptor::InterceptedService,
    transport::Channel,
};

use crate::service::{
    grpc::get_cached_channel,
    search::{MetadataMap, request::FlightSearchRequest},
};

pub async fn make_flight_client(
    trace_id: String,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    request: FlightSearchRequest,
    context: &opentelemetry::Context,
    timeout: u64,
) -> Result<
    (
        FlightServiceClient<
            InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status>>,
        >,
        tonic::Request<Ticket>,
    ),
    tonic::Status,
> {
    let cfg = config::get_config();
    let request: cluster_rpc::FlightSearchRequest = request.into();
    let mut buf: Vec<u8> = Vec::new();
    request
        .encode(&mut buf)
        .map_err(|e| Status::internal(format!("{e:?}")))?;

    let mut request = tonic::Request::new(Ticket { ticket: buf.into() });

    let org_id: MetadataValue<_> = org_id
        .parse()
        .map_err(|_| Status::internal("invalid org_id".to_string()))?;

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(context, &mut MetadataMap(request.metadata_mut()))
    });

    let org_header_key: MetadataKey<_> = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Status::internal("invalid org_header_key".to_string()))?;
    let token: MetadataValue<_> = node
        .get_auth_token()
        .parse()
        .map_err(|_| Status::internal("invalid token".to_string()))?;
    let channel = match get_cached_channel(&node.get_grpc_addr()).await {
        Ok(channel) => channel,
        Err(e) => {
            log::error!(
                "[trace_id {trace_id}] flight->search: node: {}, connect err: {e:?}",
                node.get_grpc_addr()
            );
            return Err(Status::internal(e.to_string()));
        }
    };

    let client =
        FlightServiceClient::with_interceptor(channel, move |mut req: tonic::Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut()
                .insert(org_header_key.clone(), org_id.clone());
            req.set_timeout(std::time::Duration::from_secs(timeout));
            Ok(req)
        });
    let client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    Ok((client, request))
}

/// refer: https://github.com/apache/datafusion/blob/351675ddc27c42684a079b3a89fe2dee581d89a2/datafusion/physical-plan/src/joins/utils.rs#L336
/// A [`OnceAsync`] runs an `async` closure once, where multiple calls to
/// [`OnceAsync::try_once`] return a [`OnceFut`] that resolves to the result of the
/// same computation.
///
/// This is useful for joins where the results of one child are needed to proceed
/// with multiple output stream
///
/// For example, in a hash join, one input is buffered and shared across
/// potentially multiple output partitions. Each output partition must wait for
/// the hash table to be built before proceeding.
///
/// Each output partition waits on the same `OnceAsync` before proceeding.
pub(crate) struct OnceAsync<T> {
    fut: Mutex<Option<SharedResult<OnceFut<T>>>>,
}

impl<T> Default for OnceAsync<T> {
    fn default() -> Self {
        Self {
            fut: Mutex::new(None),
        }
    }
}

impl<T> fmt::Debug for OnceAsync<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "OnceAsync")
    }
}

impl<T: 'static> OnceAsync<T> {
    /// If this is the first call to this function on this object, will invoke
    /// `f` to obtain a future and return a [`OnceFut`] referring to this. `f`
    /// may fail, in which case its error is returned.
    ///
    /// If this is not the first call, will return a [`OnceFut`] referring
    /// to the same future as was returned by the first call - or the same
    /// error if the initial call to `f` failed.
    pub(crate) fn try_once<F, Fut>(&self, f: F) -> Result<OnceFut<T>>
    where
        F: FnOnce() -> Result<Fut>,
        Fut: Future<Output = Result<T>> + Send + 'static,
    {
        self.fut
            .lock()
            .get_or_insert_with(|| f().map(OnceFut::new).map_err(Arc::new))
            .clone()
            .map_err(DataFusionError::Shared)
    }
}

/// A [`OnceFut`] represents a shared asynchronous computation, that will be evaluated
/// once for all [`Clone`]'s, with [`OnceFut::get`] providing a non-consuming interface
/// to drive the underlying [`Future`] to completion
pub(crate) struct OnceFut<T> {
    state: OnceFutState<T>,
}

impl<T> Clone for OnceFut<T> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
        }
    }
}

enum OnceFutState<T> {
    Pending(OnceFutPending<T>),
    Ready(SharedResult<Arc<T>>),
}

impl<T> Clone for OnceFutState<T> {
    fn clone(&self) -> Self {
        match self {
            Self::Pending(p) => Self::Pending(p.clone()),
            Self::Ready(r) => Self::Ready(r.clone()),
        }
    }
}

impl<T: 'static> OnceFut<T> {
    /// Create a new [`OnceFut`] from a [`Future`]
    pub(crate) fn new<Fut>(fut: Fut) -> Self
    where
        Fut: Future<Output = Result<T>> + Send + 'static,
    {
        Self {
            state: OnceFutState::Pending(
                fut.map(|res| res.map(Arc::new).map_err(Arc::new))
                    .boxed()
                    .shared(),
            ),
        }
    }

    /// Get shared reference to the result of the computation if it is ready, without consuming it
    pub(crate) fn get_shared(&mut self, cx: &mut Context<'_>) -> Poll<Result<Arc<T>>> {
        if let OnceFutState::Pending(fut) = &mut self.state {
            let r = ready!(fut.poll_unpin(cx));
            self.state = OnceFutState::Ready(r);
        }

        match &self.state {
            OnceFutState::Pending(_) => unreachable!(),
            OnceFutState::Ready(r) => Poll::Ready(r.clone().map_err(DataFusionError::Shared)),
        }
    }
}

/// The shared future type used internally within [`OnceAsync`]
type OnceFutPending<T> = Shared<BoxFuture<'static, SharedResult<Arc<T>>>>;
