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

use config::{get_config, meta::stream::StreamType};
#[cfg(feature = "enterprise")]
use o2_ratelimit::dataresource::default_rules::OpenapiInfo;
use openobserve_api_ingest::request::{clusters, logs, metrics, rum};
use openobserve_api_management::request::{
    gen_ai, keys, kv, service_accounts, service_streams, short_url, status, stream, synthetics,
};
use openobserve_api_pipelines::request::{enrichment_table, functions, pipeline, pipelines};
use openobserve_api_search::search::patterns;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};

use crate::{
    common::meta,
    handler::http::request::{mcp, ratelimit},
};

#[derive(OpenApi)]
#[openapi(
    paths(
        status::healthz,
        openobserve_api_management::request::users::list,
        openobserve_api_management::request::users::save,
        openobserve_api_management::request::users::update,
        openobserve_api_management::request::users::delete,
        openobserve_api_management::request::users::add_user_to_org,
        openobserve_api_management::request::organization::org::organizations,
        openobserve_api_management::request::organization::org::create_org,
        openobserve_api_management::request::organization::org::rename_org,
        openobserve_api_management::request::organization::assume_service_account::assume_service_account,
        openobserve_api_management::request::organization::org::org_summary,
        openobserve_api_management::request::organization::org::get_user_passcode,
        openobserve_api_management::request::organization::org::update_user_passcode,
        openobserve_api_management::request::organization::org::get_user_rumtoken,
        openobserve_api_management::request::organization::org::update_user_rumtoken,
        openobserve_api_management::request::organization::org::create_user_rumtoken,
        openobserve_api_management::request::organization::settings::get,
        openobserve_api_management::request::organization::settings::create,
        openobserve_api_management::request::organization::system_settings::get_setting,
        openobserve_api_management::request::organization::system_settings::list_settings,
        openobserve_api_management::request::organization::system_settings::set_org_setting,
        openobserve_api_management::request::organization::system_settings::set_user_setting,
        openobserve_api_management::request::organization::system_settings::delete_org_setting,
        openobserve_api_management::request::organization::system_settings::delete_user_setting,
        openobserve_api_management::request::announcements::get_announcements,
        openobserve_api_management::request::announcements::get_announcements_config,
        openobserve_api_management::request::announcements::set_announcements_config,
        stream::list,
        stream::schema,
        stream::create,
        stream::update_settings,
        stream::delete_fields,
        stream::delete,
        logs::ingest::bulk,
        logs::ingest::multi,
        logs::ingest::json,
        logs::loki::loki_push,
        openobserve_api_search::traces::traces_write,
        openobserve_api_search::traces::get_latest_traces,
        openobserve_api_search::traces::session::get_latest_sessions,
        openobserve_api_search::traces::session::get_session_details,
        openobserve_api_search::traces::user::get_latest_users,
        openobserve_api_search::traces::details::get_trace_details,
        openobserve_api_search::traces::time_index::get_trace_time_range,
        openobserve_api_search::traces::time_index::get_org_trace_time_range,
        openobserve_api_search::traces::dag::get_trace_dag,
        openobserve_api_search::profiles::meta::get_profiles_meta,
        openobserve_api_search::profiles::tag_values::get_profiles_tag_values,
        openobserve_api_search::profiles::series::profiles_series_get,
        openobserve_api_search::profiles::series::profiles_series,
        openobserve_api_search::profiles::merge::merge_profiles_get,
        openobserve_api_search::profiles::merge::merge_profiles,
        metrics::ingest::json,
        openobserve_api_search::promql::remote_write,
        openobserve_api_search::promql::query_get,
        openobserve_api_search::promql::query_range_get,
        openobserve_api_search::promql::metadata,
        openobserve_api_search::promql::series_get,
        openobserve_api_search::promql::labels_get,
        openobserve_api_search::promql::label_values,
        openobserve_api_search::promql::format_query_get,
        enrichment_table::save_enrichment_table,
        enrichment_table::save_enrichment_table_from_url,
        rum::ingest::log,
        rum::ingest::data,
        rum::ingest::sessionreplay,
        openobserve_api_search::search::search,
        openobserve_api_search::search::search_partition,
        openobserve_api_search::search::query_functions::list,
        openobserve_api_search::search::around_v1,
        openobserve_api_search::search::around_v2,
        openobserve_api_search::search::values,
        openobserve_api_search::search::search_history,
        openobserve_api_search::search::saved_view::create_view,
        openobserve_api_search::search::saved_view::delete_view,
        openobserve_api_search::search::saved_view::get_view,
        openobserve_api_search::search::saved_view::get_views,
        openobserve_api_search::search::saved_view::update_view,
        openobserve_api_management::request::folders::delete_folder,
        openobserve_api_management::request::folders::create_folder,
        openobserve_api_management::request::folders::list_folders,
        openobserve_api_management::request::folders::get_folder,
        openobserve_api_management::request::folders::get_folder_by_name,
        openobserve_api_management::request::folders::update_folder,
        openobserve_api_management::request::folders::deprecated::delete_folder,
        openobserve_api_management::request::folders::deprecated::create_folder,
        openobserve_api_management::request::folders::deprecated::list_folders,
        openobserve_api_management::request::folders::deprecated::get_folder,
        openobserve_api_management::request::folders::deprecated::get_folder_by_name,
        openobserve_api_management::request::folders::deprecated::update_folder,
        functions::list_functions,
        functions::update_function,
        functions::save_function,
        functions::delete_function,
        functions::list_pipeline_dependencies,
        functions::test_function,
        openobserve_api_management::request::dashboards::create_dashboard,
        openobserve_api_management::request::dashboards::update_dashboard,
        openobserve_api_management::request::dashboards::list_dashboards,
        openobserve_api_management::request::dashboards::get_dashboard,
        openobserve_api_management::request::dashboards::delete_dashboard,
        openobserve_api_management::request::dashboards::move_dashboard,
        openobserve_api_management::request::dashboards::move_dashboards,
        openobserve_api_management::request::dashboards::add_panel,
        openobserve_api_management::request::dashboards::update_panel,
        openobserve_api_management::request::dashboards::delete_panel,
        openobserve_api_management::request::dashboards::timed_annotations::create_annotations,
        openobserve_api_management::request::dashboards::timed_annotations::get_annotations,
        openobserve_api_management::request::dashboards::timed_annotations::delete_annotations,
        openobserve_api_management::request::dashboards::timed_annotations::update_annotations,
        openobserve_api_management::request::dashboards::timed_annotations::delete_annotation_panels,
        openobserve_api_management::request::alerts::create_alert,
        openobserve_api_management::request::alerts::validate_composite_alert,
        openobserve_api_management::request::alerts::get_composite_references,
        openobserve_api_management::request::alerts::get_composite_timeline,
        openobserve_api_management::request::alerts::get_alert,
        openobserve_api_management::request::alerts::export_alert,
        openobserve_api_management::request::alerts::update_alert,
        openobserve_api_management::request::alerts::delete_alert,
        openobserve_api_management::request::alerts::list_alerts,
        openobserve_api_management::request::alerts::enable_alert,
        openobserve_api_management::request::alerts::enable_alert_bulk,
        openobserve_api_management::request::alerts::trigger_alert,
        openobserve_api_management::request::alerts::retrain_alert,
        openobserve_api_management::request::alerts::clone_alert,
        openobserve_api_management::request::alerts::generate_sql,
        openobserve_api_management::request::alerts::move_alerts,
        openobserve_api_management::request::alerts::list_alert_tags,
        openobserve_api_management::request::alerts::history::get_alert_history,
        openobserve_api_management::request::alerts::incidents::list_incidents,
        openobserve_api_management::request::alerts::incidents::get_incident,
        openobserve_api_management::request::alerts::incidents::update_incident,
        openobserve_api_management::request::alerts::incidents::get_incident_stats,
        openobserve_api_management::request::alerts::incidents::trigger_incident_rca,
        openobserve_api_management::request::alerts::incidents::cancel_incident_rca,
        openobserve_api_management::request::alerts::incidents::get_incident_rca_history,
        openobserve_api_management::request::alerts::templates::list_templates,
        openobserve_api_management::request::alerts::templates::get_template,
        openobserve_api_management::request::alerts::templates::save_template,
        openobserve_api_management::request::alerts::templates::update_template,
        openobserve_api_management::request::alerts::templates::delete_template,
        openobserve_api_management::request::alerts::templates::get_system_templates,
        openobserve_api_management::request::alerts::destinations::list_destinations,
        openobserve_api_management::request::alerts::destinations::get_destination,
        openobserve_api_management::request::alerts::destinations::save_destination,
        openobserve_api_management::request::alerts::destinations::update_destination,
        openobserve_api_management::request::alerts::destinations::delete_destination,
        kv::get,
        kv::set,
        kv::delete,
        kv::list,
        clusters::list_clusters,
        short_url::shorten,
        short_url::retrieve,
        ratelimit::list_module_ratelimit,
        ratelimit::list_role_ratelimit,
        ratelimit::update_ratelimit,
        service_accounts::list,
        service_accounts::save,
        service_accounts::update,
        service_accounts::delete,
        mcp::handle_mcp_post,
        mcp::handle_mcp_get,
        mcp::oauth_authorization_server_metadata,
        pipeline::save_pipeline,
        pipeline::list_pipelines,
        pipeline::get_pipeline,
        pipeline::list_streams_with_pipeline,
        pipeline::delete_pipeline,
        pipeline::update_pipeline,
        pipeline::enable_pipeline,
        pipeline::enable_pipeline_bulk,
        pipelines::history::get_pipeline_history,
        pipelines::backfill::create_backfill,
        pipelines::backfill::list_backfills,
        pipelines::backfill::get_backfill,
        pipelines::backfill::enable_backfill,
        pipelines::backfill::update_backfill,
        pipelines::backfill::delete_backfill,
        openobserve_api_management::request::dashboards::reports::create_report,
        openobserve_api_management::request::dashboards::reports::update_report,
        openobserve_api_management::request::dashboards::reports::list_reports,
        openobserve_api_management::request::dashboards::reports::get_report,
        openobserve_api_management::request::dashboards::reports::delete_report,
        openobserve_api_management::request::dashboards::reports::enable_report,
        openobserve_api_management::request::dashboards::reports::trigger_report,
        openobserve_api_management::request::dashboards::reports::create_report_v2,
        openobserve_api_management::request::dashboards::reports::list_reports_v2,
        openobserve_api_management::request::dashboards::reports::get_report_v2,
        openobserve_api_management::request::dashboards::reports::update_report_v2,
        openobserve_api_management::request::dashboards::reports::delete_report_v2,
        openobserve_api_management::request::dashboards::reports::delete_report_bulk_v2,
        openobserve_api_management::request::dashboards::reports::enable_report_v2,
        openobserve_api_management::request::dashboards::reports::trigger_report_v2,
        openobserve_api_management::request::dashboards::reports::move_reports,
        openobserve_api_management::request::authz::fga::create_role,
        openobserve_api_management::request::authz::fga::delete_role,
        openobserve_api_management::request::authz::fga::get_roles,
        openobserve_api_management::request::authz::fga::update_role,
        openobserve_api_management::request::authz::fga::get_role_permissions,
        openobserve_api_management::request::authz::fga::get_all_role_permissions,
        openobserve_api_management::request::authz::fga::get_roles_for_all_users,
        openobserve_api_management::request::authz::fga::get_users_with_role,
        openobserve_api_management::request::authz::fga::create_group,
        openobserve_api_management::request::authz::fga::update_group,
        openobserve_api_management::request::authz::fga::get_groups,
        openobserve_api_management::request::authz::fga::get_group_details,
        openobserve_api_management::request::authz::fga::delete_group,
        keys::save,
        keys::get,
        keys::list,
        keys::delete,
        keys::update,
        openobserve_api_search::search::search_job::submit_job,
        openobserve_api_search::search::search_job::list_status,
        openobserve_api_search::search::search_job::get_status,
        openobserve_api_search::search::search_job::cancel_job,
        openobserve_api_search::search::search_job::get_job_result,
        openobserve_api_search::search::search_job::delete_job,
        openobserve_api_search::search::search_job::retry_job,
        openobserve_api_search::search::search_stream::search_http2_stream,
        openobserve_api_search::search::search_stream::values_http2_stream,
        patterns::extract_patterns,
        openobserve_core::traces::service_graph::api::get_current_topology,
        service_streams::list_services,
        service_streams::get_dimension_analytics,
        service_streams::correlate_streams,
        service_streams::get_identity_config,
        service_streams::save_identity_config,
        gen_ai::clear_agent_registry,
        gen_ai::get_agent_mapping,
        gen_ai::list_scored_agents,
        gen_ai::save_agent_mapping,
        openobserve_api_management::request::alerts::deduplication::get_config,
        openobserve_api_management::request::alerts::deduplication::set_config,
        openobserve_api_management::request::alerts::deduplication::delete_config,
        openobserve_api_management::request::alerts::deduplication::get_semantic_groups,
        openobserve_api_management::request::alerts::deduplication::preview_semantic_groups_diff,
        openobserve_api_management::request::alerts::deduplication::save_semantic_groups,
        openobserve_api_management::request::alerts::dedup_stats::get_dedup_summary,
        openobserve_api_management::request::slos::list_slos,
        openobserve_api_management::request::slos::get_slo,
        openobserve_api_management::request::slos::create_slo,
        openobserve_api_management::request::slos::update_slo,
        openobserve_api_management::request::slos::delete_slo,
        openobserve_api_management::request::slos::enable_slo,
        openobserve_api_management::request::slos::get_slo_groups,
        openobserve_api_management::request::slos::move_slos,
        openobserve_api_management::request::slos::list_slo_eligible_alerts,
        openobserve_api_management::request::slos::preview_alert_sli,
        synthetics::list_synthetics,
        synthetics::create_synthetic,
        synthetics::get_synthetic,
        synthetics::update_synthetic,
        synthetics::delete_synthetic,
        synthetics::move_synthetics,
        synthetics::set_synthetic_enabled,
        synthetics::run_synthetic_now,
        synthetics::list_locations,
        synthetics::list_runs,
        synthetics::get_run_detail,
        synthetics::job_resolve,
        synthetics::job_lease,
        synthetics::job_ack,
    ),
    components(
        schemas(
            meta::http::HttpResponse,
            StreamType,
            meta::stream::Stream,
            meta::stream::StreamDeleteFields,
            meta::stream::StreamCreate,
            meta::stream::ListStream,
            config::meta::stream::StreamField,
            config::meta::stream::StreamSettings,
            config::meta::stream::StreamPartition,
            config::meta::stream::StreamPartitionType,
            config::meta::stream::StreamStats,
            config::meta::stream::UpdateStreamSettings,
            config::meta::gen_ai::GenAiAgentMappingConfig,
            gen_ai::GenAiAgentListItem,
            gen_ai::GenAiAgentListResponse,
            config::meta::dashboards::Dashboard,
            config::meta::dashboards::v1::AxisItem,
            config::meta::dashboards::v1::Dashboard,
            config::meta::dashboards::v1::AggregationFunc,
            config::meta::dashboards::v1::Layout,
            config::meta::dashboards::v1::Panel,
            config::meta::dashboards::v1::PanelConfig,
            config::meta::dashboards::v1::PanelFields,
            config::meta::dashboards::v1::PanelFilter,
            config::meta::dashboards::v1::Variables,
            config::meta::dashboards::v1::QueryData,
            config::meta::dashboards::v1::CustomFieldsOption,
            config::meta::dashboards::v1::VariableList,
            config::meta::alerts::alert::Alert,
            config::meta::alerts::Aggregation,
            config::meta::alerts::AggFunction,
            config::meta::alerts::Condition,
            config::meta::alerts::CompareHistoricData,
            config::meta::alerts::FrequencyType,
            config::meta::alerts::Operator,
            config::meta::alerts::QueryType,
            config::meta::alerts::QueryCondition,
            config::meta::alerts::TriggerCondition,
            config::meta::destinations::HTTPType,
            config::meta::timed_annotations::TimedAnnotation,
            config::meta::timed_annotations::TimedAnnotationReq,
            config::meta::timed_annotations::TimedAnnotationDelete,
            config::meta::timed_annotations::TimedAnnotationUpdate,
            // Enrichment Tables
            config::meta::enrichment_table::EnrichmentTableStatus,
            config::meta::enrichment_table::EnrichmentTableUrlJob,
            enrichment_table::EnrichmentTableUrlRequest,
            // Dashboards
            openobserve_api_management::models::dashboards::DashboardRequestBody,
            openobserve_api_management::models::dashboards::DashboardResponseBody,
            openobserve_api_management::models::dashboards::ListDashboardsResponseBody,
            openobserve_api_management::models::dashboards::ListDashboardsResponseBodyItem,
            openobserve_api_management::models::dashboards::MoveDashboardRequestBody,
            openobserve_api_management::models::dashboards::MoveDashboardsRequestBody,
            // Destinations
            openobserve_api_management::models::destinations::Destination,
            openobserve_api_management::models::destinations::DestinationType,
            openobserve_api_management::models::destinations::Template,
            // Alerts
            openobserve_api_management::models::alerts::requests::CreateAlertRequestBody,
            openobserve_api_management::models::alerts::requests::UpdateAlertRequestBody,
            openobserve_api_management::models::alerts::requests::MoveAlertsRequestBody,
            openobserve_api_management::models::alerts::responses::GetAlertResponseBody,
            openobserve_api_management::models::alerts::responses::ListAlertsResponseBody,
            openobserve_api_management::models::alerts::responses::ListAlertsResponseBodyItem,
            openobserve_api_management::request::alerts::AlertTagCount,
            openobserve_api_management::models::alerts::responses::EnableAlertResponseBody,
            openobserve_api_management::models::alerts::Alert,
            openobserve_api_management::models::alerts::TriggerCondition,
            openobserve_api_management::models::alerts::CompareHistoricData,
            openobserve_api_management::models::alerts::FrequencyType,
            openobserve_api_management::models::alerts::QueryCondition,
            openobserve_api_management::models::alerts::Aggregation,
            openobserve_api_management::models::alerts::AggFunction,
            openobserve_api_management::models::alerts::QueryType,
            openobserve_api_management::models::alerts::Condition,
            openobserve_api_management::models::alerts::Operator,
            // Incidents
            openobserve_api_management::request::alerts::incidents::ListIncidentsQuery,
            openobserve_api_management::request::alerts::incidents::ListIncidentsResponse,
            openobserve_api_management::request::alerts::incidents::UpdatePayload,
            openobserve_api_management::request::alerts::incidents::IncidentSeverity,
            openobserve_api_management::request::alerts::incidents::IncidentStatus,
            config::meta::alerts::incidents::Incident,
            config::meta::alerts::incidents::IncidentWithAlerts,
            config::meta::alerts::incidents::IncidentAlert,
            config::meta::alerts::incidents::IncidentStats,
            config::meta::alerts::incidents::CorrelationReason,
            config::meta::alerts::incidents::AlertNode,
            config::meta::alerts::incidents::AlertEdge,
            config::meta::alerts::incidents::EdgeType,
            // Folders
            openobserve_api_management::models::folders::CreateFolderRequestBody,
            openobserve_api_management::models::folders::CreateFolderResponseBody,
            openobserve_api_management::models::folders::GetFolderResponseBody,
            openobserve_api_management::models::folders::ListFoldersResponseBody,
            openobserve_api_management::models::folders::UpdateFolderRequestBody,
            openobserve_api_management::models::folders::FolderType,
            config::meta::function::Transform,
            config::meta::function::FunctionList,
            config::meta::function::StreamOrder,
            config::meta::function::TestVRLRequest,
            config::meta::sql::OrderBy,
            config::meta::search::Query,
            config::meta::search::Request,
            config::meta::search::RequestEncoding,
            config::meta::search::Response,
            config::meta::search::ResponseTook,
            config::meta::search::SearchEventType,
            config::meta::search::SearchEventContext,
            config::meta::search::SearchPartitionRequest,
            config::meta::search::SearchPartitionResponse,
            config::meta::search::SearchHistoryRequest,
            config::meta::search::CancelQueryResponse,
            config::meta::search::QueryStatusResponse,
            config::meta::search::QueryStatus,
            config::meta::search::QueryInfo,
            config::meta::search::ScanStats,
            config::meta::short_url::ShortenUrlRequest,
            config::meta::short_url::ShortenUrlResponse,
            config::meta::user::UserRole,
            ingestion_common::RecordStatus,
            ingestion_common::StreamStatus,
            ingestion_common::IngestionResponse,
            meta::loki::LokiPushResponse,
            meta::loki::LokiPushRequest,
            meta::loki::LokiStream,
            meta::loki::LokiEntry,
            meta::saved_view::View,
            meta::saved_view::ViewWithoutData,
            meta::saved_view::ViewsWithoutData,
            meta::saved_view::CreateViewRequest,
            meta::saved_view::DeleteViewResponse,
            meta::saved_view::CreateViewResponse,
            meta::saved_view::UpdateViewRequest,
            meta::user::UpdateUser,
            meta::user::UserRoleRequest,
            meta::user::PostUserRequest,
            meta::user::UserOrgRole,
            meta::user::UserList,
            meta::user::UserResponse,
            meta::user::SignInResponse,
            meta::organization::OrgSummary,
            meta::organization::StreamSummary,
            meta::organization::PipelineSummary,
            meta::organization::AlertSummary,
            meta::organization::OrganizationResponse,
            meta::organization::OrgDetails,
            meta::organization::OrgUser,
            meta::organization::IngestionPasscode,
            meta::organization::PasscodeResponse,
            meta::organization::Organization,
            meta::organization::OrgRenameBody,
            meta::organization::OrganizationSetting,
            meta::organization::OrganizationSettingResponse,
            meta::organization::RumIngestionResponse,
            meta::organization::RumIngestionToken,
            openobserve_api_management::request::organization::assume_service_account::AssumeServiceAccountRequest,
            openobserve_api_management::request::organization::assume_service_account::AssumeServiceAccountResponse,
            status::HealthzResponse,
            ingestion_common::BulkResponse,
            ingestion_common::BulkResponseItem,
            ingestion_common::ShardResponse,
            ingestion_common::BulkResponseError,
            config::meta::promql::Metadata,
            config::meta::promql::MetricType,
            // Service Streams (enterprise)
            service_streams::CorrelationRequest,
            config::meta::service_streams::CorrelationResponse,
            config::meta::service_streams::DimensionAnalytics,
            config::meta::service_streams::DimensionAnalyticsSummary,
            config::meta::service_streams::CardinalityClass,
            config::meta::service_streams::RelatedStreams,
            config::meta::service_streams::StreamInfo,
            config::meta::correlation::IdentitySet,
            config::meta::correlation::ServiceIdentityConfig,
            // Alert Deduplication (enterprise)
            config::meta::alerts::deduplication::GlobalDeduplicationConfig,
            config::meta::correlation::FieldAlias,
            config::meta::alerts::deduplication::DeduplicationConfig,
            config::meta::alerts::deduplication::GroupingConfig,
            config::meta::alerts::deduplication::SendStrategy,
            openobserve_api_management::request::alerts::dedup_stats::DedupSummaryResponse,
            // Backfill
            pipelines::backfill::BackfillRequest,
            pipelines::backfill::BackfillResponse,
            openobserve_core::alerts::backfill::BackfillJobStatus,
            // Synthetics
            config::meta::synthetics::Synthetic,
            config::meta::synthetics::SyntheticType,
            config::meta::synthetics::SyntheticStatus,
            config::meta::synthetics::SyntheticFrequency,
            config::meta::synthetics::SyntheticFrequencyType,
            config::meta::synthetics::SyntheticAuth,
            config::meta::synthetics::SyntheticVariable,
            config::meta::synthetics::SyntheticListItem,
            config::meta::synthetics::SyntheticListResponse,
         ),
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Meta", description = "Meta details about the OpenObserve state itself. e.g. healthz"),
        (name = "Auth", description = "User login authentication"),
        (name = "Logs", description = "Logs data ingestion operations"),
        (name = "Dashboards", description = "Dashboard operations"),
        (name = "Search", description = "Search/Query operations"),
        (name = "Saved Views", description = "Collection of saved search views for easy retrieval"),
        (name = "Alerts", description = "Alerts retrieval & management operations"),
        (name = "Incidents", description = "Alert incident correlation & management operations"),
        (name = "AI", description = "AI agent chat analysis and SRE agent operations (enterprise)"),
        (name = "Functions", description = "Functions retrieval & management operations"),
        (name = "Organizations", description = "Organizations retrieval & management operations"),
        (name = "Streams", description = "Stream retrieval & management operations"),
        (name = "Users", description = "Users retrieval & management operations"),
        (name = "KV", description = "Key Value retrieval & management operations"),
        (name = "Metrics", description = "Metrics data ingestion operations"),
        (name = "Traces", description = "Traces data ingestion operations"),
        (name = "Profiles", description = "Profiles query and discovery operations"),
        (name = "Clusters", description = "Super cluster operations"),
        (name = "Short Url", description = "Short Url Service"),
        (name = "Ratelimit", description = "Ratelimit operations"),
        (name = "Patterns", description = "Log pattern extraction operations (enterprise)"),
        (name = "Service Streams", description = "Multi-signal correlation across logs, traces, and metrics (enterprise)"),
        (name = "Synthetics", description = "Synthetic monitoring — uptime and browser checks (enterprise)"),
        (name = "Announcements", description = "Operator-authored announcement banners shown across organizations (enterprise)"),
        (name = "Anomaly Detection", description = "Anomaly detection configuration, training and detection runs (enterprise)"),
        (name = "Workflows", description = "Workflow authoring, triggering and run history (enterprise)"),
        (name = "Raman", description = "Alert hygiene digests and configuration (enterprise)"),
    ),
    info(
        description = "OpenObserve API documents [https://openobserve.ai/docs/](https://openobserve.ai/docs/)",
        contact(name = "OpenObserve", email = "hello@zinclabs.io", url = "https://openobserve.ai/"),
    ),
)]
pub struct ApiDoc;

