// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Compile-time contract for paths preserved by the `openobserve-core` migration facade.
//!
//! Keep this test focused on representative paths consumed by API and jobs crates. Domain crates
//! may replace the implementation behind these paths, but the paths themselves stay available
//! until all downstream consumers have migrated.

use openobserve_core::{common, service};

fn assert_public_type<T: 'static>() {}

#[test]
fn common_compatibility_paths_remain_public() {
    assert_public_type::<common::meta::ingestion::IngestionRequest>();
    assert_public_type::<common::meta::search::SearchResultType>();
    assert_public_type::<common::meta::stream::SchemaRecords>();

    let _ = &common::infra::config::REALTIME_ALERT_TRIGGERS;
    let _ = &common::infra::config::STREAM_EXECUTABLE_PIPELINES;
    let _ = common::utils::js::compile_js_function;
}

#[test]
fn service_compatibility_paths_remain_public() {
    assert_public_type::<service::alerts::alert::AlertError>();
    assert_public_type::<service::dashboards::DashboardError>();
    assert_public_type::<service::dashboards::reports::ReportError>();
    assert_public_type::<service::db::scheduler::Trigger>();
    assert_public_type::<service::ingestion_types::IngestionRequest>();
    assert_public_type::<service::pipeline::batch_execution::ExecutablePipeline>();
    assert_public_type::<service::search::Searcher>();

    let _ = service::compact::run_retention;
    let _ = service::compact::incremental::incr_pending_file;
    let _ = service::db::compact::retention::is_deleting_stream;
    let _ = service::db::compact::files::get_offset;
    let _ = service::db::dashboards::dashboard_in_org;
    let _ = service::db::file_list::local::exist_pending_delete;
    let _ = service::db::scheduler::update_cron_expression;
    let _ = service::dashboards::timed_annotations::get_timed_annotations;
    let _ = service::ingestion::apply_vrl_fn;
    let _ = service::ingestion::ingestion_service::ingest;
    let _ = service::search::search;
    let _ = service::short_url::shorten;
}
