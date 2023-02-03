use actix_web::web::Query;
use std::collections::HashMap;
use std::io::{Error, ErrorKind};

use crate::meta::StreamType;

pub fn get_stream_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Result<Option<StreamType>, Error> {
    let stream_type = match query.get("type") {
        Some(s) => match s.to_lowercase().as_str() {
            "logs" => Some(StreamType::Logs),
            "metrics" => Some(StreamType::Metrics),
            "traces" => Some(StreamType::Traces),
            _ => {
                return Err(Error::new(
                    ErrorKind::Other,
                    "'type' query param with value 'logs' ,'metrics' or 'traces' allowed",
                ));
            }
        },
        None => None,
    };

    Ok(stream_type)
}
