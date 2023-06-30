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
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use std::net::SocketAddr;
use syslog_loose::{Message, ProcId, Protocol};

use crate::common::{flatten, json, time::parse_timestamp_micro_from_value};
use crate::infra::{
    cluster,
    config::{CONFIG, SYSLOG_ROUTES},
    metrics,
};
use crate::meta::{
    alert::{Alert, Trigger},
    http::HttpResponse as MetaHttpResponse,
    ingestion::{IngestionResponse, StreamSchemaChk, StreamStatus},
    syslog::SyslogRoute,
    StreamType,
};
use crate::service::{db, ingestion::write_file, schema::stream_schema_exists};

use super::StreamMeta;

pub async fn ingest(msg: &str, addr: SocketAddr) -> Result<HttpResponse, ()> {
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

    let stream_name = &crate::service::ingestion::format_stream_name(in_stream_name);
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

    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);

    let mut trigger: Option<Trigger> = None;

    // Start Register Transforms for stream
    /*
    let (local_tans, _, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        stream_name,
        StreamType::Logs,
        None,
    ); */
    // End Register Transforms for stream

    let stream_schema: StreamSchemaChk = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Logs,
        &mut stream_schema_map,
    )
    .await;
    let mut partition_keys: Vec<String> = vec![];
    if stream_schema.has_partition_keys {
        partition_keys =
            crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map)
                .await;
    }

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();

    let parsed_msg = syslog_loose::parse_message(msg);
    let mut value = message_to_value(parsed_msg);
    value = flatten::flatten(&value).unwrap();

    /*
    let mut value = crate::service::ingestion::apply_stream_transform(
        &local_tans,
        &value,
        None,
        None,
        &stream_vrl_map,
        stream_name,
        &mut runtime,
    );

    if value.is_null() || !value.is_object() {
        stream_status.status.failed += 1; // transform failed or dropped
    } */
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
    let earlest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
    if timestamp < earlest_time.timestamp_micros() {
        stream_status.status.failed += 1; // to old data, just discard
        stream_status.status.error = super::get_upto_discard_error();
    }

    local_val.insert(
        CONFIG.common.column_timestamp.clone(),
        json::Value::Number(timestamp.into()),
    );

    let local_trigger = super::add_valid_record(
        StreamMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            partition_keys: partition_keys.clone(),
            stream_alerts_map: stream_alerts_map.clone(),
        },
        &mut stream_schema_map,
        &mut stream_status.status,
        &mut buf,
        local_val,
    )
    .await;

    if local_trigger.is_some() {
        trigger = Some(local_trigger.unwrap());
    }
    let mut stream_file_name = "".to_string();
    write_file(
        buf,
        thread_id,
        org_id,
        stream_name,
        &mut stream_file_name,
        StreamType::Logs,
    );

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, stream_alerts_map).await;

    /*     req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_ingest_stats(&req_stats, org_id, StreamType::Logs, UsageEvent::Syslog).await; */

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
        ingest(&raw, addr).await.unwrap();
    }
}
