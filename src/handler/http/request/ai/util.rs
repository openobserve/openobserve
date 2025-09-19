use actix_web::{
    Error, FromRequest, HttpRequest, dev::Payload, error::ErrorBadRequest, http::header::HeaderMap,
};
use futures::future::{Ready, ready};
use serde::de::DeserializeOwned;

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
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
