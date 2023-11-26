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

use tokio::time;

use crate::common::infra::cluster::is_alert_manager;
use crate::service;

pub async fn run() -> Result<(), anyhow::Error> {
    if !is_alert_manager(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }
    // should run it every 10 seconds
    let mut interval = time::interval(time::Duration::from_secs(30));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::alert_manager::run().await;
        if ret.is_err() {
            log::error!("[ALERT MANAGER] run error: {}", ret.err().unwrap());
        }
    }
}
