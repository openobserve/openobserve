// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::handler::http::request;
use crate::meta;

#[derive(OpenApi)]
#[openapi(
    paths(
        request::stream::list,
        request::stream::schema,
        request::stream::settings,
        request::stream::delete,
        request::logs::ingest::bulk,
        request::logs::ingest::multi,
        request::logs::ingest::json,
        request::search::search,
        request::search::around,
        request::functions::list_functions,
        request::functions::save_function,
        request::functions::delete_function,
        request::functions::list_stream_function,
        request::functions::save_stream_function,
        request::functions::delete_stream_function,
        request::alerts::save_alert,
        request::alerts::list_stream_alerts,
        request::alerts::list_alerts,
        request::alerts::get_alert,
        request::alerts::delete_alert,
        request::alerts::templates::list_templates,
        request::alerts::templates::get_template,
        request::alerts::templates::save_template,
        request::alerts::templates::delete_template,
        request::alerts::destinations::list_destinations,
        request::alerts::destinations::get_destination,
        request::alerts::destinations::save_destination,
        request::alerts::destinations::delete_destination,
        request::users::list,
        request::users::save,
        request::users::update,
        request::users::delete,
        request::users::authentication,
        request::users::add_user_to_org,
        request::organization::organizations,
        request::organization::org_summary,
        request::organization::get_user_passcode,
        request::organization::update_user_passcode,
        request::kv::get,
        request::kv::set,
        request::kv::delete,
        request::kv::list,
    ),
    components(
        schemas(
            meta::http::HttpResponse,
            meta::StreamType,
            meta::stream::Stream,
            meta::stream::StreamStats,
            meta::stream::StreamProperty,
            meta::stream::StreamSettings,
            meta::stream::ListStream,
            meta::ingestion::RecordStatus,
            meta::ingestion::StreamStatus,
            meta::ingestion::IngestionResponse,
            meta::search::Query,
            meta::search::Request,
            meta::search::RequestEncoding,
            meta::search::Response,
            meta::alert::Alert,
            meta::alert::AlertList,
            meta::alert::Condition,
            meta::alert::AllOperator,
            meta::alert::AlertDestination,
            meta::alert::AlertDestinationResponse,
            meta::alert::AlertDestType,
            meta::alert::AlertHTTPType,
            meta::alert::DestinationTemplate,
            meta::functions::Transform,
            meta::functions::FunctionList,
            meta::user::UserRequest,
            meta::user::UpdateUser,
            meta::user::UserRole,
            meta::user::UserOrgRole,
            meta::user::UserList,
            meta::user::UserResponse,
            meta::user::UpdateUser,
            meta::user::SignInUser,
            meta::user::SignInResponse,
            meta::organization::OrgSummary,
            meta::organization::OrganizationResponse,
            meta::organization::OrgDetails,
            meta::organization::OrgUser,
            meta::organization::IngestionPasscode,
            meta::organization::PasscodeResponse,
        ),
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Auth", description = "User login authentication"),
        (name = "Logs", description = "Logs data ingestion operations"),
        (name = "Search", description = "Search/Query operations"),
        (name = "Alerts", description = "Alerts retrieval & management operations"),
        (name = "Functions", description = "Functions retrieval & management operations"),
        (name = "Organizations", description = "Organizations retrieval & management operations"),
        (name = "Streams", description = "Stream retrieval & management operations"),
        (name = "Users", description = "Users retrieval & management operations"),
        (name = "KV", description = "Key Value retrieval & management operations"),
    ),
    info(
        description = "ZincObserve API documents [https://docs.zinc.dev/](https://docs.zinc.dev/)",
        contact(name = "ZincObserve", email = "hello@zinclabs.io", url = "https://zinc.dev/"),
    ),
)]
pub struct ApiDoc;

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.as_mut().unwrap();
        components.add_security_scheme(
            "Authorization",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Basic).build()),
        );
    }
}
