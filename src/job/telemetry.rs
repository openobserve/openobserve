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

use tokio::time;

use crate::common::meta::telemetry::Telemetry;

pub async fn run() -> Result<(), anyhow::Error> {
    loop {
        let cfg = config::get_config();
        if !cfg.common.telemetry_enabled {
            // Sleep for a short time and check again if telemetry gets enabled
            tokio::time::sleep(time::Duration::from_secs(30)).await;
            continue;
        }

        tokio::time::sleep(time::Duration::from_secs(
            cfg.common.telemetry_heartbeat.try_into().unwrap(),
        ))
        .await;
        Telemetry::new()
            .heart_beat("OpenObserve - heartbeat", None)
            .await;
    }
}
