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
const QUERIER_ROUTES: [(&str, usize); 21] = [
    ("config", 0),                            // /config
    ("summary", 2),                           // /api/{org_id}/summary
    ("organizations", 1),                     // /api/organizations
    ("settings", 2),                          // /api/{org_id}/settings/...
    ("schema", 3),                            // /api/{org_id}/streams/{stream_name}/schema
    ("streams", 2),                           // /api/{org_id}/streams/...
    ("traces/latest", 3),                     // /api/{org_id}/{stream_name}/traces/latest
    ("clusters", 1),                          // /api/clusters
    ("query_manager", 2),                     // /api/{org_id}/query_manager/...
    ("ws", 2),                                // /api/{org_id}/ws
    ("_search", 2),                           // /api/{org_id}/_search
    ("_around", 3),                           // /api/{org_id}/{stream_name}/_around
    ("_values", 3),                           // /api/{org_id}/{stream_name}/_values
    ("functions?page_num=", 2),               // /api/{org_id}/functions
    ("prometheus/api/v1/series", 2),          // /api/{org_id}/prometheus/api/v1/series
    ("prometheus/api/v1/query", 2),           // /api/{org_id}/prometheus/api/v1/query
    ("prometheus/api/v1/query_range", 2),     // /api/{org_id}/prometheus/api/v1/query_range
    ("prometheus/api/v1/query_exemplars", 2), // /api/{org_id}/prometheus/api/v1/query_exemplars
    ("prometheus/api/v1/metadata", 2),        // /api/{org_id}/prometheus/api/v1/metadata
    ("prometheus/api/v1/labels", 2),          // /api/{org_id}/prometheus/api/v1/labels
    ("prometheus/api/v1/label/", 2),          /* /api/{org_id}/prometheus/api/v1/label/
                                               * {label_name}/
                                               * values */
];
const QUERIER_ROUTES_BY_BODY: [&str; 4] = [
    "/_search",
    "/_search_partition",
    "/prometheus/api/v1/query_range",
    "/prometheus/api/v1/query_exemplars",
];
const FIXED_QUERIER_ROUTES: [&str; 3] = ["/summary", "/schema", "/streams"];
pub const INGESTER_ROUTES: [&str; 11] = [
    "/_json",
    "/_bulk",
    "/_multi",
    "/_kinesis_firehose",
    "/_sub",
    "/v1/logs",
    "/ingest/metrics/_json",
    "/v1/metrics",
    "/traces",
    "/v1/traces",
    "/traces/latest",
];

#[inline]
pub fn is_querier_route(path: &str) -> bool {
    QUERIER_ROUTES.iter().any(|(route, skip_segments)| {
        if path.contains(route) {
            let segments = path
                .split('/')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            // check if we have enough segments
            if segments.len() <= *skip_segments {
                return false;
            }
            let route_part = segments[*skip_segments..].join("/");
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
    QUERIER_ROUTES_BY_BODY.iter().any(|x| path.contains(x))
}

#[inline]
pub fn is_fixed_querier_route(path: &str) -> bool {
    FIXED_QUERIER_ROUTES.iter().any(|x| path.contains(x))
}
