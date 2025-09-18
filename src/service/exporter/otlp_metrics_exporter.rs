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
    fmt::{Debug, Formatter},
    time::Duration,
};

use opentelemetry_proto::tonic::collector::metrics::v1::ExportMetricsServiceRequest;
use opentelemetry_sdk::{
    error::OTelSdkResult,
    metrics::{Temporality, data::ResourceMetrics, exporter::PushMetricExporter},
};

use crate::service::metrics::otlp::handle_otlp_request;

/// Export metrics in OTEL format.
pub struct O2MetricsExporter {
    temporality_selector: Temporality,
}

impl Debug for O2MetricsExporter {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MetricsExporter").finish()
    }
}

impl PushMetricExporter for O2MetricsExporter {
    fn export(
        &self,
        metrics: &ResourceMetrics,
    ) -> impl std::future::Future<Output = OTelSdkResult> + Send {
        // Convert to ExportMetricsServiceRequest immediately to avoid lifetime issues
        let request = ExportMetricsServiceRequest::from(metrics);
        async move {
            if let Err(e) = handle_otlp_request(
                "default",
                request,
                config::meta::otlp::OtlpRequestType::Grpc,
            )
            .await
            {
                log::error!("o2 metrics export fail : {e}");
            }
            Ok(())
        }
    }

    fn temporality(&self) -> Temporality {
        self.temporality_selector
    }

    fn force_flush(&self) -> OTelSdkResult {
        // this component is stateless
        Ok(())
    }

    fn shutdown(&self) -> OTelSdkResult {
        Ok(())
    }

    fn shutdown_with_timeout(&self, _timeout: Duration) -> OTelSdkResult {
        Ok(())
    }
}

impl O2MetricsExporter {
    /// Create a new metrics exporter
    pub fn new(temporality_selector: Temporality) -> O2MetricsExporter {
        O2MetricsExporter {
            temporality_selector,
        }
    }
}
