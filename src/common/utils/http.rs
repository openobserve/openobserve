// Copyright 2024 Zinc Labs Inc.
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
    collections::HashMap,
    io::{Error, ErrorKind},
};

use actix_http::header::HeaderName;
use actix_web::web::Query;
use awc::http::header::HeaderMap;
use config::meta::{search::SearchEventType, stream::StreamType};
use opentelemetry::{global, propagation::Extractor, trace::TraceContextExt};
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[inline(always)]
pub(crate) fn get_stream_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Result<Option<StreamType>, Error> {
    let stream_type = match query.get("type") {
        Some(s) => match s.to_lowercase().as_str() {
            "logs" => Some(StreamType::Logs),
            "metrics" => Some(StreamType::Metrics),
            "traces" => Some(StreamType::Traces),
            "enrichment_tables" => Some(StreamType::EnrichmentTables),
            "metadata" => Some(StreamType::Metadata),
            "index" => Some(StreamType::Index),
            _ => {
                return Err(Error::new(
                    ErrorKind::Other,
                    "'type' query param with value 'logs', 'metrics', 'traces', 'enrichment_table', 'metadata' or 'index' allowed",
                ));
            }
        },
        None => None,
    };

    Ok(stream_type)
}

#[inline(always)]
pub(crate) fn get_search_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Result<Option<SearchEventType>, Error> {
    let event_type = match query.get("search_type") {
        Some(s) => match s.to_lowercase().as_str() {
            "ui" => Some(SearchEventType::UI),
            "dashboards" => Some(SearchEventType::Dashboards),
            "reports" => Some(SearchEventType::Reports),
            "alerts" => Some(SearchEventType::Alerts),
            "values" => Some(SearchEventType::Values),
            "rum" => Some(SearchEventType::RUM),
            _ => {
                return Err(Error::new(
                    ErrorKind::Other,
                    "'event_type' query param with value 'ui', 'dashboards', 'reports', 'alerts' , 'rum' or 'values' allowed",
                ));
            }
        },
        None => None,
    };

    Ok(event_type)
}

#[inline(always)]
pub(crate) fn get_use_cache_from_request(query: &Query<HashMap<String, String>>) -> bool {
    match query.get("use_cache") {
        Some(s) => match s.to_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => true,
        },
        None => true,
    }
}

#[inline(always)]
pub(crate) fn get_folder(query: &Query<HashMap<String, String>>) -> String {
    match query.get("folder") {
        Some(s) => s.to_string(),
        None => crate::common::meta::dashboards::DEFAULT_FOLDER.to_owned(),
    }
}

#[inline(always)]
pub(crate) fn get_or_create_trace_id_and_span(
    headers: &HeaderMap,
    ep: String,
) -> (String, Option<tracing::Span>) {
    let cfg = config::get_config();
    if let Some(traceparent) = headers.get("traceparent") {
        if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
            // OpenTelemetry is initialized -> can use propagator to get traceparent
            let ctx = global::get_text_map_propagator(|propagator| {
                propagator.extract(&RequestHeaderExtractor::new(headers))
            });
            let trace_id = ctx.span().span_context().trace_id().to_string();

            let span = if cfg.common.tracing_search_enabled {
                // Create the span and set parent context
                let span = tracing::info_span!("{ep}", ep = ep);
                span.set_parent(ctx);
                Some(span)
            } else {
                None
            };
            (trace_id, span)
        } else {
            // manually parse trace_id
            if let Ok(traceparent_str) = traceparent.to_str() {
                let parts: Vec<&str> = traceparent_str.split('-').collect();
                if parts.len() >= 3 {
                    let trace_id = parts[1].to_string();
                    // If the trace-id value is invalid (for example if it contains non-allowed
                    // characters or all zeros), vendors MUST ignore the traceparent.
                    // https://www.w3.org/TR/trace-context/#traceparent-header
                    if trace_id.len() == 32 && !trace_id.chars().all(|c| c == '0') {
                        return (trace_id, None);
                    }
                }
            }
            // If parsing fails or trace_id is invalid, generate a new one
            log::warn!("Failed to parse valid trace_id from received [Traceparent] header");
            (config::ider::uuid(), None)
        }
    } else if cfg.common.tracing_search_enabled {
        let span = tracing::info_span!("{ep}", ep = ep);
        let trace_id = span.context().span().span_context().trace_id().to_string();
        (trace_id, Some(span))
    } else {
        (config::ider::uuid(), None)
    }
}

// Extractor for request headers
pub struct RequestHeaderExtractor<'a> {
    headers: &'a HeaderMap,
}

impl<'a> RequestHeaderExtractor<'a> {
    pub fn new(headers: &'a HeaderMap) -> Self {
        RequestHeaderExtractor { headers }
    }
}

impl<'a> Extractor for RequestHeaderExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        // Convert the key to a HeaderName, ignoring case
        HeaderName::try_from(key)
            .ok()
            .and_then(|header_name| self.headers.get(header_name))
            .and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.headers.keys().map(|header| header.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_file_from_cache() {
        let key = "type".to_string();

        let mut map: HashMap<String, String> = HashMap::default();
        map.insert(key.clone(), key.clone());

        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert!(resp.is_err());

        map.insert(key.clone(), "LOGS".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Logs));

        map.insert(key.clone(), "METRICS".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Metrics));

        map.insert(key.clone(), "TRACES".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Traces));
    }
}
