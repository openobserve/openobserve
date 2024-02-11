// Copyright 2023 Zinc Labs Inc.
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

use core::future::Future;

use boa_engine::{Context, JsArgs, JsError, JsResult, JsValue};
use reqwest::Url;
use serde_json::Value;

/// Asynchronous fetch API for boa engine VM. In the JS script executed by boa engine,
/// this API can be used to make asynchronous CRUD http requests to external REST APIs.
/// However, there are some differences between this `fetch` API and the Web `fetch` API.
///
/// Take the following examples of executing a JS script with the boa engine-
///
/// ```rust
/// let js_code = r#"
///     function doSomething(response) {
///         // Do something with response
///     }
///
///     // GET request to https://jsonplaceholder.typicode.com
///     fetch('https://jsonplaceholder.typicode.com/posts?userId=1')
///     .then(res => {
///         // Unlike Web "fetch" API, non-asynchronous "toJson()"
///         // function needs to be used here.
///         let resp = toJson(res);
///         doSomething(resp);
///     })
///     .catch(err => {
///         console.log('Err', err);
///     })
/// "#;
///
/// let mut context = Context::default();
/// context
///     .register_global_builtin_callable("fetch", 1, NativeFunction::from_async_fn(fetch))
///     .expect("fetch API could not be added");
/// context
///     .register_global_builtin_callable("toJson", 1, NativeFunction::from_fn_ptr(to_json))
///     .expect("toJson API could not be added");
///
/// context.eval(Source::from_bytes(js_code))?
/// ```
///
/// Similarly to make POST request in the JS script -
///
/// ```rust
/// let js_code = r#"
///     function doSomething(response) {
///         // Do something with response
///     }
///
///     // POST request to https://jsonplaceholder.typicode.com
///     fetch('https://jsonplaceholder.typicode.com/posts', {
///         method: 'POST',
///         // Don't use JSON.stringify here, "fetch" automatically
///         // converts the body into string
///         body: {
///             title: 'foo',
///             body: 'bar',
///             userId: 1,
///         },
///         headers: {
///             'Content-type': 'application/json; charset=UTF-8',
///         },
///     })
///     .then(res => {
///         // Unlike Web "fetch" API, non-asynchronous "toJson()"
///         // function needs to be used here.
///         let resp = toJson(res);
///         doSomething(resp);
///     })
///     .catch(err => {
///         console.log('Err', err);
///     })
/// "#;
/// ```
pub fn fetch(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context<'_>,
) -> impl Future<Output = JsResult<JsValue>> {
    // Due to the limitation of boa_engine, the returned `Future`
    // must have a `'static` lifetime, so that the argument of
    // `NativeFunction::from_async_fn(f)` meets the `'static` bound requirement.
    // See https://docs.rs/boa_engine/latest/boa_engine/struct.NativeFunction.html#caveats-1.
    let url = args.get_or_undefined(0).clone();
    let configs = args.get_or_undefined(1).clone();
    let configs = if configs.is_undefined() {
        Value::Null
    } else {
        configs
            .to_json(context)
            .map_or(Value::Null, |configs| configs)
    };

    async move {
        if url.is_undefined() {
            return Err(JsError::from_opaque("Url not specified".into()));
        }
        let url = format!("{}", url.display());
        match make_request(&url, configs).await {
            Ok(val) => Ok(val),
            Err(e) => Err(JsError::from_opaque(e.to_string().into())),
        }
    }
}

async fn make_request(url: &String, configs: Value) -> Result<JsValue, anyhow::Error> {
    // `url` contains `""` - e.g. `"https://examples.com"`, so remove them.
    match Url::parse(&url.trim().replace("\"", "")) {
        Ok(url) => {
            let client = reqwest::Client::new();
            let req = if !configs.is_object() {
                client.get(url)
            } else {
                let mut has_content_type = false;
                let configs = configs.as_object().unwrap();
                let mut req = match configs.get("method") {
                    Some(method) => {
                        let method = method.to_string().trim().to_lowercase().replace("\"", "");
                        if method == "post" {
                            client.post(url)
                        } else if method == "put" {
                            client.put(url)
                        } else if method == "patch" {
                            client.patch(url)
                        } else if method == "delete" {
                            client.delete(url)
                        } else {
                            client.get(url)
                        }
                    }
                    _ => client.get(url),
                };

                if let Some(headers) = configs.get("headers") {
                    if headers.is_object() {
                        let headers = headers.as_object().unwrap();
                        for (key, value) in headers.iter() {
                            let value = value.to_string().replace("\"", "");
                            if key.to_lowercase().trim() == "content-type" {
                                has_content_type = true;
                            }
                            req = req.header(key.trim(), value.trim());
                        }
                    }
                }

                if let Some(body) = configs.get("body") {
                    if !has_content_type {
                        req = req.header("Content-type", "application/json");
                    }
                    req = req.body(body.to_string());
                }
                req
            };
            // Don't call `Response::json()` here, without `Context`
            // `Value` can not be converted into `JsValue`.
            let resp = req.send().await?.text().await?;
            Ok(resp.into())
        }
        Err(e) => Err(anyhow::anyhow!("Error parsing Url: {}", e.to_string())),
    }
}

/// Blocking function for boa_engine VM, to convert a text into JSON object.
pub fn to_json(_this: &JsValue, args: &[JsValue], context: &mut Context<'_>) -> JsResult<JsValue> {
    let text = args.get_or_undefined(0);
    if !text.is_string() {
        return Err(JsError::from_opaque("Given text is not a string".into()));
    }
    let text: String = match text.to_string(context)?.to_std_string() {
        Ok(text) => text,
        Err(e) => return Err(JsError::from_opaque(e.to_string().into())),
    };

    let json: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(e) => return Err(JsError::from_opaque(e.to_string().into())),
    };

    JsValue::from_json(&json, context)
}
