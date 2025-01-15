// Copyright 2024 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>.\

use actix_web::{dev::Payload, Error, FromRequest, HttpRequest};
use config::utils::json;
use futures::future::{ready, Ready};

#[cfg(feature = "enterprise")]
use crate::common::infra::config::USER_SESSIONS;
#[cfg(feature = "enterprise")]
use crate::common::meta::ingestion::INGESTION_EP;
use crate::common::meta::user::AuthTokens;

#[derive(Debug)]
pub struct AuthExtractor {
    pub auth: String,
    pub method: String,
    pub o2_type: String,
    pub org_id: String,
    pub bypass_check: bool,
    pub parent_id: String,
}

impl FromRequest for AuthExtractor {
    type Error = Error;
    type Future = Ready<Result<Self, Error>>;

    #[cfg(feature = "enterprise")]
    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        let start = std::time::Instant::now();

        use std::collections::HashMap;

        use actix_web::web;
        use config::meta::stream::StreamType;
        use o2_enterprise::enterprise::openfga::meta::mapping::OFGA_MODELS;

        use crate::common::utils::http::{get_folder, get_stream_type_from_request};

        let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
        let stream_type = match get_stream_type_from_request(&query) {
            Ok(v) => v,
            Err(_) => Some(StreamType::Logs),
        };

        let folder = get_folder(&query);

        let mut method = req.method().to_string();
        let local_path = req.path().to_string();
        let path = match local_path
            .strip_prefix(format!("{}/api/", config::get_config().common.base_uri).as_str())
        {
            Some(path) => path,
            None => &local_path,
        };

        let path_columns = path.split('/').collect::<Vec<&str>>();
        let url_len = path_columns.len();
        let org_id = path_columns[0].to_string();

