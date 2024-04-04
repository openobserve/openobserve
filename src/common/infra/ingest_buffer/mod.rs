// Copyright 2023 Zinc Labs Inc.
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

pub mod entry;
mod queue_store;
pub mod task_queue;
mod workers;

static INTERVAL: tokio::time::Duration = tokio::time::Duration::from_secs(600);

pub async fn init() -> Result<(), anyhow::Error> {
    // check uncompleted ingestion requests persisted in the disk

    // replay wal files to create ingestion tasks

    // init task queue
    task_queue::init().await?;

    Ok(())
}
