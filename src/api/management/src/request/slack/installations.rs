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

//! Section 7.2 rows 1-10, 14-17, 19 and 24.

use axum::{
    Json,
    extract::{
        Path, Query,
        rejection::{JsonRejection, QueryRejection},
    },
    response::Response,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::slack as ent;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

#[cfg(not(feature = "enterprise"))]
use super::not_supported;
use super::{JsonOrEmpty, ManifestQuery};
#[cfg(feature = "enterprise")]
use super::{caller, parse, parse_query, parse_value, respond, respond_with};

/// SlackInstallStart
#[utoipa::path(
    post,
    path = "/{org_id}/slack/install/start",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackInstallStart",
    summary = "Start a Cloud Slack install",
    description = "Returns the Slack authorize URL for the shared Cloud app, with the source signed into the state. Cloud only; self-hosted answers 404.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"source\": \"destination_form\" | \"settings\" | \"upgrade_banner\" | \"reinstall\"}`; `reinstall` creates no destination and no channel default; `create_destination: true` (the Slack app form) makes the exchange create the Slack app destination", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"authorization_url\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Unknown source", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or not Cloud", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn install_start(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::install::install_start(&caller(&org_id, &user_email.user_id), &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackInstallExchange
#[utoipa::path(
    post,
    path = "/{org_id}/slack/install/exchange",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackInstallExchange",
    summary = "Finish a Slack install",
    description = "Redeems Slack's code, stores the bot token encrypted and connects this organization. The answer depends on the signed source: the destination form gets today's webhook fields, Settings gets the installation and the created destination, and a workspace already installed for another organization gets a single-use connect ticket.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"code\", \"state\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "Form, Settings or already-installed shape", content_type = "application/json", body = Object),
        (status = 400, description = "Bad code or state", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization", content_type = "application/json", body = ()),
        (status = 409, description = "Credentials from another app or team", content_type = "application/json", body = ()),
        (status = 502, description = "Slack refused the code", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn install_exchange(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::install::install_exchange(&caller(&org_id, &user_email.user_id), &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackPrerequisites
#[utoipa::path(
    get,
    path = "/{org_id}/slack/prerequisites",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPrerequisites",
    summary = "Check the self-hosted Slack prerequisites",
    description = "Step 0: master key, delegation key, home region, web URL and agent. While Slack is disabled only `_meta` admins may read it, and org admins too once O2_SLACK_ENABLED is on.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "`{\"checks\": [{\"id\", \"status\", \"detail\", \"variable\", \"fix\"}]}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled and the caller may not read the prerequisites", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn prerequisites(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(ent::prereq::prerequisites(&caller(&org_id, &user_email.user_id)).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email);
        not_supported()
    }
}

/// SlackConnectivity
#[utoipa::path(
    post,
    path = "/{org_id}/slack/connectivity",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackConnectivity",
    summary = "Check the connection to Slack",
    description = "Step 1: reaches Slack's API and Socket Mode hosts through the configured proxy and CA bundle.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"installation_id\"?}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"checks\": [{\"host\", \"status\", \"detail\"}], \"proxy\", \"ca_bundle\", \"socket_url_host\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn connectivity(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::prereq::connectivity(&caller(&org_id, &user_email.user_id), &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackManifest
#[utoipa::path(
    get,
    path = "/{org_id}/slack/manifest",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackManifest",
    summary = "Build the Slack app manifest",
    description = "The manifest O2 would create, for Set up manually. Self-hosted only.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ManifestQuery),
    responses(
        (status = 200, description = "Slack app manifest", content_type = "application/json", body = Object),
        (status = 400, description = "Unknown mode or bad name", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or Cloud", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn manifest(
    Path(org_id): Path<String>,
    query: Result<Query<ManifestQuery>, QueryRejection>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let query = match parse_query(&org_id, query) {
            Ok(query) => query,
            Err(response) => return response,
        };
        let q: ent::manifest::ManifestQuery =
            match parse_value(&org_id, serde_json::to_value(&query).unwrap_or_default()) {
                Ok(q) => q,
                Err(response) => return response,
            };
        respond(ent::manifest::manifest_for(&caller(&org_id, &user_email.user_id), &q).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query, user_email);
        not_supported()
    }
}

/// SlackCreateInstallation
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackCreateInstallation",
    summary = "Create a self-hosted Slack app",
    description = "With a configuration refresh token O2 creates the app from its manifest; with Set up manually it stores the app's own credentials. Returns the pending installation and O2's bot-only authorize URL.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"mode\", \"config_refresh_token\", \"app_name\"?, \"channel_history\"?}` or `{\"mode\", \"client_id\", \"client_secret\", \"signing_secret\"?, \"app_token\"?}`", content_type = "application/json"),
    responses(
        (status = 201, description = "`{\"installation\", \"authorize_url\", \"app_settings_url\", \"manifest_page_url\"?}`", content_type = "application/json", body = Object),
        (status = 400, description = "Bad body or unknown mode", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or Cloud", content_type = "application/json", body = ()),
        (status = 422, description = "Slack refused the configuration refresh token", content_type = "application/json", body = ()),
        (status = 502, description = "Slack error on apps.manifest.create", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_installation(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond_with(
            axum::http::StatusCode::CREATED,
            ent::install::create_installation(&caller(&org_id, &user_email.user_id), &req).await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackInstallUrl
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/install-url",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackInstallUrl",
    summary = "Get the Finish install URL",
    description = "A fresh bot-only authorize URL for a pending self-hosted installation.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"authorize_url\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn install_url(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            ent::install::install_url(&caller(&org_id, &user_email.user_id), &installation_id)
                .await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackUpdateCredentials
#[utoipa::path(
    put,
    path = "/{org_id}/slack/installations/{installation_id}/credentials",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackUpdateCredentials",
    summary = "Update the Slack app credentials",
    description = "Replaces the app token, signing secret or client credentials, checked against the installed app. `config_refresh_token: null` forgets O2's copy only. Needs the permission in every connected organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"app_token\"?, \"signing_secret\"?, \"client_id\"?, \"client_secret\"?, \"config_refresh_token\"?: string | null}`", content_type = "application/json"),
    responses(
        (status = 200, description = "InstallationView", content_type = "application/json", body = Object),
        (status = 400, description = "Bad body", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin of every connected organization, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
        (status = 409, description = "Credentials from another app or team", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_credentials(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::install::update_credentials(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackListInstallations
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackListInstallations",
    summary = "List Slack installations",
    description = "The installations connected to this organization; self-hosted adds the ones it may connect, Cloud the workspaces whose webhook destinations can be upgraded.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "`{\"installations\", \"available\"?, \"upgrade_candidates\"?}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_installations(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(ent::settings::list_installations(&caller(&org_id, &user_email.user_id)).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email);
        not_supported()
    }
}

/// SlackTestInstallation
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/test",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackTestInstallation",
    summary = "Test a Slack installation",
    description = "Runs auth.test, reads the socket health and the last event, probes the agent, and optionally posts a test message.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"channel_id\"?}`; no body at all means `{}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"checks\", \"test_post\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "A body that is not JSON", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn test_installation(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<JsonOrEmpty, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body.map(|JsonOrEmpty(value)| Json(value))) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::health::test_installation(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackConnectionStart
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/connection/start",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackConnectionStart",
    summary = "Start Sign in with Slack",
    description = "The Sign in with Slack URL that proves workspace membership, to connect this organization or to test the app's client secret.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"purpose\": \"connect\" | \"test\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"url\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Unknown purpose", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn connection_start(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::install::connection_start(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackConnectionConfirm
#[utoipa::path(
    post,
    path = "/{org_id}/slack/connection/confirm",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackConnectionConfirm",
    summary = "Finish Sign in with Slack",
    description = "Redeems the Sign in with Slack code; the installation, the purpose and the organization come from the signed state, never from the path. Connects that organization or reports the test result.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "`{\"oidc_code\", \"oidc_state\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"connected\": true, \"org_id\"}` (the org of the signed state) or `{\"test\": \"pass\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Bad or reused state, nonce mismatch", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, another workspace, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
        (status = 502, description = "Slack refused the code or the client secret", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn connection_confirm(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        respond(ent::install::connection_confirm(&caller(&org_id, &user_email.user_id), &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, body);
        not_supported()
    }
}

/// SlackConnect
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/connection",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackConnect",
    summary = "Connect this organization with a ticket",
    description = "Connects this organization to an installed workspace with the single-use ticket the exchange returned, and creates the destination and channel default from the new webhook.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"connect_ticket\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"connected\": true, \"destination\", \"channel_default_set\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
        (status = 410, description = "The ticket expired or was used", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn connect(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::install::connect(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackDisconnect
#[utoipa::path(
    delete,
    path = "/{org_id}/slack/installations/{installation_id}/connection",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackDisconnect",
    summary = "Disconnect this organization",
    description = "Disconnects this organization from the workspace and lists the Slack destinations that stop working.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"stopped_destinations\": [{\"org_id\", \"id\", \"name\"}]}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, unknown installation or not connected", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn disconnect(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            ent::install::disconnect(&caller(&org_id, &user_email.user_id), &installation_id).await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackUninstall
#[utoipa::path(
    delete,
    path = "/{org_id}/slack/installations/{installation_id}",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackUninstall",
    summary = "Uninstall from the workspace",
    description = "Self-hosted: uninstalls the app, revokes every link and removes the connections; a pending install is started over. Cloud never calls apps.uninstall and refuses while other organizations still use the app's webhooks. Needs the permission in every connected organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"revoked\", \"affected\": {\"orgs\", \"destinations\", \"links_revoked\"}, \"delete_app_url\", \"app_deleted\"?, \"app_delete_error\"?}`; Start over sets `app_deleted: false` and the reason when Slack kept the app", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin of every connected organization, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
        (status = 409, description = "Cloud: webhook-only destinations in other organizations still use the app", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn uninstall(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            ent::install::uninstall(&caller(&org_id, &user_email.user_id), &installation_id).await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackGetOrgAccess
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/org-access",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackGetOrgAccess",
    summary = "Get the instance workspace's organization access",
    description = "Self-hosted instance workspace only, from `_meta`: all organizations or the listed ones, each served organization with its channel defaults, links and members, and every organization on the server for the picker.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name; only `_meta`"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"all\", \"orgs\": [{\"org_id\", \"org_name\", \"source\", \"added_by\", \"added_at\", \"channel_defaults\", \"links\", \"members\"}], \"organizations\": [{\"org_id\", \"org_name\", \"members\"}], \"other_apps_in_team\": [{\"installation_id\", \"org_ids\"}]}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an instance admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled, not `_meta`, Cloud, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_org_access(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            ent::access::get_org_access(&caller(&org_id, &user_email.user_id), &installation_id)
                .await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackPutOrgAccess
#[utoipa::path(
    put,
    path = "/{org_id}/slack/installations/{installation_id}/org-access",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPutOrgAccess",
    summary = "Set the instance workspace's organization access",
    description = "Self-hosted, from `_meta`: serve all organizations or the listed ones. Removed organizations lose their channel defaults, threads and connection, and their links move to another served organization or are unlinked. `preview: true` changes nothing and reports what Save would remove. On an organization workspace the call takes it over as the instance workspace.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name; only `_meta`"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"all\": true}` or `{\"orgs\": [string]}`, plus optional `\"preview\": true`", content_type = "application/json"),
    responses(
        (status = 200, description = "OrgAccessView, with `removed`: [{\"org_id\", \"org_name\", \"channels\", \"links_moving\", \"links_unlinked\"}] when organizations are or would be removed", content_type = "application/json", body = Object),
        (status = 400, description = "Bad body", content_type = "application/json", body = ()),
        (status = 403, description = "Not an instance admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled, not `_meta`, Cloud, or unknown installation", content_type = "application/json", body = ()),
        (status = 409, description = "The take-over is refused: the workspace is not active, or its team already has an instance workspace", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_org_access(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req: ent::access::OrgAccessRequest = match parse(&org_id, body) {
            Ok(req) => req,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::access::put_org_access(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn every_route_is_forbidden_in_the_oss_build() {
        use axum::http::StatusCode;

        use super::*;

        let org = || Path("default".to_string());
        let one = || Path(("default".to_string(), "I1".to_string()));
        let user = || {
            Headers(UserEmail {
                user_id: "root@example.com".to_string(),
            })
        };
        let body = || Ok(Json(serde_json::json!({})));
        let responses = vec![
            install_start(org(), user(), body()).await,
            install_exchange(org(), user(), body()).await,
            prerequisites(org(), user()).await,
            connectivity(org(), user(), body()).await,
            manifest(org(), Ok(Query(ManifestQuery::default())), user()).await,
            create_installation(org(), user(), body()).await,
            install_url(one(), user()).await,
            update_credentials(one(), user(), body()).await,
            list_installations(org(), user()).await,
            test_installation(one(), user(), Ok(JsonOrEmpty(serde_json::json!({})))).await,
            connection_start(one(), user(), body()).await,
            connection_confirm(org(), user(), body()).await,
            connect(one(), user(), body()).await,
            disconnect(one(), user()).await,
            uninstall(one(), user()).await,
            get_org_access(one(), user()).await,
            put_org_access(one(), user(), body()).await,
        ];
        for response in responses {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(json["message"], "Not Supported");
        }
    }
}
