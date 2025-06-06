// Copyright 2025 OpenObserve Inc.
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
use std::io::{BufRead, BufReader};

use actix_web::web;
use config::{meta::stream::StreamType, utils::json};
use hashbrown::HashMap;
use serde::Deserialize;

use crate::{
    common::meta::ingestion::{HecResponse, HecStatus, IngestionRequest},
    service::ingestion::check_ingestion_allowed,
};

#[derive(Deserialize, Clone)]
struct HecEntry {
    index: String,
    time: Option<i64>,
    fields: Option<json::Value>,
    event: json::Value,
}

pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: web::Bytes,
    user_email: &str,
) -> Result<HecResponse, anyhow::Error> {
    // check system resource
    if check_ingestion_allowed(org_id, StreamType::Logs, None).is_err() {
        return Ok(HecStatus::InvalidIndex.into());
    }

    let reader = BufReader::new(body.as_ref());
    let mut streams: HashMap<String, Vec<json::Value>> = HashMap::new();

    // in case of ndjson, each line will have a json
    // for non ndjson, there will only be one item.
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let value: HecEntry = match json::from_slice(trimmed.as_bytes()) {
            Ok(v) => v,
            Err(e) => {
                log::info!("error in ingesting hec data '{trimmed}' : {e}");
                return Ok(HecStatus::InvalidFormat.into());
            }
        };
        let mut data = match &value.event {
            json::Value::String(s) => {
                serde_json::json!({"log":s.to_owned()})
            }
            json::Value::Object(_) => value.event.to_owned(),
            _ => return Ok(HecStatus::InvalidFormat.into()),
        };
        if let Some(s) = value.time {
            data["_timestamp"] = s.into();
        }
        if let Some(fields) = value.fields {
            if let Some(o) = fields.as_object() {
                for (f, v) in o {
                    data[f] = v.to_owned()
                }
            }
        }

        streams.entry(value.index).or_default().push(data);
    }

    for (stream, entries) in streams {
        let in_req = IngestionRequest::Hec(&entries);
        if let Err(e) =
            super::ingest::ingest(thread_id, org_id, &stream, in_req, user_email, None).await
        {
            return Ok(HecStatus::Custom(e.to_string(), 400).into());
        }
    }

    Ok(HecStatus::Success.into())
}
