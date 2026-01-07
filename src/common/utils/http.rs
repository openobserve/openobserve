// Copyright 2026 OpenObserve Inc.
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
    io::Error,
    net::{AddrParseError, IpAddr, SocketAddr},
};

use axum::http::header::{HeaderMap, HeaderName};
use config::meta::{
    dashboards::usage_report::DashboardInfo,
    search::{SearchEventContext, SearchEventType, default_use_cache},
    stream::StreamType,
};
use hashbrown::{HashMap, HashSet};
use opentelemetry::{global, propagation::Extractor, trace::TraceContextExt};
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[inline(always)]
pub(crate) fn get_stream_type_from_request(query: &HashMap<String, String>) -> Option<StreamType> {
    query.get("type").map(|s| StreamType::from(s.as_str()))
}

#[inline(always)]
pub(crate) fn get_enable_align_histogram_from_request(query: &HashMap<String, String>) -> bool {
    query
        .get("enable_align_histogram")
        .and_then(|s| s.parse::<bool>().ok())
        .unwrap_or_default()
}

#[inline(always)]
pub(crate) fn get_ts_from_request_with_key(
    query: &HashMap<String, String>,
    key: &str,
) -> Result<i64, String> {
    let value = query
        .get(key)
        .ok_or_else(|| format!("{key} parameter is missing"))?
        .parse::<i64>()
        .map_err(|_| format!("{key} is not a valid timestamp"))?;
    Ok(value)
}

#[inline(always)]
pub(crate) fn get_fallback_order_by_col_from_request(
    query: &HashMap<String, String>,
) -> Option<String> {
    query.get("fallback_order_by_col").map(|s| s.to_string())
}

#[inline(always)]
pub(crate) fn get_search_type_from_request(
    query: &HashMap<String, String>,
) -> Result<Option<SearchEventType>, Error> {
    query
        .get("search_type")
        .map(|s| SearchEventType::try_from(s.as_str()))
        .transpose()
        .map_err(Error::other)
}

#[inline(always)]
pub(crate) fn get_search_event_context_from_request(
    search_event_type: &SearchEventType,
    query: &HashMap<String, String>,
) -> Option<SearchEventContext> {
    let f = |k| query.get(k).map(String::from);
    match search_event_type {
        SearchEventType::Dashboards => Some(SearchEventContext::with_dashboard(
            f("dashboard_id"),
            f("dashboard_name"),
            f("folder_id"),
            f("folder_name"),
        )),
        SearchEventType::Alerts => Some(SearchEventContext::with_alert(f("alert_key"))),
        SearchEventType::Reports => Some(SearchEventContext::with_report(f("report_id"))),
        _ => None,
    }
}

#[inline(always)]
fn get_key_as_bool(query: &HashMap<String, String>, key: &str) -> bool {
    query
        .get(key)
        .and_then(|v| v.to_lowercase().as_str().parse::<bool>().ok())
        .unwrap_or_default()
}

#[inline(always)]
pub(crate) fn get_use_cache_from_request(query: &HashMap<String, String>) -> bool {
    if !default_use_cache() {
        return false;
    }
    let Some(v) = query.get("use_cache") else {
        return true;
    };
    v.to_lowercase().as_str().parse::<bool>().unwrap_or(true)
}

#[inline(always)]
pub(crate) fn get_is_ui_histogram_from_request(query: &HashMap<String, String>) -> bool {
    get_key_as_bool(query, "is_ui_histogram")
}

#[inline(always)]
pub(crate) fn get_is_multi_stream_search_from_request(query: &HashMap<String, String>) -> bool {
    get_key_as_bool(query, "is_multi_stream_search")
}

#[inline(always)]
pub(crate) fn get_clear_cache_from_request(query: &HashMap<String, String>) -> bool {
    get_key_as_bool(query, "clear_cache")
}

#[inline(always)]
#[cfg(feature = "enterprise")]
pub(crate) fn get_extract_patterns_from_request(query: &HashMap<String, String>) -> bool {
    get_key_as_bool(query, "patterns")
}

