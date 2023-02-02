use tokio::time;

use crate::infra::cluster::is_alert_manager;
use crate::service;

pub async fn run() -> Result<(), anyhow::Error> {
    if !is_alert_manager(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }
    // should run it every 10 seconds
    let mut interval = time::interval(time::Duration::from_secs(10));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::alert_manager::run().await;
        if ret.is_err() {
            log::error!("[ALERT MANAGER] run error: {}", ret.err().unwrap());
        }
    }
}
