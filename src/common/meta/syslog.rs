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

use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyslogRoute {
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub stream_name: String,
    #[serde(default)]
    #[schema(value_type = Vec<String>)]
    pub subnets: Vec<IpNetwork>,
    #[serde(default)]
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SyslogRoutes {
    pub routes: Vec<SyslogRoute>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyslogServer {
    pub state: bool,
}

#[cfg(test)]
mod tests {
    use ipnetwork::IpNetwork;

    use super::*;

    #[test]
    fn test_syslog_route() {
        let route = SyslogRoute {
            org_id: "test-org".to_string(),
            stream_name: "test-stream".to_string(),
            subnets: vec![
                IpNetwork::V4("192.168.1.0/24".parse().unwrap()),
                IpNetwork::V6("2001:db8::/32".parse().unwrap()),
            ],
            id: "test-id".to_string(),
        };

        assert_eq!(route.org_id, "test-org");
        assert_eq!(route.stream_name, "test-stream");
        assert_eq!(route.subnets.len(), 2);
        assert_eq!(route.id, "test-id");
    }

    #[test]
    fn test_syslog_route_default() {
        let route = SyslogRoute {
            org_id: String::new(),
            stream_name: String::new(),
            subnets: Vec::new(),
            id: String::new(),
        };

        assert_eq!(route.org_id, "");
        assert_eq!(route.stream_name, "");
        assert!(route.subnets.is_empty());
        assert_eq!(route.id, "");
    }

    #[test]
    fn test_syslog_route_serialization() {
        let route = SyslogRoute {
            org_id: "test-org".to_string(),
            stream_name: "test-stream".to_string(),
            subnets: vec![IpNetwork::V4("192.168.1.0/24".parse().unwrap())],
            id: "test-id".to_string(),
        };

        let serialized = serde_json::to_string(&route).unwrap();
        let deserialized: SyslogRoute = serde_json::from_str(&serialized).unwrap();

        assert_eq!(route, deserialized);
    }

    #[test]
    fn test_syslog_routes() {
        let routes = SyslogRoutes {
            routes: vec![SyslogRoute {
                org_id: "test-org".to_string(),
                stream_name: "test-stream".to_string(),
                subnets: vec![IpNetwork::V4("192.168.1.0/24".parse().unwrap())],
                id: "test-id".to_string(),
            }],
        };

        assert_eq!(routes.routes.len(), 1);
        assert_eq!(routes.routes[0].org_id, "test-org");
        assert_eq!(routes.routes[0].stream_name, "test-stream");
    }

    #[test]
    fn test_syslog_routes_serialization() {
        let routes = SyslogRoutes {
            routes: vec![SyslogRoute {
                org_id: "test-org".to_string(),
                stream_name: "test-stream".to_string(),
                subnets: vec![IpNetwork::V4("192.168.1.0/24".parse().unwrap())],
                id: "test-id".to_string(),
            }],
        };

        let serialized = serde_json::to_string(&routes).unwrap();
        let deserialized: SyslogRoutes = serde_json::from_str(&serialized).unwrap();

        assert_eq!(routes.routes.len(), deserialized.routes.len());
        assert_eq!(routes.routes[0], deserialized.routes[0]);
    }

    #[test]
    fn test_syslog_server() {
        let server = SyslogServer { state: true };
        assert!(server.state);
    }

    #[test]
    fn test_syslog_server_serialization() {
        let server = SyslogServer { state: true };
        let serialized = serde_json::to_string(&server).unwrap();
        let deserialized: SyslogServer = serde_json::from_str(&serialized).unwrap();
        assert_eq!(server.state, deserialized.state);
    }

    #[test]
    fn test_syslog_route_camel_case() {
        let route = SyslogRoute {
            org_id: "test-org".to_string(),
            stream_name: "test-stream".to_string(),
            subnets: vec![IpNetwork::V4("192.168.1.0/24".parse().unwrap())],
            id: "test-id".to_string(),
        };

        let serialized = serde_json::to_string(&route).unwrap();
        assert!(serialized.contains("orgId"));
        assert!(serialized.contains("streamName"));
    }

    #[test]
    fn test_empty_syslog_routes() {
        let routes = SyslogRoutes { routes: vec![] };
        assert!(routes.routes.is_empty());

        let serialized = serde_json::to_string(&routes).unwrap();
        let deserialized: SyslogRoutes = serde_json::from_str(&serialized).unwrap();
        assert!(deserialized.routes.is_empty());
    }
}
