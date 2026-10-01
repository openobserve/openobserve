// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Applies downtime rows replicated from another region, so each region decides locally.

use config::meta::{
    downtimes::Downtime,
    folder::{DEFAULT_FOLDER, Folder, FolderType},
};
use infra::{
    coordinator,
    errors::{Error, Result},
    table,
};
use o2_enterprise::enterprise::super_cluster::queue::{DowntimeMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg: DowntimeMessage = msg
        .try_into()
        .map_err(|e| Error::Message(format!("[DOWNTIMES] Failed to deserialize: {e}")))?;
    match msg {
        DowntimeMessage::Put { org, mut downtime } => {
            downtime.org = org;
            downtime.folder_id = local_folder_id(&downtime).await?;
            let coverage_changed = table::downtimes::get(&downtime.org, &downtime.id)
                .await?
                .is_some_and(|before| !before.same_coverage(&downtime));
            table::downtimes::put(&downtime).await?;
            coordinator::downtimes::emit_put_event(&downtime.org, &downtime.id).await?;
            if coverage_changed {
                forget_recorded_mutes(&downtime.id).await;
            }
            Ok(())
        }
        DowntimeMessage::Delete { org, id } => {
            table::downtimes::delete(&org, &id).await?;
            coordinator::downtimes::emit_delete_event(&org, &id).await
        }
    }
}

/// The same rule as the region that made the edit; a failure only delays the chip's correction.
async fn forget_recorded_mutes(id: &str) {
    if let Err(e) = table::alert_states::clear_last_downtime_id(id).await {
        log::warn!("[DOWNTIMES] could not clear the recorded mutes of {id}: {e}");
    }
}

/// A row that arrives before its folder is filed in the default folder until its next edit.
async fn local_folder_id(downtime: &Downtime) -> Result<String> {
    if table::folders::get_pk_by_name(&downtime.org, &downtime.folder_id, FolderType::Downtimes)
        .await?
        .is_some()
    {
        return Ok(downtime.folder_id.clone());
    }
    log::warn!(
        "[DOWNTIMES] folder {} of downtime {}/{} is not in this region yet, filing it in the default folder",
        downtime.folder_id,
        downtime.org,
        downtime.id
    );
    let default = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: DEFAULT_FOLDER.to_owned(),
        description: DEFAULT_FOLDER.to_owned(),
        icon: None,
    };
    table::folders::get_or_create(&downtime.org, default, FolderType::Downtimes).await?;
    Ok(DEFAULT_FOLDER.to_owned())
}