#[cfg(feature = "enterprise")]
#[derive(OpenApi)]
#[openapi(paths(
    openobserve_api_management::request::experiments::preview_experiment,
    openobserve_api_management::request::experiments::create_experiment,
    openobserve_api_management::request::experiments::list_experiments,
    openobserve_api_management::request::experiments::compare_experiments,
    openobserve_api_management::request::experiments::get_experiment,
    openobserve_api_management::request::experiments::list_experiment_result_rows,
    openobserve_api_management::request::experiments::get_experiment_row,
    openobserve_api_management::request::experiments::retry_experiment_slot,
    openobserve_api_management::request::experiments::cancel_experiment,
    openobserve_api_management::request::experiments::retry_experiment,
    openobserve_api_management::request::experiments::clone_experiment,
    openobserve_api_management::request::experiments::delete_experiment,
    openobserve_api_management::request::experiments::set_experiment_baseline,
    openobserve_api_management::request::experiments::clear_experiment_baseline,
    openobserve_api_management::request::playground::share_playground_snapshot,
    openobserve_api_management::request::playground::get_playground_snapshot,
    openobserve_api_management::request::playground::run_playground_cell,
    openobserve_api_management::request::playground::score_playground_cell,
    openobserve_api_management::request::remote_tasks::list_remote_tasks,
    openobserve_api_management::request::remote_tasks::create_remote_task,
    openobserve_api_management::request::remote_tasks::test_remote_task,
    openobserve_api_management::request::remote_tasks::get_remote_task,
    openobserve_api_management::request::remote_tasks::list_remote_task_versions,
    openobserve_api_management::request::remote_tasks::get_remote_task_stats,
    openobserve_api_management::request::remote_tasks::save_remote_task_draft,
    openobserve_api_management::request::remote_tasks::get_remote_task_draft,
    openobserve_api_management::request::remote_tasks::discard_remote_task_draft,
    openobserve_api_management::request::remote_tasks::publish_remote_task,
    openobserve_api_management::request::remote_tasks::delete_remote_task,
    openobserve_api_management::request::remote_tasks::test_run_remote_task,
    openobserve_api_management::request::remote_tasks::replace_remote_task_auth_secret,
    openobserve_api_management::request::remote_tasks::revoke_remote_task_auth_secret,
    openobserve_api_management::request::remote_tasks::replace_remote_task_header_secret,
    openobserve_api_management::request::remote_tasks::revoke_remote_task_header_secret,
    openobserve_api_management::request::remote_tasks::get_remote_task_signing_status,
    openobserve_api_management::request::remote_tasks::rotate_remote_task_signing_secret,
    openobserve_api_management::request::remote_tasks::test_remote_task_signing_candidate,
    openobserve_api_management::request::remote_tasks::activate_remote_task_signing_candidate,
    openobserve_api_management::request::remote_tasks::end_remote_task_signing_grace,
    openobserve_api_management::request::remote_tasks::revoke_remote_task_signing_secret,
    openobserve_api_management::request::anomaly_detection::list_configs,
    openobserve_api_management::request::anomaly_detection::get_config,
    openobserve_api_management::request::anomaly_detection::create_config,
    openobserve_api_management::request::anomaly_detection::update_config,
    openobserve_api_management::request::anomaly_detection::delete_config,
    openobserve_api_management::request::anomaly_detection::train_model,
    openobserve_api_management::request::anomaly_detection::cancel_training,
    openobserve_api_management::request::anomaly_detection::detect_anomalies,
    openobserve_api_management::request::anomaly_detection::get_detection_history,
    openobserve_api_management::request::alerts::history::get_all_anomaly_history,
    openobserve_api_management::request::workflows::save_workflow,
    openobserve_api_management::request::workflows::list_workflows,
    openobserve_api_management::request::workflows::delete_workflows,
    openobserve_api_management::request::workflows::update_workflows,
    openobserve_api_management::request::workflows::test_workflow,
    openobserve_api_management::request::workflows::trigger_workflow,
    openobserve_api_management::request::workflows::get_workflow_errors,
    openobserve_api_management::request::workflows::retry_workflow,
    openobserve_api_management::request::workflows::enable_workflow,
    openobserve_api_management::request::workflows::get_workflow_history,
    openobserve_api_management::request::workflows::promote_draft,
    openobserve_api_management::request::raman::config::get_raman_config,
    openobserve_api_management::request::raman::config::update_raman_config,
    openobserve_api_management::request::raman::digests::list_raman_digests,
    openobserve_api_management::request::raman::digests::get_raman_digest,
    openobserve_api_management::request::raman::digests::run_raman_digest,
))]
#[openapi(components(schemas(
    openobserve_api_management::models::experiments::ExperimentResultRowSortBody,
)))]
struct EnterpriseExperimentApiDoc;

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        #[cfg(feature = "enterprise")]
        {
            let enterprise = EnterpriseExperimentApiDoc::openapi();
            openapi.paths.paths.extend(enterprise.paths.paths);
            if let (Some(components), Some(enterprise_components)) =
                (openapi.components.as_mut(), enterprise.components)
            {
                components.schemas.extend(enterprise_components.schemas);
                components.responses.extend(enterprise_components.responses);
            }
        }
        let cfg = get_config();
        if !cfg.common.base_uri.is_empty() {
            openapi.servers = Some(vec![utoipa::openapi::Server::new(&cfg.common.base_uri)]);
        }
        let components = openapi.components.as_mut().unwrap();
        components.add_security_scheme(
            "Authorization",
            SecurityScheme::ApiKey(utoipa::openapi::security::ApiKey::Header(
                utoipa::openapi::security::ApiKeyValue::new("Authorization"),
            )),
        );
        components.add_security_scheme(
            "BasicAuth",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Basic)),
        );
    }
}

