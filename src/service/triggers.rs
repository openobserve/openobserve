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

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;

use super::db;
use crate::meta::alert::Trigger;
use crate::meta::http::HttpResponse as MetaHttpResponse;

#[tracing::instrument(skip_all)]
pub async fn save_trigger(
    alert_name: &str,
    trigger: &Trigger,
) -> Result<HttpResponse, anyhow::Error> {
    db::triggers::set(alert_name, trigger).await.unwrap();
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Trigger saved".to_string(),
    )))
}

#[tracing::instrument]
pub async fn delete_trigger(alert_name: String) -> Result<HttpResponse, Error> {
    let result = db::triggers::delete(&alert_name).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Trigger deleted ".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
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
                stream_type: crate::meta::StreamType::Logs,
                count: 0,
                is_ingest_time: false,
            },
        )
        .await;

        assert!(resp.is_ok());

        let resp = crate::service::alerts::get_alert(
            "dummy".to_string(),
            "TestStream".to_string(),
            crate::meta::StreamType::Logs,
            "TestAlert".to_string(),
        )
        .await;

        assert!(resp.is_ok());

        let resp = delete_trigger("TestAlert".to_string()).await;

        assert!(resp.is_ok());
    }
}
