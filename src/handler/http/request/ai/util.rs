use actix_web::{
    Error, FromRequest, HttpRequest, dev::Payload, error::ErrorBadRequest, http::header::HeaderMap,
};
use futures::future::{Ready, ready};
use serde::de::DeserializeOwned;

/// Wrapper extractor to deserialize headers into a struct
pub struct Headers<T>(pub T);

impl<T> FromRequest for Headers<T>
where
    T: DeserializeOwned + 'static,
{
    type Error = Error;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        let headers = req.headers();

        match deserialize_headers::<T>(headers) {
            Ok(inner) => ready(Ok(Headers(inner))),
            Err(e) => ready(Err(ErrorBadRequest(e))),
        }
    }
}

fn deserialize_headers<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, String> {
    let iter = headers.iter().filter_map(|(k, v)| {
        v.to_str()
            .ok()
            .map(|s| (k.as_str().to_string(), serde_json::json!(s)))
    });

    let map = serde_json::Map::from_iter(iter);

    let val = serde_json::json!(map);
    serde_json::from_value(val).map_err(|e| format!("Header deserialization error: {e}"))
}
