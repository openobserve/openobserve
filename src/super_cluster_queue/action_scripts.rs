// Copyright (c) 2025. OpenObserve Inc.
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

use infra::errors::Result;
use o2_enterprise::enterprise::super_cluster::queue::{ActionScriptsMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let action_scripts_message: ActionScriptsMessage = msg.try_into()?;
    match action_scripts_message {
        ActionScriptsMessage::Put { action } => {
            if let Ok(current_cluster_action) =
                infra::table::action_scripts::get(&action.id.unwrap().to_string(), &action.org_id)
                    .await
            {
                // first we check if the origin cluster url has changed
                // if it has, we check if the previous action zip file was uploaded in the s3 bucket
                // of the current cluster if it was, we remove the zip file from s3
                // bucket
                if current_cluster_action.origin_cluster_url != action.origin_cluster_url
                    && current_cluster_action.origin_cluster_url
                        == config::get_config().common.web_url
                    && infra::storage::del(&[current_cluster_action
                        .zip_file_path
                        .as_ref()
                        .expect("zip file path is required")])
                    .await
                    .is_err()
                {
                    log::error!(
                        "failed to delete the zip file from s3 bucket {}",
                        current_cluster_action
                            .zip_file_path
                            .expect("zip file path is required")
                    );
                };
                infra::table::action_scripts::update(&action).await?;
            } else {
                infra::table::action_scripts::add(&action).await?;
            }
        }
        ActionScriptsMessage::Delete { org_id, action_id } => {
            if let Ok(current_cluster_action) =
                infra::table::action_scripts::get(&action_id, &org_id).await
            {
                // check if the current cluster is the custodian of the action zip file
                if current_cluster_action.origin_cluster_url == config::get_config().common.web_url
                    && infra::storage::del(&[current_cluster_action
                        .zip_file_path
                        .as_ref()
                        .expect("zip file path is required")])
                    .await
                    .is_err()
                {
                    log::error!(
                        "failed to delete the zip file from s3 bucket {}",
                        current_cluster_action
                            .zip_file_path
                            .expect("zip file path is required")
                    );
                }
            }
            infra::table::action_scripts::remove(&org_id, &action_id).await?;
        }
    }
    Ok(())
}