        if method.eq("POST") && INGESTION_EP.contains(&path_columns[url_len - 1]) {
            if let Some(auth_header) = req.headers().get("Authorization") {
                if let Ok(auth_str) = auth_header.to_str() {
                    return ready(Ok(AuthExtractor {
                        auth: auth_str.to_owned(),
                        method,
                        o2_type: format!("stream:{org_id}"),
                        org_id,
                        bypass_check: true,
                        parent_id: folder,
                    }));
                }
            }
            return ready(Err(actix_web::error::ErrorUnauthorized(
                "Unauthorized Access",
            )));
        }
        let object_type = if url_len == 1 {
            if method.eq("GET") && path_columns[0].eq("organizations") {
                if method.eq("GET") {
                    method = "LIST".to_string();
                };

                "org:##user_id##".to_string()
            } else {
                path_columns[0].to_string()
            }
        } else if url_len == 2 || (url_len > 2 && path_columns[1].starts_with("settings")) {
            if path_columns[1].starts_with("settings") {
                if method.eq("POST") || method.eq("DELETE") {
                    method = "PUT".to_string();
                }
            } else if method.eq("GET") {
                method = "LIST".to_string();
            }
            format!(
                "{}:{}",
                OFGA_MODELS
                    .get(path_columns[1])
                    .map_or(path_columns[1], |model| model.key),
                path_columns[0]
            )
        } else if path_columns[1].starts_with("groups") || path_columns[1].starts_with("roles") {
            format!(
                "{}:{org_id}/{}",
                OFGA_MODELS
                    .get(path_columns[1])
                    .map_or(path_columns[1], |model| model.key),
                path_columns[2]
            )
        } else if url_len == 3 {
            if path_columns[2].starts_with("alerts")
                || path_columns[2].starts_with("templates")
                || path_columns[2].starts_with("destinations")
                || path.ends_with("users/roles")
            {
                if method.eq("GET") {
                    method = "LIST".to_string();
                }
                if method.eq("PUT") || method.eq("DELETE") || path_columns[1].eq("search_jobs") {
                    format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(path_columns[1])
                            .map_or(path_columns[1], |model| model.key),
                        path_columns[2]
                    )
                } else {
                    format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(path_columns[2])
                            .map_or(path_columns[2], |model| model.key),
                        path_columns[0]
                    )
                }
            } else if path_columns[2].starts_with("_values")
                || path_columns[2].starts_with("_around")
            {
                format!(
                    "{}:{}",
                    OFGA_MODELS.get("streams").unwrap().key,
                    path_columns[1]
                )
            } else if method.eq("PUT")
                || method.eq("DELETE")
                || path_columns[1].starts_with("reports")
                || path_columns[1].starts_with("savedviews")
                || path_columns[1].starts_with("functions")
                || path_columns[1].starts_with("service_accounts")
            {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[2]
                )
            } else if method.eq("GET") && path_columns[1].starts_with("dashboards") {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[2] // dashboard id
                )
            } else {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[0]
                )
            }
        } else if url_len == 4 {
            if method.eq("PUT") && path_columns[1].eq("reports") {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[2]
                )
            } else if method.eq("PUT")
                && path_columns[1] != "streams"
                && path_columns[1] != "pipelines"
                || method.eq("DELETE")
            {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[2])
                        .map_or(path_columns[2], |model| model.key),
                    path_columns[3]
                )
            } else if method.eq("GET")
                && path_columns[1].eq("folders")
                && path_columns[2].eq("name")
            {
                // To search with folder name, you need GET permission on all folders
                format!(
                    "{}:_all_{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[0]
                )
            } else {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[2]
                )
            }
        } else if method.eq("PUT") || method.eq("DELETE") {
            if path_columns[url_len - 1].eq("delete_fields") {
                method = "DELETE".to_string();
            }
            if path_columns[url_len - 1].eq("enable") {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[2])
                        .map_or(path_columns[2], |model| model.key),
                    path_columns[3]
                )
            } else {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[2]
                )
            }
        } else {
            format!(
                "{}:{}",
                OFGA_MODELS
                    .get(path_columns[1])
                    .map_or(path_columns[1], |model| model.key),
                path_columns[2]
            )
        };

        let auth_str = extract_auth_str(req);

        // if let Some(auth_header) = req.headers().get("Authorization") {
        if !auth_str.is_empty() {
            if (method.eq("POST") && url_len > 1 && path_columns[1].starts_with("_search"))
                || path.contains("/prometheus/api/v1/query")
                || path.contains("/resources")
                || path.contains("/format_query")
                || path.contains("/prometheus/api/v1/series")
                || path.contains("/traces/latest")
                || path.contains("clusters")
                || path.contains("query_manager")
                || path.contains("/short")
                || path.contains("/ws")
            {
                return ready(Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method: "".to_string(),
                    o2_type: "".to_string(),
                    org_id: "".to_string(),
                    bypass_check: true, // bypass check permissions
                    parent_id: folder,
                }));
            }
            if object_type.starts_with("stream") {
                let object_type = match stream_type {
                    Some(stream_type) => {
                        if stream_type.eq(&StreamType::EnrichmentTables) {
                            // since enrichment tables have separate permissions
                            let stream_type_str = format!("{stream_type}");

                            object_type.replace(
                                "stream:",
                                format!(
                                    "{}:",
                                    OFGA_MODELS
                                        .get(stream_type_str.as_str())
                                        .map_or(stream_type_str.as_str(), |model| model.key)
                                )
                                .as_str(),
                            )
                        } else {
                            object_type.replace("stream:", format!("{}:", stream_type).as_str())
                        }
                    }
                    None => object_type,
                };
                return ready(Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method,
                    o2_type: object_type,
                    org_id,
                    bypass_check: false,
                    parent_id: folder,
                }));
            }
            if object_type.contains("dashboard") && url_len > 1 {
                let object_type = if method.eq("POST") || method.eq("LIST") {
                    format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(path_columns[1])
                            .map_or("dfolder", |model| model.parent),
                        folder.as_str(),
                    )
                } else {
                    object_type
                };

                return ready(Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method,
                    o2_type: object_type,
                    org_id,
                    bypass_check: false,
                    parent_id: folder,
                }));
            }

            return ready(Ok(AuthExtractor {
                auth: auth_str.to_owned(),
                method,
                o2_type: object_type,
                org_id,
                bypass_check: false,
                parent_id: folder,
            }));
        }
        //}
        log::info!(
            "AuthExtractor::from_request took {} ms",
            start.elapsed().as_millis()
        );
        ready(Err(actix_web::error::ErrorUnauthorized(
            "Unauthorized Access",
        )))
    }

    #[cfg(not(feature = "enterprise"))]
    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        let auth_str = if let Some(cookie) = req.cookie("auth_tokens") {
            let auth_tokens: AuthTokens = json::from_str(cookie.value()).unwrap_or_default();
            let access_token = auth_tokens.access_token;
            if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
                access_token
            } else {
                format!("Bearer {}", access_token)
            }
        } else if let Some(auth_header) = req.headers().get("Authorization") {
            if let Ok(auth_str) = auth_header.to_str() {
                auth_str.to_owned()
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        };

        // if let Some(auth_header) = req.headers().get("Authorization") {
        if !auth_str.is_empty() {
            return ready(Ok(AuthExtractor {
                auth: auth_str.to_owned(),
                method: "".to_string(),
                o2_type: "".to_string(),
                org_id: "".to_string(),
                bypass_check: true, // bypass check permissions
                parent_id: "".to_string(),
            }));
        }

        ready(Err(actix_web::error::ErrorUnauthorized(
            "Unauthorized Access",
        )))
    }
}

#[cfg(feature = "enterprise")]
pub fn extract_auth_str(req: &HttpRequest) -> String {
    let auth_ext_cookie = |req: &HttpRequest| -> String {
        req.cookie("auth_ext")
            .map(|cookie| cookie.value().to_string())
            .unwrap_or_default()
    };

    if let Some(cookie) = req.cookie("auth_tokens") {
        let auth_tokens: AuthTokens = json::from_str(cookie.value()).unwrap_or_default();
        let access_token = auth_tokens.access_token;
        if access_token.is_empty() {
            // If cookie was set but access token is still empty
            // we check auth_ext cookie to get the token.
            auth_ext_cookie(req)
        } else if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
            access_token
        } else if access_token.starts_with("session") {
            let session_key = access_token.strip_prefix("session ").unwrap().to_string();
            match USER_SESSIONS.get(&session_key) {
                Some(token) => {
                    format!("Bearer {}", *token)
                }
                None => access_token,
            }
        } else {
            format!("Bearer {}", access_token)
        }
    } else if let Some(cookie) = req.cookie("auth_ext") {
        cookie.value().to_string()
    } else if let Some(auth_header) = req.headers().get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            auth_str.to_owned()
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    }
}
