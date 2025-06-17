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
    io::{Error, ErrorKind},
    net::{AddrParseError, IpAddr, SocketAddr},
};

use actix_web::{
    http::header::{HeaderMap, HeaderName},
    web::Query,
};
use config::meta::{
    search::{SearchEventContext, SearchEventType, default_use_cache},
    stream::StreamType,
};
use hashbrown::{HashMap, HashSet};
use opentelemetry::{global, propagation::Extractor, trace::TraceContextExt};
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[inline(always)]
pub(crate) fn get_stream_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Option<StreamType> {
    query.get("type").map(|s| StreamType::from(s.as_str()))
}

#[inline(always)]
pub(crate) fn get_fallback_order_by_col_from_request(
    query: &Query<HashMap<String, String>>,
) -> Option<String> {
    query.get("fallback_order_by_col").map(|s| s.to_string())
}

#[inline(always)]
pub(crate) fn get_search_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Result<Option<SearchEventType>, Error> {
    let event_type = match query.get("search_type") {
        Some(s) => match SearchEventType::try_from(s.as_str()) {
            Ok(search_type) => Some(search_type),
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
pub(crate) fn get_search_event_context_from_request(
    search_event_type: &SearchEventType,
    query: &Query<HashMap<String, String>>,
) -> Option<SearchEventContext> {
    match search_event_type {
        SearchEventType::Dashboards => Some(SearchEventContext::with_dashboard(
            query.get("dashboard_id").map(String::from),
            query.get("dashboard_name").map(String::from),
            query.get("folder_id").map(String::from),
            query.get("folder_name").map(String::from),
        )),
        SearchEventType::Alerts => Some(SearchEventContext::with_alert(
            query.get("alert_key").map(String::from),
        )),
        SearchEventType::Reports => Some(SearchEventContext::with_report(
            query.get("report_id").map(String::from),
        )),
        _ => None,
    }
}

#[inline(always)]
pub(crate) fn get_use_cache_from_request(query: &Query<HashMap<String, String>>) -> bool {
    if !default_use_cache() {
        return false;
    }
    let Some(v) = query.get("use_cache") else {
        return true;
    };
    v.to_lowercase().as_str().parse::<bool>().unwrap_or(true)
}

#[inline(always)]
pub(crate) fn get_folder(query: &Query<HashMap<String, String>>) -> String {
    match query.get("folder") {
        Some(s) => s.to_string(),
        None => config::meta::folder::DEFAULT_FOLDER.to_owned(),
    }
}

#[inline(always)]
pub(crate) fn get_or_create_trace_id(headers: &HeaderMap, span: &tracing::Span) -> String {
    let cfg = config::get_config();
    if let Some(traceparent) = headers.get("traceparent") {
        if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
            // OpenTelemetry is initialized -> can use propagator to get traceparent
            let ctx = global::get_text_map_propagator(|propagator| {
                propagator.extract(&RequestHeaderExtractor::new(headers))
            });
            let trace_id = ctx.span().span_context().trace_id().to_string();
            if !span.is_none() {
                span.set_parent(ctx);
            }
            trace_id
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
                        return trace_id;
                    }
                }
            }
            // If parsing fails or trace_id is invalid, generate a new one
            log::warn!("Failed to parse valid trace_id from received [Traceparent] header");
            config::ider::generate_trace_id()
        }
    } else if !span.is_none() {
        span.context().span().span_context().trace_id().to_string()
    } else {
        config::ider::generate_trace_id()
    }
}

