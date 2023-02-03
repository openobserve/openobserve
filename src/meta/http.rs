use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct HttpResponse {
    pub code: u16,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ESResponse {
    pub took: u16,
    pub errors: bool,
    // pub items: Vec<Item>
}

impl HttpResponse {
    pub fn _new(code: u16, message: String, error: Option<String>) -> Self {
        HttpResponse {
            code,
            message,
            error,
        }
    }

    pub fn message(code: u16, message: String) -> Self {
        HttpResponse {
            code,
            message,
            error: None,
        }
    }

    pub fn error(code: u16, error: Option<String>) -> Self {
        HttpResponse {
            code,
            message: "".to_string(),
            error,
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
        let err = HttpResponse::error(
            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
            Some(msg.to_string()),
        );
        assert_eq!(err.error.unwrap(), msg);
    }
}
