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

#[cfg(any(feature = "enterprise", test))]
use std::collections::HashSet;
#[cfg(all(feature = "enterprise", feature = "test-utils"))]
use std::sync::RwLock;
#[cfg(feature = "enterprise")]
use std::sync::{Arc, LazyLock};

#[cfg(feature = "enterprise")]
use axum::response::Response;
#[cfg(feature = "enterprise")]
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(any(feature = "enterprise", test))]
use config::meta::stream::StreamType;
use config::meta::user::UserRole;
#[cfg(feature = "enterprise")]
use db::user::is_root_user;

use crate::auth::AuthExtractor;

#[cfg(any(feature = "enterprise", test))]
pub const STREAM_ACCESS_HINT: &str = "Ask an org admin for read access to the listed streams, or change the query to streams you can read.";

#[cfg(feature = "enterprise")]
static PRODUCTION_CHECKER: LazyLock<Arc<dyn StreamAccessChecker>> =
    LazyLock::new(|| Arc::new(OpenFgaStreamChecker));

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
static TEST_CHECKER: RwLock<Option<Arc<dyn StreamAccessChecker>>> = RwLock::new(None);

#[cfg(feature = "enterprise")]
#[derive(Clone, Copy)]
pub enum StreamPermissionResourceType {
    Search,
    PatternExtract,
    Insights,
}

/// Every variant carries the org it reads in, which may differ from the request org.
#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq)]
pub enum QuerySource {
    Sql {
        org_id: String,
        sql: String,
        default_type: StreamType,
    },
    PromQl {
        org_id: String,
        query: String,
    },
    Stream {
        org_id: String,
        stream_type: StreamType,
        name: String,
    },
    Vrl {
        org_id: String,
        source: String,
    },
    Dashboard {
        org_id: String,
        folder: String,
        dashboard_id: String,
    },
    Unparseable {
        source: String,
        error: String,
    },
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TypedStream {
    pub org_id: String,
    pub stream_type: StreamType,
    pub name: String,
}

#[cfg(any(feature = "enterprise", test))]
impl TypedStream {
    /// The org is named only when it differs from the request org.
    pub fn display(&self, request_org: &str) -> String {
        if self.org_id == request_org {
            format!("{}/{}", self.stream_type, self.name)
        } else {
            format!("{}/{}/{}", self.org_id, self.stream_type, self.name)
        }
    }
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq)]
pub enum Denial {
    Stream(TypedStream),
    CipherKey(String),
    Dashboard { folder: String, id: String },
    Unparseable { source: String, error: String },
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq)]
pub struct StreamAccessDenied {
    pub denials: Vec<Denial>,
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolvedSources {
    pub streams: Vec<TypedStream>,
    /// `(org, key)`.
    pub cipher_keys: Vec<(String, String)>,
    /// `(org, folder, dashboard id)`.
    pub dashboards: Vec<(String, String, String)>,
    pub unparseable: Vec<Denial>,
    pub resource_texts: Vec<String>,
}

#[cfg(any(feature = "enterprise", test))]
impl ResolvedSources {
    fn push_stream(&mut self, stream: TypedStream) {
        if !self.streams.contains(&stream) {
            self.streams.push(stream);
        }
    }

    fn push_unparseable(&mut self, source: &str, error: impl ToString) {
        let denial = Denial::Unparseable {
            source: source_label(source),
            error: source_label(&error.to_string()),
        };
        if !self.unparseable.contains(&denial) {
            self.unparseable.push(denial);
        }
    }
}

#[cfg(any(feature = "enterprise", test))]
#[async_trait::async_trait]
pub trait StreamAccessChecker: Send + Sync {
    async fn is_root(&self, user_id: &str) -> bool;
    async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool;
    async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool;
    async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool;
    async fn can_read_dashboard(
        &self,
        org_id: &str,
        user_id: &str,
        folder: &str,
        dashboard_id: &str,
    ) -> bool;
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
#[derive(Default)]
pub struct FakeStreamChecker {
    roots: RwLock<HashSet<String>>,
    admins: RwLock<HashSet<(String, String)>>,
    grants: RwLock<HashSet<(String, String)>>,
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
impl FakeStreamChecker {
    pub fn grant_root(&self, user_id: &str) {
        write_set(&self.roots).insert(user_id.to_string());
    }

