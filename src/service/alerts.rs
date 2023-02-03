use actix_web::{http, HttpResponse};
use arrow_schema::DataType;
use chrono::Utc;
use std::collections::HashMap;
use std::io::Error;
use tracing::info_span;

use super::search::sql::Sql;
use super::{db, triggers};
use crate::handler::grpc::cluster_rpc;
use crate::meta;
use crate::meta::alert::{Alert, AlertList, Trigger};
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::search::Query;

pub async fn save_alert(
    org_id: String,
    stream_name: String,
    name: String,
    mut alert: Alert,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:alerts:save");
    let _guard = loc_span.enter();

    alert.stream = stream_name.to_string();
    alert.name = name.to_string();

    // before saving alert check column type to decide numeric condition
    let schema = db::schema::get(&org_id, &stream_name, Some(crate::meta::StreamType::Logs))
        .await
        .unwrap();

    let fields = schema.fields;
    if fields.is_empty() {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            Some(format!("Stream with name {} not found", stream_name)),
        )));
    }

    if alert.query.is_none() {
        alert.query = Some(Query {
            sql: format!("select * from {}", stream_name),
            start_time: 0,
            end_time: 0,
            sql_mode: "full".to_owned(),
            track_total_hits: false,
            from: 0,
            size: 0,
        });
        alert.is_real_time = true;

        //for condtion in alert.trigger.iter_mut() {
        let mut local_fields = fields.clone();

        local_fields.retain(|field| field.name().eq(&alert.condition.column));

        if !local_fields.is_empty() {
            if local_fields
                .first()
                .unwrap()
                .data_type()
                .eq(&DataType::Utf8)
            {
                alert.condition.is_numeric = Some(false);
            } else {
                alert.condition.is_numeric = Some(true);
            }
        } else {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(format!(
                    "Column named {} not found on stream {}",
                    &alert.condition.column, stream_name
                )),
            )));
        }
        //}
    } else {
        let meta_req = meta::search::Request {
            query: alert.clone().query.unwrap(),
            aggs: HashMap::new(),
        };
        let req: cluster_rpc::SearchRequest = meta_req.into();
        let sql = Sql::new(&req).await;

        if sql.is_err() {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(format!("Invalid query : {:?} ", sql.err())),
            )));
        }
    }

    db::alerts::set(
        org_id.as_str(),
        stream_name.as_str(),
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
            alert_name: alert.name.clone(),
            stream: stream_name,
            org: org_id,
            last_sent_at: 0,
            count: 0,
            is_ingest_time: false,
        };
        let _ = triggers::save_trigger(trigger.alert_name.clone(), trigger.clone()).await;
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Alert saved".to_string(),
    )))
}

pub async fn list_alert(org_id: String, stream_name: Option<&str>) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:alerts:list");
    let _guard = loc_span.enter();
    let alerts_list = db::alerts::list(org_id.as_str(), stream_name)
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(AlertList { list: alerts_list }))
}

pub async fn delete_alert(
    org_id: String,
    stream_name: String,
    name: String,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:alerts:delete");
    let _guard = loc_span.enter();
    let result = db::alerts::delete(org_id.as_str(), stream_name.as_str(), name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert deleted ".to_string(),
        ))),
        Err(err) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            Some(err.to_string()),
        ))),
    }
}

pub async fn get_alert(
    org_id: String,
    stream_name: String,
    name: String,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:alerts:get");
    let _guard = loc_span.enter();
    let result = db::alerts::get(org_id.as_str(), stream_name.as_str(), name.as_str()).await;
    match result {
        Ok(alert) => Ok(HttpResponse::Ok().json(alert)),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            Some("alert not found".to_string()),
        ))),
    }
}
