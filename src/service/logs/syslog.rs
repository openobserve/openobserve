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

use std::net::SocketAddr;

use actix_web::{http, HttpResponse};
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use syslog_loose::{Message, ProcId, Protocol};

use super::StreamMeta;
use crate::{
    common::{
        infra::{
            cluster,
            config::{CONFIG, DISTINCT_FIELDS, SYSLOG_ROUTES},
            metrics,
        },
        meta::{
            alerts::Alert,
            http::HttpResponse as MetaHttpResponse,
            ingestion::{IngestionResponse, StreamStatus},
            stream::{SchemaRecords, StreamParams},
            syslog::SyslogRoute,
            StreamType,
        },
        utils::{flatten, json, time::parse_timestamp_micro_from_value},
    },
    service::{
        db, distinct_values, get_formatted_stream_name,
        ingestion::{evaluate_trigger, write_file_arrow, TriggerAlertData},
    },
};

pub async fn ingest(msg: &str, addr: SocketAddr) -> Result<HttpResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    let ip = addr.ip();
    let matching_route = get_org_for_ip(ip).await;

    let route = match matching_route {
        Some(matching_route) => matching_route,
        None => {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    "Syslogs from the IP are not allowed".to_string(),
                )),
            );
        }
    };

    let thread_id = 0;
    let in_stream_name = &route.stream_name;
    let org_id = &route.org_id;

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_name, StreamType::Logs, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("stream [{stream_name}] is being deleted"),
            )),
        );
    }

    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut distinct_values = Vec::with_capacity(16);

    let mut trigger: TriggerAlertData = None;

    let partition_det =
        crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map).await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    crate::service::ingestion::get_stream_alerts(
        org_id,
        StreamType::Logs,
        stream_name,
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let mut buf: AHashMap<String, SchemaRecords> = AHashMap::new();

    let parsed_msg = syslog_loose::parse_message(msg);
    let mut value = message_to_value(parsed_msg);
    value = flatten::flatten(&value).unwrap();

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_transform(
            &local_trans,
            &value,
            &stream_vrl_map,
            stream_name,
            &mut runtime,
        )?;
    }
    if value.is_null() || !value.is_object() {
        stream_status.status.failed += 1; // transform failed or dropped
    }
    // End row based transform

    // get json object
    let local_val = value.as_object_mut().unwrap();

    // handle timestamp
    let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
        Some(v) => match parse_timestamp_micro_from_value(v) {
            Ok(t) => t,
            Err(_) => Utc::now().timestamp_micros(),
        },
        None => Utc::now().timestamp_micros(),
    };
    // check ingestion time
    let earlest_time = Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto);
    if timestamp < earlest_time.timestamp_micros() {
        stream_status.status.failed += 1; // to old data, just discard
        stream_status.status.error = super::get_upto_discard_error();
    }

    local_val.insert(
        CONFIG.common.column_timestamp.clone(),
        json::Value::Number(timestamp.into()),
    );

    let local_trigger = super::add_valid_record_arrow(
        &StreamMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            partition_keys: &partition_keys,
            partition_time_level: &partition_time_level,
            stream_alerts_map: &stream_alerts_map,
        },
        &mut stream_schema_map,
        &mut stream_status.status,
        &mut buf,
        local_val,
        trigger.is_none(),
    )
    .await;
    if local_trigger.is_some() {
        trigger = local_trigger;
    }

    // get distinct_value item
    for field in DISTINCT_FIELDS.iter() {
        if let Some(val) = local_val.get(field) {
            if !val.is_null() {
                distinct_values.push(distinct_values::DvItem {
                    stream_type: StreamType::Logs,
                    stream_name: stream_name.to_string(),
                    field_name: field.to_string(),
                    field_value: val.as_str().unwrap().to_string(),
                    filter_name: "".to_string(),
                    filter_value: "".to_string(),
                });
            }
        }
    }

    let mut stream_file_name = "".to_string();
    write_file_arrow(&buf, thread_id, &stream_params, &mut stream_file_name, None).await;

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_syslog",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_syslog",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    Ok(HttpResponse::Ok().json(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    )))
}

async fn get_org_for_ip(ip: std::net::IpAddr) -> Option<SyslogRoute> {
    let mut matching_route = None;
    for (_, route) in SYSLOG_ROUTES.clone() {
        for subnet in &route.subnets {
            if subnet.contains(ip) {
                matching_route = Some(route);
                break;
            }
        }
    }
    matching_route
}

/// Create a `Value::Map` from the fields of the given syslog message.
fn message_to_value(message: Message<&str>) -> json::Value {
    let mut result = json::Map::new();

    result.insert("message".to_string(), message.msg.to_string().into());

    if let Some(host) = message.hostname {
        result.insert("hostname".to_string(), host.to_string().into());
    }

    if let Some(severity) = message.severity {
        result.insert("severity".to_string(), severity.as_str().to_owned().into());
    }

    if let Some(facility) = message.facility {
        result.insert("facility".to_string(), facility.as_str().to_owned().into());
    }

    if let Protocol::RFC5424(version) = message.protocol {
        result.insert("version".to_string(), version.into());
    }

    if let Some(app_name) = message.appname {
        result.insert("appname".to_string(), app_name.to_owned().into());
    }

    if let Some(msg_id) = message.msgid {
        result.insert("msgid".to_string(), msg_id.to_owned().into());
    }

    if let Some(timestamp) = message.timestamp {
        result.insert(
            "_timestamp".to_string(),
            timestamp.timestamp_micros().into(),
        );
    }

    if let Some(procid) = message.procid {
        let value: json::Value = match procid {
            ProcId::PID(pid) => pid.into(),
            ProcId::Name(name) => name.to_string().into(),
        };
        result.insert("procid".to_string(), value);
    }

    for element in message.structured_data {
        let mut sdata = json::Map::new();
        for (name, value) in element.params() {
            sdata.insert(name.to_string(), value.into());
        }
        result.insert(element.id.to_string(), sdata.into());
    }

    result.into()
}

#[cfg(test)]
mod test {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    #[actix_web::test]
    async fn test_ingest() {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 8080);
        let raw = r#"<190>2019-02-13T21:53:30.605850+00:00 74794bfb6795 liblogging-stdlog: [origin software="rsyslogd" swVersion="8.24.0" x-pid="9043" x-info="http://www.rsyslog.com"] This is a test message"#;
        ingest(raw, addr).await.unwrap();
    }
}
