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

use chrono::Utc;
use config::meta::{
    self_reporting::error::{ErrorData, ErrorSource, FunctionError},
    stream::StreamParams,
};

use crate::self_reporting::publish_error;

/// Loads function records into the shared cache and reports invalid entries.
pub async fn cache() -> Result<(), anyhow::Error> {
    for error in ::db::functions::load_cache().await? {
        publish_error(ErrorData {
            _timestamp: Utc::now().timestamp_micros(),
            stream_params: StreamParams {
                org_id: error.org_id.into(),
                ..Default::default()
            },
            error_source: ErrorSource::Function(FunctionError::new(
                error.function_name,
                error.message,
            )),
        })
        .await;
    }
    Ok(())
}
