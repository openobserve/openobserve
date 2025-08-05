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

use infra::{
    errors::Result,
    table::compactor_manual_jobs::{CompactorManualJob, add},
};
use o2_enterprise::enterprise::super_cluster::queue::Message;

pub(crate) async fn process(msg: Message) -> Result<()> {
    let job: CompactorManualJob = serde_json::from_slice(&msg.value.unwrap())?;
    add(job).await?;
    Ok(())
}