/// This function can handle IPv4 and IPv6 addresses which may have port numbers appended
pub fn parse_ip_addr(ip_address: &str) -> Result<(IpAddr, Option<u16>), AddrParseError> {
    let mut port: Option<u16> = None;
    let ip = ip_address.parse::<IpAddr>().or_else(|_| {
        ip_address
            .parse::<SocketAddr>()
            .map(|sock_addr| {
                port = Some(sock_addr.port());
                sock_addr.ip()
            })
            .map_err(|e| {
                log::error!("Error parsing IP address: {}, {}", &ip_address, e);
                e
            })
    })?;

    Ok((ip, port))
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

impl Extractor for RequestHeaderExtractor<'_> {
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

pub fn get_work_group(work_group_set: Vec<Option<String>>) -> Option<String> {
    let work_groups = work_group_set.into_iter().flatten().collect::<HashSet<_>>();
    if work_groups.contains("long") {
        return Some("long".to_string());
    } else if work_groups.contains("short") {
        return Some("short".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use actix_web::{http::header::HeaderValue, web::Query};

    use super::*;

    #[test]
    fn test_get_stream_type_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("type".to_string(), "logs".to_string());
        assert_eq!(get_stream_type_from_request(&query), Some(StreamType::Logs));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("type".to_string(), "metrics".to_string());
        assert_eq!(
            get_stream_type_from_request(&query),
            Some(StreamType::Metrics)
        );

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("type".to_string(), "traces".to_string());
        assert_eq!(
            get_stream_type_from_request(&query),
            Some(StreamType::Traces)
        );

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(get_stream_type_from_request(&query), None);
    }

    #[test]
    fn test_get_fallback_order_by_col_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("fallback_order_by_col".to_string(), "timestamp".to_string());
        assert_eq!(
            get_fallback_order_by_col_from_request(&query),
            Some("timestamp".to_string())
        );

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(get_fallback_order_by_col_from_request(&query), None);
    }

    #[test]
    fn test_get_search_type_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("search_type".to_string(), "ui".to_string());
        assert_eq!(
            get_search_type_from_request(&query).unwrap(),
            Some(SearchEventType::UI)
        );

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("search_type".to_string(), "dashboards".to_string());
        assert_eq!(
            get_search_type_from_request(&query).unwrap(),
            Some(SearchEventType::Dashboards)
        );

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("search_type".to_string(), "invalid".to_string());
        assert!(get_search_type_from_request(&query).is_err());

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(get_search_type_from_request(&query).unwrap(), None);
    }

    #[test]
    fn test_get_search_event_context_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("dashboard_id".to_string(), "123".to_string());
        query.insert("dashboard_name".to_string(), "Test Dashboard".to_string());
        query.insert("folder_id".to_string(), "456".to_string());
        query.insert("folder_name".to_string(), "Test Folder".to_string());

        let context =
            get_search_event_context_from_request(&SearchEventType::Dashboards, &query).unwrap();
        assert_eq!(context.dashboard_id, Some("123".to_string()));
        assert_eq!(context.dashboard_name, Some("Test Dashboard".to_string()));
        assert_eq!(context.dashboard_folder_id, Some("456".to_string()));
        assert_eq!(
            context.dashboard_folder_name,
            Some("Test Folder".to_string())
        );

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("alert_key".to_string(), "alert123".to_string());

        let context =
            get_search_event_context_from_request(&SearchEventType::Alerts, &query).unwrap();
        assert_eq!(context.alert_key, Some("alert123".to_string()));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("report_id".to_string(), "report123".to_string());

        let context =
            get_search_event_context_from_request(&SearchEventType::Reports, &query).unwrap();
        assert_eq!(context.report_key, Some("report123".to_string()));

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(
            get_search_event_context_from_request(&SearchEventType::UI, &query),
            None
        );
    }

    #[test]
    fn test_get_use_cache_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("use_cache".to_string(), "true".to_string());
        assert!(get_use_cache_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("use_cache".to_string(), "false".to_string());
        assert!(!get_use_cache_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("use_cache".to_string(), "invalid".to_string());
        assert!(get_use_cache_from_request(&query));

        let query = Query::<HashMap<String, String>>(Default::default());
        assert!(get_use_cache_from_request(&query));
    }

    #[test]
    fn test_get_folder() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("folder".to_string(), "custom_folder".to_string());
        assert_eq!(get_folder(&query), "custom_folder");

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(get_folder(&query), config::meta::folder::DEFAULT_FOLDER);
    }

    #[test]
    fn test_parse_ip_addr() {
        // Test IPv4
        let (ip, port) = parse_ip_addr("192.168.1.1").unwrap();
        assert_eq!(ip, "192.168.1.1".parse::<IpAddr>().unwrap());
        assert_eq!(port, None);

        // Test IPv4 with port
        let (ip, port) = parse_ip_addr("192.168.1.1:8080").unwrap();
        assert_eq!(ip, "192.168.1.1".parse::<IpAddr>().unwrap());
        assert_eq!(port, Some(8080));

        // Test IPv6
        let (ip, port) = parse_ip_addr("2001:db8::1").unwrap();
        assert_eq!(ip, "2001:db8::1".parse::<IpAddr>().unwrap());
        assert_eq!(port, None);

        // Test IPv6 with port
        let (ip, port) = parse_ip_addr("[2001:db8::1]:8080").unwrap();
        assert_eq!(ip, "2001:db8::1".parse::<IpAddr>().unwrap());
        assert_eq!(port, Some(8080));

        // Test invalid IP
        assert!(parse_ip_addr("invalid").is_err());
    }

    #[test]
    fn test_request_header_extractor() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("Bearer token"),
        );

        let extractor = RequestHeaderExtractor::new(&headers);

        assert_eq!(extractor.get("content-type"), Some("application/json"));
        assert_eq!(extractor.get("authorization"), Some("Bearer token"));
        assert_eq!(extractor.get("nonexistent"), None);

        let keys = extractor.keys();
        assert!(keys.contains(&"content-type"));
        assert!(keys.contains(&"authorization"));
    }

    #[test]
    fn test_get_work_group() {
        let work_groups = vec![Some("long".to_string()), Some("short".to_string()), None];
        assert_eq!(get_work_group(work_groups), Some("long".to_string()));

        let work_groups = vec![Some("short".to_string()), None];
        assert_eq!(get_work_group(work_groups), Some("short".to_string()));

        let work_groups = vec![Some("other".to_string()), None];
        assert_eq!(get_work_group(work_groups), None);

        let work_groups = vec![None];
        assert_eq!(get_work_group(work_groups), None);
    }
}
