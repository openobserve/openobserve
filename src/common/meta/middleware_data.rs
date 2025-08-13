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

use std::{collections::HashMap, net::IpAddr, sync::Arc};

use actix_web::{
    Error as ActixErr, HttpMessage,
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    middleware::Next,
    web,
};
use maxminddb::geoip2::city::Location;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use uaparser::{Parser, UserAgentParser};

use crate::{
    USER_AGENT_REGEX_FILE,
    common::{infra::config::MAXMIND_DB_CLIENT, utils::http::parse_ip_addr},
};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GeoInfoData<'a> {
    pub city: Option<&'a str>,
    pub country: Option<&'a str>,
    pub country_iso_code: Option<&'a str>,
    pub location: Option<Location<'a>>,
}

/// This is a global cache for user agent parser. This is lazily initialized only when
/// the first request comes in.
static UA_PARSER: Lazy<Arc<UserAgentParser>> = Lazy::new(|| Arc::new(initialize_ua_parser()));

pub fn initialize_ua_parser() -> UserAgentParser {
    UserAgentParser::builder()
        .build_from_bytes(USER_AGENT_REGEX_FILE)
        .expect("User Agent Parser creation failed")
}

/// This is the custom data which is provided by `browser-sdk`
/// in form of query-parameters.
/// NOTE: the only condition is that the prefix of such params is `oo`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RumExtraData {
    pub data: HashMap<String, serde_json::Value>,
}

impl RumExtraData {
    fn filter_api_keys(data: &mut HashMap<String, String>) {
        data.retain(|k, _| {
            (k.starts_with("oo") || k.starts_with("o2") || k.starts_with("batch_time"))
                && !(k.eq("oo-api-key") || k.eq("o2-api-key"))
        })
    }

    fn filter_tags(data: &HashMap<String, String>) -> HashMap<String, serde_json::Value> {
        data.get("ootags")
            .or_else(|| data.get("o2tags"))
            .map_or_else(HashMap::default, |tags| {
                tags.split(',')
                    .map(|tag| {
                        let key_val: Vec<_> = tag.split(':').collect();
                        (key_val[0].to_string(), key_val[1].into())
                    })
                    .collect()
            })
    }

    pub async fn extractor(
        req: ServiceRequest,
        next: Next<impl MessageBody>,
    ) -> Result<ServiceResponse<impl MessageBody>, ActixErr> {
        let mut data =
            web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
        Self::filter_api_keys(&mut data);

        // These are the tags which come in `ootags` or `o2tags`
        let tags: HashMap<String, serde_json::Value> = Self::filter_tags(&data);

        let mut user_agent_hashmap: HashMap<String, serde_json::Value> = data
            .into_inner()
            .into_iter()
            .map(|(key, val)| (key, val.into()))
            .collect();

        // Now extend the existing hashmap with tags.
        user_agent_hashmap.extend(tags);
        {
            let headers = req.headers();
            // Borrow checker can't reliably tell that RefCell has been dropped
            // before an await, even if `drop` is directly used
            // This little contraption helps avoid clippy issues
            let ip_address = {
                let conn_info = req.connection_info();
                match headers.contains_key("X-Forwarded-For") || headers.contains_key("Forwarded") {
                    true => conn_info.realip_remote_addr(),
                    false => conn_info.peer_addr(),
                }
                .unwrap()
                .to_string()
            };

            let ip = match parse_ip_addr(&ip_address) {
                Ok((ip, _)) => ip,
                // Default to ipv4 loopback address
                Err(_) => IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)),
            };

            user_agent_hashmap.insert("ip".into(), ip_address.into());

