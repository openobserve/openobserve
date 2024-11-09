// Copyright 2024 OpenObserve Inc.
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

use anyhow::Error;
use config::{
    get_config,
    meta::{
        cluster::get_internal_grpc_token,
        self_reporting::usage::{
            AggregatedData, GroupKey, TriggerData, UsageData, UsageEvent, TRIGGERS_USAGE_STREAM,
            USAGE_STREAM,
        },
    },
    utils::json,
};
use hashbrown::HashMap;
use proto::cluster_rpc;
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    Request,
};

use crate::service::grpc::get_ingester_channel;

pub(super) async fn ingest(
    dest_org_id: &str,
    req: cluster_rpc::UsageRequest,
) -> Result<cluster_rpc::UsageResponse, Error> {
    let cfg = config::get_config();
    let org_header_key: MetadataKey<_> = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Error::msg("invalid org_header_key".to_string()))?;
    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| Error::msg("invalid token".to_string()))?;
    let (addr, channel) = get_ingester_channel().await?;
    let mut client = cluster_rpc::usage_client::UsageClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut()
                .insert(org_header_key.clone(), dest_org_id.parse().unwrap());
            Ok(req)
        },
    );
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let res: cluster_rpc::UsageResponse = match client.report_usage(req).await {
        Ok(res) => res.into_inner(),
        Err(err) => {
            log::error!(
                "[UsageReport] export partial_success node: {addr}, response: {:?}",
                err
            );
            if err.code() == tonic::Code::Internal {
                return Err(err.into());
            }
            return Err(Error::msg(format!(
                "Ingest node {addr}, response error: {}",
                err
            )));
        }
    };
    Ok(res)
}

pub(super) async fn ingest_usages(curr_usages: Vec<UsageData>) {
    if curr_usages.is_empty() {
        log::info!("Returning as no usages reported ");
        return;
    }
    let mut groups: HashMap<GroupKey, AggregatedData> = HashMap::new();
    let mut search_events = vec![];
    for usage_data in &curr_usages {
        // Skip aggregation for usage_data with event "Search"
        if usage_data.event == UsageEvent::Search {
            search_events.push(usage_data.clone());
            continue;
        }

        let key = GroupKey {
            stream_name: usage_data.stream_name.clone(),
            org_id: usage_data.org_id.clone(),
            stream_type: usage_data.stream_type,
            day: usage_data.day,
            hour: usage_data.hour,
            event: usage_data.event,
            email: usage_data.user_email.clone(),
        };

        let is_new = groups.contains_key(&key);

        let entry = groups.entry(key).or_insert_with(|| AggregatedData {
            count: 1,
            usage_data: usage_data.clone(),
        });
        if !is_new {
            continue;
        } else {
            entry.usage_data.num_records += usage_data.num_records;
            entry.usage_data.size += usage_data.size;
            entry.usage_data.response_time += usage_data.response_time;
            entry.count += 1;
        }
    }

    let mut report_data = vec![];
    for (_, data) in groups {
        let mut usage_data = data.usage_data;
        usage_data.response_time /= data.count as f64;
        report_data.push(usage_data);
    }

    // Push all the search events
    report_data.append(&mut search_events);
    let cfg = get_config();
    if &cfg.common.usage_reporting_mode != "local"
        && !cfg.common.usage_reporting_url.is_empty()
        && !cfg.common.usage_reporting_creds.is_empty()
    {
        let url = url::Url::parse(&cfg.common.usage_reporting_url).unwrap();
        let creds = if cfg.common.usage_reporting_creds.starts_with("Basic") {
            cfg.common.usage_reporting_creds.to_string()
        } else {
            format!("Basic {}", &cfg.common.usage_reporting_creds)
        };
        match reqwest::Client::builder()
            .build()
            .unwrap()
            .post(url)
            .header("Content-Type", "application/json")
            .header(reqwest::header::AUTHORIZATION, creds)
            .json(&report_data)
            .send()
            .await
        {
            Ok(resp) => {
                let resp_status = resp.status();
                if !resp_status.is_success() {
                    log::error!(
                        "Error in ingesting usage data to external URL: {}",
                        resp.text()
                            .await
                            .unwrap_or_else(|_| resp_status.to_string())
                    );
                    if &cfg.common.usage_reporting_mode != "both" {
                        // on error in ingesting usage data, push back the data
                        let curr_usages = curr_usages.clone();
                        if let Err(e) = super::queuer::USAGE_QUEUER
                            .enqueue(
                                curr_usages
                                    .into_iter()
                                    .map(|item| super::queuer::UsageBuffer::Usage(Box::new(item)))
                                    .collect(),
                            )
                            .await
                        {
                            log::error!(
                                "Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Error in ingesting usage data to external URL {:?}", e);
                if &cfg.common.usage_reporting_mode != "both" {
                    // on error in ingesting usage data, push back the data
                    let curr_usages = curr_usages.clone();
                    if let Err(e) = super::queuer::USAGE_QUEUER
                        .enqueue(
                            curr_usages
                                .into_iter()
                                .map(|item| super::queuer::UsageBuffer::Usage(Box::new(item)))
                                .collect(),
                        )
                        .await
                    {
                        log::error!(
                            "Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                        );
                    }
                }
            }
        }
    }

    if &cfg.common.usage_reporting_mode != "remote" {
        let report_data = report_data
            .iter_mut()
            .map(|usage| json::to_value(usage).unwrap())
            .collect::<Vec<_>>();
        // report usage data
        let req = cluster_rpc::UsageRequest {
            stream_name: USAGE_STREAM.to_owned(),
            data: Some(cluster_rpc::UsageData::from(report_data)),
        };
        if let Err(e) = ingest(&cfg.common.usage_org, req).await {
            log::error!("Error in ingesting usage data {:?}", e);
            // on error in ingesting usage data, push back the data
            if let Err(e) = super::queuer::USAGE_QUEUER
                .enqueue(
                    curr_usages
                        .into_iter()
                        .map(|item| super::queuer::UsageBuffer::Usage(Box::new(item)))
                        .collect(),
                )
                .await
            {
                log::error!("Error in pushing back un-ingested Usage data to UsageQueuer: {e}");
            }
        }
    }
}

pub(super) async fn ingest_trigger_usages(curr_usages: Vec<TriggerData>) {
    if curr_usages.is_empty() {
        log::info!(" Returning as no triggers reported");
        return;
    }

    let mut json_triggers = vec![];
    for trigger_data in &curr_usages {
        json_triggers.push(json::to_value(trigger_data).unwrap());
    }

    // report trigger usage data
    let req = cluster_rpc::UsageRequest {
        stream_name: TRIGGERS_USAGE_STREAM.to_owned(),
        data: Some(cluster_rpc::UsageData::from(json_triggers)),
    };
    if let Err(e) = ingest(&get_config().common.usage_org, req).await {
        log::error!("Error in ingesting triggers usage data {:?}", e);
        if let Err(e) = super::queuer::USAGE_QUEUER
            .enqueue(
                curr_usages
                    .into_iter()
                    .map(|item| super::queuer::UsageBuffer::Trigger(Box::new(item)))
                    .collect(),
            )
            .await
        {
            log::error!("Error in pushing back un-ingested Usage data to UsageQueuer: {e}");
        }
    }
}
