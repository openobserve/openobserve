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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct HttpResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
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
            code: Some(code),
            message: Some(message),
            error_code: None,
            error_message: None,
        }
    }

    pub fn error(code: u16, error: String) -> Self {
        HttpResponse {
            code: None,
            message: None,
            error_code: Some(code),
            error_message: Some(error),
        }
    }

    pub fn error_code(err: errors::ErrorCodes) -> Self {
        HttpResponse {
            code: None,
            message: None,
            error_code: Some(err.get_code()),
            error_message: Some(err.get_message()),
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use actix_web::http;
    #[test]
    fn test_err_response() {
        let msg = "This is an error response";
        let err = HttpResponse::message(http::StatusCode::OK.into(), msg.to_string());
        assert_eq!(err.code.unwrap(), http::StatusCode::OK);
        assert_eq!(err.message.unwrap(), msg);
        assert_eq!(err.error_code, None);
        assert_eq!(err.error_message, None);

        let err = HttpResponse::error(
            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
            msg.to_string(),
        );
        assert_eq!(err.code, None);
        assert_eq!(err.message, None);
        assert_eq!(
            err.error_code.unwrap(),
            http::StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(err.error_message.unwrap(), msg);

        let err =
            HttpResponse::error_code(errors::ErrorCodes::ServerInternalError(msg.to_string()));
        assert_eq!(err.code, None);
        assert_eq!(err.message, None);
        assert_eq!(
            err.error_code.unwrap(),
            errors::ErrorCodes::ServerInternalError(msg.to_string()).get_code()
        );
        assert_eq!(
            err.error_message.unwrap(),
            errors::ErrorCodes::ServerInternalError(msg.to_string()).get_message()
        );
    }
}
