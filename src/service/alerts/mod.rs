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

use actix_web::{http, HttpResponse};
use arrow_schema::DataType;
use chrono::Utc;
use std::collections::HashMap;
use std::io::Error;

use super::search::sql::Sql;
use super::{db, triggers};
use crate::common::notification::send_notification;
use crate::handler::grpc::cluster_rpc;
use crate::meta::alert::{Alert, AlertList, Trigger};
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::search::Query;
use crate::meta::{self, StreamType};

pub mod destinations;
pub mod templates;

#[tracing::instrument(skip_all)]
pub async fn save_alert(
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    name: String,
    mut alert: Alert,
) -> Result<HttpResponse, Error> {
    alert.stream = stream_name.to_string();
    alert.name = name.to_string();
    alert.stream_type = Some(stream_type);
    let in_dest = alert.clone().destination;

    // before saving alert check alert destination
    let dest = db::alerts::destinations::get(&org_id, &in_dest)
        .await
        .unwrap();

    if dest.is_none() {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            format!("Destination with name {in_dest} not found"),
        )));
    }

    // before saving alert check column type to decide numeric condition
    let schema = db::schema::get(&org_id, &stream_name, stream_type)
        .await
        .unwrap();
    let fields = schema.fields;
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
            sql_mode: "full".to_owned(),
            query_type: "logs".to_owned(),
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

    db::alerts::set(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
        name.as_str(),
        alert.clone(),
    )
    .await
    .unwrap();
    // For non-ingest alert set trigger immediately
    if !alert.is_real_time {
        let trigger = Trigger {
            timestamp: Utc::now().timestamp_micros(),
            is_valid: true,
            alert_name: alert.name,
            stream: stream_name,
            stream_type,
            org: org_id,
            last_sent_at: 0,
            count: 0,
            is_ingest_time: false,
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
    org_id: String,
    stream_name: Option<&str>,
    stream_type: Option<StreamType>,
) -> Result<HttpResponse, Error> {
    let alerts_list = db::alerts::list(org_id.as_str(), stream_name, stream_type)
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(AlertList { list: alerts_list }))
}

#[tracing::instrument]
pub async fn delete_alert(
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    name: String,
) -> Result<HttpResponse, Error> {
    let result = db::alerts::delete(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
        name.as_str(),
    )
    .await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert deleted ".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

#[tracing::instrument]
pub async fn get_alert(
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    name: String,
) -> Result<HttpResponse, Error> {
    let result = db::alerts::get(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
        name.as_str(),
    )
    .await;
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
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    name: String,
) -> Result<HttpResponse, Error> {
    let result = db::alerts::get(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
        name.as_str(),
    )
    .await;

    match result {
        Ok(Some(alert)) => {
            let trigger = Trigger {
                timestamp: Utc::now().timestamp_micros(),
                is_valid: false,
                alert_name: name,
                stream: stream_name,
                org: org_id,
                last_sent_at: 0,
                count: 0,
                is_ingest_time: alert.is_real_time,
                stream_type,
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
    use crate::common::json;
    use crate::meta::alert::{AllOperator, Condition};

    fn prepare_test_alert_object(name: &str, stream: &str) -> Alert {
        Alert {
            name: name.to_string(),
            stream: stream.to_string(),
            stream_type: Some(StreamType::Logs),
            query: Some(Query {
                sql: format!("select count(*) as occurance from olympics"),
                start_time: 0,
                end_time: 0,
                sql_mode: "full".to_owned(),
                query_type: "logs".to_owned(),
                track_total_hits: false,
                from: 0,
                size: 0,
                query_context: None,
                uses_zo_fn: false,
                query_fn: None,
            }),
            condition: Condition {
                column: "occurance".to_owned(),
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
        let res = save_alert(
            "nexus".to_string(),
            "olympics".to_string(),
            StreamType::Logs,
            "500error".to_string(),
            alert,
        )
        .await;
        assert!(res.is_ok());

        let list_res = list_alert(
            "nexus".to_string(),
            Some("olympics"),
            Some(StreamType::Logs),
        )
        .await;
        assert!(list_res.is_ok());

        let list_res = list_alert("nexus".to_string(), None, None).await;
        assert!(list_res.is_ok());

        let get_res = get_alert(
            "nexus".to_string(),
            "olympics".to_string(),
            StreamType::Logs,
            "500error".to_string(),
        )
        .await;
        assert!(get_res.is_ok());

        let del_res = delete_alert(
            "nexus".to_string(),
            "olympics".to_string(),
            StreamType::Logs,
            "500error".to_string(),
        )
        .await;
        assert!(del_res.is_ok());
    }

    #[actix_web::test]
    async fn test_trigger_alert() {
        let alert_name = "500error";
        let alert_stream: &str = "olympics";
        let alert = prepare_test_alert_object(alert_name, alert_stream);
        let res = save_alert(
            "nexus".to_string(),
            "olympics".to_string(),
            StreamType::Logs,
            "500error".to_string(),
            alert,
        )
        .await;
        assert!(res.is_ok());

        let del_res = trigger_alert(
            "nexus".to_string(),
            "olympics".to_string(),
            StreamType::Logs,
            "500error".to_string(),
        )
        .await;
        assert!(del_res.is_ok());
    }
}
