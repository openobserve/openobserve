// Copyright 2023 Zinc Labs Inc.
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

use crate::common::infra::config::MAXMIND_DB_CLIENT;
use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    web, Error as ActixErr, FromRequest, HttpMessage,
};
use actix_web_lab::middleware::Next;
use ahash::AHashMap;
use maxminddb::geoip2::city::Location;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use uaparser::{Parser, UserAgentParser};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GeoInfoData<'a> {
    pub city: Option<&'a str>,
    pub country: Option<&'a str>,
    pub location: Option<Location<'a>>,
}

/// This is the custom data which is provided by `browser-sdk`
/// in form of query-parameters.
/// NOTE: the only condition is that the prefix of such params is `oo`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RumExtraData {
    pub data: AHashMap<String, serde_json::Value>,
}

impl RumExtraData {
    fn filter_api_keys(data: &mut AHashMap<String, String>) {
        data.retain(|k, _| {
            (k.starts_with("oo") || k.starts_with("o2") || k.starts_with("batch_time"))
                && !(k.eq("oo-api-key") || k.eq("o2-api-key"))
        })
    }

    pub async fn extractor(
        req: ServiceRequest,
        next: Next<impl MessageBody>,
    ) -> Result<ServiceResponse<impl MessageBody>, ActixErr> {
        let maxminddb_client = MAXMIND_DB_CLIENT.read().await;
        let mut data =
            web::Query::<AHashMap<String, String>>::from_query(req.query_string()).unwrap();
        Self::filter_api_keys(&mut data);

        // These are the tags which come in `ootags`
        let tags: AHashMap<String, serde_json::Value> = match data.get("ootags") {
            Some(tags) => tags
                .split(',')
                .map(|tag| {
                    let key_val: Vec<_> = tag.split(':').collect();
                    (key_val[0].to_string(), key_val[1].into())
                })
                .collect(),

            None => AHashMap::default(),
        };

        let mut user_agent_hashmap: AHashMap<String, serde_json::Value> = data
            .into_inner()
            .into_iter()
            .map(|(key, val)| (key, val.into()))
            .collect();

        // Now extend the existing hashmap with tags.
        user_agent_hashmap.extend(tags);

        {
            let headers = req.headers();
            let conn_info = req.connection_info();
            let ip_address = match headers.contains_key("X-Forwarded-For")
                || headers.contains_key("Forwarded")
            {
                true => conn_info.realip_remote_addr().unwrap(),
                false => conn_info.peer_addr().unwrap(),
            };

            user_agent_hashmap.insert("ip".into(), ip_address.into());

            let ip: IpAddr = ip_address.parse().unwrap();

            let geo_info = if let Some(client) = &(*maxminddb_client) {
                if let Ok(city_info) = client.city_reader.lookup::<maxminddb::geoip2::City>(ip) {
                    let country = city_info
                        .country
                        .and_then(|c| c.names.and_then(|map| map.get("en").copied()));
                    let city = city_info
                        .city
                        .and_then(|c| c.names.and_then(|map| map.get("en").copied()));

                    GeoInfoData {
                        city,
                        country,
                        location: city_info.location,
                    }
                } else {
                    GeoInfoData::default()
                }
            } else {
                GeoInfoData::default()
            };

            user_agent_hashmap.insert(
                "geo_info".into(),
                serde_json::to_value(geo_info).unwrap_or_default(),
            );
        }

        // User-agent parsing
        {
            let user_agent = req
                .headers()
                .get("User-Agent")
                .map(|v| v.to_str().unwrap_or(""))
                .unwrap_or_default();

            let ua_parser = web::Data::<UserAgentParser>::extract(req.request())
                .await
                .unwrap();
            let parsed_user_agent = ua_parser.parse(user_agent);

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
    use actix_web::test;

    #[test]
    async fn test_data_filtering() {
        // Create a mock query string
        let query_string =
            "oo-api-key=123&o2-api-key=456&oo-param1=value1&o2-param2=value2&batch_time=123456";

        // Create a mock ServiceRequest with the query string
        let req = test::TestRequest::with_uri(&format!("/path?{}", query_string)).to_srv_request();

        // Call the from_query function
        let mut data =
            web::Query::<AHashMap<String, String>>::from_query(req.query_string()).unwrap();
        RumExtraData::filter_api_keys(&mut data);

        // Assert that the data is filtered correctly
        assert_eq!(data.len(), 3);
        assert!(data.contains_key("oo-param1"));
        assert!(data.contains_key("o2-param2"));
        assert!(data.contains_key("batch_time"));
        assert!(!data.contains_key("oo-api-key"));
        assert!(!data.contains_key("o2-api-key"));
    }
}
