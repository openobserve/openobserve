// Copyright 2026 OpenObserve Inc.
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

pub use ::db::functions::*;
use chrono::Utc;
use config::{
    meta::{
        function::Transform,
        self_reporting::error::{ErrorData, ErrorSource, FunctionError},
        stream::StreamParams,
    },
    utils::json,
};

use crate::{common::infra::config::QUERY_FUNCTIONS, service::self_reporting::publish_error};

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/function/";
    let functions = ::db::list(key).await?;
    for (item_key, item_value) in functions {
        let item_key = item_key.strip_prefix(key).unwrap();
        let function: Transform = match json::from_slice(&item_value) {
            Ok(function) => function,
            Err(err) => {
                log::error!("Error deserializing function {item_key}: {err}");
                let mut parts = item_key.splitn(2, '/');
                let org_id = parts.next().unwrap_or_default();
                let function_name = parts.next().unwrap_or(item_key);
                publish_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: StreamParams {
                        org_id: org_id.to_string().into(),
                        ..Default::default()
                    },
                    error_source: ErrorSource::Function(FunctionError::new(
                        function_name.to_string(),
                        format!("Error deserializing function: {err}"),
                    )),
                })
                .await;
                continue;
            }
        };
        QUERY_FUNCTIONS.insert(item_key.to_string(), function);
    }
    log::info!("Functions Cached");
    Ok(())
}
