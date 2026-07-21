// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Shared query-condition evaluation for alerts and scheduled pipelines.
//!
//! The evaluator owns query construction and result interpretation, while the
//! application supplies query execution, tracing, and reporting through
//! [`QueryExecutor`]. This keeps feature crates independent of the concrete
//! search-service implementation.

use std::sync::{Arc, OnceLock};

use config::meta::{
    promql,
    search::{MultiStreamRequest, Request, Response},
    stream::StreamType,
};

mod evaluation;

pub use evaluation::{QueryConditionExt, build_sql};

#[async_trait::async_trait]
pub trait QueryExecutor: Send + Sync + 'static {
    /// Execute through the application search service rather than the
    /// background gRPC orchestration used by scheduled conditions.
    async fn search_service(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        request: &Request,
    ) -> infra::errors::Result<Response>;

    async fn search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        request: &Request,
    ) -> infra::errors::Result<Response>;

    async fn search_multi(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        request: &MultiStreamRequest,
    ) -> infra::errors::Result<Response>;

    #[allow(clippy::too_many_arguments)]
    async fn promql_search(
        &self,
        trace_id: &str,
        org_id: &str,
        query: String,
        start: i64,
        end: i64,
        step: i64,
        is_super_cluster: bool,
    ) -> anyhow::Result<promql::value::Value>;

    async fn setup_tracing_with_trace_id(
        &self,
        trace_id: &str,
        span: tracing::Span,
    ) -> tracing::Span;

    fn report_search_metrics(
        &self,
        start: std::time::Instant,
        org_id: &str,
        stream_type: StreamType,
        search_type: &str,
    );
}

static QUERY_EXECUTOR: OnceLock<Arc<dyn QueryExecutor>> = OnceLock::new();

pub fn install_query_executor(
    executor: Arc<dyn QueryExecutor>,
) -> Result<(), Arc<dyn QueryExecutor>> {
    QUERY_EXECUTOR.set(executor)
}

fn query_executor() -> anyhow::Result<&'static dyn QueryExecutor> {
    QUERY_EXECUTOR
        .get()
        .map(Arc::as_ref)
        .ok_or_else(|| anyhow::anyhow!("query evaluator executor is not installed"))
}

pub(crate) async fn search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    request: &Request,
) -> infra::errors::Result<Response> {
    query_executor()
        .map_err(|error| infra::errors::Error::Message(error.to_string()))?
        .search(trace_id, org_id, stream_type, request)
        .await
}

pub async fn search_service(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    request: &Request,
) -> infra::errors::Result<Response> {
    query_executor()
        .map_err(|error| infra::errors::Error::Message(error.to_string()))?
        .search_service(trace_id, org_id, stream_type, request)
        .await
}

pub(crate) async fn search_multi(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    request: &MultiStreamRequest,
) -> infra::errors::Result<Response> {
    query_executor()
        .map_err(|error| infra::errors::Error::Message(error.to_string()))?
        .search_multi(trace_id, org_id, stream_type, request)
        .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn promql_search(
    trace_id: &str,
    org_id: &str,
    query: String,
    start: i64,
    end: i64,
    step: i64,
    is_super_cluster: bool,
) -> anyhow::Result<promql::value::Value> {
    query_executor()?
        .promql_search(trace_id, org_id, query, start, end, step, is_super_cluster)
        .await
}

pub(crate) async fn setup_tracing_with_trace_id(
    trace_id: &str,
    span: tracing::Span,
) -> tracing::Span {
    match query_executor() {
        Ok(executor) => executor.setup_tracing_with_trace_id(trace_id, span).await,
        Err(_) => span,
    }
}

pub(crate) fn report_search_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    search_type: &str,
) {
    if let Ok(executor) = query_executor() {
        executor.report_search_metrics(start, org_id, stream_type, search_type);
    }
}
