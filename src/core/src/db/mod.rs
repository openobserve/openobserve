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
pub mod distinct_values {
    pub use openobserve_dashboards::distinct_values::*;
}
pub mod enrichment_table {
    pub use openobserve_enrichment::repository::*;
}
pub mod file_list {
    pub use openobserve_catalog::file_list::{BLOCKED_ORGS, DEDUPLICATE_FILES, DELETED_FILES, set};

    pub mod broadcast {
        pub use openobserve_catalog::file_list::broadcast::*;
    }

    pub mod local {
        pub use openobserve_catalog::file_list::local::*;
    }

    pub async fn cache_stats() -> infra::errors::Result<()> {
        let orgs = openobserve_catalog::schema::list_organizations_from_cache().await;
        openobserve_catalog::file_list::cache_stats(&orgs).await
    }
}
pub mod functions {
    pub use openobserve_transform::repository::*;
}
#[cfg(feature = "enterprise")]
pub mod keys {
    pub use openobserve_organization::keys::*;
}
pub mod kv {
    pub use common::kv::*;
}
#[cfg(feature = "enterprise")]
pub mod license {
    pub use openobserve_organization::license::*;
}
pub mod metas {
    pub use ::common::metadata::*;
}
pub mod metrics {
    pub use openobserve_ingestion::metrics::cluster::*;
}
pub mod model_pricing {
    pub use openobserve_ingestion::repository::model_pricing::*;
}
pub mod org_ingestion_tokens {
    pub use openobserve_ingestion::repository::org_ingestion_tokens::*;
}
pub mod org_status {
    pub use openobserve_organization::status::*;
}
#[cfg(feature = "enterprise")]
pub mod org_storage_providers {
    pub use openobserve_organization::repository::org_storage_providers::*;
}
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
pub mod re_pattern {
    pub use openobserve_catalog::re_pattern::*;
}
pub mod saved_view {
    pub use openobserve_organization::repository::saved_view::*;
}
pub mod scheduler {
    pub use openobserve_scheduler::*;
}
pub mod schema {
    pub use openobserve_catalog::schema::*;
}
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
pub mod service_graph {
    pub use openobserve_ingestion::repository::service_graph::*;
}
pub mod session {
    pub use openobserve_organization::repository::session::*;
}
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