    pub fn grant_admin(&self, org_id: &str, user_id: &str) {
        write_set(&self.admins).insert((org_id.to_string(), user_id.to_string()));
    }

    pub fn grant_read(&self, user_id: &str, stream: &TypedStream) {
        let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
        write_set(&self.grants).insert((user_id.to_string(), key));
    }

    pub fn grant_cipher_key(&self, org_id: &str, user_id: &str, key: &str) {
        write_set(&self.grants)
            .insert((user_id.to_string(), format!("{org_id}/cipher_keys/{key}")));
    }

    pub fn grant_dashboard(&self, org_id: &str, user_id: &str, folder: &str, dashboard_id: &str) {
        write_set(&self.grants).insert((
            user_id.to_string(),
            format!("{org_id}/dashboards/{folder}/{dashboard_id}"),
        ));
    }

    fn granted(&self, user_id: &str, key: String) -> bool {
        self.grants
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&(user_id.to_string(), key))
    }
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
#[async_trait::async_trait]
impl StreamAccessChecker for FakeStreamChecker {
    async fn is_root(&self, user_id: &str) -> bool {
        self.roots
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(user_id)
    }

    async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
        self.admins
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&(org_id.to_string(), user_id.to_string()))
    }

    async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
        let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
        self.granted(user_id, key)
    }

    async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool {
        self.granted(user_id, format!("{org_id}/cipher_keys/{key}"))
    }

    async fn can_read_dashboard(
        &self,
        org_id: &str,
        user_id: &str,
        folder: &str,
        dashboard_id: &str,
    ) -> bool {
        self.granted(
            user_id,
            format!("{org_id}/dashboards/{folder}/{dashboard_id}"),
        )
    }
}

#[cfg(feature = "enterprise")]
struct OpenFgaStreamChecker;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl StreamAccessChecker for OpenFgaStreamChecker {
    async fn is_root(&self, user_id: &str) -> bool {
        is_root_user(user_id)
    }

    async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
        crate::users::get_user(Some(org_id), user_id)
            .await
            .is_some_and(|user| matches!(user.role, UserRole::Root | UserRole::Admin))
    }

    async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        // a non-member of the stream's org is denied there, as the search path does
        let Some(user) = crate::users::get_user(Some(&stream.org_id), user_id).await else {
            return false;
        };
        let type_str = stream.stream_type.as_str();
        let model = OFGA_MODELS
            .get(type_str)
            .map_or(type_str, |model| model.key);
        check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: "GET".to_string(),
                o2_type: format!(
                    "{model}:{}",
                    config::utils::str::into_ofga_supported_format(&stream.name)
                ),
                org_id: stream.org_id.clone(),
                bypass_check: false,
                parent_id: "".to_string(),
                use_all_org: false,
                use_self_context: false,
                use_self_parent: true,
            },
            user.role,
            user.is_external,
        )
        .await
    }

    async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool {
        let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
            return false;
        };
        cipher_key_allowed(org_id, user_id, &user, key).await
    }

    async fn can_read_dashboard(
        &self,
        org_id: &str,
        user_id: &str,
        folder: &str,
        dashboard_id: &str,
    ) -> bool {
        crate::auth::check_permissions(
            dashboard_id,
            org_id,
            user_id,
            "dashboards",
            "GET",
            Some(folder),
            false,
            true,
            false,
        )
        .await
    }
}

