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

use crate::errors::Error;

pub const AI_PROMPTS_WATCH_PREFIX: &str = "/ai_prompts/";

/// Sends event to the cluster coordinator indicating that an AI prompt has been put
/// into the database.
pub async fn emit_put_event(prompt_id: &str) -> Result<(), Error> {
    let key = format!("{AI_PROMPTS_WATCH_PREFIX}{prompt_id}");
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(&key, bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

/// Sends event to the cluster coordinator indicating that an AI prompt has been
/// deleted from the database.
pub async fn emit_delete_event(prompt_id: &str) -> Result<(), Error> {
    let key = format!("{AI_PROMPTS_WATCH_PREFIX}{prompt_id}");
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(&key, false, true, None).await
} 