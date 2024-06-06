// Copyright 2024 Zinc Labs Inc.
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

use std::{collections::HashMap, net::SocketAddr};

use actix_web::{http, HttpResponse};
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::stream::StreamType,
    metrics,
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
    DISTINCT_FIELDS,
};
use infra::schema::SchemaCache;
use syslog_loose::{Message, ProcId, Protocol};

use super::StreamMeta;
use crate::{
    common::{
        infra::config::SYSLOG_ROUTES,
        meta::{
            alerts::Alert,
            http::HttpResponse as MetaHttpResponse,
            ingestion::{IngestionResponse, StreamStatus},
            stream::{SchemaRecords, StreamParams},
            syslog::SyslogRoute,
        },
    },
    service::{
        db, get_formatted_stream_name,
        ingestion::{evaluate_trigger, write_file, TriggerAlertData},
        metadata::{distinct_values::DvItem, write, MetadataItem, MetadataType},
        schema::get_upto_discard_error,
    },
};

pub async fn ingest(msg: &str, addr: SocketAddr) -> Result<HttpResponse> {
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
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
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
    if db::compact::retention::is_deleting_stream(org_id, StreamType::Logs, stream_name, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("stream [{stream_name}] is being deleted"),
            )),
        );
    }

    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut distinct_values = Vec::with_capacity(16);

    let mut trigger: Option<TriggerAlertData> = None;

    let partition_det = crate::service::ingestion::get_stream_partition_keys(
        org_id,
        &StreamType::Logs,
        stream_name,
    )
    .await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    crate::service::ingestion::get_stream_alerts(
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: stream_name.to_owned().into(),
            stream_type: StreamType::Logs,
        }],
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let mut buf: HashMap<String, SchemaRecords> = HashMap::new();

    let cfg = config::get_config();
    let parsed_msg = syslog_loose::parse_message(msg);
    let mut value = message_to_value(parsed_msg);
    value = flatten::flatten_with_level(value, cfg.limit.ingest_flatten_level).unwrap();

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_functions(
            &local_trans,
            value,
            &stream_vrl_map,
            org_id,
            stream_name,
            &mut runtime,
        )?;
    }

    if value.is_null() || !value.is_object() {
        stream_status.status.failed += 1; // transform failed or dropped
        return Ok(HttpResponse::Ok().json(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ))); // just return
    }
    // End row based transform

    // get json object
    let mut local_val = match value.take() {
        json::Value::Object(v) => v,
        _ => unreachable!(),
    };

    // handle timestamp
    let timestamp = match local_val.get(&cfg.common.column_timestamp) {
        Some(v) => match parse_timestamp_micro_from_value(v) {
            Ok(t) => t,
            Err(_) => Utc::now().timestamp_micros(),
        },
        None => Utc::now().timestamp_micros(),
    };
    // check ingestion time
    let earlest_time = Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap();
    if timestamp < earlest_time.timestamp_micros() {
        stream_status.status.failed += 1; // to old data, just discard
        stream_status.status.error = get_upto_discard_error().to_string();
    }

    local_val.insert(
        cfg.common.column_timestamp.clone(),
        json::Value::Number(timestamp.into()),
    );

    let mut to_add_distinct_values = vec![];
    // get distinct_value item
    for field in DISTINCT_FIELDS.iter() {
        if let Some(val) = local_val.get(field) {
            if !val.is_null() {
                to_add_distinct_values.push(MetadataItem::DistinctValues(DvItem {
                    stream_type: StreamType::Logs,
                    stream_name: stream_name.to_string(),
                    field_name: field.to_string(),
                    field_value: val.as_str().unwrap().to_string(),
                    filter_name: "".to_string(),
                    filter_value: "".to_string(),
                }));
            }
        }
    }

    let local_trigger = match super::add_valid_record(
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
    .await
    {
        Ok(v) => v,
        Err(e) => {
            stream_status.status.failed += 1;
            stream_status.status.error = e.to_string();
            None
        }
    };
    if local_trigger.is_some() {
        trigger = local_trigger;
    }

    // get distinct_value item
    distinct_values.extend(to_add_distinct_values);

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    write_file(&writer, stream_name, buf).await;
    if let Err(e) = writer.sync() {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
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
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    #[tokio::test]
    async fn test_ingest() {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 8080);
        let raw = r#"<190>2019-02-13T21:53:30.605850+00:00 74794bfb6795 liblogging-stdlog: [origin software="rsyslogd" swVersion="8.24.0" x-pid="9043" x-info="http://www.rsyslog.com"] This is a test message"#;
        ingest(raw, addr).await.unwrap();
    }
}
