use tokio::time;

use crate::{infra::config::CONFIG, meta::telemetry::Telemetry};

pub async fn run() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(
        (CONFIG.limit.hb_interval * 60).try_into().unwrap(),
    ));
    interval.tick().await;
    loop {
        interval.tick().await;
        Telemetry::new()
            .heart_beat("Zinc Observe - heartbeat", None)
            .await;
    }
}
