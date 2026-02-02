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

/// usize indicates the number of parts to skip based on their actual paths.
const QUERIER_ROUTES: [(&str, usize); 25] = [
    ("config", 0),         // /config
    ("summary", 2),        // /api/{org_id}/summary
    ("organizations", 1),  // /api/organizations
    ("settings", 2),       // /api/{org_id}/settings/...
    ("schema", 3),         // /api/{org_id}/streams/{stream_name}/schema
    ("streams", 2),        // /api/{org_id}/streams/...
    ("traces/latest", 3),  // /api/{org_id}/{stream_name}/traces/latest
    ("clusters", 1),       // /api/clusters
    ("query_manager", 2),  // /api/{org_id}/query_manager/...
    ("_search", 2),        // /api/{org_id}/_search
    ("_search_stream", 2), // /api/{org_id}/_search_stream
    ("_values_stream", 2), // /api/{org_id}/_values_stream
    ("_around", 3),        // /api/{org_id}/{stream_name}/_around
    ("_values", 3),        // /api/{org_id}/{stream_name}/_values
    ("patterns/extract", 3), /* /api/{org_id}/streams/{stream_name}/patterns/
                            * extract */
    ("functions?page_num=", 2),               // /api/{org_id}/functions
    ("prometheus/api/v1/series", 2),          // /api/{org_id}/prometheus/api/v1/series
    ("prometheus/api/v1/query", 2),           // /api/{org_id}/prometheus/api/v1/query
    ("prometheus/api/v1/query_range", 2),     // /api/{org_id}/prometheus/api/v1/query_range
    ("prometheus/api/v1/query_exemplars", 2), // /api/{org_id}/prometheus/api/v1/query_exemplars
    ("prometheus/api/v1/metadata", 2),        // /api/{org_id}/prometheus/api/v1/metadata
    ("prometheus/api/v1/labels", 2),          // /api/{org_id}/prometheus/api/v1/labels
    ("prometheus/api/v1/label/", 2),          // /api/{org_id}/prometheus/api/v1/label/
    ("chat_stream", 3),                       /* /api/{org_id}/ai/chat_stream
                                               * {label_name}/
                                               * values */
    ("service_streams", 2), // /api/{org_id}/service_streams/...
];
const QUERIER_ROUTES_BY_BODY: [&str; 6] = [
    "/_search",
    "/_search_partition",
    "/_search_stream",
    "/_values_stream",
    "/prometheus/api/v1/query_range",
    "/prometheus/api/v1/query_exemplars",
];
const FIXED_QUERIER_ROUTES: [&str; 3] = ["/summary", "/schema", "/streams"];
pub const INGESTER_ROUTES: [&str; 12] = [
    "/_json",
    "/_bulk",
    "/_multi",
    "/_hec",
    "/_kinesis_firehose",
    "/_sub",
    "/v1/logs",
    "/loki/api/v1/push",
    "/ingest/metrics/_json",
    "/v1/metrics",
    "/traces",
    "/v1/traces",
];

#[inline]
pub fn is_querier_route(path: &str) -> bool {
    let path = remove_base_uri(path);
    QUERIER_ROUTES.iter().any(|(route, skip_segments)| {
        if path.contains(route) {
            let mut segments = path.split('/').filter(|s| !s.is_empty());
            // Skip the required number of segments
            for _ in 0..*skip_segments {
                if segments.next().is_none() {
                    return false;
                }
            }
            // Join remaining segments without collecting into a Vec
            let route_part = segments.collect::<Vec<_>>().join("/");
            route_part.starts_with(route)
                && INGESTER_ROUTES
                    .iter()
                    .all(|ingest_route| !route_part.ends_with(ingest_route))
        } else {
            false
        }
    })
}

#[inline]
pub fn is_querier_route_by_body(path: &str) -> bool {
    let path = remove_base_uri(path);
    QUERIER_ROUTES_BY_BODY.iter().any(|x| path.contains(x))
}

#[inline]
pub fn is_fixed_querier_route(path: &str) -> bool {
    let path = remove_base_uri(path);
    FIXED_QUERIER_ROUTES.iter().any(|x| path.contains(x))
}

#[inline]
fn remove_base_uri(path: &str) -> &str {
    let base_uri = &crate::get_config().common.base_uri;
    if base_uri.is_empty() {
        return path;
    }
    if let Some(stripped) = path.strip_prefix(base_uri) {
        stripped
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_querier_route() {
        // Test config route
        assert!(is_querier_route("/config"));
        assert!(!is_querier_route("/api/org1/config"));

        // Test summary route
        assert!(is_querier_route("/api/org1/summary"));
        assert!(!is_querier_route("/summary")); // Should fail as it needs org_id

        // Test streams route
        assert!(is_querier_route("/api/org1/streams"));
        assert!(is_querier_route("/api/org1/streams/mystream"));

        // Test prometheus routes
        assert!(is_querier_route("/api/org1/prometheus/api/v1/query"));
        assert!(is_querier_route("/api/org1/prometheus/api/v1/query_range"));

        // Test service_streams routes
        assert!(is_querier_route("/api/org1/service_streams/_analytics"));
        assert!(is_querier_route("/api/org1/service_streams/_correlate"));
        assert!(is_querier_route("/api/org1/service_streams/_grouped"));
    }

    #[test]
    fn test_is_querier_route_by_body() {
        assert!(is_querier_route_by_body("/_search"));
        assert!(is_querier_route_by_body("/_search_stream"));
        assert!(is_querier_route_by_body("/_values_stream"));
        assert!(is_querier_route_by_body("/prometheus/api/v1/query_range"));
        assert!(is_querier_route_by_body(
            "/prometheus/api/v1/query_exemplars"
        ));

        assert!(!is_querier_route_by_body("/other_route"));
        assert!(is_querier_route_by_body("/_search_other"));
    }

    #[test]
    fn test_is_fixed_querier_route() {
        assert!(is_fixed_querier_route("/summary"));
        assert!(is_fixed_querier_route("/schema"));
        assert!(is_fixed_querier_route("/streams"));

        assert!(!is_fixed_querier_route("/other_route"));
        assert!(is_fixed_querier_route("/summary_other"));
    }
}
