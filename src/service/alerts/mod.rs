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
use arrow_schema::DataType;
use chrono::Utc;
use std::collections::HashMap;
use std::io::Error;

use super::search::sql::Sql;
use super::{db, triggers};
use crate::common::meta::alert::{Alert, AlertList, Trigger};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;
use crate::common::meta::search::Query;
use crate::common::meta::{self, StreamType};
use crate::common::utils::notification::send_notification;
use crate::common::utils::schema_ext::SchemaExt;
use crate::handler::grpc::cluster_rpc;

pub mod destinations;
pub mod templates;

#[tracing::instrument(skip_all)]
pub async fn save_alert(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
    mut alert: Alert,
) -> Result<HttpResponse, Error> {
    alert.stream = stream_name.to_string();
    alert.name = name.to_string();
    alert.stream_type = Some(stream_type);
    let in_dest = alert.clone().destination;

    // before saving alert check alert destination
    if db::alerts::destinations::get(org_id, &in_dest)
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            format!("Destination with name {in_dest} not found"),
        )));
    };

    // before saving alert check column type to decide numeric condition
    let schema = db::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();
    let fields = schema.to_cloned_fields();
    if fields.is_empty() {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            format!("Stream with name {stream_name} not found"),
        )));
    }

    if alert.query.is_none() {
        alert.query = Some(Query {
            sql: format!("select * from {stream_name}"),
            start_time: 0,
            end_time: 0,
            sort_by: None,
            sql_mode: "full".to_owned(),
            query_type: "".to_owned(),
            track_total_hits: false,
            from: 0,
            size: 0,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        });
        alert.is_real_time = true;

        let mut local_fields = fields.clone();
        local_fields.retain(|field| field.name().eq(&alert.condition.column));

        if local_fields.is_empty() {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!(
                    "Column named {} not found on stream {stream_name}",
                    &alert.condition.column
                ),
            )));
        }
        alert.condition.is_numeric = Some(!matches!(
            local_fields[0].data_type(),
            DataType::Boolean | DataType::Utf8
        ));
    } else {
        let meta_req = meta::search::Request {
            query: alert.clone().query.unwrap(),
            aggs: HashMap::new(),
            encoding: meta::search::RequestEncoding::Empty,
            timeout: 0,
        };
        let req: cluster_rpc::SearchRequest = meta_req.into();
        let sql = Sql::new(&req).await;

        if sql.is_err() {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Invalid query : {:?} ", sql.err()),
            )));
        }
    }

    db::alerts::set(org_id, stream_name, stream_type, name, alert.clone())
        .await
        .unwrap();
    // For non-ingest alert set trigger immediately
    if !alert.is_real_time {
        let trigger = Trigger {
            timestamp: Utc::now().timestamp_micros(),
            is_valid: true,
            alert_name: alert.name,
            stream: stream_name.to_string(),
            stream_type,
            org: org_id.to_string(),
            last_sent_at: 0,
            count: 0,
            is_ingest_time: false,
            parent_alert_deleted: false,
        };
        let _ = triggers::save_trigger(&trigger.alert_name, &trigger).await;
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Alert saved".to_string(),
    )))
}

#[tracing::instrument]
pub async fn list_alert(
    org_id: &str,
    stream_name: Option<&str>,
    stream_type: Option<StreamType>,
) -> Result<HttpResponse, Error> {
    let alerts_list = db::alerts::list(org_id, stream_name, stream_type)
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(AlertList { list: alerts_list }))
}

#[tracing::instrument]
pub async fn delete_alert(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
) -> Result<HttpResponse, Error> {
    if db::alerts::get(org_id, stream_name, stream_type, name)
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert not found".to_string(),
        )));
    }
    match db::alerts::delete(org_id, stream_name, stream_type, name).await {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert deleted ".to_string(),
        ))),
        Err(e) => Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                e.to_string(),
            )),
        ),
    }
}

#[tracing::instrument]
pub async fn get_alert(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
) -> Result<HttpResponse, Error> {
    let result = db::alerts::get(org_id, stream_name, stream_type, name).await;
    match result {
        Ok(alert) => Ok(HttpResponse::Ok().json(alert)),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "alert not found".to_string(),
        ))),
    }
}

#[tracing::instrument]
pub async fn trigger_alert(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    name: &str,
) -> Result<HttpResponse, Error> {
    let result = db::alerts::get(org_id, stream_name, stream_type, name).await;

    match result {
        Ok(Some(alert)) => {
            let trigger = Trigger {
                timestamp: Utc::now().timestamp_micros(),
                is_valid: false,
                alert_name: name.to_string(),
                stream: stream_name.to_string(),
                org: org_id.to_string(),
                last_sent_at: 0,
                count: 0,
                is_ingest_time: alert.is_real_time,
                stream_type,
                parent_alert_deleted: false,
            };
            let _ = send_notification(&alert, &trigger).await;
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "Alert successfully triggered ".to_string(),
            )))
        }
        _ => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert not found".to_string(),
        ))),
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::common::meta::alert::{AllOperator, Condition};
    use crate::common::utils::json;

    fn prepare_test_alert_object(name: &str, stream: &str) -> Alert {
        Alert {
            name: name.to_string(),
            stream: stream.to_string(),
            stream_type: Some(StreamType::Logs),
            query: Some(Query {
                sql: ("select count(*) as occurrence from olympics").to_string(),
                start_time: 0,
                end_time: 0,
                sort_by: None,
                sql_mode: "full".to_owned(),
                query_type: "".to_owned(),
                track_total_hits: false,
                from: 0,
                size: 0,
                query_context: None,
                uses_zo_fn: false,
                query_fn: None,
            }),
            condition: Condition {
                column: "occurrence".to_owned(),
                operator: AllOperator::GreaterThanEquals,
                ignore_case: None,
                value: json::json!("5"),
                is_numeric: None,
            },
            duration: 1,
            frequency: 1,
            time_between_alerts: 10,
            destination: "test".to_string(),
            is_real_time: false,
            context_attributes: None,
        }
    }

    #[actix_web::test]
    async fn test_alerts() {
        let alert_name = "500error";
        let alert_stream: &str = "olympics";
        let alert = prepare_test_alert_object(alert_name, alert_stream);
        let res = save_alert("nexus", "olympics", StreamType::Logs, "500error", alert).await;
        assert!(res.is_ok());

        let list_res = list_alert("nexus", Some("olympics"), Some(StreamType::Logs)).await;
        assert!(list_res.is_ok());

        let list_res = list_alert("nexus", None, None).await;
        assert!(list_res.is_ok());

        let get_res = get_alert("nexus", "olympics", StreamType::Logs, "500error").await;
        assert!(get_res.is_ok());

        let del_res = delete_alert("nexus", "olympics", StreamType::Logs, "500error").await;
        assert!(del_res.is_ok());
    }

    #[actix_web::test]
    async fn test_trigger_alert() {
        let alert_name = "500error";
        let alert_stream: &str = "olympics";
        let alert = prepare_test_alert_object(alert_name, alert_stream);
        let res = save_alert("nexus", "olympics", StreamType::Logs, "500error", alert).await;
        assert!(res.is_ok());

        let del_res = trigger_alert("nexus", "olympics", StreamType::Logs, "500error").await;
        assert!(del_res.is_ok());
    }
}
