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

use config::CONFIG;
use tokio::time;

use crate::common::meta::telemetry::Telemetry;

pub async fn run() -> Result<(), anyhow::Error> {
    let config = CONFIG.read().await;
    if !config.common.telemetry_enabled {
        return Ok(());
    }

    let mut interval = time::interval(time::Duration::from_secs(
        (config.common.telemetry_heartbeat).try_into().unwrap(),
    ));
    interval.tick().await;
    loop {
        interval.tick().await;
        Telemetry::new()
            .heart_beat("OpenObserve - heartbeat", None)
            .await;
    }
}
