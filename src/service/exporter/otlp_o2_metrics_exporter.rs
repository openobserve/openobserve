use core::fmt;
use std::fmt::{Debug, Formatter};

use async_trait::async_trait;
use opentelemetry::metrics::Result;
use opentelemetry_proto::tonic::collector::metrics::v1::ExportMetricsServiceRequest;
use opentelemetry_sdk::metrics::{
    data::{ResourceMetrics, Temporality},
    exporter::PushMetricsExporter,
    reader::{AggregationSelector, TemporalitySelector},
    Aggregation, InstrumentKind,
};

use crate::service::metrics::otlp_grpc::handle_grpc_request;

/// An interface for OTLP metrics clients
#[async_trait]
pub trait MetricsClient: fmt::Debug + Send + Sync + 'static {
    async fn export(&self, metrics: &mut ResourceMetrics) -> Result<()>;
    fn shutdown(&self) -> Result<()>;
}

/// Export metrics in OTEL format.
pub struct O2MetricsExporter {
    client: Box<dyn MetricsClient>,
    temporality_selector: Box<dyn TemporalitySelector>,
    aggregation_selector: Box<dyn AggregationSelector>,
}

impl Debug for O2MetricsExporter {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MetricsExporter").finish()
    }
}

impl TemporalitySelector for O2MetricsExporter {
    fn temporality(&self, kind: InstrumentKind) -> Temporality {
        self.temporality_selector.temporality(kind)
    }
}

impl AggregationSelector for O2MetricsExporter {
    fn aggregation(&self, kind: InstrumentKind) -> Aggregation {
        self.aggregation_selector.aggregation(kind)
    }
}

#[async_trait]
impl PushMetricsExporter for O2MetricsExporter {
    async fn export(&self, metrics: &mut ResourceMetrics) -> Result<()> {
        self.client.export(metrics).await
    }

    async fn force_flush(&self) -> Result<()> {
        // this component is stateless
        Ok(())
    }

    fn shutdown(&self) -> Result<()> {
        self.client.shutdown()
    }
}

impl O2MetricsExporter {
    /// Create a new metrics exporter
    pub fn new(
        client: impl MetricsClient,
        temporality_selector: Box<dyn TemporalitySelector>,
        aggregation_selector: Box<dyn AggregationSelector>,
    ) -> O2MetricsExporter {
        O2MetricsExporter {
            client: Box::new(client),
            temporality_selector,
            aggregation_selector,
        }
    }
}

pub(crate) struct O2MetricsClient {}

impl fmt::Debug for O2MetricsClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("O2MetricsClient")
    }
}

impl O2MetricsClient {
    pub fn new() -> Self {
        O2MetricsClient {}
    }
}

#[async_trait]
impl MetricsClient for O2MetricsClient {
    async fn export(&self, metrics: &mut ResourceMetrics) -> Result<()> {
        if let Err(e) = handle_grpc_request(
            "default",
            ExportMetricsServiceRequest::from(&*metrics),
            true,
        )
        .await
        {
            log::error!("o2 metrics export fail : {e}")
        }

        Ok(())
    }

    fn shutdown(&self) -> Result<()> {
        Ok(())
    }
}
