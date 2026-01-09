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

/// Helper functions to set OpenTelemetry span kinds for proper service graph generation.
///
/// According to OTEL spec:
/// - INTERNAL: Operations within a single process (function calls, local operations)
/// - CLIENT: Outbound RPC/HTTP calls to other services
/// - SERVER: Inbound RPC/HTTP request handlers
/// - PRODUCER: Message queue producers
/// - CONSUMER: Message queue consumers
use tracing::Span;

const SPAN_KIND: &str = "otel.kind";

/// Sets the current span kind to SERVER.
/// Use this for inbound gRPC/HTTP request handlers.
///
/// # Example
/// ```rust
/// #[tracing::instrument(name = "grpc:server:search", skip_all)]
/// async fn handle_request(
///     req: Request<SearchRequest>,
/// ) -> Result<Response<SearchResponse>, Status> {
///     set_span_kind_server();
///     // Handle request...
/// }
/// ```
pub fn set_span_kind_server() {
    Span::current().record(SPAN_KIND, "server");
}
