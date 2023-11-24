// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{http, HttpResponse};

use super::db;
use crate::common::meta::alerts::Trigger;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[tracing::instrument(skip_all)]
pub async fn save_trigger(
    alert_name: &str,
    trigger: &Trigger,
) -> Result<HttpResponse, anyhow::Error> {
    db::alerts::triggers::set(format!("{}/{alert_name}", &trigger.org).as_str(), trigger)
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Trigger saved".to_string(),
    )))
}

#[tracing::instrument]
pub async fn delete_trigger(alert_name: String) -> Result<(), anyhow::Error> {
    db::alerts::triggers::delete(&alert_name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_triggers() {
        let resp = save_trigger(
            "dummy_trigger",
            &Trigger {
                timestamp: 0,
                is_valid: true,
                alert_name: "TestAlert".to_string(),
                stream: "TestStream".to_string(),
                org: "dummy".to_string(),
                last_sent_at: 0,
                stream_type: crate::common::meta::StreamType::Logs,
                count: 0,
                is_ingest_time: false,
                parent_alert_deleted: false,
            },
        )
        .await;
        assert!(resp.is_ok());

        let resp = crate::service::alerts::get_alert(
            "dummy",
            "TestStream",
            crate::common::meta::StreamType::Logs,
            "TestAlert",
        )
        .await;
        assert!(resp.is_ok());

        let resp = delete_trigger("TestAlert".to_string()).await;
        assert!(resp.is_ok());
    }
}