/// Checks stream permissions, returning `Some(forbidden response)` when the
/// user is not permitted and `None` when access is allowed.
#[cfg(feature = "enterprise")]
pub async fn check_stream_permissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
    permission_resource_type: StreamPermissionResourceType,
) -> Option<Response> {
    if is_root_user(user_id) {
        return None;
    }

    use o2_openfga::{
        config::get_config,
        meta::mapping::{LOGS_INSIGHTS_KEY, LOGS_PATTERN_KEY, OFGA_MODELS},
    };

    // A user can hit this with an org they are not a member of (e.g. the search
    // profile endpoint always checks against _meta), so a missing user is a
    // deny, not a panic.
    let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
        return Some(MetaHttpResponse::forbidden("Unauthorized Access"));
    };
    let stream_type_str = stream_type.as_str();
    let config = get_config();
    let mut o2_model_type = "";

    match permission_resource_type {
        StreamPermissionResourceType::PatternExtract if config.logs_pattern_rbac_enabled => {
            o2_model_type = LOGS_PATTERN_KEY;
        }
        StreamPermissionResourceType::Insights if config.logs_pattern_rbac_enabled => {
            o2_model_type = LOGS_INSIGHTS_KEY;
        }
        _ => {}
    }

    if o2_model_type.is_empty() {
        o2_model_type = OFGA_MODELS
            .get(stream_type_str)
            .map_or(stream_type_str, |model| model.key);
    }

    if check_permissions(
        user_id,
        AuthExtractor {
            auth: "".to_string(),
            method: "GET".to_string(),
            o2_type: format!(
                "{}:{}",
                o2_model_type,
                crate::auth::into_ofga_supported_format(stream_name)
            ),
            org_id: org_id.to_string(),
            bypass_check: false,
            parent_id: "".to_string(),
            use_all_org: false,
            use_self_context: false,
            use_self_parent: true,
        },
        user.role,
        user.is_external,
    )
    .await
    {
        None
    } else {
        Some(MetaHttpResponse::forbidden("Unauthorized Access"))
    }
}

/// Requires GET permission on every cipher key the SQL references; `None` means allowed.
#[cfg(feature = "enterprise")]
pub async fn check_cipher_key_permissions(
    org_id: &str,
    user_id: &str,
    sql: &str,
) -> Option<Response> {
    check_cipher_key_permissions_multi(org_id, user_id, std::slice::from_ref(&sql)).await
}

/// [`check_cipher_key_permissions`] over several statements, checking each distinct key once.
#[cfg(feature = "enterprise")]
pub async fn check_cipher_key_permissions_multi(
    org_id: &str,
    user_id: &str,
    sqls: &[&str],
) -> Option<Response> {
    match denied_cipher_keys(org_id, user_id, sqls).await {
        Err(e) => Some(MetaHttpResponse::bad_request(e)),
        Ok(denied) if !denied.is_empty() => {
            Some(MetaHttpResponse::forbidden("Unauthorized Access to key"))
        }
        Ok(_) => None,
    }
}

#[cfg(feature = "enterprise")]
pub async fn denied_cipher_keys(
    org_id: &str,
    user_id: &str,
    sqls: &[&str],
) -> Result<Vec<String>, String> {
    let mut keys_used = Vec::new();
    for sql in sqls {
        match search::sql::visitor::cipher_key::get_cipher_key_names(sql) {
            Ok(v) => keys_used.extend(v),
            Err(e) => return Err(e.to_string()),
        }
    }
    keys_used.sort_unstable();
    keys_used.dedup();
    if keys_used.is_empty() || is_root_user(user_id) {
        return Ok(Vec::new());
    }
    log::info!("keys used : {keys_used:?}");

    let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
        return Ok(keys_used);
    };
    let mut denied = Vec::new();
    for key in keys_used {
        if !cipher_key_allowed(org_id, user_id, &user, &key).await {
            denied.push(key);
        }
    }
    Ok(denied)
}

