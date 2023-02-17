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

use std::error::Error as StdError;

pub async fn send_notification(
    url: &str,
    payload: serde_json::Value,
) -> Result<(), Box<dyn StdError>> {
    let client = reqwest::Client::new();
    match url::Url::parse(url) {
        Ok(dest_url) => {
            let req = client
                .post(dest_url)
                .header("Content-type", "application/json")
                .json(&payload);

            let _ = req.send().await.unwrap();
        }
        Err(_) => log::info!("Error parsing notification url"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[actix_web::test]
    async fn test_send_notification() {
        let obj = json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}});
        let res = send_notification("https://httpbin.org/post", obj).await;
        assert!(res.is_ok());
    }
}
