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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::errors;

/// HTTP response
/// code 200 is success
/// code 400 is error
/// code 404 is not found
/// code 500 is internal server error
/// code 503 is service unavailable
/// code >= 1000 is custom error code
/// message is the message or error message
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct HttpResponse {
    pub code: u16,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ESResponse {
    pub took: u16,
    pub errors: bool,
    // pub items: Vec<Item>
}

impl HttpResponse {
    pub fn message(code: u16, message: String) -> Self {
        HttpResponse {
            code,
            message,
            error_detail: None,
        }
    }

    pub fn error(code: u16, error: String) -> Self {
        HttpResponse {
            code,
            message: error,
            error_detail: None,
        }
    }

    pub fn error_code(err: errors::ErrorCodes) -> Self {
        HttpResponse {
            code: err.get_code(),
            message: err.get_message(),
            error_detail: Some(err.get_error_detail()),
        }
    }
}

#[cfg(test)]
mod test {
    use actix_web::http;

    use super::*;

    #[test]
    fn test_http_response() {
        let msg = "This is an error response";
        let err = HttpResponse::message(http::StatusCode::OK.into(), msg.to_string());
        assert_eq!(err.code, http::StatusCode::OK);
        assert_eq!(err.message, msg);

        let err = HttpResponse::error(
            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
            msg.to_string(),
        );
        assert_eq!(err.code, http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(err.message, msg);

        let errcode = errors::ErrorCodes::ServerInternalError(msg.to_string());
        let err =
            HttpResponse::error_code(errors::ErrorCodes::ServerInternalError(msg.to_string()));
        assert_eq!(err.code, errcode.get_code());
        assert_eq!(err.message, errcode.get_message());
    }
}
