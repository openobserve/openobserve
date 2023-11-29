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

use super::db;
use crate::common::meta::{alerts::triggers::Trigger, StreamType};

pub async fn save(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
    trigger: &Trigger,
) -> Result<(), anyhow::Error> {
    db::alerts::triggers::set(org_id, stream_type, stream_name, alert_name, trigger).await
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    alert_name: &str,
) -> Result<(), anyhow::Error> {
    db::alerts::triggers::delete(org_id, stream_type, stream_name, alert_name).await
}