#[inline(always)]
pub(crate) fn get_folder(query: &HashMap<String, String>) -> String {
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
                let _ = span.set_parent(ctx);
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

#[inline(always)]
pub(crate) fn get_dashboard_info_from_request(
    query: &HashMap<String, String>,
) -> Option<DashboardInfo> {
    let run_id = query.get("run_id").map(|s| s.to_string())?;
    let panel_id = query.get("panel_id").map(|s| s.to_string())?;
    let panel_name = query.get("panel_name").map(|s| s.to_string())?;
    let tab_id = query.get("tab_id").map(|s| s.to_string())?;
    let tab_name = query.get("tab_name").map(|s| s.to_string())?;

    Some(DashboardInfo {
        run_id,
        panel_id,
        panel_name,
        tab_id,
        tab_name,
    })
}

#[cfg(test)]
mod tests {
    use axum::extract::Query;
    use http::HeaderValue;

    use super::*;

    #[test]
    fn test_get_stream_type_from_request() {
        let k_v_exp = [
            ("logs".to_string(), Some(StreamType::Logs)),
            ("metrics".to_string(), Some(StreamType::Metrics)),
            ("traces".to_string(), Some(StreamType::Traces)),
            (
                "enrichment_tables".to_string(),
                Some(StreamType::EnrichmentTables),
            ),
            ("file_list".to_string(), Some(StreamType::Filelist)),
            ("metadata".to_string(), Some(StreamType::Metadata)),
            ("index".to_string(), Some(StreamType::Index)),
        ];

        let mut query = HashMap::<String, String>::new();
        assert_eq!(get_stream_type_from_request(&query), None);

        for (value, expected) in k_v_exp {
            query.insert("type".to_string(), value);
            assert_eq!(get_stream_type_from_request(&query), expected);
        }
    }

    #[test]
    fn test_get_fallback_order_by_col_from_request() {
        let mut query = HashMap::<String, String>::new();
        assert_eq!(get_fallback_order_by_col_from_request(&query), None);

        query.insert("fallback_order_by_col".to_string(), "timestamp".to_string());
        assert_eq!(
            get_fallback_order_by_col_from_request(&query),
            Some("timestamp".to_string())
        );
    }

    #[test]
    fn test_get_search_type_from_request() {
        let mut query = HashMap::<String, String>::new();

        assert_eq!(get_search_type_from_request(&query).unwrap(), None);

        query.insert("search_type".to_string(), "ui".to_string());
        assert_eq!(
            get_search_type_from_request(&query).unwrap(),
            Some(SearchEventType::UI)
        );

        query.insert("search_type".to_string(), "dashboards".to_string());
        assert_eq!(
            get_search_type_from_request(&query).unwrap(),
            Some(SearchEventType::Dashboards)
        );

        query.insert("search_type".to_string(), "invalid".to_string());
        assert!(get_search_type_from_request(&query).is_err());
    }

    #[test]
    fn test_get_search_event_context_from_request() {
        let f = get_search_event_context_from_request;
        let mut query = HashMap::<String, String>::new();
        query.insert("dashboard_id".to_string(), "123".to_string());
        query.insert("dashboard_name".to_string(), "Test Dashboard".to_string());
        query.insert("folder_id".to_string(), "456".to_string());
        query.insert("folder_name".to_string(), "Test Folder".to_string());

        let context = f(&SearchEventType::Dashboards, &query).unwrap();
        assert_eq!(context.dashboard_id, Some("123".to_string()));
        assert_eq!(context.dashboard_name, Some("Test Dashboard".to_string()));
        assert_eq!(context.dashboard_folder_id, Some("456".to_string()));
        assert_eq!(
            context.dashboard_folder_name,
            Some("Test Folder".to_string())
        );

        query.clear();
        assert_eq!(f(&SearchEventType::UI, &query), None);

        query.insert("alert_key".to_string(), "alert123".to_string());

        let context = f(&SearchEventType::Alerts, &query).unwrap();
        assert_eq!(context.alert_key, Some("alert123".to_string()));

        query.insert("report_id".to_string(), "report123".to_string());

        let context = f(&SearchEventType::Reports, &query).unwrap();
        assert_eq!(context.report_key, Some("report123".to_string()));
    }

    #[test]
    fn test_get_use_cache_from_request() {
        let mut query = HashMap::<String, String>::new();
        assert!(get_use_cache_from_request(&query));

        query.insert("use_cache".to_string(), "true".to_string());
        assert!(get_use_cache_from_request(&query));

        query.insert("use_cache".to_string(), "false".to_string());
        assert!(!get_use_cache_from_request(&query));

        query.insert("use_cache".to_string(), "invalid".to_string());
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
        let ip_port_exp_map = [
            (
                "192.168.1.1",
                "192.168.1.1".parse::<IpAddr>().unwrap(),
                None,
            ),
            (
                "192.168.1.1:8080",
                "192.168.1.1".parse::<IpAddr>().unwrap(),
                Some(8080),
            ),
            (
                "2001:db8::1",
                "2001:db8::1".parse::<IpAddr>().unwrap(),
                None,
            ),
            (
                "[2001:db8::1]:8080",
                "2001:db8::1".parse::<IpAddr>().unwrap(),
                Some(8080),
            ),
        ];

        for (ip, exp_ip, exp_port) in ip_port_exp_map {
            assert_eq!(parse_ip_addr(ip).unwrap(), (exp_ip, exp_port));
        }

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

    #[test]
    fn test_get_enable_align_histogram_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("enable_align_histogram".to_string(), "true".to_string());
        assert!(get_enable_align_histogram_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("enable_align_histogram".to_string(), "false".to_string());
        assert!(!get_enable_align_histogram_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("enable_align_histogram".to_string(), "invalid".to_string());
        assert!(!get_enable_align_histogram_from_request(&query));

        let query = Query::<HashMap<String, String>>(Default::default());
        assert!(!get_enable_align_histogram_from_request(&query));
    }

    #[test]
    fn test_get_ts_from_request_with_key() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("start_time".to_string(), "1640995200".to_string());
        assert_eq!(
            get_ts_from_request_with_key(&query, "start_time").unwrap(),
            1640995200
        );

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("end_time".to_string(), "invalid".to_string());
        assert!(get_ts_from_request_with_key(&query, "end_time").is_err());

        let query = Query::<HashMap<String, String>>(Default::default());
        assert!(get_ts_from_request_with_key(&query, "missing_key").is_err());
    }

    #[test]
    fn test_get_is_ui_histogram_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("is_ui_histogram".to_string(), "true".to_string());
        assert!(get_is_ui_histogram_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("is_ui_histogram".to_string(), "FALSE".to_string());
        assert!(!get_is_ui_histogram_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("is_ui_histogram".to_string(), "invalid".to_string());
        assert!(!get_is_ui_histogram_from_request(&query));

        let query = Query::<HashMap<String, String>>(Default::default());
        assert!(!get_is_ui_histogram_from_request(&query));
    }

    #[test]
    fn test_get_is_multi_stream_search_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("is_multi_stream_search".to_string(), "TRUE".to_string());
        assert!(get_is_multi_stream_search_from_request(&query));

        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("is_multi_stream_search".to_string(), "false".to_string());
        assert!(!get_is_multi_stream_search_from_request(&query));

        let query = Query::<HashMap<String, String>>(Default::default());
        assert!(!get_is_multi_stream_search_from_request(&query));
    }

    #[test]
    fn test_get_dashboard_info_from_request() {
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("run_id".to_string(), "run123".to_string());
        query.insert("panel_id".to_string(), "panel456".to_string());
        query.insert("panel_name".to_string(), "Test Panel".to_string());
        query.insert("tab_id".to_string(), "tab789".to_string());
        query.insert("tab_name".to_string(), "Test Tab".to_string());

        let dashboard_info = get_dashboard_info_from_request(&query).unwrap();
        assert_eq!(dashboard_info.run_id, "run123".to_string());
        assert_eq!(dashboard_info.panel_id, "panel456".to_string());
        assert_eq!(dashboard_info.panel_name, "Test Panel".to_string());
        assert_eq!(dashboard_info.tab_id, "tab789".to_string());
        assert_eq!(dashboard_info.tab_name, "Test Tab".to_string());

        // Test partial data - missing run_id should return None
        let mut query = Query::<HashMap<String, String>>(Default::default());
        query.insert("panel_id".to_string(), "panel456".to_string());
        assert_eq!(get_dashboard_info_from_request(&query), None);

        let query = Query::<HashMap<String, String>>(Default::default());
        assert_eq!(get_dashboard_info_from_request(&query), None);
    }

    #[test]
    fn test_get_or_create_trace_id_new_generation() {
        // Test when no traceparent header is present and span is none
        let headers = HeaderMap::new();
        let span = tracing::Span::none();
        let trace_id = get_or_create_trace_id(&headers, &span);
        // Should generate a new trace ID (32 characters hex)
        assert_eq!(trace_id.len(), 32);
        assert!(trace_id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_get_or_create_trace_id_manual_parse_valid() {
        // Test manual parsing of valid traceparent
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("traceparent"),
            HeaderValue::from_static("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
        );
        let span = tracing::Span::none();
        let trace_id = get_or_create_trace_id(&headers, &span);
        assert_eq!(trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
    }

    #[test]
    fn test_get_or_create_trace_id_manual_parse_invalid() {
        // Test manual parsing of invalid traceparent (all zeros)
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("traceparent"),
            HeaderValue::from_static("00-00000000000000000000000000000000-0000000000000000-01"),
        );
        let span = tracing::Span::none();
        let trace_id = get_or_create_trace_id(&headers, &span);
        // Should generate new trace ID when all zeros detected
        assert_ne!(trace_id, "00000000000000000000000000000000");
        assert_eq!(trace_id.len(), 32);
    }

    #[test]
    fn test_get_or_create_trace_id_malformed_traceparent() {
        // Test malformed traceparent header
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("traceparent"),
            HeaderValue::from_static("invalid-format"),
        );
        let span = tracing::Span::none();
        let trace_id = get_or_create_trace_id(&headers, &span);
        // Should generate new trace ID for malformed header
        assert_eq!(trace_id.len(), 32);
        assert!(trace_id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_search_event_types_comprehensive() {
        // Test all supported search event types
        let test_cases = vec![
            ("ui", Some(SearchEventType::UI)),
            ("dashboards", Some(SearchEventType::Dashboards)),
            ("reports", Some(SearchEventType::Reports)),
            ("alerts", Some(SearchEventType::Alerts)),
            ("rum", Some(SearchEventType::RUM)),
            ("values", Some(SearchEventType::Values)),
        ];

        for (search_type, expected) in test_cases {
            let mut query = Query::<HashMap<String, String>>(Default::default());
            query.insert("search_type".to_string(), search_type.to_string());
            assert_eq!(get_search_type_from_request(&query).unwrap(), expected);
        }
    }

    #[test]
    fn test_work_group_priority() {
        // Test that "long" has priority over "short"
        let work_groups = vec![
            Some("short".to_string()),
            Some("other".to_string()),
            Some("long".to_string()),
        ];
        assert_eq!(get_work_group(work_groups), Some("long".to_string()));

        // Test empty vector
        let work_groups: Vec<Option<String>> = vec![];
        assert_eq!(get_work_group(work_groups), None);

        // Test multiple instances of same priority
        let work_groups = vec![Some("short".to_string()), Some("short".to_string())];
        assert_eq!(get_work_group(work_groups), Some("short".to_string()));
    }
}
