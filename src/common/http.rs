use crate::meta::StreamType;
use actix_web::web::Query;
use ahash::AHashMap;
use std::io::{Error, ErrorKind};

pub fn get_stream_type_from_request(
    query: &Query<AHashMap<String, String>>,
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
