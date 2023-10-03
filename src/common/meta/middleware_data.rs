// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
    pub async fn extractor(
        req: ServiceRequest,
        next: Next<impl MessageBody>,
    ) -> Result<ServiceResponse<impl MessageBody>, ActixErr> {
        let maxminddb_client = MAXMIND_DB_CLIENT.read().await;
        let mut data =
            web::Query::<AHashMap<String, String>>::from_query(req.query_string()).unwrap();
        data.retain(|k, _| {
            (k.starts_with("oo") || k.starts_with("batch_time")) && !k.eq("oo-api-key")
        });

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
