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
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, LazyLock as Lazy},
};

use axum::{body::Body, http::Request, middleware::Next, response::Response};
use config::axum::middlewares::RealIp;
use http_body_util::BodyExt;
use maxminddb::geoip2::city::Location;
use serde::{Deserialize, Serialize};
use uaparser::{Parser, UserAgentParser};

use crate::{USER_AGENT_REGEX_FILE, infra::config::MAXMIND_DB_CLIENT};

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
    // Unicode classes multiply each regex's lazy-DFA cache (kept per thread, never shrunk).
    // Input is HeaderValue::to_str output, which is ASCII only, so matching is unchanged.
    UserAgentParser::builder()
        .with_unicode_support(false)
        .build_from_bytes(USER_AGENT_REGEX_FILE)
        .expect("User Agent Parser creation failed")
}

/// This is the custom data which is provided by `browser-sdk`
/// in form of query-parameters.
/// NOTE: the only condition is that the prefix of such params is `oo` or `o2`.
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
                    .filter_map(|tag| {
                        let mut parts = tag.splitn(2, ':');
                        let key = parts.next()?.trim();
                        let val = parts.next().unwrap_or("");
                        if key.is_empty() {
                            return None;
                        }
                        Some((key.to_string(), val.into()))
                    })
                    .collect()
            })
    }

    /// Returns the first ootags/o2tags of the first NDJSON line, a single object or array element.
    fn extract_tags_from_body_bytes(body: &[u8]) -> Option<String> {
        // Skip leading whitespace that some NDJSON encoders may emit
        let start = body
            .iter()
            .position(|&b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
            .unwrap_or(body.len());
        if start < body.len() && body[start] == b'[' {
            // The first element's tags apply to an array batch, as NDJSON's first line does.
            return Self::tags_of(Self::first_array_element(&body[start..])?.as_object()?);
        }
        if start >= body.len() || body[start] != b'{' {
            return None;
        }
        let end = body[start..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| start + p)
            .unwrap_or(body.len());
        let json: serde_json::Value = serde_json::from_slice(&body[start..end]).ok()?;
        Self::tags_of(json.as_object()?)
    }

    /// Reads only the first element of exactly one well-formed JSON array.
    fn first_array_element(body: &[u8]) -> Option<serde_json::Value> {
        struct First;
        impl<'de> serde::de::Visitor<'de> for First {
            type Value = Option<serde_json::Value>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON array")
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let first = seq.next_element()?;
                while seq.next_element::<serde::de::IgnoredAny>()?.is_some() {}
                Ok(first)
            }
        }
        let mut de = serde_json::Deserializer::from_slice(body);
        let first = serde::Deserializer::deserialize_seq(&mut de, First).ok()?;
        de.end().ok()?;
        first
    }

    fn tags_of(obj: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
        obj.get("ootags")
            .or_else(|| obj.get("o2tags"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// Middleware function for axum to extract RUM extra data
    pub async fn extractor_middleware(request: Request<Body>, next: Next) -> Response {
        // Buffer the body so we can inspect it for ootags/o2tags, then
        // reconstruct it unchanged for downstream handlers.
        let (parts, body) = request.into_parts();
        let body_bytes = body.collect().await.unwrap_or_default().to_bytes();
        let body_tags = Self::extract_tags_from_body_bytes(&body_bytes);

        // Parse query parameters
        let query_string = parts.uri.query().unwrap_or("");
        let mut data: HashMap<String, String> =
            url::form_urlencoded::parse(query_string.as_bytes())
                .into_owned()
                .collect();

        // Merge body tags into data — query string takes precedence
        if let Some(tags_val) = body_tags {
            data.entry("o2tags".to_string()).or_insert(tags_val);
        }

        Self::filter_api_keys(&mut data);

        // These are the tags which come in `ootags` or `o2tags`
        let tags: HashMap<String, serde_json::Value> = Self::filter_tags(&data);

        let mut user_agent_hashmap: HashMap<String, serde_json::Value> = data
            .into_iter()
            .map(|(key, val)| (key, val.into()))
            .collect();

        // Now extend the existing hashmap with tags.
        user_agent_hashmap.extend(tags);
        {
            // Resolved up-chain by the `extract_real_ip` middleware; fall back to
            // ipv4 loopback so the downstream geo-lookup stays well-defined.
            let ip = parts
                .extensions
                .get::<RealIp>()
                .map(|r| r.0)
                .unwrap_or(IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

            user_agent_hashmap.insert("ip".into(), ip.to_string().into());

            let maxminddb_client = MAXMIND_DB_CLIENT.read().await;
            let geo_info = if let Some(client) = maxminddb_client.as_ref() {
                if let Some(city_info) = client
                    .city_reader
                    .lookup(ip)
                    .ok()
                    .and_then(|r| r.decode::<maxminddb::geoip2::City>().ok())
                    .flatten()
                {
                    let country = city_info.country.names.english;
                    let city = city_info.city.names.english;
                    let country_iso_code = city_info.country.iso_code;
                    GeoInfoData {
                        city,
                        country,
                        country_iso_code,
                        location: Some(city_info.location),
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
            let user_agent = parts
                .headers
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

        // Reconstruct the request with the original body
        let mut request = Request::from_parts(parts, Body::from(body_bytes));
        request.extensions_mut().insert(rum_extracted_data);

        next.run(request).await
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

        // Parse query string manually
        let mut data: HashMap<String, String> =
            url::form_urlencoded::parse(query_string.as_bytes())
                .into_owned()
                .collect();

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
            let query_data: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
                .into_owned()
                .collect();

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

    fn body_tags(body: &str) -> Option<String> {
        RumExtraData::extract_tags_from_body_bytes(body.as_bytes())
    }

    #[test]
    fn test_body_tags_object_paths_unchanged() {
        assert_eq!(body_tags(r#"{"o2tags":"a:b"}"#).as_deref(), Some("a:b"));
        assert_eq!(
            body_tags("  {\"ootags\":\"a:b\"}\n{\"o2tags\":\"c:d\"}").as_deref(),
            Some("a:b")
        );
        assert_eq!(body_tags(r#"{"m":1}"#), None);
        assert_eq!(body_tags(""), None);
    }

    #[test]
    fn test_body_tags_array_uses_first_element() {
        let body = r#"[{"m":1,"o2tags":"env:dev,service:x"},{"o2tags":"env:other"}]"#;
        assert_eq!(body_tags(body).as_deref(), Some("env:dev,service:x"));
        assert_eq!(
            body_tags(&format!(" \r\n\t{body}\n")).as_deref(),
            Some("env:dev,service:x")
        );
    }

    #[test]
    fn test_body_tags_pretty_printed_array_and_ootags_alias() {
        let body = "[\n  {\n    \"m\": 1,\n    \"ootags\": \"env:dev\"\n  },\n  {\"m\": 2}\n]\n";
        assert_eq!(body_tags(body).as_deref(), Some("env:dev"));
    }

    #[test]
    fn test_body_tags_array_without_usable_first_element_is_none() {
        for body in [
            r#"[{"m":1},{"o2tags":"env:dev"}]"#,
            "[]",
            "[1,{\"o2tags\":\"a:b\"}]",
            r#"[[{"o2tags":"a:b"}]]"#,
            r#"[{"o2tags":"a:b"},"#,
            r#"[{"o2tags":"a:b"}] {"m":1}"#,
            r#"[{"o2tags":5}]"#,
            r#"[{"o2tags":"a:b"}]x"#,
            r#"[{"o2tags":"a:b"},{"m":1}"#,
            r#"[{"o2tags":"a:b"},{"m":1}]]"#,
        ] {
            assert_eq!(body_tags(body), None, "{body}");
        }
    }

    #[test]
    fn test_body_tags_array_first_element_with_very_large_later_element() {
        let big = "x".repeat(1_000_000);
        let body = format!(r#"[{{"o2tags":"a:b"}},{{"m":"{big}"}}]"#);
        assert_eq!(body_tags(&body).as_deref(), Some("a:b"));
    }

    const UA_SAMPLES: &[&str] = &[
        "",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.20(0x18001442) NetType/WIFI Language/zh_CN",
        "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; U; Android 4.2.2; en-us; ALCATEL ONE TOUCH 6040D Build/JDQ39) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30",
        "Mozilla/5.0 (Linux; Android 4.4.2; OnePAD 1100X Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/30.0.0.0 Safari/537.36",
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        "MyApp/1.2.3 CFNetwork/1410.0.3 Darwin/22.6.0",
        "curl/8.4.0",
        "okhttp/4.9.0",
    ];

    #[test]
    fn test_ua_parser_without_unicode_matches_unicode_parser() {
        let unicode = UserAgentParser::builder()
            .with_unicode_support(true)
            .build_from_bytes(USER_AGENT_REGEX_FILE)
            .unwrap();
        let parser = initialize_ua_parser();
        for ua in UA_SAMPLES {
            for input in [ua.to_string(), ua.to_lowercase(), ua.to_uppercase()] {
                assert_eq!(parser.parse(&input), unicode.parse(&input), "{input}");
            }
        }
        let non_ascii = axum::http::HeaderValue::from_bytes("小米手机/1.0".as_bytes()).unwrap();
        assert!(non_ascii.to_str().is_err());
    }

    #[test]
    fn test_ua_parser_known_results() {
        let parser = initialize_ua_parser();
        let chrome = parser.parse(UA_SAMPLES[1]);
        assert_eq!(chrome.user_agent.family, "Chrome");
        assert_eq!(chrome.user_agent.major.as_deref(), Some("120"));
        assert_eq!(chrome.os.family, "Windows");
        let iphone = parser.parse(UA_SAMPLES[6]);
        assert_eq!(iphone.user_agent.family, "Mobile Safari");
        assert_eq!(iphone.os.family, "iOS");
        assert_eq!(iphone.os.major.as_deref(), Some("17"));
        assert_eq!(iphone.device.brand.as_deref(), Some("Apple"));
        let samsung = parser.parse(UA_SAMPLES[10]);
        assert_eq!(samsung.user_agent.family, "Samsung Internet");
        assert_eq!(samsung.device.brand.as_deref(), Some("Samsung"));
        assert_eq!(samsung.device.model.as_deref(), Some("SM-S918B"));
        let lowercase_alcatel = UA_SAMPLES[12].to_lowercase();
        let alcatel = parser.parse(&lowercase_alcatel);
        assert_eq!(alcatel.device.brand.as_deref(), Some("Alcatel"));
        let bot = parser.parse(UA_SAMPLES[14]);
        assert_eq!(bot.user_agent.family, "Googlebot");
        assert_eq!(bot.device.family, "Spider");
    }
}