#[cfg(feature = "enterprise")]
pub async fn openapi_info() -> OpenapiInfo {
    let api = ApiDoc::openapi();

    // Group endpoints by tags with full operation details
    let mut tag_operations: OpenapiInfo = std::collections::HashMap::new();

    for (path, path_item) in &api.paths.paths {
        for (method, operation) in [
            (utoipa::openapi::HttpMethod::Get, path_item.get.as_ref()),
            (utoipa::openapi::HttpMethod::Post, path_item.post.as_ref()),
            (utoipa::openapi::HttpMethod::Put, path_item.put.as_ref()),
            (
                utoipa::openapi::HttpMethod::Delete,
                path_item.delete.as_ref(),
            ),
            (utoipa::openapi::HttpMethod::Patch, path_item.patch.as_ref()),
            (utoipa::openapi::HttpMethod::Head, path_item.head.as_ref()),
            (
                utoipa::openapi::HttpMethod::Options,
                path_item.options.as_ref(),
            ),
            (utoipa::openapi::HttpMethod::Trace, path_item.trace.as_ref()),
        ]
        .into_iter()
        .filter_map(|(method, op)| op.map(|operation| (method, operation)))
        {
            let tags = operation
                .tags
                .clone()
                .unwrap_or_else(|| vec!["untagged".to_string()]);

            let method = match method {
                utoipa::openapi::HttpMethod::Get => "GET",
                utoipa::openapi::HttpMethod::Post => "POST",
                utoipa::openapi::HttpMethod::Put => "PUT",
                utoipa::openapi::HttpMethod::Delete => "DELETE",
                utoipa::openapi::HttpMethod::Patch => "PATCH",
                utoipa::openapi::HttpMethod::Head => "HEAD",
                utoipa::openapi::HttpMethod::Options => "OPTIONS",
                utoipa::openapi::HttpMethod::Trace => "TRACE",
            };

            let extensions: std::collections::HashMap<String, serde_json::Value> = operation
                .extensions
                .as_ref()
                .map(|ext| ext.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();

            let operation_info = (
                method.to_string(),
                path.clone(),
                operation.clone().description,
                tags.clone(),
                extensions,
            );

            for tag in tags {
                tag_operations
                    .entry(tag)
                    .or_default()
                    .push(operation_info.clone());
            }
        }
    }

    tag_operations
}

#[cfg(all(test, feature = "enterprise"))]
mod experiment_tests {
    use super::*;

    #[test]
    fn coordinate_retry_is_registered_in_openapi() {
        let api = EnterpriseExperimentApiDoc::openapi();
        let path = api
            .paths
            .paths
            .get("/api/{org_id}/experiments/{experiment_id}/rows/{row_id}/trials/{trial_index}/retry")
            .expect("coordinate retry path must be documented");
        assert_eq!(
            path.post
                .as_ref()
                .and_then(|operation| operation.operation_id.as_deref()),
            Some("RetryExperimentSlot")
        );
        let row_detail = api
            .paths
            .paths
            .get("/api/{org_id}/experiments/{experiment_id}/rows/{row_id}")
            .and_then(|path| path.get.as_ref())
            .expect("row detail path must be documented");
        assert!(row_detail.responses.responses.contains_key("403"));

        let comparison = api
            .paths
            .paths
            .get("/api/{org_id}/experiments/compare")
            .and_then(|path| path.get.as_ref())
            .expect("comparison path must be documented");
        assert_eq!(
            comparison.operation_id.as_deref(),
            Some("CompareExperiments")
        );
        assert!(comparison.responses.responses.contains_key("400"));
        assert!(comparison.responses.responses.contains_key("403"));
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use std::collections::BTreeSet;

    use utoipa::OpenApi;

    use super::ApiDoc;

    #[cfg(feature = "enterprise")]
    const ROUTER_SOURCE: &str = include_str!("mod.rs");

    /// Only routes registered here are served; a route defined anywhere else is dead code.
    #[cfg(feature = "enterprise")]
    const SERVICE_ROUTES_SIGNATURE: &str = "pub fn service_routes(";

    #[cfg(feature = "enterprise")]
    const HTTP_METHODS: &[&str] = &[
        "get", "post", "put", "delete", "patch", "head", "options", "trace",
    ];

    /// The path prefixes owned by the four enterprise-gated management modules.
    #[cfg(feature = "enterprise")]
    const ENTERPRISE_MODULE_PREFIXES: &[&str] = &[
        "/{org_id}/anomaly_detection",
        "/{org_id}/workflows",
        "/{org_id}/tasks",
        "/v2/{org_id}/raman",
    ];

    /// Spelled as the merged spec does; the router's own placeholder names differ.
    #[cfg(feature = "enterprise")]
    const ENTERPRISE_MODULE_ROUTES: &[(&str, &str)] = &[
        ("/api/v2/{org_id}/raman/config", "get"),
        ("/api/v2/{org_id}/raman/config", "put"),
        ("/api/v2/{org_id}/raman/digests", "get"),
        ("/api/v2/{org_id}/raman/digests/run", "post"),
        ("/api/v2/{org_id}/raman/digests/{digest_id}", "get"),
        ("/api/{org_id}/anomaly_detection", "get"),
        ("/api/{org_id}/anomaly_detection", "post"),
        ("/api/{org_id}/anomaly_detection/history", "get"),
        ("/api/{org_id}/anomaly_detection/{anomaly_id}", "get"),
        ("/api/{org_id}/anomaly_detection/{anomaly_id}", "put"),
        ("/api/{org_id}/anomaly_detection/{anomaly_id}", "delete"),
        ("/api/{org_id}/anomaly_detection/{anomaly_id}/train", "post"),
        (
            "/api/{org_id}/anomaly_detection/{anomaly_id}/train",
            "delete",
        ),
        (
            "/api/{org_id}/anomaly_detection/{anomaly_id}/detect",
            "post",
        ),
        (
            "/api/{org_id}/anomaly_detection/{anomaly_id}/history",
            "get",
        ),
        ("/api/{org_id}/workflows", "get"),
        ("/api/{org_id}/workflows", "post"),
        ("/api/{org_id}/workflows/test", "post"),
        ("/api/{org_id}/workflows/{id}", "put"),
        ("/api/{org_id}/workflows/{id}", "delete"),
        ("/api/{org_id}/workflows/{id}/trigger", "post"),
        ("/api/{org_id}/workflows/{id}/errors/{run_id}", "get"),
        ("/api/{org_id}/workflows/{id}/retry", "post"),
        ("/api/{org_id}/workflows/{id}/enable", "put"),
        ("/api/{org_id}/workflows/{id}/history", "get"),
        ("/api/{org_id}/workflows/promote/{id}", "post"),
        ("/api/{org_id}/tasks", "get"),
        ("/api/{org_id}/tasks", "post"),
        ("/api/{org_id}/tasks/test", "post"),
        ("/api/{org_id}/tasks/{entity_id}", "get"),
        ("/api/{org_id}/tasks/{entity_id}", "put"),
        ("/api/{org_id}/tasks/{entity_id}", "delete"),
        ("/api/{org_id}/tasks/{entity_id}/auth", "put"),
        ("/api/{org_id}/tasks/{entity_id}/auth", "delete"),
        (
            "/api/{org_id}/tasks/{entity_id}/headers/{header_name}/secret",
            "put",
        ),
        (
            "/api/{org_id}/tasks/{entity_id}/headers/{header_name}/secret",
            "delete",
        ),
        ("/api/{org_id}/tasks/{entity_id}/signing", "get"),
        ("/api/{org_id}/tasks/{entity_id}/signing", "delete"),
        ("/api/{org_id}/tasks/{entity_id}/signing/rotate", "post"),
        ("/api/{org_id}/tasks/{entity_id}/signing/test", "post"),
        ("/api/{org_id}/tasks/{entity_id}/signing/activate", "post"),
        ("/api/{org_id}/tasks/{entity_id}/signing/end_grace", "post"),
        ("/api/{org_id}/tasks/{entity_id}/versions", "get"),
        ("/api/{org_id}/tasks/{entity_id}/stats", "get"),
        ("/api/{org_id}/tasks/{entity_id}/draft", "get"),
        ("/api/{org_id}/tasks/{entity_id}/draft", "delete"),
        ("/api/{org_id}/tasks/{entity_id}/test_connection", "post"),
        ("/api/{org_id}/tasks/{entity_id}/test_run", "post"),
    ];

    // Ends at the column-0 close brace, so an item after the body is never scraped into it.
    #[cfg(feature = "enterprise")]
    fn service_routes_body() -> &'static str {
        let start = ROUTER_SOURCE
            .find(SERVICE_ROUTES_SIGNATURE)
            .expect("the router must define service_routes()");
        let after_signature = &ROUTER_SOURCE[start + SERVICE_ROUTES_SIGNATURE.len()..];
        let end = after_signature
            .find("\n}\n")
            .expect("service_routes() must end at a column-0 close brace");
        &after_signature[..end]
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_scrape_stops_at_the_end_of_service_routes() {
        let body = service_routes_body();
        for item in ["\nfn ", "\npub fn ", "\npub(crate) fn ", "\nasync fn "] {
            assert!(
                !body.contains(item),
                "the scrape ran past service_routes() and swallowed a following {item:?} item, \
                 so a route block moved there would read as registered while being served nowhere"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    fn strip_comments(source: &str) -> String {
        let mut without_blocks = String::with_capacity(source.len());
        let mut rest = source;
        while let Some(open) = rest.find("/*") {
            without_blocks.push_str(&rest[..open]);
            let after_open = &rest[open + 2..];
            rest = match after_open.find("*/") {
                Some(close) => &after_open[close + 2..],
                None => "",
            };
        }
        without_blocks.push_str(rest);
        without_blocks
            .lines()
            .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[cfg(feature = "enterprise")]
    fn normalize(source: &str) -> String {
        source.chars().filter(|c| !c.is_whitespace()).collect()
    }

    /// Placeholder names never reach the wire, so only their positions can be compared.
    #[cfg(feature = "enterprise")]
    fn erase_placeholders(path: &str) -> String {
        let mut erased = String::with_capacity(path.len());
        let mut rest = path;
        while let Some(open) = rest.find('{') {
            erased.push_str(&rest[..open]);
            erased.push_str("{}");
            rest = match rest[open..].find('}') {
                Some(close) => &rest[open + close + 1..],
                None => "",
            };
        }
        erased.push_str(rest);
        erased
    }

    /// Stops at the `.route(` call's own closing paren, so a chained call is not part of it.
    #[cfg(feature = "enterprise")]
    fn balanced_arguments(call: &str) -> Option<&str> {
        let mut depth = 1usize;
        for (index, character) in call.char_indices() {
            match character {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&call[..index]);
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// `get(` inside a handler path such as `remote_tasks::get_remote_task` is not a verb binding.
    #[cfg(feature = "enterprise")]
    fn binds_method(bindings: &str, method: &str) -> bool {
        let needle = format!("{method}(");
        let mut searched = 0;
        while let Some(at) = bindings[searched..].find(&needle) {
            let start = searched + at;
            let preceding = bindings[..start].chars().next_back();
            if !preceding.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == ':') {
                return true;
            }
            searched = start + needle.len();
        }
        false
    }

    #[cfg(feature = "enterprise")]
    fn registered_module_routes() -> BTreeSet<(String, String)> {
        let live = normalize(&strip_comments(service_routes_body()));
        let mut routes = BTreeSet::new();
        for call in live.split(".route(").skip(1) {
            let Some(arguments) = balanced_arguments(call) else {
                continue;
            };
            let Some(path) = arguments
                .strip_prefix('"')
                .and_then(|rest| rest.split('"').next())
            else {
                continue;
            };
            if !ENTERPRISE_MODULE_PREFIXES
                .iter()
                .any(|prefix| path.starts_with(prefix))
            {
                continue;
            }
            let bindings = &arguments[path.len() + 2..];
            for method in HTTP_METHODS {
                if binds_method(bindings, method) {
                    let served = erase_placeholders(&format!("/api{path}"));
                    routes.insert((served, (*method).to_string()));
                }
            }
        }
        routes
    }

    // Handlers that gained a folder-destination authorization check must
    // advertise the 403 it returns, or clients cannot distinguish it from a bug.
    // The /{org}/anomaly_detection pair is annotated but enterprise-gated, so it
    // is absent from this ApiDoc and cannot be asserted from an OSS build.
    #[test]
    fn folder_scoped_writes_document_forbidden() {
        let spec = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let paths = spec.get("paths").unwrap().as_object().unwrap();

        let cases: &[(&str, &str)] = &[
            ("/api/v2/{org_id}/alerts", "post"),
            ("/api/v2/{org_id}/alerts/{alert_id}", "put"),
            ("/api/v2/{org_id}/alerts/{alert_id}/clone", "post"),
            ("/api/v2/{org_id}/alerts/move", "patch"),
            ("/api/{org_id}/slos", "post"),
            ("/api/{org_id}/slos/{slo_id}", "put"),
            ("/api/{org_id}/slos/move", "post"),
            ("/api/{org_id}/synthetics/{id}", "put"),
            ("/api/v2/{org_id}/synthetics/move", "patch"),
            ("/api/v2/{org_id}/reports/{report_id}", "put"),
            ("/api/v2/{org_id}/reports/move", "patch"),
            ("/api/{org_id}/folders/dashboards/{dashboard_id}", "put"),
            ("/api/{org_id}/dashboards/move", "patch"),
        ];

        let mut missing = Vec::new();
        for (path, method) in cases {
            let Some(item) = paths.get(*path).and_then(|p| p.get(*method)) else {
                missing.push(format!("{method} {path}: not found in spec"));
                continue;
            };
            if item.get("responses").and_then(|r| r.get("403")).is_none() {
                missing.push(format!("{method} {path}: no 403 documented"));
            }
        }
        assert!(missing.is_empty(), "{missing:#?}");
    }

    /// A path parameter with no placeholder makes generated clients demand a phantom value.
    #[test]
    fn every_declared_path_parameter_appears_in_its_template() {
        let spec = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let paths = spec.get("paths").unwrap().as_object().unwrap();

        let mut invalid = Vec::new();
        for (path, item) in paths {
            let placeholders: Vec<&str> = path
                .split('{')
                .skip(1)
                .filter_map(|rest| rest.split('}').next())
                .collect();
            for (method, operation) in item.as_object().unwrap() {
                let Some(parameters) = operation.get("parameters").and_then(|p| p.as_array())
                else {
                    continue;
                };
                for parameter in parameters {
                    if parameter.get("in").and_then(|i| i.as_str()) != Some("path") {
                        continue;
                    }
                    let name = parameter.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    if !placeholders.contains(&name) {
                        invalid.push(format!(
                            "{method} {path}: declares path parameter `{name}`, which the template \
                             has no placeholder for"
                        ));
                    }
                }
            }
        }
        assert!(invalid.is_empty(), "{invalid:#?}");
    }

    /// The bulk-history route is the exception: it carries no feature-switch guard at all.
    #[cfg(feature = "enterprise")]
    #[test]
    fn anomaly_detection_documents_the_statuses_its_handlers_return() {
        let spec = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let paths = spec.get("paths").unwrap().as_object().unwrap();

        let expected: &[(&str, &str, &[&str])] = &[
            (
                "/api/{org_id}/anomaly_detection/history",
                "get",
                &["200", "400", "403", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection",
                "get",
                &["200", "403", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection",
                "post",
                &["200", "400", "403", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}",
                "get",
                &["200", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}",
                "put",
                &["200", "400", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}",
                "delete",
                &["200", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}/train",
                "post",
                &["200", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}/train",
                "delete",
                &["200", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}/detect",
                "post",
                &["200", "403", "404", "500"],
            ),
            (
                "/api/{org_id}/anomaly_detection/{anomaly_id}/history",
                "get",
                &["200", "403", "500"],
            ),
        ];

        let mut wrong = Vec::new();
        for (path, method, statuses) in expected {
            let Some(operation) = paths.get(*path).and_then(|item| item.get(*method)) else {
                wrong.push(format!("{method} {path}: absent from the spec"));
                continue;
            };
            let mut documented: Vec<&str> = operation
                .get("responses")
                .and_then(|r| r.as_object())
                .map(|r| r.keys().map(String::as_str).collect())
                .unwrap_or_default();
            documented.sort_unstable();
            let mut returned = statuses.to_vec();
            returned.sort_unstable();
            if documented != returned {
                wrong.push(format!(
                    "{method} {path}: documents {documented:?}, handler returns {returned:?}"
                ));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    /// Only `SecurityAddon` merges these modules in, so the merged doc is the real surface.
    #[cfg(feature = "enterprise")]
    #[test]
    fn enterprise_gated_modules_are_published_in_the_openapi_surface() {
        let spec = ApiDoc::openapi();
        let mut missing = Vec::new();
        for (path, method) in ENTERPRISE_MODULE_ROUTES {
            let Some(item) = spec.paths.paths.get(*path) else {
                missing.push(format!("{method} {path}: path absent from the spec"));
                continue;
            };
            let published = match *method {
                "get" => item.get.is_some(),
                "post" => item.post.is_some(),
                "put" => item.put.is_some(),
                "delete" => item.delete.is_some(),
                "patch" => item.patch.is_some(),
                "head" => item.head.is_some(),
                "options" => item.options.is_some(),
                "trace" => item.trace.is_some(),
                other => {
                    missing.push(format!("{other} {path}: not an HTTP method"));
                    continue;
                }
            };
            if !published {
                missing.push(format!("{method} {path}: path present but method absent"));
            }
        }
        assert!(missing.is_empty(), "{missing:#?}");
    }

    /// A handler served over HTTP but absent from the spec is the gap this table closes.
    #[cfg(feature = "enterprise")]
    #[test]
    fn the_route_table_covers_exactly_what_the_router_registers() {
        let registered = registered_module_routes();
        assert!(
            !registered.is_empty(),
            "the scrape found no routes at all - service_routes() no longer registers these \
             modules, or the scrape stopped matching it"
        );
        let listed: BTreeSet<(String, String)> = ENTERPRISE_MODULE_ROUTES
            .iter()
            .map(|(path, method)| (erase_placeholders(path), (*method).to_string()))
            .collect();

        let unlisted: Vec<_> = registered.difference(&listed).collect();
        let unregistered: Vec<_> = listed.difference(&registered).collect();
        assert!(
            unlisted.is_empty() && unregistered.is_empty(),
            "served by the router but not published: {unlisted:#?}\n\
             published but not served by the router: {unregistered:#?}"
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_commented_out_route_is_not_read_as_a_registration() {
        assert_eq!(strip_comments("a\n// .route(\"/x\", get(h))\nb"), "a\n\nb");
        assert_eq!(strip_comments("a/* .route(\"/x\") */b"), "ab");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_chained_call_after_a_route_is_not_read_as_one_of_its_verbs() {
        let call = normalize("\"/{org_id}/workflows\",get(h)).layer(post(x))");
        let arguments = balanced_arguments(&call).expect("the route call must close");
        assert!(binds_method(arguments, "get"));
        assert!(!binds_method(arguments, "post"));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_verb_name_inside_a_handler_path_is_not_read_as_a_verb_binding() {
        assert!(binds_method("get(routes::post(state))", "get"));
        assert!(!binds_method("get(routes::post(state))", "post"));
        assert!(!binds_method(
            "get(remote_tasks::get_remote_task)",
            "delete"
        ));
    }
}
