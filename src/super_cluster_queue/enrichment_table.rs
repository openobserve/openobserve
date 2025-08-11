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

use config::meta::stream::StreamType;
use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::Message;

pub(crate) async fn process_file_list_delete(msg: Message) -> Result<()> {
    let key_parts = msg.key.split('/').collect::<Vec<&str>>();
    if key_parts.len() != 5 {
        let err_msg = format!(
            "enrichment table super cluster queue file list delete key is not valid: {}",
            msg.key
        );
        log::error!("{err_msg}");
        return Err(Error::Message(err_msg));
    }
    // Format is /enrichment_file_list_delete/{org_id}/{stream_type}/{stream_name}
    let org_id = key_parts[2];
    let stream_name = key_parts[4];
    let time_range: config::meta::stream::TimeRange = serde_json::from_slice(&msg.value.unwrap())?;
    crate::service::compact::retention::delete_from_file_list(
        org_id,
        StreamType::EnrichmentTables,
        stream_name,
        (time_range.start, time_range.end),
    )
    .await
    .map_err(|e| {
        let err_msg =
            format!("[ENRICHMENT_TABLE] delete_from_file_list {org_id}/{stream_name} failed: {e}",);
        log::error!("{err_msg}");
        Error::Message(err_msg)
    })?;
    Ok(())
}
