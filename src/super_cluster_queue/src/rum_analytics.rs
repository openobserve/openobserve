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

//! Maps a meta-topic message onto the OSS replication applier, which never emits.

use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};
use openobserve_core::rum_pa::replication::{self, Op};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let op = match msg.message_type {
        MessageType::Put => Op::Put(msg.value.as_deref()),
        MessageType::Delete(prefix) => Op::Delete {
            prefix,
            version: msg.start_dt,
        },
        _ => Op::Other,
    };
    replication::apply(infra::db::get_orm_client_rw().await, &msg.key, op)
        .await
        .map_err(Error::Message)
}
