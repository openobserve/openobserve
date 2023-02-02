use tokio::time::{self, Duration};

use crate::infra::cluster;
use crate::infra::config::{CONFIG, METRIC_CLUSTER_LEADER};
use crate::service::db;

pub async fn run() -> Result<(), anyhow::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(()); // not an ingester, no need to init job
    }

    if !CONFIG.common.metrics_dedup_enabled {
        return Ok(());
    }

    let mut interval = time::interval(Duration::from_secs(
        CONFIG.limit.metrics_leader_push_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let leaders = METRIC_CLUSTER_LEADER.clone();
        for item in leaders.iter() {
            // log::info!("Cluster leader for {:?} --> {:?}", item.key(), item.value());
            let result = db::set_prom_cluster_leader(item.key(), item.value()).await;
            match result {
                Ok(_) => log::info!("Successfully updated leader to etcd "),
                Err(err) => log::error!("error updating leader to etcd {}", err),
            }
        }
    }
}