            let maxminddb_client = MAXMIND_DB_CLIENT.read().await;
            let geo_info = if let Some(client) = maxminddb_client.as_ref() {
                if let Ok(city_info) = client.city_reader.lookup::<maxminddb::geoip2::City>(ip) {
                    let country = city_info
                        .country
                        .as_ref()
                        .and_then(|c| c.names.as_ref().and_then(|map| map.get("en").copied()));
                    let city = city_info
                        .city
                        .and_then(|c| c.names.and_then(|map| map.get("en").copied()));
                    let country_iso_code = city_info.country.and_then(|c| c.iso_code);
                    GeoInfoData {
                        city,
                        country,
                        country_iso_code,
                        location: city_info.location,
                    }
                } else {
                    GeoInfoData::default()
                }
            } else {
                GeoInfoData::default()
            };

            let geo_info = serde_json::to_value(geo_info).unwrap_or_default();
            drop(maxminddb_client);

            user_agent_hashmap.insert("geo_info".into(), geo_info);
        }

        // User-agent parsing
        {
            let user_agent = req
                .headers()
                .get("User-Agent")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default();

            let parsed_user_agent = (*UA_PARSER).parse(user_agent);

            user_agent_hashmap.insert(
                "user_agent".into(),
                serde_json::to_value(parsed_user_agent).unwrap_or_default(),
            );
        }

        let rum_extracted_data = RumExtraData {
            data: user_agent_hashmap,
        };
        req.extensions_mut().insert(rum_extracted_data);
        next.call(req).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_data_filtering() {
        // Create a mock query string
        let query_string =
            "oo-api-key=123&o2-api-key=456&oo-param1=value1&o2-param2=value2&batch_time=123456";

        // Create a mock ServiceRequest with the query string
        let req = actix_web::test::TestRequest::with_uri(&format!("/path?{query_string}"))
            .to_srv_request();

        // Call the from_query function
        let mut data =
            web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
        RumExtraData::filter_api_keys(&mut data);

        // Assert that the data is filtered correctly
        assert_eq!(data.len(), 3);
        assert!(data.contains_key("oo-param1"));
        assert!(data.contains_key("o2-param2"));
        assert!(data.contains_key("batch_time"));
        assert!(!data.contains_key("oo-api-key"));
        assert!(!data.contains_key("o2-api-key"));
    }

    #[tokio::test]
    async fn test_filter_tags() {
        // Create a mock query string
        let query_string_oo_tags = "ootags=sdk_version:0.2.9,api:fetch,env:production,service:web-application,version:1.0.1";
        let query_string_o2_tags = "o2tags=sdk_version:0.2.9,api:fetch,env:production,service:web-application,version:1.0.1";

        for query in &[query_string_oo_tags, query_string_o2_tags] {
            // Create a mock ServiceRequest with the query string
            let req =
                actix_web::test::TestRequest::with_uri(&format!("/path?{query}")).to_srv_request();

            // Call the from_query function
            let query_data =
                web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
            let data = RumExtraData::filter_tags(&query_data);

            // Assert that the tags are filtered correctly
            assert!(!data.is_empty());
            assert!(data.get("sdk_version").unwrap() == "0.2.9");
            assert!(data.get("api").unwrap() == "fetch");
            assert!(data.get("env").unwrap() == "production");
            assert!(data.get("service").unwrap() == "web-application");
            assert!(data.get("version").unwrap() == "1.0.1");
        }
    }

    #[test]
    fn test_geo_info_data_creation_and_properties() {
        // Test GeoInfoData struct creation and property access
        let geo_info = GeoInfoData {
            city: Some("New York"),
            country: Some("United States"),
            country_iso_code: Some("US"),
            location: None,
        };

        assert_eq!(geo_info.city, Some("New York"));
        assert_eq!(geo_info.country, Some("United States"));
        assert_eq!(geo_info.country_iso_code, Some("US"));
        assert!(geo_info.location.is_none());
    }

    #[test]
    fn test_initialize_ua_parser() {
        // Test that initialize_ua_parser returns a valid UserAgentParser
        let parser = initialize_ua_parser();

        // Test that the parser can parse a basic user agent
        let user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
        let parsed = parser.parse(user_agent);

        // Verify that parsing doesn't panic and returns some result
        assert!(!parsed.user_agent.family.is_empty());
    }

    #[test]
    fn test_ua_parser_global_static() {
        // Test that the global UA_PARSER static is properly initialized
        // Access it to trigger lazy initialization
        let _parser = &*UA_PARSER;

        // Test that it can parse a user agent
        let user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
        let parsed = (*UA_PARSER).parse(user_agent);

        assert!(!parsed.user_agent.family.is_empty());
    }

    #[test]
    fn test_filter_api_keys_edge_cases() {
        // Test edge cases for filter_api_keys function
        let test_cases = [
            // Empty HashMap
            (HashMap::new(), 0),
            // Only invalid keys
            (
                vec![("invalid_key".to_string(), "value".to_string())]
                    .into_iter()
                    .collect(),
                0,
            ),
            // Mixed valid and invalid keys
            (
                vec![
                    ("oo-api-key".to_string(), "secret".to_string()),
                    ("oo-valid-key".to_string(), "value".to_string()),
                    ("o2-api-key".to_string(), "secret2".to_string()),
                    ("o2-valid-key".to_string(), "value2".to_string()),
                    ("batch_time".to_string(), "123456".to_string()),
                    ("other-key".to_string(), "other-value".to_string()),
                ]
                .into_iter()
                .collect(),
                3,
            ),
        ];

        for (mut input, expected_len) in test_cases {
            RumExtraData::filter_api_keys(&mut input);
            assert_eq!(input.len(), expected_len);

            // Verify no API keys remain
            assert!(!input.contains_key("oo-api-key"));
            assert!(!input.contains_key("o2-api-key"));
        }
    }

    #[test]
    fn test_filter_api_keys_case_sensitivity() {
        // Test case sensitivity of key filtering
        let mut data = vec![
            ("OO-API-KEY".to_string(), "value".to_string()),
            ("O2-API-KEY".to_string(), "value".to_string()),
            ("oo-api-key".to_string(), "value".to_string()),
            ("o2-api-key".to_string(), "value".to_string()),
            ("OO-VALID-KEY".to_string(), "value".to_string()),
            ("O2-VALID-KEY".to_string(), "value".to_string()),
        ]
        .into_iter()
        .collect();

        RumExtraData::filter_api_keys(&mut data);

        // Should only keep the valid keys (case-sensitive matching)
        assert_eq!(data.len(), 0); // All keys are filtered out due to case sensitivity
        assert!(!data.contains_key("oo-api-key"));
        assert!(!data.contains_key("o2-api-key"));
    }

    #[test]
    fn test_filter_tags_edge_cases() {
        // Test edge cases for filter_tags function
        let test_cases = [
            // Empty HashMap
            (HashMap::new(), 0),
            // No tags present
            (
                vec![("other-key".to_string(), "other-value".to_string())]
                    .into_iter()
                    .collect(),
                0,
            ),
        ];

        for (input, expected_len) in test_cases {
            let result = RumExtraData::filter_tags(&input);
            assert_eq!(result.len(), expected_len);
        }
    }

    #[test]
    fn test_filter_tags_malformed_input() {
        // Test malformed tag inputs
        let test_cases = [
            // Special characters in keys/values
            (
                "ootags=key-with-dash:value-with-dash,key_with_underscore:value_with_underscore",
                2,
            ),
        ];

        for (tags_str, expected_count) in test_cases {
            let mut data = HashMap::new();
            data.insert("ootags".to_string(), tags_str.to_string());

            let result = RumExtraData::filter_tags(&data);
            assert_eq!(result.len(), expected_count);
        }
    }

    #[test]
    fn test_filter_tags_no_tags_present() {
        // Test when neither ootags nor o2tags are present
        let mut data = HashMap::new();
        data.insert("other-param".to_string(), "other-value".to_string());
        data.insert("oo-param".to_string(), "oo-value".to_string());

        let result = RumExtraData::filter_tags(&data);
        assert!(result.is_empty());
    }
}
