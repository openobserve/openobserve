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
