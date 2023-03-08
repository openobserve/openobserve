// Copyright 2022 Zinc Labs Inc. and Contributors
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

use actix_web::HttpResponse;
use std::io::{Error, ErrorKind};

pub const SQL_FULL_TEXT_SEARCH_FIELDS: [&str; 5] = ["log", "message", "msg", "content", "data"];

#[inline(always)]
pub fn stream_type_query_param_error() -> Result<HttpResponse, Error> {
    /*  return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
        http::StatusCode::BAD_REQUEST.into(),
        Some("only 'type' query param with value 'logs' or 'metrics' allowed".to_string()),
    ))); */

    Err(Error::new(
        ErrorKind::Other,
        "only 'type' query param with value 'logs' or 'metrics' allowed",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_type_query_param_error() {
        let res = stream_type_query_param_error();
        assert!(res.is_err());
    }
}
