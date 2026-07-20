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

use bytes::Bytes;
use hashbrown::HashMap;
use infra::{db as infra_db, errors::Result};
#[cfg(feature = "enterprise")]
use {
    infra::errors::Error, o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

pub mod alerts {
    pub mod alert {
        pub use openobserve_alerts::repository::alert::*;
    }
    pub mod destinations {
        pub use openobserve_alerts::repository::destinations::*;
    }
    pub mod realtime_triggers {
        pub use openobserve_alerts::repository::realtime_triggers::*;
    }
    pub mod templates {
        pub use openobserve_alerts::repository::templates::*;
    }
}
pub mod compact {
    pub mod compactor_manual_jobs {
        pub use openobserve_compactor::repository::compactor_manual_jobs::*;
    }
    pub mod downsampling {
        pub use openobserve_compactor::repository::downsampling::*;
    }
    pub mod files {
        pub use openobserve_compactor::repository::files::*;
    }
    pub mod organization {
        pub use openobserve_compactor::repository::organization::*;
    }
    pub mod retention {
        pub use openobserve_compactor::repository::retention::*;
    }
    pub mod stats {
        pub use openobserve_compactor::repository::stats::*;
    }
    pub mod stream {
        pub use openobserve_compactor::repository::stream::*;
    }
}
pub mod dashboards {
    pub use openobserve_dashboards::repository::*;

    pub mod reports {
        pub use openobserve_reports::repository::*;
    }
}
pub mod distinct_values;
pub mod enrichment_table {
    pub use openobserve_enrichment::repository::*;
}
pub mod file_list;
pub mod functions {
    pub use openobserve_transform::repository::*;
}
#[cfg(feature = "enterprise")]
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod metas;
pub mod metrics;
pub mod model_pricing {
    pub use openobserve_ingestion::repository::model_pricing::*;
}
pub mod model_pricing_sync;
#[cfg(feature = "enterprise")]
pub mod ofga;
pub mod org_ingestion_tokens {
    pub use openobserve_ingestion::repository::org_ingestion_tokens::*;
}
pub mod org_status {
    pub use openobserve_organization::status::*;
}
#[cfg(feature = "enterprise")]
pub mod org_storage_providers;
pub mod org_users {
    pub use openobserve_organization::repository::org_users::*;
}
pub mod organization {
    pub use openobserve_organization::repository::organization::*;
}
pub mod pipeline_errors {
    pub use openobserve_pipeline::repository::pipeline_errors::*;
}
#[cfg(feature = "vectorscan")]
pub mod re_pattern;
pub mod saved_view {
    pub use openobserve_organization::repository::saved_view::*;
}
pub mod scheduler {
    pub use openobserve_scheduler::*;
}
pub mod schema;
pub mod search_job {
    pub mod search_job_partitions {
        pub use openobserve_search_service::repository::search_job::search_job_partitions::*;
    }
    pub mod search_job_results {
        pub use openobserve_search_service::repository::search_job::search_job_results::*;
    }
    pub mod search_jobs {
        pub use openobserve_search_service::repository::search_job::search_jobs::*;
    }
}
#[cfg(feature = "enterprise")]
pub mod service_graph;
pub mod session;
pub mod short_url {
    pub use common::short_url::repository::*;
}
pub mod sourcemaps {
    pub use openobserve_search_service::sourcemaps::repository::*;
}
pub mod system_settings {
    pub use common::system_settings::*;
}
pub mod user {
    pub use openobserve_organization::repository::user::*;
}

pub(crate) use infra_db::{Event, NEED_WATCH, NO_NEED_WATCH, get_coordinator};

#[inline]
pub(crate) async fn get(key: &str) -> Result<Bytes> {
    let db = infra_db::get_db().await;
    db.get(key).await
}

#[cfg(feature = "enterprise")]
// checks if the value of the given compact delete job is updated to a node id
fn check_if_compact_delete_node_value_updated(key: &str, value: &Bytes) -> bool {
    let value_str = String::from_utf8_lossy(value);
    key.starts_with("/compact/delete") && value_str.ne("OK")
}

#[inline]
pub(crate) async fn put(
    key: &str,
    value: Bytes,
    need_watch: bool,
    start_dt: Option<i64>,
) -> Result<()> {
    let db = infra_db::get_db().await;
    db.put(key, value.clone(), need_watch, start_dt).await?;

    // Hack: if the key starts with /compact/delete, and the value is not "OK",
    // then we don't need to put it to super cluster. This is because compact/delete
    // is a local cluster job, when we call process_stream, it will set the node id
    // as the value
    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled
        && !check_if_compact_delete_node_value_updated(key, &value)
    {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, start_dt)
            .await
            .map_err(|e| {
                log::error!("[COMPACTOR] put to super cluster failed: {key} - {e}");
                Error::Message(e.to_string())
            })?;
    }

    Ok(())
}

#[inline]
pub(crate) async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
    let db = infra_db::get_db().await;
    db.list(prefix).await
}

#[inline]
pub(crate) async fn list_values_by_start_dt(
    prefix: &str,
    start_dt: Option<(i64, i64)>,
) -> Result<Vec<(i64, Bytes)>> {
    let db = infra_db::get_db().await;
    db.list_values_by_start_dt(prefix, start_dt).await
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use super::*;

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_check_if_compact_delete_node_value_updated() {
        let key = "/compact/delete/test/123";
        let value = Bytes::from("OK");
        assert!(!check_if_compact_delete_node_value_updated(key, &value));

        let value = Bytes::from("NOT_OK");
        assert!(check_if_compact_delete_node_value_updated(key, &value));
    }
}
