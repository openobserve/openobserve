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

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use {
    crate::common::meta::http::HttpResponse as MetaHttpResponse,
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

pub async fn cancel_query(Path(params): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, trace_id) = params;
        let trace_ids = trace_id.split(',').collect::<Vec<&str>>();
        cancel_query_inner(&org_id, &trace_ids).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(params);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

pub async fn cancel_multiple_query(Path(params): Path<String>, body: Bytes) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let org_id = params;
        let trace_ids: Vec<String> = match config::utils::json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                return MetaHttpResponse::bad_request(e);
            }
        };
        let trace_ids = trace_ids.iter().map(|s| s.as_str()).collect::<Vec<&str>>();
        cancel_query_inner(&org_id, &trace_ids).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(params);
        drop(body);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

pub async fn query_status(Path(_params): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let res = crate::service::search::query_status().await;
        match res {
            Ok(query_status) => Json(query_status).into_response(),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

pub async fn cancel_query_inner(org_id: &str, trace_ids: &[&str]) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if trace_ids.is_empty() {
            return (StatusCode::BAD_REQUEST, Json("Invalid trace_id")).into_response();
        }
        let mut res = Vec::with_capacity(trace_ids.len());
        for trace_id in trace_ids {
            if trace_id.is_empty() {
                continue;
            }
            let ret = if get_o2_config().super_cluster.enabled {
                o2_enterprise::enterprise::super_cluster::search::cancel_query(org_id, trace_id)
                    .await
            } else {
                crate::service::search::cancel_query(org_id, trace_id).await
            };
            match ret {
                Ok(status) => res.push(status),
                Err(e) => return MetaHttpResponse::bad_request(e),
            }
        }
        Json(res).into_response()
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        let _ = trace_ids;
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}
