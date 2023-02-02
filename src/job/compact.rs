use tokio::time;

use crate::infra::cluster::is_compactor;
use crate::infra::config::CONFIG;
use crate::service;

pub async fn run() -> Result<(), anyhow::Error> {
    if !is_compactor(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }
    if !CONFIG.compact.enabled {
        return Ok(());
    }
    // should run it every hour
    let mut interval = time::interval(time::Duration::from_secs(CONFIG.compact.interval));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::compact::run().await;
        if ret.is_err() {
            log::error!("[COMPACTOR] run error: {}", ret.err().unwrap());
        }
    }
}