#[cfg(feature = "enterprise")]
pub async fn check_permissions(
    user_id: &str,
    auth_info: AuthExtractor,
    role: UserRole,
    _is_external: bool,
) -> bool {
    use common::infra::config::ORG_USERS;

    if !o2_openfga::config::get_config().enabled {
        return true;
    }

    if report_failure_lifts_rbac().await {
        return true;
    }

    let object_str = auth_info.o2_type;
    log::debug!("Role of user {user_id} is {role:#?}");
    let role = if role == UserRole::Root {
        return true;
    } else {
        role.to_string()
    };

    let org_id = &auth_info.org_id;
    let effective_role = if org_id == config::META_ORG_ID {
        match ORG_USERS.get(&format!("{}/{user_id}", config::META_ORG_ID)) {
            Some(user) => user.role.to_string(),
            None => role,
        }
    } else {
        role
    };

    o2_openfga::authorizer::authz::is_allowed(
        org_id,
        user_id,
        &auth_info.method,
        &object_str,
        &auth_info.parent_id,
        &effective_role,
        auth_info.use_all_org,
        auth_info.use_self_context,
        auth_info.use_self_parent,
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
pub async fn check_permissions(
    _user_id: &str,
    _auth_info: AuthExtractor,
    _role: UserRole,
    _is_external: bool,
) -> bool {
    true
}

pub async fn list_objects_for_user(
    org_id: &str,
    user_id: &str,
    permission: &str,
    object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    db::authz::list_objects_for_user(org_id, user_id, permission, object_type).await
}

/// Never before the first usage report: an unloaded license also reads as a reporting failure.
#[cfg(feature = "enterprise")]
pub async fn report_failure_lifts_rbac() -> bool {
    use o2_enterprise::enterprise::license::{
        block_feature_for_report_failure, last_reported_timestamp,
    };
    block_feature_for_report_failure().await && last_reported_timestamp().await > 0
}

#[cfg(any(feature = "enterprise", test))]
pub fn resolve_query_sources(sources: &[QuerySource]) -> ResolvedSources {
    let mut resolved = ResolvedSources::default();
    for source in sources {
        match source {
            QuerySource::Sql {
                org_id,
                sql,
                default_type,
            } => resolve_sql(&mut resolved, org_id, sql, *default_type),
            QuerySource::PromQl { org_id, query } => resolve_promql(&mut resolved, org_id, query),
            QuerySource::Stream {
                org_id,
                stream_type,
                name,
            } => resolved.push_stream(TypedStream {
                org_id: org_id.clone(),
                stream_type: *stream_type,
                name: name.clone(),
            }),
            QuerySource::Vrl { org_id, source } => resolve_vrl(&mut resolved, org_id, source),
            QuerySource::Dashboard {
                org_id,
                folder,
                dashboard_id,
            } => {
                let entry = (org_id.clone(), folder.clone(), dashboard_id.clone());
                if !resolved.dashboards.contains(&entry) {
                    resolved.dashboards.push(entry);
                }
            }
            QuerySource::Unparseable { source, error } => {
                resolved.push_unparseable(source, error);
            }
        }
    }
    resolved
}

/// Every table `sql` reads, after the custom-pattern rewrite the search engine applies first.
pub fn resolve_sql_tables(
    sql: &str,
) -> Result<Vec<datafusion::common::TableReference>, anyhow::Error> {
    config::meta::sql::resolve_stream_names_with_type(&search_rewritten_sql(sql))
}

#[cfg(any(feature = "enterprise", test))]
pub fn source_orgs(resolved: &ResolvedSources) -> Vec<String> {
    let mut orgs: Vec<String> = Vec::new();
    let all = resolved
        .streams
        .iter()
        .map(|s| &s.org_id)
        .chain(resolved.cipher_keys.iter().map(|(org, _)| org))
        .chain(resolved.dashboards.iter().map(|(org, ..)| org));
    for org in all {
        if !orgs.contains(org) {
            orgs.push(org.clone());
        }
    }
    orgs
}

/// Root or Admin skips only the sources in an org it holds that role in.
#[cfg(any(feature = "enterprise", test))]
pub async fn authorize_with(
    checker: &dyn StreamAccessChecker,
    user_id: &str,
    sources: &[QuerySource],
) -> Result<(), StreamAccessDenied> {
    use futures::future::join_all;

    if checker.is_root(user_id).await {
        return Ok(());
    }
    let resolved = resolve_query_sources(sources);
    let orgs = source_orgs(&resolved);
    let admin_flags = join_all(
        orgs.iter()
            .map(|org| checker.is_root_or_admin(org, user_id)),
    )
    .await;
    let admin_orgs: HashSet<&str> = orgs
        .iter()
        .zip(admin_flags)
        .filter_map(|(org, admin)| admin.then_some(org.as_str()))
        .collect();

    let streams: Vec<&TypedStream> = resolved
        .streams
        .iter()
        .filter(|s| !admin_orgs.contains(s.org_id.as_str()))
        .collect();
    let keys: Vec<&(String, String)> = resolved
        .cipher_keys
        .iter()
        .filter(|(org, _)| !admin_orgs.contains(org.as_str()))
        .collect();
    let dashboards: Vec<&(String, String, String)> = resolved
        .dashboards
        .iter()
        .filter(|(org, ..)| !admin_orgs.contains(org.as_str()))
        .collect();
    let (stream_ok, key_ok, dashboard_ok) = futures::join!(
        join_all(streams.iter().map(|s| checker.can_read_stream(user_id, s))),
        join_all(
            keys.iter()
                .map(|(org, key)| checker.can_use_cipher_key(org, user_id, key))
        ),
        join_all(
            dashboards
                .iter()
                .map(|(org, folder, id)| checker.can_read_dashboard(org, user_id, folder, id))
        ),
    );

    let mut denials: Vec<Denial> = streams
        .into_iter()
        .zip(stream_ok)
        .filter(|(_, ok)| !ok)
        .map(|(s, _)| Denial::Stream(s.clone()))
        .collect();
    denials.extend(
        keys.into_iter()
            .zip(key_ok)
            .filter(|(_, ok)| !ok)
            .map(|((_, key), _)| Denial::CipherKey(key.clone())),
    );
    denials.extend(
        dashboards
            .into_iter()
            .zip(dashboard_ok)
            .filter(|(_, ok)| !ok)
            .map(|((_, folder, id), _)| Denial::Dashboard {
                folder: folder.clone(),
                id: id.clone(),
            }),
    );
    denials.extend(resolved.unparseable);
    if denials.is_empty() {
        Ok(())
    } else {
        Err(StreamAccessDenied { denials })
    }
}

#[cfg(feature = "enterprise")]
pub async fn authorize_query_sources(
    user_id: &str,
    sources: &[QuerySource],
) -> Result<(), StreamAccessDenied> {
    let checker = active_checker();
    authorize_with(checker.as_ref(), user_id, sources).await
}

#[cfg(feature = "enterprise")]
pub fn active_checker() -> Arc<dyn StreamAccessChecker> {
    #[cfg(feature = "test-utils")]
    if let Some(checker) = TEST_CHECKER
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        return checker.clone();
    }
    PRODUCTION_CHECKER.clone()
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
pub fn install_test_checker(checker: Arc<dyn StreamAccessChecker>) {
    *TEST_CHECKER.write().unwrap_or_else(|e| e.into_inner()) = Some(checker);
}

/// One process-wide checker, so tests isolate by granting to unique users.
#[cfg(all(feature = "enterprise", feature = "test-utils"))]
pub fn fake_checker() -> Arc<FakeStreamChecker> {
    static FAKE: std::sync::OnceLock<Arc<FakeStreamChecker>> = std::sync::OnceLock::new();
    FAKE.get_or_init(|| {
        let checker = Arc::new(FakeStreamChecker::default());
        install_test_checker(checker.clone());
        checker
    })
    .clone()
}

#[cfg(any(feature = "enterprise", test))]
pub fn stream_access_message(request_org: &str, denied: &StreamAccessDenied) -> String {
    let mut streams = Vec::new();
    let mut keys = Vec::new();
    let mut dashboards = Vec::new();
    let mut unparseable = Vec::new();
    for denial in &denied.denials {
        match denial {
            Denial::Stream(s) => streams.push(s.display(request_org)),
            Denial::CipherKey(key) => keys.push(key.clone()),
            Denial::Dashboard { folder, id } => dashboards.push(format!("{folder}/{id}")),
            Denial::Unparseable { source, error } => {
                unparseable.push(format!("{source} ({error})"))
            }
        }
    }
    let mut parts = Vec::new();
    if !streams.is_empty() {
        parts.push(format!("no read permission on {}", streams.join(", ")));
    }
    if !keys.is_empty() {
        parts.push(format!("cipher keys: {}", keys.join(", ")));
    }
    if !dashboards.is_empty() {
        parts.push(format!("dashboards: {}", dashboards.join(", ")));
    }
    if !unparseable.is_empty() {
        parts.push(format!("unparseable: {}", unparseable.join(", ")));
    }
    format!("Unauthorized Access: {}", parts.join("; "))
}

#[cfg(feature = "enterprise")]
pub fn stream_access_forbidden(request_org: &str, denied: &StreamAccessDenied) -> Response {
    use axum::{Json, http::StatusCode, response::IntoResponse};

    let mut body = MetaHttpResponse::error(
        StatusCode::FORBIDDEN,
        stream_access_message(request_org, denied),
    );
    body.hint = Some(STREAM_ACCESS_HINT.to_string());
    (StatusCode::FORBIDDEN, Json(body)).into_response()
}

#[cfg(feature = "enterprise")]
async fn cipher_key_allowed(
    org_id: &str,
    user_id: &str,
    user: &config::meta::user::User,
    key: &str,
) -> bool {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let key_model = OFGA_MODELS
        .get("cipher_keys")
        .map_or("cipher_keys", |model| model.key);
    check_permissions(
        user_id,
        AuthExtractor {
            auth: "".to_string(),
            method: "GET".to_string(),
            o2_type: format!("{key_model}:{key}"),
            org_id: org_id.to_string(),
            bypass_check: false,
            parent_id: "".to_string(),
            use_all_org: false,
            use_self_context: false,
            use_self_parent: true,
        },
        user.role.clone(),
        user.is_external,
    )
    .await
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_sql(resolved: &mut ResolvedSources, org_id: &str, sql: &str, default_type: StreamType) {
    use config::meta::sql::TableReferenceExt;

    let tables = match resolve_sql_tables(sql) {
        Ok(tables) => tables,
        Err(e) => {
            resolved.push_unparseable(sql, e);
            return;
        }
    };
    for table in tables {
        resolved.resource_texts.push(table.to_string());
        resolved.push_stream(TypedStream {
            org_id: org_id.to_string(),
            stream_type: table.get_stream_type(default_type),
            name: table.stream_name(),
        });
    }
    #[cfg(feature = "enterprise")]
    match search::sql::visitor::cipher_key::get_cipher_key_names(&search_rewritten_sql(sql)) {
        Ok(keys) => {
            for key in keys {
                resolved.resource_texts.push(key.clone());
                let entry = (org_id.to_string(), key);
                if !resolved.cipher_keys.contains(&entry) {
                    resolved.cipher_keys.push(entry);
                }
            }
        }
        Err(e) => resolved.push_unparseable(sql, e),
    }
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_promql(resolved: &mut ResolvedSources, org_id: &str, query: &str) {
    use promql::ast::{name_visitor::MetricNameVisitor, visitor::walk_expr};

    let ast = match promql_parser::parser::parse(query) {
        Ok(ast) => ast,
        Err(e) => {
            resolved.push_unparseable(query, e);
            return;
        }
    };
    let mut visitor = MetricNameVisitor::new();
    if let Err(e) = walk_expr(&mut visitor, &ast) {
        resolved.push_unparseable(query, e);
        return;
    }
    let mut names: Vec<String> = visitor.into_names().into_iter().collect();
    names.sort_unstable();
    for name in names {
        resolved.resource_texts.push(name.clone());
        resolved.push_stream(TypedStream {
            org_id: org_id.to_string(),
            stream_type: StreamType::Metrics,
            name,
        });
    }
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_vrl(resolved: &mut ResolvedSources, org_id: &str, source: &str) {
    match transform::enrichment_tables_read(source, org_id) {
        Ok(tables) => {
            for (table_org, name) in tables {
                resolved.push_stream(TypedStream {
                    org_id: table_org,
                    stream_type: StreamType::EnrichmentTables,
                    name,
                });
            }
        }
        Err(e) => resolved.push_unparseable(source, e),
    }
}

fn search_rewritten_sql(sql: &str) -> String {
    config::utils::query_select_utils::replace_o2_custom_patterns(sql)
        .unwrap_or_else(|_| sql.to_string())
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
fn write_set<T>(set: &RwLock<HashSet<T>>) -> std::sync::RwLockWriteGuard<'_, HashSet<T>> {
    set.write().unwrap_or_else(|e| e.into_inner())
}

/// A denial names the query without echoing a whole program into the response.
#[cfg(any(feature = "enterprise", test))]
fn source_label(source: &str) -> String {
    const MAX_CHARS: usize = 120;
    let line = source.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= MAX_CHARS {
        line
    } else {
        format!("{}...", line.chars().take(MAX_CHARS).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[derive(Default)]
    struct FakeChecker {
        roots: HashSet<String>,
        admins: HashSet<(String, String)>,
        readable: HashSet<(String, String)>,
    }

    impl FakeChecker {
        fn admin(mut self, user: &str, org: &str) -> Self {
            self.admins.insert((user.to_string(), org.to_string()));
            self
        }

        fn reads(mut self, user: &str, stream: &str) -> Self {
            self.readable.insert((user.to_string(), stream.to_string()));
            self
        }
    }

    #[async_trait::async_trait]
    impl StreamAccessChecker for FakeChecker {
        async fn is_root(&self, user_id: &str) -> bool {
            self.roots.contains(user_id)
        }

        async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
            self.admins
                .contains(&(user_id.to_string(), org_id.to_string()))
        }

        async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
            let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
            self.readable.contains(&(user_id.to_string(), key))
        }

        async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool {
            self.readable
                .contains(&(user_id.to_string(), format!("{org_id}/key/{key}")))
        }

        async fn can_read_dashboard(
            &self,
            org_id: &str,
            user_id: &str,
            folder: &str,
            dashboard_id: &str,
        ) -> bool {
            self.readable.contains(&(
                user_id.to_string(),
                format!("{org_id}/dashboard/{folder}/{dashboard_id}"),
            ))
        }
    }

    fn sql(org: &str, text: &str) -> QuerySource {
        QuerySource::Sql {
            org_id: org.to_string(),
            sql: text.to_string(),
            default_type: StreamType::Logs,
        }
    }

    fn promql(org: &str, text: &str) -> QuerySource {
        QuerySource::PromQl {
            org_id: org.to_string(),
            query: text.to_string(),
        }
    }

    fn stream(org: &str, stream_type: StreamType, name: &str) -> QuerySource {
        QuerySource::Stream {
            org_id: org.to_string(),
            stream_type,
            name: name.to_string(),
        }
    }

    fn names(resolved: &ResolvedSources) -> Vec<String> {
        resolved
            .streams
            .iter()
            .map(|s| format!("{}/{}", s.stream_type, s.name))
            .collect()
    }

    #[test]
    fn resolves_prefixed_joined_nested_and_unioned_streams_but_not_ctes() {
        let resolved = resolve_query_sources(&[
            sql("o1", r#"SELECT * FROM "metrics".cpu"#),
            sql(
                "o1",
                "SELECT a.x FROM app a JOIN audit b ON a.id = b.id WHERE a.k IN (SELECT k FROM nested)",
            ),
            sql(
                "o1",
                "SELECT x FROM left_side UNION ALL SELECT x FROM right_side",
            ),
            sql(
                "o1",
                "WITH recent AS (SELECT * FROM base) SELECT * FROM recent JOIN app ON true",
            ),
        ]);
        assert_eq!(
            names(&resolved),
            vec![
                "metrics/cpu",
                "logs/app",
                "logs/audit",
                "logs/nested",
                "logs/left_side",
                "logs/right_side",
                "logs/base",
            ]
        );
        assert!(resolved.unparseable.is_empty());
    }

    #[test]
    fn resolves_promql_metric_names_as_metrics_streams() {
        let one = resolve_query_sources(&[promql("o1", "rate(http_total[5m])")]);
        assert_eq!(names(&one), vec!["metrics/http_total"]);

        let several = resolve_query_sources(&[promql(
            "o1",
            r#"sum(rate(req_errors{job="api"}[5m])) / sum(rate(req_total[5m])) + topk(3, mem_used)"#,
        )]);
        assert_eq!(
            names(&several),
            vec![
                "metrics/mem_used",
                "metrics/req_errors",
                "metrics/req_total"
            ]
        );
    }

    #[test]
    fn a_query_that_does_not_parse_is_a_denial_never_a_pass() {
        let resolved = resolve_query_sources(&[
            sql("o1", "SELEC * FRM nothing"),
            promql("o1", "sum(("),
            promql("o1", r#"{job="nameless"}"#),
        ]);
        assert!(resolved.streams.is_empty());
        assert_eq!(resolved.unparseable.len(), 3);
    }

    #[tokio::test]
    async fn unparseable_source_is_denied_even_for_an_admin() {
        let checker = FakeChecker::default().admin("u1", "o1");
        let denied = authorize_with(&checker, "u1", &[sql("o1", "not sql at all")])
            .await
            .unwrap_err();
        assert!(matches!(
            denied.denials.as_slice(),
            [Denial::Unparseable { .. }]
        ));
    }

    #[tokio::test]
    async fn lists_every_denied_stream_once_in_query_order() {
        let checker = FakeChecker::default().reads("u1", "o1/logs/allowed");
        let denied = authorize_with(
            &checker,
            "u1",
            &[
                stream("o1", StreamType::Logs, "secret"),
                sql(
                    "o1",
                    "SELECT * FROM secret JOIN allowed ON true JOIN other ON true",
                ),
            ],
        )
        .await
        .unwrap_err();
        assert_eq!(
            stream_access_message("o1", &denied),
            "Unauthorized Access: no read permission on logs/secret, logs/other"
        );
    }

    #[tokio::test]
    async fn readable_sources_pass() {
        let checker = FakeChecker::default()
            .reads("u1", "o1/logs/app")
            .reads("u1", "o1/metrics/cpu");
        let sources = [sql("o1", "SELECT * FROM app"), promql("o1", "cpu")];
        assert!(authorize_with(&checker, "u1", &sources).await.is_ok());
    }

    #[tokio::test]
    async fn admin_shortcut_skips_only_the_orgs_the_caller_administers() {
        let sources = [
            stream("org_a", StreamType::Logs, "a_stream"),
            stream("org_b", StreamType::Logs, "b_stream"),
        ];

        let admin_of_a = FakeChecker::default().admin("u1", "org_a");
        let denied = authorize_with(&admin_of_a, "u1", &sources)
            .await
            .unwrap_err();
        assert_eq!(
            stream_access_message("org_a", &denied),
            "Unauthorized Access: no read permission on org_b/logs/b_stream"
        );

        let admin_of_both = FakeChecker::default()
            .admin("u1", "org_a")
            .admin("u1", "org_b");
        assert!(authorize_with(&admin_of_both, "u1", &sources).await.is_ok());

        let mut root = FakeChecker::default();
        root.roots.insert("u1".to_string());
        assert!(authorize_with(&root, "u1", &sources).await.is_ok());
    }

    #[tokio::test]
    async fn dashboards_and_unparseable_sources_get_their_own_segments() {
        let checker = FakeChecker::default();
        let denied = authorize_with(
            &checker,
            "u1",
            &[
                QuerySource::Dashboard {
                    org_id: "o1".to_string(),
                    folder: "f1".to_string(),
                    dashboard_id: "d1".to_string(),
                },
                QuerySource::Unparseable {
                    source: "SELECT * FROM \"$s\"".to_string(),
                    error: "unresolved variable s in stream position".to_string(),
                },
            ],
        )
        .await
        .unwrap_err();
        assert_eq!(
            stream_access_message("o1", &denied),
            "Unauthorized Access: dashboards: f1/d1; unparseable: SELECT * FROM \"$s\" (unresolved variable s in stream position)"
        );
    }

    #[test]
    fn no_authorization_code_uses_the_untyped_resolver() {
        let needle = concat!("resolve_stream_names", "(");
        for (file, text) in [
            ("authz.rs", include_str!("authz.rs")),
            (
                "background_access/mod.rs",
                include_str!("background_access/mod.rs"),
            ),
            (
                "background_access/placeholders.rs",
                include_str!("background_access/placeholders.rs"),
            ),
            (
                "background_access/audit.rs",
                include_str!("background_access/audit.rs"),
            ),
        ] {
            assert!(!text.contains(needle), "{file} uses the untyped resolver");
        }
    }

    #[test]
    fn committed_code_names_no_advisory() {
        let patterns = [concat!("GHSA", "-"), concat!("CVE", "-")];
        for (file, text) in [
            ("authz.rs", include_str!("authz.rs")),
            (
                "background_access/mod.rs",
                include_str!("background_access/mod.rs"),
            ),
            (
                "background_access/placeholders.rs",
                include_str!("background_access/placeholders.rs"),
            ),
            (
                "background_access/audit.rs",
                include_str!("background_access/audit.rs"),
            ),
        ] {
            for pattern in patterns {
                assert!(!text.contains(pattern), "{file} names an advisory");
            }
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn report_failure_does_not_lift_rbac_before_any_report() {
        assert_eq!(
            o2_enterprise::enterprise::license::last_reported_timestamp().await,
            0
        );
        assert!(!report_failure_lifts_rbac().await);
    }
}
