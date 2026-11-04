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

//! Section 7.2 rows 11-13 and 20-23: linking, channels, channel defaults, help contact.

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
use super::{ChannelsQuery, CursorQuery};
#[cfg(feature = "enterprise")]
use super::{caller, parse, parse_query, respond};

/// SlackGetLinking
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/linking",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackGetLinking",
    summary = "Get the linking settings",
    description = "Automatic linking by email domain, its source, and link counts for this organization's members.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "LinkingView `{\"enabled\", \"source\", \"domains\", \"counts\"}` (this organization's mapped domains only) plus `\"manual_domains\"` (the list for organizations without a mapping), `\"other_org_domains\"`, `\"truncated\"` and `\"refreshing\"` (the workspace scan runs in the background)", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_linking(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::get_linking(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackPutLinking
#[utoipa::path(
    put,
    path = "/{org_id}/slack/installations/{installation_id}/linking",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPutLinking",
    summary = "Change the linking settings",
    description = "Turns automatic linking on or off and sets its domains. Needs the permission in every connected organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"enabled\", \"domains\"?}`", content_type = "application/json"),
    responses(
        (status = 200, description = "LinkingView plus `\"other_org_domains\"`, `\"truncated\"`, `\"refreshing\"`", content_type = "application/json", body = Object),
        (status = 400, description = "Public email domain, or domains while they come from the domain mapping", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin of every connected organization, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_linking(
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
        respond(ent::settings::put_linking(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackLinkMatches
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/links/matches",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackLinkMatches",
    summary = "List workspace members that match this organization's users",
    description = "Slack members whose verified email matches a member of this organization and who are not linked yet.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
        CursorQuery,
    ),
    responses(
        (status = 200, description = "`{\"members\": [{\"slack_user_id\", \"name\", \"email\", \"o2_user\"}], \"next_cursor\", \"truncated\", \"refreshing\"}` from the last background scan", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn link_matches(
    Path((org_id, installation_id)): Path<(String, String)>,
    query: Result<Query<CursorQuery>, QueryRejection>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let query = match parse_query(&org_id, query) {
            Ok(query) => query,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        let cursor = query.cursor.as_deref().filter(|c| !c.is_empty());
        respond(ent::settings::link_matches(&caller, &installation_id, cursor).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, query, user_email);
        not_supported()
    }
}

/// SlackLinkAll
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/link-all",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackLinkAll",
    summary = "Link every matching member",
    description = "Links every matching member; continues in the background after 60 s. Needs the permission in every connected organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"linked\", \"complete\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin of every connected organization, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
        (status = 409, description = "A run is already active", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn link_all(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::link_all(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackChannels
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/channels",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackChannels",
    summary = "List the workspace's channels",
    description = "Public and private channels the bot can see, filtered by name; cached for five minutes.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
        ChannelsQuery,
    ),
    responses(
        (status = 200, description = "`{\"channels\": [{\"id\", \"name\", \"is_private\", \"is_member\", \"is_shared\"}], \"next_cursor\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn channels(
    Path((org_id, installation_id)): Path<(String, String)>,
    query: Result<Query<ChannelsQuery>, QueryRejection>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let query = match parse_query(&org_id, query) {
            Ok(query) => query,
            Err(response) => return response,
        };
        let caller = caller(&org_id, &user_email.user_id);
        let q = query.q.as_deref().filter(|q| !q.is_empty());
        let cursor = query.cursor.as_deref().filter(|c| !c.is_empty());
        respond(ent::settings::channels(&caller, &installation_id, q, cursor).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, query, user_email);
        not_supported()
    }
}

/// SlackChannelDefaults
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/channel-defaults",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackChannelDefaults",
    summary = "List channel defaults",
    description = "Which organization answers in each channel, and how.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"defaults\": [{\"channel_id\", \"channel_name\", \"answer_mode\", \"set_from\", \"set_by_this_org\", \"org_id\"?, \"org_name\"?}]}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn channel_defaults(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::channel_defaults(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackGetChannelDefault
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/channel-defaults/{channel_id}",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackGetChannelDefault",
    summary = "Get one channel default",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
        ("channel_id" = String, Path, description = "Slack channel id"),
    ),
    responses(
        (status = 200, description = "`{\"channel_id\", \"channel_name\", \"answer_mode\", \"set_from\", \"set_by_this_org\", \"org_id\"?, \"org_name\"?}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, unknown installation or no default", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_channel_default(
    Path((org_id, installation_id, channel_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::get_channel_default(&caller, &installation_id, &channel_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, channel_id, user_email);
        not_supported()
    }
}

/// SlackPutChannelDefault
#[utoipa::path(
    put,
    path = "/{org_id}/slack/installations/{installation_id}/channel-defaults/{channel_id}",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPutChannelDefault",
    summary = "Set a channel default",
    description = "Sets which organization answers in the channel and how. Needs the permission in the row's current organization, and in the target organization when it moves.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
        ("channel_id" = String, Path, description = "Slack channel id"),
    ),
    request_body(content = Object, description = "`{\"org_id\", \"answer_mode\": \"thread\" | \"private\"}`", content_type = "application/json"),
    responses(
        (status = 200, description = "The channel default", content_type = "application/json", body = Object),
        (status = 400, description = "Bad body", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin of the organization that owns the default, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_channel_default(
    Path((org_id, installation_id, channel_id)): Path<(String, String, String)>,
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
        respond(
            ent::settings::put_channel_default(&caller, &installation_id, &channel_id, &req).await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, channel_id, user_email, body);
        not_supported()
    }
}

/// SlackDeleteChannelDefault
#[utoipa::path(
    delete,
    path = "/{org_id}/slack/installations/{installation_id}/channel-defaults/{channel_id}",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackDeleteChannelDefault",
    summary = "Remove a channel default",
    description = "Needs the permission in the organization that owns the default.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
        ("channel_id" = String, Path, description = "Slack channel id"),
    ),
    responses(
        (status = 204, description = "Removed"),
        (status = 403, description = "Not an admin of the organization that owns the default, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, unknown installation or no default", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_channel_default(
    Path((org_id, installation_id, channel_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use axum::response::IntoResponse;

        let caller = caller(&org_id, &user_email.user_id);
        match ent::settings::delete_channel_default(&caller, &installation_id, &channel_id).await {
            Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
            Err(e) => super::slack_error(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, channel_id, user_email);
        not_supported()
    }
}

/// SlackGetHelpContact
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/help-contact",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackGetHelpContact",
    summary = "Get the help contact",
    description = "Who a Slack user without O2 access should ask. Any member of the organization may read it.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"help_contact\"}`", content_type = "application/json", body = Object),
        (status = 403, description = "Not a member, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_help_contact(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::get_help_contact(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackPutHelpContact
#[utoipa::path(
    put,
    path = "/{org_id}/slack/installations/{installation_id}/help-contact",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackPutHelpContact",
    summary = "Set the help contact",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    request_body(content = Object, description = "`{\"help_contact\"}`, at most 256 characters", content_type = "application/json"),
    responses(
        (status = 200, description = "`{\"help_contact\"}`", content_type = "application/json", body = Object),
        (status = 400, description = "Longer than 256 characters", content_type = "application/json", body = ()),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_help_contact(
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
        respond(ent::settings::put_help_contact(&caller, &installation_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email, body);
        not_supported()
    }
}

/// SlackOncallUnlinked
#[utoipa::path(
    get,
    path = "/{org_id}/slack/installations/{installation_id}/oncall-unlinked",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackOncallUnlinked",
    summary = "On-call members without a Slack link",
    description = "Members of this organization's on-call teams who have not linked a Slack account in this workspace, with their next shift and the last reminder.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"members\": [{\"email\", \"team_id\", \"team_name\", \"next_shift_at\", \"reminded_at\"}]}`; empty when on-call is off", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn oncall_unlinked(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::oncall_unlinked(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
        not_supported()
    }
}

/// SlackRemindOncallUnlinked
#[utoipa::path(
    post,
    path = "/{org_id}/slack/installations/{installation_id}/oncall-unlinked/remind",
    context_path = "/api",
    tag = "Slack",
    operation_id = "SlackRemindOncallUnlinked",
    summary = "Send the pre-shift DM again",
    description = "DMs every unlinked on-call member of this organization a fresh link prompt; people Slack does not know by email are skipped.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("installation_id" = String, Path, description = "Slack installation id"),
    ),
    responses(
        (status = 200, description = "`{\"sent\"}`, the number of DMs that went out", content_type = "application/json", body = Object),
        (status = 403, description = "Not an admin, or the OSS build", content_type = "application/json", body = ()),
        (status = 404, description = "Slack is not enabled for this organization, or unknown installation", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Slack", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn remind_oncall_unlinked(
    Path((org_id, installation_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller = caller(&org_id, &user_email.user_id);
        respond(ent::settings::remind_oncall_unlinked(&caller, &installation_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, installation_id, user_email);
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

        let one = || Path(("default".to_string(), "I1".to_string()));
        let channel = || Path(("default".to_string(), "I1".to_string(), "C1".to_string()));
        let user = || {
            Headers(UserEmail {
                user_id: "root@example.com".to_string(),
            })
        };
        let body = || Ok(Json(serde_json::json!({})));
        let responses = vec![
            get_linking(one(), user()).await,
            put_linking(one(), user(), body()).await,
            link_matches(one(), Ok(Query(CursorQuery::default())), user()).await,
            link_all(one(), user()).await,
            channels(one(), Ok(Query(ChannelsQuery::default())), user()).await,
            channel_defaults(one(), user()).await,
            get_channel_default(channel(), user()).await,
            put_channel_default(channel(), user(), body()).await,
            delete_channel_default(channel(), user()).await,
            get_help_contact(one(), user()).await,
            put_help_contact(one(), user(), body()).await,
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
