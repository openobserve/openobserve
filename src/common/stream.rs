use actix_web::HttpResponse;
use std::io::{Error, ErrorKind};

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
