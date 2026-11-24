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

#[cfg(feature = "enterprise")]
pub mod accounting;
#[cfg(any(feature = "enterprise", test))]
pub mod list;

#[cfg(any(feature = "enterprise", test))]
use std::collections::{HashMap, HashSet};
#[cfg(any(feature = "enterprise", test))]
use std::sync::Arc;
#[cfg(feature = "enterprise")]
use std::sync::LazyLock;
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
use std::sync::RwLock;

#[cfg(feature = "enterprise")]
use axum::response::Response;
#[cfg(feature = "enterprise")]
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::user::UserRole;
#[cfg(any(feature = "enterprise", test))]
use config::meta::{
    service_streams::{RelatedStreams, StreamInfo},
    stream::StreamType,
};
#[cfg(feature = "enterprise")]
use db::user::is_root_user;
#[cfg(any(feature = "enterprise", test))]
use infra::table::service_streams::ServiceRecord;

#[cfg(any(feature = "enterprise", test))]
pub use self::list::readable_streams;
#[cfg(any(feature = "enterprise", test))]
use self::list::{
    AuthzUnavailable, ListSettings, ObjectRef, ObjectsQuery, OrgWideCheck, StreamShape,
    TypeAccessKind, UnlistedKind,
};
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
use self::list::{ListPolicy, UnavailableReason};
use crate::auth::AuthExtractor;

/// Longest object id the fake lets through, as OpenFGA's Check pattern does.
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
const FAKE_MAX_ID_LEN: usize = 256;

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
        org_id: String,
        source: String,
        error: String,
    },
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq, Eq)]
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
    Dashboard {
        folder: String,
        id: String,
    },
    Unparseable {
        org_id: String,
        source: String,
        error: String,
        /// An uncompilable VRL may read another org's enrichment table, so no admin skips it.
        from_vrl: bool,
    },
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

    fn push_unparseable(
        &mut self,
        org_id: &str,
        source: &str,
        error: impl ToString,
        from_vrl: bool,
    ) {
        let denial = Denial::Unparseable {
            org_id: org_id.to_string(),
            source: source_label(source),
            error: source_label(&error.to_string()),
            from_vrl,
        };
        if !self.unparseable.contains(&denial) {
            self.unparseable.push(denial);
        }
    }
}

#[cfg(any(feature = "enterprise", test))]
#[async_trait::async_trait]
pub trait StreamAccessChecker: Send + Sync {
    async fn enforces_rbac(&self) -> bool;
    async fn is_root(&self, user_id: &str) -> bool;
    async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool;
    async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool;
    /// The types of `wanted` with a confirmed read grant on every stream of the org.
    /// The default, no type, sends each stream to `can_read_stream`.
    async fn org_wide_readable(
        &self,
        _user_id: &str,
        _org_id: &str,
        _wanted: &[StreamType],
    ) -> HashSet<StreamType> {
        HashSet::new()
    }
    async fn can_use_cipher_key(&self, org_id: &str, user_id: &str, key: &str) -> bool;
    async fn can_read_dashboard(
        &self,
        org_id: &str,
        user_id: &str,
        folder: &str,
        dashboard_id: &str,
    ) -> bool;
    /// The list authorization mode and limits; the default keeps the `origin/main` path.
    fn list_settings(&self, _user_id: &str) -> ListSettings {
        ListSettings::default()
    }
    /// Per-type answers for `types`; the default gives none, so every object takes `check_object`.
    async fn types_access(
        &self,
        _user_id: &str,
        _org_id: &str,
        _shape: &StreamShape<'_>,
        types: &[StreamType],
    ) -> Result<HashMap<StreamType, TypeAccessKind>, AuthzUnavailable> {
        let unlisted = TypeAccessKind::Unlisted(UnlistedKind::Disabled);
        Ok(types.iter().map(|t| (*t, unlisted.clone())).collect())
    }
    /// The exact per-object Check of the site, fallible.
    async fn check_object(
        &self,
        user_id: &str,
        org_id: &str,
        _query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        let stream = TypedStream {
            org_id: org_id.to_string(),
            stream_type: object.stream_type,
            name: object.id.to_string(),
        };
        Ok(self.can_read_stream(user_id, &stream).await)
    }
    /// A site prelude, sent verbatim; the default never confirms one.
    async fn org_wide_check(
        &self,
        _user_id: &str,
        _org_id: &str,
        _check: &OrgWideCheck<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        Ok(false)
    }
}

/// A refusal a save's error can carry: errors must be `Sync`, and a response body is not.
pub struct Refusal(std::sync::Mutex<axum::response::Response>);

impl Refusal {
    pub fn new(response: axum::response::Response) -> Self {
        Self(std::sync::Mutex::new(response))
    }

    pub fn into_response(self) -> axum::response::Response {
        self.0.into_inner().unwrap_or_else(|e| e.into_inner())
    }
}

impl std::fmt::Debug for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Refusal")
    }
}

/// A caller's last check on an object its save has already validated, run right before the write.
#[async_trait::async_trait]
pub trait WriteCheck<T: Sync>: Send + Sync {
    async fn check(&self, object: &T) -> Result<(), axum::response::Response>;
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[derive(Default)]
pub struct FakeStreamChecker {
    roots: RwLock<HashSet<String>>,
    admins: RwLock<HashSet<(String, String)>>,
    grants: RwLock<HashSet<(String, String)>>,
    org_wide: RwLock<HashSet<(String, String, StreamType)>>,
    org_wide_failures: RwLock<HashSet<String>>,
    every_stream: RwLock<HashSet<(String, String)>>,
    org_wide_checks: RwLock<HashSet<(String, String, String)>>,
    roles: RwLock<HashMap<(String, String), String>>,
    role_answers: RwLock<HashMap<(String, String), bool>>,
    users: RwLock<HashMap<String, FakeUser>>,
    in_flight: RwLock<HashMap<String, usize>>,
    calls: RwLock<HashMap<String, CheckCalls>>,
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
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

    /// A wide grant on one stream type: the B1/B2 probe of the type-level path.
    pub fn grant_read_all(&self, user_id: &str, org_id: &str, stream_type: StreamType) {
        write_set(&self.org_wide).insert((user_id.to_string(), org_id.to_string(), stream_type));
    }

    /// A grant on every stream type at once: the C probe of the type-level path.
    pub fn grant_read_every_stream(&self, user_id: &str, org_id: &str) {
        write_set(&self.every_stream).insert((user_id.to_string(), org_id.to_string()));
    }

    pub fn grant_org_wide_check(&self, user_id: &str, org_id: &str, resource: &str) {
        write_set(&self.org_wide_checks).insert((
            user_id.to_string(),
            org_id.to_string(),
            resource.to_string(),
        ));
    }

    /// The user's role, for the offline rule; `admin` and `editor` are answered by their role.
    pub fn set_role(&self, org_id: &str, user_id: &str, role: &str) {
        let key = (org_id.to_string(), user_id.to_string());
        write_map(&self.roles).insert(key, role.to_string());
    }

    /// Makes the user's role Check answer every stream with `allowed`.
    pub fn set_role_answer(&self, org_id: &str, user_id: &str, allowed: bool) {
        let key = (org_id.to_string(), user_id.to_string());
        write_map(&self.role_answers).insert(key, allowed);
    }

    pub fn set_list_mode(&self, user_id: &str, mode: list::ListMode) {
        self.user(user_id, |user| user.settings.mode = mode);
    }

    pub fn set_shadow_sample(&self, user_id: &str, sample: f64) {
        self.user(user_id, |user| user.settings.shadow_sample = sample);
    }

    pub fn set_fallback_concurrency(&self, user_id: &str, concurrency: usize) {
        self.user(user_id, |user| {
            user.settings.fallback_concurrency = concurrency
        });
    }

    /// Lists are enabled by default for a fake user, as a declared deadline enables them.
    pub fn set_list_policy(&self, user_id: &str, policy: ListPolicy) {
        self.user(user_id, |user| user.policy = policy);
    }

    pub fn set_offline_roles(&self, user_id: &str, roles: &[&str]) {
        let roles = roles.iter().map(|r| r.to_string()).collect();
        self.user(user_id, |user| user.offline_roles = roles);
    }

    /// Makes the next org-wide question of this user come back empty, as a failed Check does.
    pub fn fail_org_wide_once(&self, user_id: &str) {
        write_set(&self.org_wide_failures).insert(user_id.to_string());
    }

    pub fn fail_types_access_once(&self, user_id: &str, reason: UnavailableReason) {
        self.user(user_id, |user| user.failures.probe = Some(reason));
    }

    pub fn fail_list_once(&self, user_id: &str, reason: UnavailableReason) {
        self.user(user_id, |user| user.failures.list = Some(reason));
    }

    pub fn fail_list_incomplete_once(&self, user_id: &str, stream_type: StreamType) {
        self.user(user_id, |user| user.failures.incomplete = Some(stream_type));
    }

    pub fn fail_org_wide_check_once(&self, user_id: &str, reason: UnavailableReason) {
        self.user(user_id, |user| user.failures.org_wide_check = Some(reason));
    }

    pub fn fail_object_check_once(&self, user_id: &str, reason: UnavailableReason) {
        self.user(user_id, |user| user.failures.object_check = Some(reason));
    }

    /// Fails every later call of this user, the per-stream Checks of the legacy path included.
    pub fn fail_every_call(&self, user_id: &str, reason: UnavailableReason) {
        self.user(user_id, |user| user.failures.every_call = Some(reason));
    }

    /// Makes the next legacy Check of `name` fail, which the legacy path reads as a deny.
    pub fn fail_stream_read_once(&self, user_id: &str, name: &str) {
        self.user(user_id, |user| {
            user.failures.stream_read = Some(name.to_string())
        });
    }

    /// Adds `name` to the next list of `stream_type`, so the two paths disagree once.
    pub fn list_extra_once(&self, user_id: &str, stream_type: StreamType, name: &str) {
        let extra = Some((stream_type, name.to_string()));
        self.user(user_id, |user| user.failures.list_extra = extra);
    }

    pub fn calls(&self, user_id: &str) -> CheckCalls {
        let calls = self.calls.read().unwrap_or_else(|e| e.into_inner());
        calls.get(user_id).cloned().unwrap_or_default()
    }

    fn count(&self, user_id: &str, add: impl FnOnce(&mut CheckCalls)) {
        let mut calls = self.calls.write().unwrap_or_else(|e| e.into_inner());
        add(calls.entry(user_id.to_string()).or_default());
    }

    fn user<R>(&self, user_id: &str, f: impl FnOnce(&mut FakeUser) -> R) -> R {
        let mut users = write_map(&self.users);
        f(users.entry(user_id.to_string()).or_default())
    }

    fn granted(&self, user_id: &str, key: String) -> bool {
        self.grants
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&(user_id.to_string(), key))
    }

    fn reads_all(&self, user_id: &str, org_id: &str, stream_type: StreamType) -> bool {
        self.org_wide
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&(user_id.to_string(), org_id.to_string(), stream_type))
    }

    fn reads_every_stream(&self, user_id: &str, org_id: &str) -> bool {
        self.every_stream
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&(user_id.to_string(), org_id.to_string()))
    }

    fn role(&self, org_id: &str, user_id: &str) -> String {
        let roles = self.roles.read().unwrap_or_else(|e| e.into_inner());
        let key = (org_id.to_string(), user_id.to_string());
        roles
            .get(&key)
            .cloned()
            .unwrap_or_else(|| "user".to_string())
    }

    /// The answer of the user's role Check, for the users the role branch answers.
    fn role_branch(&self, org_id: &str, user_id: &str) -> Option<bool> {
        let key = (org_id.to_string(), user_id.to_string());
        let answers = self.role_answers.read().unwrap_or_else(|e| e.into_inner());
        if let Some(allowed) = answers.get(&key) {
            return Some(*allowed);
        }
        let role = self.role(org_id, user_id);
        (matches!(role.as_str(), "admin" | "editor") && user_id != org_id).then_some(true)
    }

    /// Takes the one-shot failure `pick` names, or the failure of every call.
    fn failure(
        &self,
        user_id: &str,
        pick: impl FnOnce(&mut FakeFailures) -> Option<UnavailableReason>,
    ) -> Option<UnavailableReason> {
        self.user(user_id, |user| {
            pick(&mut user.failures).or(user.failures.every_call)
        })
    }

    /// A failure answered as `is_allowed` answers it: `true` for an offline-access role.
    fn offline(&self, org_id: &str, user_id: &str, reason: UnavailableReason) -> bool {
        let role = self.role(org_id, user_id);
        reason == UnavailableReason::Transport
            && self.user(user_id, |user| user.offline_roles.contains(&role))
    }

    fn listed(&self, user_id: &str, org_id: &str, stream_type: StreamType) -> HashSet<String> {
        let prefix = format!("{org_id}/{stream_type}/");
        let grants = self.grants.read().unwrap_or_else(|e| e.into_inner());
        let mut ids: HashSet<String> = grants
            .iter()
            .filter(|(user, _)| user == user_id)
            .filter_map(|(_, key)| key.strip_prefix(&prefix))
            .map(config::utils::str::into_ofga_supported_format)
            .collect();
        drop(grants);
        let extra = self.user(user_id, |user| match &user.failures.list_extra {
            Some((t, _)) if *t == stream_type => user.failures.list_extra.take(),
            _ => None,
        });
        ids.extend(extra.map(|(_, name)| name));
        ids
    }

    fn list_type(
        &self,
        user_id: &str,
        org_id: &str,
        stream_type: StreamType,
    ) -> Result<TypeAccessKind, AuthzUnavailable> {
        self.count(user_id, |calls| calls.lists += 1);
        if let Some(reason) = self.failure(user_id, |f| f.list.take()) {
            fake_record(true);
            if self.offline(org_id, user_id, reason) {
                return Ok(TypeAccessKind::Unlisted(UnlistedKind::OfflineRule));
            }
            return Err(reason.into());
        }
        fake_record(false);
        let incomplete = self.user(user_id, |user| match user.failures.incomplete {
            Some(t) if t == stream_type => user.failures.incomplete.take(),
            _ => None,
        });
        if incomplete.is_some() {
            return Ok(TypeAccessKind::Unlisted(UnlistedKind::Incomplete));
        }
        Ok(TypeAccessKind::Listed(self.listed(
            user_id,
            org_id,
            stream_type,
        )))
    }

    async fn enter_check(&self, user_id: &str) {
        let now = {
            let mut in_flight = write_map(&self.in_flight);
            let n = in_flight.entry(user_id.to_string()).or_default();
            *n += 1;
            *n
        };
        self.count(user_id, |calls| {
            calls.max_in_flight = calls.max_in_flight.max(now)
        });
        tokio::task::yield_now().await;
        let mut in_flight = write_map(&self.in_flight);
        if let Some(n) = in_flight.get_mut(user_id) {
            *n -= 1;
        }
    }
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[async_trait::async_trait]
impl StreamAccessChecker for FakeStreamChecker {
    async fn enforces_rbac(&self) -> bool {
        true
    }

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
        self.count(user_id, |calls| calls.streams += 1);
        tokio::task::yield_now().await;
        let failed_once = self.user(user_id, |user| {
            let hit = user.failures.stream_read.as_deref() == Some(stream.name.as_str());
            if hit {
                user.failures.stream_read = None;
            }
            hit
        });
        if failed_once {
            fake_record(true);
            return false;
        }
        if let Some(reason) = self.failure(user_id, |_| None) {
            fake_record(true);
            return self.offline(&stream.org_id, user_id, reason);
        }
        fake_record(false);
        if let Some(allowed) = self.role_branch(&stream.org_id, user_id) {
            return allowed;
        }
        let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
        self.granted(user_id, key) || self.reads_all(user_id, &stream.org_id, stream.stream_type)
    }

    async fn org_wide_readable(
        &self,
        user_id: &str,
        org_id: &str,
        wanted: &[StreamType],
    ) -> HashSet<StreamType> {
        self.count(user_id, |calls| calls.org_wide.push(wanted.to_vec()));
        tokio::task::yield_now().await;
        let failed = write_set(&self.org_wide_failures).remove(user_id)
            || self.failure(user_id, |_| None).is_some();
        fake_record(failed);
        if failed {
            return HashSet::new();
        }
        wanted
            .iter()
            .copied()
            .filter(|stream_type| self.reads_all(user_id, org_id, *stream_type))
            .collect()
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

    fn list_settings(&self, user_id: &str) -> ListSettings {
        self.user(user_id, |user| user.settings)
    }

    async fn types_access(
        &self,
        user_id: &str,
        org_id: &str,
        shape: &StreamShape<'_>,
        types: &[StreamType],
    ) -> Result<HashMap<StreamType, TypeAccessKind>, AuthzUnavailable> {
        self.count(user_id, |calls| {
            calls.types_access += 1;
            if shape.identity == list::Identity::StoredEmail {
                calls.stored_email_types += 1;
            }
        });
        let every = |kind: TypeAccessKind| types.iter().map(|t| (*t, kind.clone())).collect();
        if let Some(allowed) = self.role_branch(org_id, user_id) {
            self.count(user_id, |calls| calls.role_checks += 1);
            let failure = self.failure(user_id, |_| None);
            fake_record(failure.is_some());
            return match failure {
                Some(reason) if self.offline(org_id, user_id, reason) => {
                    Ok(every(TypeAccessKind::Role(true)))
                }
                Some(reason) => Err(reason.into()),
                None => Ok(every(TypeAccessKind::Role(allowed))),
            };
        }
        self.count(user_id, |calls| calls.probe_c += 1);
        if let Some(reason) = self.failure(user_id, |f| f.probe.take()) {
            fake_record(true);
            if self.offline(org_id, user_id, reason) {
                return Ok(every(TypeAccessKind::Unlisted(UnlistedKind::OfflineRule)));
            }
            return Err(reason.into());
        }
        fake_record(false);
        if self.reads_every_stream(user_id, org_id) {
            return Ok(every(TypeAccessKind::All));
        }
        let mut access = HashMap::new();
        let mut open = Vec::new();
        for stream_type in types {
            if shape.self_parent_edge {
                self.count(user_id, |calls| calls.probe_b += 2);
                fake_record(false);
                fake_record(false);
                if self.reads_all(user_id, org_id, *stream_type) {
                    access.insert(*stream_type, TypeAccessKind::All);
                    continue;
                }
            }
            open.push(*stream_type);
        }
        let policy = self.user(user_id, |user| user.policy);
        for stream_type in open {
            let kind = if policy == ListPolicy::Disabled {
                TypeAccessKind::Unlisted(UnlistedKind::Disabled)
            } else {
                self.list_type(user_id, org_id, stream_type)?
            };
            access.insert(stream_type, kind);
        }
        Ok(access)
    }

    async fn check_object(
        &self,
        user_id: &str,
        org_id: &str,
        query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        self.count(user_id, |calls| {
            calls.object_checks += 1;
            calls.object_check_args.push(ObjectCheckArgs {
                permission: query.permission.to_string(),
                use_all_org: query.use_all_org,
                parent_id: query.parent_id.to_string(),
                use_self_context: query.use_self_context,
                use_self_parent: query.use_self_parent,
                identity: query.identity,
            });
        });
        self.enter_check(user_id).await;
        if let Some(reason) = self.failure(user_id, |f| f.object_check.take()) {
            fake_record(true);
            if self.offline(org_id, user_id, reason) {
                return Ok(true);
            }
            return Err(reason.into());
        }
        fake_record(false);
        if let Some(allowed) = self.role_branch(org_id, user_id) {
            return Ok(allowed);
        }
        let id = object.ofga_id.as_ref();
        let refused = id.len() > FAKE_MAX_ID_LEN
            || id
                .chars()
                .any(|c| c.is_ascii_whitespace() || c.is_control() || matches!(c, '#' | ':'));
        if refused {
            return Ok(false);
        }
        let key = format!("{org_id}/{}/{}", object.stream_type, object.id);
        Ok(self.granted(user_id, key)
            || (query.use_self_parent && self.reads_all(user_id, org_id, object.stream_type))
            || self.reads_every_stream(user_id, org_id))
    }

    async fn org_wide_check(
        &self,
        user_id: &str,
        org_id: &str,
        check: &OrgWideCheck<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        self.count(user_id, |calls| calls.org_wide_checks += 1);
        if let Some(reason) = self.failure(user_id, |f| f.org_wide_check.take()) {
            fake_record(true);
            if self.offline(org_id, user_id, reason) {
                return Ok(true);
            }
            return Err(reason.into());
        }
        fake_record(false);
        let key = (
            user_id.to_string(),
            org_id.to_string(),
            check.resource.to_string(),
        );
        Ok(self
            .org_wide_checks
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&key))
    }
}

/// What one user asked a [`FakeStreamChecker`], so a test can count the Checks a path costs.
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckCalls {
    pub streams: usize,
    pub org_wide: Vec<Vec<StreamType>>,
    pub types_access: usize,
    pub stored_email_types: usize,
    pub role_checks: usize,
    pub probe_c: usize,
    pub probe_b: usize,
    pub lists: usize,
    pub object_checks: usize,
    pub object_check_args: Vec<ObjectCheckArgs>,
    pub org_wide_checks: usize,
    pub max_in_flight: usize,
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
impl CheckCalls {
    /// OpenFGA calls of the type-level path.
    pub fn total(&self) -> usize {
        self.role_checks
            + self.probe_c
            + self.probe_b
            + self.lists
            + self.object_checks
            + self.org_wide_checks
    }
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObjectCheckArgs {
    pub permission: String,
    pub use_all_org: bool,
    pub parent_id: String,
    pub use_self_context: bool,
    pub use_self_parent: bool,
    pub identity: list::Identity,
}

/// One fake user's settings and pending failures.
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
struct FakeUser {
    settings: ListSettings,
    policy: ListPolicy,
    offline_roles: Vec<String>,
    failures: FakeFailures,
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
impl Default for FakeUser {
    fn default() -> Self {
        Self {
            settings: ListSettings::default(),
            policy: ListPolicy::Enabled,
            offline_roles: ["admin", "editor", "root"].map(String::from).to_vec(),
            failures: FakeFailures::default(),
        }
    }
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[derive(Default)]
struct FakeFailures {
    probe: Option<UnavailableReason>,
    list: Option<UnavailableReason>,
    incomplete: Option<StreamType>,
    org_wide_check: Option<UnavailableReason>,
    object_check: Option<UnavailableReason>,
    every_call: Option<UnavailableReason>,
    stream_read: Option<String>,
    list_extra: Option<(StreamType, String)>,
}

#[cfg(feature = "enterprise")]
struct OpenFgaStreamChecker;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl StreamAccessChecker for OpenFgaStreamChecker {
    async fn enforces_rbac(&self) -> bool {
        rbac_enforced().await
    }

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
        // the stored email, as `auth::check_permissions` uses, in case the header differs in case
        check_permissions(
            &user.email,
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
                feature: None,
            },
            user.role,
            user.is_external,
        )
        .await
    }

    async fn org_wide_readable(
        &self,
        user_id: &str,
        org_id: &str,
        wanted: &[StreamType],
    ) -> HashSet<StreamType> {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        // a non-member of the org reads no stream there, as `can_read_stream` answers
        let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
            return HashSet::new();
        };
        if !o2_openfga::config::get_config().enabled || user.role == UserRole::Root {
            return wanted.iter().copied().collect();
        }
        let role = effective_role(org_id, user_id, user.role.to_string());
        let models: Vec<&str> = wanted
            .iter()
            .map(|stream_type| {
                let type_str = stream_type.as_str();
                OFGA_MODELS
                    .get(type_str)
                    .map_or(type_str, |model| model.key)
            })
            .collect();
        let readable = o2_openfga::authorizer::authz::org_wide_readable_types(
            org_id,
            &user.email,
            &role,
            &models,
        )
        .await;
        wanted
            .iter()
            .zip(models)
            .filter(|(_, model)| readable.contains(*model))
            .map(|(stream_type, _)| *stream_type)
            .collect()
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

    fn list_settings(&self, _user_id: &str) -> ListSettings {
        use o2_openfga::config::ListAuthzMode;

        let cfg = o2_openfga::config::get_config();
        let mode = match cfg.list_authz_mode() {
            ListAuthzMode::Off => list::ListMode::Off,
            ListAuthzMode::Shadow => list::ListMode::Shadow,
            ListAuthzMode::On => list::ListMode::On,
        };
        ListSettings {
            mode,
            shadow_sample: cfg.list_authz_shadow_sample,
            fallback_concurrency: cfg.list_fallback_concurrency,
        }
    }

    async fn types_access(
        &self,
        user_id: &str,
        org_id: &str,
        shape: &StreamShape<'_>,
        types: &[StreamType],
    ) -> Result<HashMap<StreamType, TypeAccessKind>, AuthzUnavailable> {
        use o2_openfga::authorizer::list::{ListPolicy, TypeAccess, TypesQuery, types_access};

        let every = |kind: TypeAccessKind| types.iter().map(|t| (*t, kind.clone())).collect();
        let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
            // Missing membership denies without OpenFGA, so it cannot count as a list.
            return Ok(every(TypeAccessKind::Role(false)));
        };
        if !o2_openfga::config::get_config().enabled || user.role == UserRole::Root {
            return Ok(every(TypeAccessKind::All));
        }
        let sent = sent_user_id(shape.identity, user_id, &user.email);
        let role = effective_role(org_id, sent, user.role.to_string());
        let models: Vec<&str> = types.iter().map(|t| stream_model(*t)).collect();
        let query = TypesQuery {
            org: org_id,
            user_id: sent,
            role: &role,
            obj_types: &models,
            permission: shape.permission,
            self_parent_edge: shape.self_parent_edge,
        };
        let (access, role_check_sent) =
            accounting::track_role_check(types_access(&query, ListPolicy::configured())).await;
        let mut access = access?;
        let mut answers = HashMap::with_capacity(types.len());
        // One Role call answers all listable types because stream models share role eligibility.
        for (stream_type, model) in types.iter().zip(models) {
            let kind = match access.remove(model) {
                Some(TypeAccess::All) if role_check_sent => TypeAccessKind::Role(true),
                Some(TypeAccess::Listed(ids)) if role_check_sent && ids.is_empty() => {
                    TypeAccessKind::Role(false)
                }
                Some(kind) => kind.into(),
                None => TypeAccessKind::Unlisted(UnlistedKind::Disabled),
            };
            answers.insert(*stream_type, kind);
        }
        Ok(answers)
    }

    async fn check_object(
        &self,
        user_id: &str,
        org_id: &str,
        query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
            return Ok(false);
        };
        let sent = sent_user_id(query.identity, user_id, &user.email);
        let object_id = format!("{}:{}", stream_model(object.stream_type), object.ofga_id);
        let check = SentCheck {
            org_id,
            user_id: sent,
            permission: query.permission,
            object: &object_id,
            parent_id: query.parent_id,
            use_all_org: query.use_all_org,
            use_self_context: query.use_self_context,
            use_self_parent: query.use_self_parent,
        };
        check.send(&user).await
    }

    async fn org_wide_check(
        &self,
        user_id: &str,
        org_id: &str,
        check: &OrgWideCheck<'_>,
    ) -> Result<bool, AuthzUnavailable> {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        if is_root_user(user_id) {
            return Ok(true);
        }
        let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
            return Ok(false);
        };
        let model = OFGA_MODELS
            .get(check.resource)
            .map_or(check.resource, |model| model.key);
        let object_id = format!("{model}:{org_id}");
        let sent = SentCheck {
            org_id,
            user_id: &user.email,
            permission: check.permission,
            object: &object_id,
            parent_id: "",
            use_all_org: check.use_all_org,
            use_self_context: check.use_self_context,
            use_self_parent: check.use_self_parent,
        };
        sent.send(&user).await
    }
}

/// One Check as `check_permissions` sends it, but with the request timeout and a typed error.
#[cfg(feature = "enterprise")]
struct SentCheck<'a> {
    org_id: &'a str,
    user_id: &'a str,
    permission: &'a str,
    object: &'a str,
    parent_id: &'a str,
    use_all_org: bool,
    use_self_context: bool,
    use_self_parent: bool,
}

#[cfg(feature = "enterprise")]
impl SentCheck<'_> {
    async fn send(&self, user: &config::meta::user::User) -> Result<bool, AuthzUnavailable> {
        use o2_openfga::authorizer::decision::{CheckArgs, check_decision, offline_check_allows};

        let cfg = o2_openfga::config::get_config();
        if !cfg.enabled || user.role == UserRole::Root {
            return Ok(true);
        }
        let role = effective_role(self.org_id, self.user_id, user.role.to_string());
        let args = CheckArgs {
            org: self.org_id,
            user_id: self.user_id,
            permission: self.permission,
            object: self.object,
            parent_id: self.parent_id,
            role: &role,
            use_all_org: self.use_all_org,
            use_self_context: self.use_self_context,
            use_self_parent: self.use_self_parent,
        };
        match check_decision(&args, Some(cfg.request_timeout())).await {
            Ok(allowed) => Ok(allowed),
            Err(err) if offline_check_allows(&args, err) => Ok(true),
            Err(err) => Err(err.into()),
        }
    }
}

/// One request's stream reads for one user and org, so a stream named on many rows is checked once.
#[cfg(feature = "enterprise")]
#[derive(Default)]
pub struct StreamReadMemo {
    unrestricted: tokio::sync::OnceCell<bool>,
    org_wide: SharedAnswers<StreamType, StreamReadAnswer>,
    streams: SharedAnswers<(StreamType, String), StreamReadAnswer>,
}

#[cfg(feature = "enterprise")]
impl StreamReadMemo {
    /// Shares checks across evidence rows using the rules of [`list::legacy_readable_streams`].
    pub async fn can_read(
        &self,
        checker: &dyn StreamAccessChecker,
        user_id: &str,
        org_id: &str,
        stream_type: StreamType,
        name: &str,
    ) -> bool {
        self.read(checker, user_id, org_id, stream_type, name)
            .await
            .allowed
    }

    pub(crate) async fn read(
        &self,
        checker: &dyn StreamAccessChecker,
        user_id: &str,
        org_id: &str,
        stream_type: StreamType,
        name: &str,
    ) -> StreamReadAnswer {
        let unrestricted = *self
            .unrestricted
            .get_or_init(|| async {
                !checker.enforces_rbac().await
                    || checker.is_root(user_id).await
                    || checker.is_root_or_admin(org_id, user_id).await
            })
            .await;
        if unrestricted {
            return StreamReadAnswer {
                allowed: true,
                had_error: false,
            };
        }
        let shortcut = org_wide_shortcut_covers(stream_type, name);
        let (cell, first_of_type) = {
            let mut cells = self.streams.lock().unwrap_or_else(|e| e.into_inner());
            let first = !cells
                .keys()
                .any(|(t, n)| *t == stream_type && org_wide_shortcut_covers(*t, n));
            let cell = cells.entry((stream_type, name.to_string())).or_default();
            (cell.clone(), first)
        };
        // A lone stream's own Check already counts the org-wide grants.
        *cell
            .get_or_init(|| async {
                let wide = if !first_of_type && shortcut {
                    self.org_wide(checker, user_id, org_id, stream_type).await
                } else {
                    StreamReadAnswer::default()
                };
                if wide.allowed {
                    return wide;
                }
                let mut answer = StreamReadAnswer::counted(checker.can_read_stream(
                    user_id,
                    &TypedStream {
                        org_id: org_id.to_string(),
                        stream_type,
                        name: name.to_string(),
                    },
                ))
                .await;
                answer.had_error |= wide.had_error;
                answer
            })
            .await
    }

    async fn org_wide(
        &self,
        checker: &dyn StreamAccessChecker,
        user_id: &str,
        org_id: &str,
        stream_type: StreamType,
    ) -> StreamReadAnswer {
        let cell = shared_cell(&self.org_wide, stream_type);
        *cell
            .get_or_init(|| {
                StreamReadAnswer::counted(async {
                    checker
                        .org_wide_readable(user_id, org_id, &[stream_type])
                        .await
                        .contains(&stream_type)
                })
            })
            .await
    }
}

#[cfg(feature = "enterprise")]
#[derive(Clone, Copy, Default)]
pub(crate) struct StreamReadAnswer {
    pub(crate) allowed: bool,
    pub(crate) had_error: bool,
}

#[cfg(feature = "enterprise")]
impl StreamReadAnswer {
    async fn counted(fut: impl Future<Output = bool>) -> Self {
        let (allowed, errors) = if accounting::REQUEST_CALLS.try_with(|_| ()).is_ok() {
            accounting::in_own_scope(fut).await
        } else {
            (fut.await, 0)
        };
        Self {
            allowed,
            had_error: errors > 0,
        }
    }
}

/// One answer per key, shared by every reader of that key while it is still in flight.
#[cfg(any(feature = "enterprise", test))]
type SharedAnswers<K, V> = std::sync::Mutex<HashMap<K, Arc<tokio::sync::OnceCell<V>>>>;

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
            feature: None,
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
    log::info!("keys used : {keys_used:?}");
    Ok(denied_named_cipher_keys(org_id, user_id, &keys_used).await)
}

/// The named cipher keys `user_id` may not read; a user that cannot be loaded may read none.
#[cfg(feature = "enterprise")]
pub async fn denied_named_cipher_keys(org_id: &str, user_id: &str, keys: &[String]) -> Vec<String> {
    if keys.is_empty() || is_root_user(user_id) {
        return Vec::new();
    }
    let Some(user) = crate::users::get_user(Some(org_id), user_id).await else {
        return keys.to_vec();
    };
    let mut denied = Vec::new();
    for key in keys {
        if !cipher_key_allowed(org_id, user_id, &user, key).await {
            denied.push(key.clone());
        }
    }
    denied
}

#[cfg(feature = "enterprise")]
pub async fn check_permissions(
    user_id: &str,
    auth_info: AuthExtractor,
    role: UserRole,
    _is_external: bool,
) -> bool {
    if !o2_openfga::config::get_config().enabled {
        return true;
    }

    let object_str = auth_info.o2_type;
    log::debug!("Role of user {user_id} is {role:#?}");
    let role = if role == UserRole::Root {
        return true;
    } else {
        role.to_string()
    };
    // an unmapped route carries no object; deny without asking OpenFGA, which would log an error
    if object_str.is_empty() {
        log::warn!(
            "permission denied for {user_id}: {} route has no permission mapping",
            auth_info.method
        );
        return false;
    }

    let org_id = &auth_info.org_id;
    let effective_role = effective_role(org_id, user_id, role);

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

/// Off RBAC allows every read, as [`check_permissions`] answers.
#[cfg(feature = "enterprise")]
pub async fn rbac_enforced() -> bool {
    o2_openfga::config::get_config().enabled
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
            QuerySource::Unparseable {
                org_id,
                source,
                error,
            } => {
                resolved.push_unparseable(org_id, source, error, false);
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
        .chain(resolved.dashboards.iter().map(|(org, ..)| org))
        .chain(
            resolved
                .unparseable
                .iter()
                .filter_map(|denial| match denial {
                    Denial::Unparseable { org_id, .. } => Some(org_id),
                    _ => None,
                }),
        );
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

    if !checker.enforces_rbac().await || checker.is_root(user_id).await {
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
    denials.extend(
        resolved
            .unparseable
            .into_iter()
            .filter(|denial| match denial {
                Denial::Unparseable {
                    org_id, from_vrl, ..
                } => *from_vrl || !admin_orgs.contains(org_id.as_str()),
                _ => true,
            }),
    );
    if denials.is_empty() {
        Ok(())
    } else {
        Err(StreamAccessDenied { denials })
    }
}

/// Keeps, in order, the streams of `org_id` the user can read.
#[cfg(any(feature = "enterprise", test))]
pub async fn readable_related_streams(
    checker: &dyn StreamAccessChecker,
    site: list::Site,
    user_id: &str,
    org_id: &str,
    streams: RelatedStreams,
) -> Result<RelatedStreams, AuthzUnavailable> {
    let wanted = related_stream_set(&streams);
    let readable = readable_streams(checker, site, user_id, org_id, wanted).await?;
    Ok(keep_related_streams(streams, readable))
}

/// The `origin/main` [`readable_related_streams`]: an errored check denies. [no-fail]
#[cfg(any(feature = "enterprise", test))]
pub async fn legacy_readable_related_streams(
    checker: &dyn StreamAccessChecker,
    user_id: &str,
    org_id: &str,
    streams: RelatedStreams,
) -> RelatedStreams {
    let wanted = related_stream_set(&streams);
    let readable = list::legacy_readable_streams(checker, user_id, org_id, wanted).await;
    keep_related_streams(streams, readable)
}

/// Keeps the services with a stream the user can read, each listing only those streams.
#[cfg(any(feature = "enterprise", test))]
pub async fn readable_service_records(
    checker: &dyn StreamAccessChecker,
    site: list::Site,
    user_id: &str,
    org_id: &str,
    mut records: Vec<ServiceRecord>,
) -> Result<Vec<ServiceRecord>, AuthzUnavailable> {
    let wanted = service_record_set(&mut records);
    let readable = readable_streams(checker, site, user_id, org_id, wanted).await?;
    Ok(keep_service_records(records, readable))
}

/// The `origin/main` [`readable_service_records`]: an errored check denies. [no-fail]
#[cfg(any(feature = "enterprise", test))]
pub async fn legacy_readable_service_records(
    checker: &dyn StreamAccessChecker,
    user_id: &str,
    org_id: &str,
    mut records: Vec<ServiceRecord>,
) -> Vec<ServiceRecord> {
    let wanted = service_record_set(&mut records);
    let readable = list::legacy_readable_streams(checker, user_id, org_id, wanted).await;
    keep_service_records(records, readable)
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

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
pub async fn within_budget<F: Future>(budget: u32, fut: F) -> F::Output {
    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    {
        accounting::with_budget(budget, fut).await
    }
    #[cfg(not(all(feature = "enterprise", feature = "test-utils")))]
    {
        let _ = budget;
        fut.await
    }
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
            Denial::Unparseable { source, error, .. } => {
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

/// [`list::legacy_readable_streams`] with the live checker, for callers outside this crate.
#[cfg(feature = "enterprise")]
pub async fn readable_org_streams(
    user_id: &str,
    org_id: &str,
    streams: HashSet<(StreamType, String)>,
) -> Option<HashSet<(StreamType, String)>> {
    let checker = active_checker();
    list::legacy_readable_streams(checker.as_ref(), user_id, org_id, streams).await
}

/// One Check per stream, 16 at a time; the streams that pass.
#[cfg(any(feature = "enterprise", test))]
pub(crate) async fn check_each(
    checker: &dyn StreamAccessChecker,
    user_id: &str,
    org_id: &str,
    streams: Vec<(StreamType, String)>,
) -> HashSet<(StreamType, String)> {
    use futures::stream::StreamExt;

    futures::stream::iter(streams)
        .map(|(stream_type, name)| async move {
            let stream = TypedStream {
                org_id: org_id.to_string(),
                stream_type,
                name,
            };
            let allowed = checker.can_read_stream(user_id, &stream).await;
            allowed.then_some((stream.stream_type, stream.name))
        })
        .buffer_unordered(16)
        .filter_map(std::future::ready)
        .collect()
        .await
}

#[cfg(feature = "enterprise")]
fn sent_user_id<'a>(identity: list::Identity, user_id: &'a str, stored_email: &'a str) -> &'a str {
    match identity {
        list::Identity::GivenId => user_id,
        list::Identity::StoredEmail => stored_email,
    }
}

/// In `_meta` the cached membership names the role, whatever role the request carries.
#[cfg(feature = "enterprise")]
fn effective_role(org_id: &str, user_id: &str, role: String) -> String {
    use common::infra::config::ORG_USERS;

    if org_id != config::META_ORG_ID {
        return role;
    }
    match ORG_USERS.get(&format!("{}/{user_id}", config::META_ORG_ID)) {
        Some(user) => user.role.to_string(),
        None => role,
    }
}

/// The OpenFGA type key of a stream type.
#[cfg(feature = "enterprise")]
fn stream_model(stream_type: StreamType) -> &'static str {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let type_str = stream_type.as_str();
    OFGA_MODELS
        .get(type_str)
        .map_or(type_str, |model| model.key)
}

/// The one cell of `key`, so concurrent readers of a key wait on a single Check.
#[cfg(any(feature = "enterprise", test))]
fn shared_cell<K: Eq + std::hash::Hash, V>(
    cells: &SharedAnswers<K, V>,
    key: K,
) -> Arc<tokio::sync::OnceCell<V>> {
    let mut cells = cells.lock().unwrap_or_else(|e| e.into_inner());
    cells.entry(key).or_default().clone()
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
            feature: None,
        },
        user.role.clone(),
        user.is_external,
    )
    .await
}

#[cfg(any(feature = "enterprise", test))]
fn related_stream_set(streams: &RelatedStreams) -> HashSet<(StreamType, String)> {
    [
        (StreamType::Logs, &streams.logs),
        (StreamType::Traces, &streams.traces),
        (StreamType::Metrics, &streams.metrics),
        (StreamType::Profiles, &streams.profiles),
    ]
    .into_iter()
    .flat_map(|(stream_type, list)| {
        list.iter()
            .map(move |info| (stream_type, info.stream_name.clone()))
    })
    .collect()
}

#[cfg(any(feature = "enterprise", test))]
fn keep_related_streams(
    streams: RelatedStreams,
    readable: Option<HashSet<(StreamType, String)>>,
) -> RelatedStreams {
    let Some(readable) = readable else {
        return streams;
    };
    let keep = |stream_type: StreamType, list: Vec<StreamInfo>| -> Vec<StreamInfo> {
        list.into_iter()
            .filter(|info| readable.contains(&(stream_type, info.stream_name.clone())))
            .collect()
    };
    let RelatedStreams {
        logs,
        traces,
        metrics,
        profiles,
    } = streams;
    RelatedStreams {
        logs: keep(StreamType::Logs, logs),
        traces: keep(StreamType::Traces, traces),
        metrics: keep(StreamType::Metrics, metrics),
        profiles: keep(StreamType::Profiles, profiles),
    }
}

#[cfg(any(feature = "enterprise", test))]
fn service_record_set(records: &mut [ServiceRecord]) -> HashSet<(StreamType, String)> {
    let mut wanted = HashSet::new();
    for record in records {
        for (stream_type, list) in service_record_streams(record) {
            let names = list.as_array().into_iter().flatten();
            wanted.extend(names.filter_map(|v| v.as_str().map(|n| (stream_type, n.to_string()))));
        }
    }
    wanted
}

#[cfg(any(feature = "enterprise", test))]
fn keep_service_records(
    records: Vec<ServiceRecord>,
    readable: Option<HashSet<(StreamType, String)>>,
) -> Vec<ServiceRecord> {
    let Some(readable) = readable else {
        return records;
    };
    records
        .into_iter()
        .filter_map(|mut record| {
            let mut any_left = false;
            for (stream_type, list) in service_record_streams(&mut record) {
                let Some(items) = list.as_array_mut() else {
                    continue;
                };
                items.retain(|v| {
                    v.as_str()
                        .is_some_and(|n| readable.contains(&(stream_type, n.to_string())))
                });
                any_left |= !items.is_empty();
            }
            any_left.then_some(record)
        })
        .collect()
}

/// True when an org-wide grant decides the stream; `stream:_all_` never reaches enrichment tables.
#[cfg(any(feature = "enterprise", test))]
fn org_wide_shortcut_covers(stream_type: StreamType, name: &str) -> bool {
    matches!(
        stream_type,
        StreamType::Logs
            | StreamType::Metrics
            | StreamType::Traces
            | StreamType::Profiles
            | StreamType::Index
            | StreamType::Metadata
    ) && list::org_wide_grant_covers(name)
}

#[cfg(any(feature = "enterprise", test))]
fn service_record_streams(record: &mut ServiceRecord) -> [(StreamType, &mut serde_json::Value); 4] {
    [
        (StreamType::Logs, &mut record.logs_streams),
        (StreamType::Traces, &mut record.traces_streams),
        (StreamType::Metrics, &mut record.metrics_streams),
        (StreamType::Profiles, &mut record.profiles_streams),
    ]
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_sql(resolved: &mut ResolvedSources, org_id: &str, sql: &str, default_type: StreamType) {
    use config::meta::sql::TableReferenceExt;

    let tables = match resolve_sql_tables(sql) {
        Ok(tables) => tables,
        Err(e) => {
            resolved.push_unparseable(org_id, sql, e, false);
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
        Err(e) => resolved.push_unparseable(org_id, sql, e, false),
    }
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_promql(resolved: &mut ResolvedSources, org_id: &str, query: &str) {
    use promql::ast::{name_visitor::MetricNameVisitor, visitor::walk_expr};

    // the engine's parser registers holt_winters; the raw retry still names refused queries
    let parsed = promql::parse(query).or_else(|_| promql_parser::parser::parse(query));
    let ast = match parsed {
        Ok(ast) => ast,
        Err(e) => {
            resolved.push_unparseable(org_id, query, e, false);
            return;
        }
    };
    let mut visitor = MetricNameVisitor::new();
    if let Err(e) = walk_expr(&mut visitor, &ast) {
        resolved.push_unparseable(org_id, query, e, false);
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
        Err(e) => resolved.push_unparseable(org_id, source, e, true),
    }
}

fn search_rewritten_sql(sql: &str) -> String {
    config::utils::query_select_utils::replace_o2_custom_patterns(sql)
        .unwrap_or_else(|_| sql.to_string())
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
fn write_set<T>(set: &RwLock<HashSet<T>>) -> std::sync::RwLockWriteGuard<'_, HashSet<T>> {
    set.write().unwrap_or_else(|e| e.into_inner())
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
fn write_map<K, V>(map: &RwLock<HashMap<K, V>>) -> std::sync::RwLockWriteGuard<'_, HashMap<K, V>> {
    map.write().unwrap_or_else(|e| e.into_inner())
}

/// Counts one fake call in the request's `REQUEST_CALLS`, as ENT counts a sent one.
#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
fn fake_record(failed: bool) {
    #[cfg(feature = "enterprise")]
    accounting::record_call(if failed {
        accounting::CallOutcome::Error
    } else {
        accounting::CallOutcome::Allow
    });
    #[cfg(not(feature = "enterprise"))]
    let _ = failed;
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

    use super::{list::MAX_COVERED_ID_LEN, *};

    const SITE: list::Site = "authz_tests";

    #[derive(Default)]
    struct FakeChecker {
        rbac_off: bool,
        roots: HashSet<String>,
        admins: HashSet<(String, String)>,
        readable: HashSet<(String, String)>,
        stream_checks: std::sync::atomic::AtomicUsize,
        org_wide: HashSet<(String, String, StreamType)>,
        org_wide_fails: bool,
        org_wide_asked: std::sync::Mutex<Vec<Vec<StreamType>>>,
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

        fn reads_all(mut self, user: &str, org: &str, stream_type: StreamType) -> Self {
            self.org_wide
                .insert((user.to_string(), org.to_string(), stream_type));
            self
        }

        fn stream_checks(&self) -> usize {
            self.stream_checks
                .load(std::sync::atomic::Ordering::Relaxed)
        }

        fn org_wide_asked(&self) -> Vec<Vec<StreamType>> {
            self.org_wide_asked.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl StreamAccessChecker for FakeChecker {
        async fn enforces_rbac(&self) -> bool {
            !self.rbac_off
        }

        async fn is_root(&self, user_id: &str) -> bool {
            self.roots.contains(user_id)
        }

        async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
            self.admins
                .contains(&(user_id.to_string(), org_id.to_string()))
        }

        async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
            self.stream_checks
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
            self.readable.contains(&(user_id.to_string(), key))
        }

        async fn org_wide_readable(
            &self,
            user_id: &str,
            org_id: &str,
            wanted: &[StreamType],
        ) -> HashSet<StreamType> {
            self.org_wide_asked.lock().unwrap().push(wanted.to_vec());
            if self.org_wide_fails {
                return HashSet::new();
            }
            wanted
                .iter()
                .copied()
                .filter(|stream_type| {
                    let key = (user_id.to_string(), org_id.to_string(), *stream_type);
                    self.org_wide.contains(&key)
                })
                .collect()
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

    type ServiceView = Vec<(String, Vec<serde_json::Value>)>;

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
    async fn unparseable_source_passes_only_an_admin_of_its_own_org() {
        let sources = [
            sql("o1", "not sql at all"),
            QuerySource::Unparseable {
                org_id: "o1".to_string(),
                source: "$s".to_string(),
                error: "unresolved variable s in stream position".to_string(),
            },
        ];
        let admin = FakeChecker::default().admin("u1", "o1");
        assert!(authorize_with(&admin, "u1", &sources).await.is_ok());

        let other_org_admin = FakeChecker::default().admin("u1", "o2");
        let denied = authorize_with(&other_org_admin, "u1", &sources)
            .await
            .unwrap_err();
        assert!(matches!(
            denied.denials.as_slice(),
            [Denial::Unparseable { .. }, Denial::Unparseable { .. }]
        ));

        let member = FakeChecker::default().reads("u1", "o1/logs/app");
        assert_eq!(
            authorize_with(&member, "u1", &sources)
                .await
                .unwrap_err()
                .denials
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn uncompilable_vrl_is_refused_even_for_an_admin_of_its_own_org() {
        let sources = [QuerySource::Vrl {
            org_id: "o1".to_string(),
            source: ".x = get_enrichment_table_record(".to_string(),
        }];
        let admin = FakeChecker::default().admin("u1", "o1");
        let denied = authorize_with(&admin, "u1", &sources).await.unwrap_err();
        assert!(matches!(
            denied.denials.as_slice(),
            [Denial::Unparseable { from_vrl: true, .. }]
        ));

        let rbac_off = FakeChecker {
            rbac_off: true,
            ..FakeChecker::default().admin("u1", "o1")
        };
        assert!(authorize_with(&rbac_off, "u1", &sources).await.is_ok());
    }

    #[tokio::test]
    async fn rbac_off_allows_what_rbac_on_denies() {
        let sources = [
            stream("o1", StreamType::Logs, "secret"),
            stream("o2", StreamType::EnrichmentTables, "foreign_table"),
            sql("o1", "SELECT decrypt(body, 'vault_key') FROM app"),
            sql("o1", "not sql at all"),
            QuerySource::Dashboard {
                org_id: "o1".to_string(),
                folder: "f1".to_string(),
                dashboard_id: "d1".to_string(),
            },
        ];
        let rbac_on = FakeChecker::default();
        assert!(
            authorize_with(&rbac_on, "non_member", &sources)
                .await
                .is_err()
        );

        let rbac_off = FakeChecker {
            rbac_off: true,
            ..FakeChecker::default()
        };
        assert!(
            authorize_with(&rbac_off, "non_member", &sources)
                .await
                .is_ok()
        );
    }

    #[test]
    fn holt_winters_resolves_without_an_earlier_engine_parse() {
        const CHILD: &str = "O2_AUTHZ_FRESH_PARSE_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "authz::tests::holt_winters_resolves_without_an_earlier_engine_parse",
                    "--exact",
                    "--test-threads=1",
                ])
                .env(CHILD, "1")
                .status()
                .unwrap();
            assert!(status.success(), "fresh-process run failed: {status}");
            return;
        }
        let resolved = resolve_query_sources(&[promql("o1", "holt_winters(cpu[5m], 0.5, 0.3)")]);
        assert!(resolved.unparseable.is_empty(), "{resolved:?}");
        assert_eq!(names(&resolved), vec!["metrics/cpu"]);
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
                    org_id: "o1".to_string(),
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
        ] {
            assert!(!text.contains(needle), "{file} uses the untyped resolver");
        }
    }

    #[test]
    fn rbac_is_never_lifted_by_a_report_failure() {
        let source = include_str!("authz.rs");
        let code = source
            .split(concat!("#[cfg(test)]\nmod ", "tests {"))
            .next()
            .unwrap();
        for needle in [
            concat!("block_feature", "_for_report_failure"),
            concat!("report_failure", "_lifts_rbac"),
        ] {
            assert!(!code.contains(needle), "authz.rs calls {needle}");
        }
    }

    // o2-enterprise#3642: DB monitoring's `?stream=` reads `{type}:_all_` through selfParent.
    #[test]
    fn the_live_stream_check_counts_per_type_all_grants() {
        let source = include_str!("authz.rs");
        let start = source
            .find(concat!(
                "impl StreamAccessChecker for ",
                "OpenFgaStreamChecker"
            ))
            .unwrap();
        let body = &source[start..];
        let check = &body[body.find("async fn can_read_stream(").unwrap()..];
        let check = &check[..check.find("async fn org_wide_readable(").unwrap()];
        assert!(check.contains("use_self_parent: true"));
        assert!(check.contains("use_self_context: false"));
        assert!(
            check.contains("&user.email,"),
            "OpenFGA must get the stored email"
        );
    }

    fn related(logs: &[&str], traces: &[&str], metrics: &[&str]) -> RelatedStreams {
        let infos = |names: &[&str]| -> Vec<StreamInfo> {
            names
                .iter()
                .map(|n| StreamInfo::new(n.to_string()))
                .collect()
        };
        RelatedStreams {
            logs: infos(logs),
            traces: infos(traces),
            metrics: infos(metrics),
            profiles: infos(&["profile_a"]),
        }
    }

    fn related_names(streams: &RelatedStreams) -> [Vec<&str>; 4] {
        fn names(list: &[StreamInfo]) -> Vec<&str> {
            list.iter().map(|s| s.stream_name.as_str()).collect()
        }
        [
            names(&streams.logs),
            names(&streams.traces),
            names(&streams.metrics),
            names(&streams.profiles),
        ]
    }

    #[tokio::test]
    async fn related_streams_keep_only_what_the_user_reads_by_list_type() {
        let all = || related(&["prod_data", "prod_data_uk"], &["prod_data_uk"], &["cpu"]);
        let mut root = FakeChecker::default();
        root.roots.insert("u1".to_string());
        let rbac_off = FakeChecker {
            rbac_off: true,
            ..FakeChecker::default()
        };
        let cases: [(&str, FakeChecker, [Vec<&str>; 4]); 6] = [
            (
                "mixed access",
                FakeChecker::default()
                    .reads("u1", "o1/logs/prod_data_uk")
                    .reads("u1", "o1/logs/cpu")
                    .reads("u1", "o2/traces/prod_data_uk"),
                [vec!["prod_data_uk"], vec![], vec![], vec![]],
            ),
            (
                "no access",
                FakeChecker::default(),
                [vec![], vec![], vec![], vec![]],
            ),
            (
                "rbac off",
                rbac_off,
                [
                    vec!["prod_data", "prod_data_uk"],
                    vec!["prod_data_uk"],
                    vec!["cpu"],
                    vec!["profile_a"],
                ],
            ),
            (
                "root",
                root,
                [
                    vec!["prod_data", "prod_data_uk"],
                    vec!["prod_data_uk"],
                    vec!["cpu"],
                    vec!["profile_a"],
                ],
            ),
            (
                "org admin",
                FakeChecker::default().admin("u1", "o1"),
                [
                    vec!["prod_data", "prod_data_uk"],
                    vec!["prod_data_uk"],
                    vec!["cpu"],
                    vec!["profile_a"],
                ],
            ),
            (
                "admin of another org",
                FakeChecker::default().admin("u1", "o2"),
                [vec![], vec![], vec![], vec![]],
            ),
        ];
        for (case, checker, expected) in cases {
            let kept = readable_related_streams(&checker, SITE, "u1", "o1", all())
                .await
                .unwrap();
            assert_eq!(related_names(&kept), expected, "{case}");
        }
    }

    #[tokio::test]
    async fn related_streams_keep_their_order_past_the_concurrency_limit() {
        let names: Vec<String> = (0..40).map(|i| format!("s{i:02}")).collect();
        let checker = names
            .iter()
            .enumerate()
            .filter(|(i, _)| i % 3 != 0)
            .fold(FakeChecker::default(), |c, (_, n)| {
                c.reads("u1", &format!("o1/logs/{n}"))
            });
        let streams = RelatedStreams {
            logs: names
                .iter()
                .rev()
                .map(|n| StreamInfo::new(n.clone()))
                .collect(),
            traces: vec![],
            metrics: vec![],
            profiles: vec![],
        };
        let kept = readable_related_streams(&checker, SITE, "u1", "o1", streams)
            .await
            .unwrap();
        let expected: Vec<&str> = names
            .iter()
            .enumerate()
            .rev()
            .filter(|(i, _)| i % 3 != 0)
            .map(|(_, n)| n.as_str())
            .collect();
        assert_eq!(related_names(&kept)[0], expected);
    }

    fn service(name: &str, logs: &[&str], traces: &[&str]) -> ServiceRecord {
        let mut record = ServiceRecord::new("o1", name, "default", serde_json::json!({}));
        record.logs_streams = serde_json::json!(logs);
        record.traces_streams = serde_json::json!(traces);
        record.metrics_streams = serde_json::json!(["cpu"]);
        record
    }

    fn service_names(records: &[ServiceRecord]) -> ServiceView {
        records
            .iter()
            .map(|r| {
                let streams = [&r.logs_streams, &r.traces_streams, &r.metrics_streams];
                let streams = streams.into_iter().cloned().collect();
                (r.service_name.clone(), streams)
            })
            .collect()
    }

    // o2-enterprise#3642: a stream on many rows costs one Check, a wide type one question.
    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn stream_read_memo_checks_each_stream_and_type_once() {
        let checker = FakeStreamChecker::default();
        let stream = |name: &str| TypedStream {
            org_id: "o1".to_string(),
            stream_type: StreamType::Traces,
            name: name.to_string(),
        };
        checker.grant_read("u1", &stream("a"));
        let memo = StreamReadMemo::default();
        for _ in 0..10 {
            assert!(
                memo.can_read(&checker, "u1", "o1", StreamType::Traces, "a")
                    .await
            );
            assert!(
                !memo
                    .can_read(&checker, "u1", "o1", StreamType::Traces, "b")
                    .await
            );
        }
        let calls = checker.calls("u1");
        assert_eq!(calls.streams, 2);
        assert_eq!(calls.org_wide, vec![vec![StreamType::Traces]]);

        checker.grant_read_all("u2", "o1", StreamType::Logs);
        let memo = StreamReadMemo::default();
        for name in ["x", "y", "z"] {
            assert!(
                memo.can_read(&checker, "u2", "o1", StreamType::Logs, name)
                    .await
            );
        }
        let calls = checker.calls("u2");
        assert_eq!(calls.streams, 1, "only the first stream of the type");
        assert_eq!(calls.org_wide.len(), 1);

        checker.grant_admin("o1", "u3");
        let memo = StreamReadMemo::default();
        assert!(
            memo.can_read(&checker, "u3", "o1", StreamType::Logs, "x")
                .await
        );
        assert_eq!(checker.calls("u3"), CheckCalls::default());
    }

    // Concurrent readers of one stream share the Check still in flight.
    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn stream_read_memo_shares_checks_in_flight() {
        let checker = FakeStreamChecker::default();
        let memo = StreamReadMemo::default();
        let reads = (0..16).map(|_| memo.can_read(&checker, "u1", "o1", StreamType::Logs, "a"));
        assert!(futures::future::join_all(reads).await.iter().all(|ok| !ok));
        let calls = checker.calls("u1");
        assert_eq!(calls.streams, 1);
        assert!(
            calls.org_wide.is_empty(),
            "a lone stream needs no org-wide question"
        );

        let reads = ["b", "c", "d"]
            .into_iter()
            .flat_map(|name| (0..4).map(move |_| name))
            .map(|name| memo.can_read(&checker, "u1", "o1", StreamType::Logs, name));
        futures::future::join_all(reads).await;
        let calls = checker.calls("u1");
        assert_eq!(calls.streams, 4);
        assert_eq!(calls.org_wide.len(), 1);
    }

    // A `stream:_all_` grant does not reach enrichment tables, so their own Check always decides.
    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn enrichment_tables_never_take_the_org_wide_shortcut() {
        let checker = FakeStreamChecker::default();
        let wanted: HashSet<(StreamType, String)> = ["t1", "t2", "t3"]
            .into_iter()
            .map(|name| (StreamType::EnrichmentTables, name.to_string()))
            .chain([
                (StreamType::Logs, "app".to_string()),
                (StreamType::Logs, "a b/c".repeat(200)),
            ])
            .collect();
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", wanted).await;
        assert_eq!(kept, Some(HashSet::new()));
        let calls = checker.calls("u1");
        assert!(calls.org_wide.is_empty(), "{:?}", calls.org_wide);
        assert_eq!(calls.streams, 5);

        let memo = StreamReadMemo::default();
        for name in ["t1", "t2"] {
            assert!(
                !memo
                    .can_read(&checker, "u2", "o1", StreamType::EnrichmentTables, name)
                    .await
            );
        }
        assert!(checker.calls("u2").org_wide.is_empty());
    }

    // The shortcut's types are OpenFGA's stream resources, whose GET reads its parent.
    #[cfg(feature = "enterprise")]
    #[test]
    fn org_wide_shortcut_types_are_the_openfga_stream_resources() {
        use o2_openfga::meta::mapping::{OFGA_MODELS, is_stream_resource};

        for stream_type in [
            StreamType::Logs,
            StreamType::Metrics,
            StreamType::Traces,
            StreamType::Profiles,
            StreamType::ServiceGraph,
            StreamType::EnrichmentTables,
            StreamType::Filelist,
            StreamType::Metadata,
            StreamType::Index,
        ] {
            let type_str = stream_type.as_str();
            let model = OFGA_MODELS
                .get(type_str)
                .map_or(type_str, |model| model.key);
            assert_eq!(
                org_wide_shortcut_covers(stream_type, "s"),
                is_stream_resource(model),
                "{type_str}"
            );
        }
    }

    #[tokio::test]
    async fn service_records_keep_only_readable_streams_and_drop_emptied_services() {
        let all = || {
            vec![
                service(
                    "checkout",
                    &["prod_data", "prod_data_uk"],
                    &["prod_data_uk"],
                ),
                service("billing", &["prod_data_bk"], &[]),
            ]
        };
        let untouched = service_names(&all());
        let cases: [(&str, FakeChecker, ServiceView); 5] = [
            (
                "mixed access",
                FakeChecker::default()
                    .reads("u1", "o1/logs/prod_data_uk")
                    .reads("u1", "o1/logs/cpu"),
                vec![(
                    "checkout".to_string(),
                    vec![
                        serde_json::json!(["prod_data_uk"]),
                        serde_json::json!([]),
                        serde_json::json!([]),
                    ],
                )],
            ),
            ("no access", FakeChecker::default(), vec![]),
            (
                "rbac off",
                FakeChecker {
                    rbac_off: true,
                    ..FakeChecker::default()
                },
                untouched.clone(),
            ),
            (
                "org admin",
                FakeChecker::default().admin("u1", "o1"),
                untouched.clone(),
            ),
            (
                "admin of another org",
                FakeChecker::default().admin("u1", "o2"),
                vec![],
            ),
        ];
        for (case, checker, expected) in cases {
            let kept = readable_service_records(&checker, SITE, "u1", "o1", all())
                .await
                .unwrap();
            assert_eq!(service_names(&kept), expected, "{case}");
        }
    }

    #[tokio::test]
    async fn service_records_check_each_shared_stream_once() {
        let checker = FakeChecker::default().reads("u1", "o1/metrics/cpu");
        let records = vec![
            service("a", &["shared"], &["shared"]),
            service("b", &["shared"], &[]),
        ];
        let kept = readable_service_records(&checker, SITE, "u1", "o1", records)
            .await
            .unwrap();
        assert_eq!(kept.len(), 2);
        let checks = checker
            .stream_checks
            .load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(checks, 3, "logs/shared, traces/shared and metrics/cpu");
    }

    fn wanted(streams: &[(StreamType, &str)]) -> HashSet<(StreamType, String)> {
        streams
            .iter()
            .map(|(stream_type, name)| (*stream_type, name.to_string()))
            .collect()
    }

    #[tokio::test]
    async fn an_org_wide_grant_keeps_every_stream_of_its_type_without_a_stream_check() {
        use StreamType::{Logs, Metrics, Profiles, Traces};

        let all = wanted(&[
            (Logs, "app"),
            (Logs, "audit"),
            (Metrics, "cpu"),
            (Metrics, "mem"),
            (Traces, "default"),
            (Traces, "other"),
            (Profiles, "heap"),
            (Profiles, "cpu"),
        ]);
        let checker = [Logs, Metrics, Traces, Profiles]
            .into_iter()
            .fold(FakeChecker::default(), |c, t| c.reads_all("u1", "o1", t));
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", all.clone()).await;
        assert_eq!(kept, Some(all.clone()));
        assert_eq!(checker.stream_checks(), 0);
        assert_eq!(checker.org_wide_asked().len(), 1);

        let other_org = list::legacy_readable_streams(&checker, "u1", "o2", all).await;
        assert_eq!(other_org, Some(HashSet::new()), "a grant opens one org");
    }

    #[tokio::test]
    async fn only_the_types_without_an_org_wide_grant_cost_stream_checks() {
        use StreamType::{Logs, Metrics};

        let metrics: Vec<String> = (0..10).map(|i| format!("m{i}")).collect();
        let mut all = wanted(&[(Logs, "app"), (Logs, "audit")]);
        all.extend(metrics.iter().map(|name| (Metrics, name.clone())));
        let checker = FakeChecker::default()
            .reads_all("u1", "o1", Logs)
            .reads("u1", "o1/metrics/m3")
            .reads("u1", "o1/metrics/m7");
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", all).await;
        let expected = wanted(&[
            (Logs, "app"),
            (Logs, "audit"),
            (Metrics, "m3"),
            (Metrics, "m7"),
        ]);
        assert_eq!(kept, Some(expected));
        assert_eq!(checker.stream_checks(), 10, "one per metrics stream");
    }

    #[tokio::test]
    async fn without_an_org_wide_grant_each_stream_is_checked_as_before() {
        use StreamType::{Logs, Traces};

        let all = wanted(&[(Logs, "app"), (Logs, "audit"), (Traces, "default")]);
        let granted = FakeChecker::default().reads("u1", "o1/logs/audit");
        let failed = FakeChecker {
            org_wide_fails: true,
            ..FakeChecker::default()
                .reads("u1", "o1/logs/audit")
                .reads_all("u1", "o1", Logs)
        };
        for (case, checker) in [("no org-wide grant", granted), ("failed question", failed)] {
            let kept = list::legacy_readable_streams(&checker, "u1", "o1", all.clone()).await;
            assert_eq!(kept, Some(wanted(&[(Logs, "audit")])), "{case}");
            assert_eq!(checker.stream_checks(), 3, "{case}");
            assert_eq!(checker.org_wide_asked().len(), 1, "{case}");
        }
    }

    // o2-enterprise#3642: one stream of a type costs its own Check and no org-wide question.
    #[tokio::test]
    async fn a_lone_stream_of_a_type_skips_the_org_wide_question() {
        use StreamType::{Logs, Traces};

        let checker = FakeChecker::default()
            .reads("u1", "o1/traces/default")
            .reads("u1", "o1/logs/app");
        let all = wanted(&[(Logs, "app"), (Logs, "audit"), (Traces, "default")]);
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", all).await;
        assert_eq!(kept, Some(wanted(&[(Logs, "app"), (Traces, "default")])));
        assert_eq!(checker.org_wide_asked(), [vec![Logs]]);
        assert_eq!(checker.stream_checks(), 3);
    }

    #[tokio::test]
    async fn a_user_who_reads_everything_is_asked_nothing() {
        let all = || wanted(&[(StreamType::Logs, "app")]);
        let mut root = FakeChecker::default();
        root.roots.insert("u1".to_string());
        let rbac_off = FakeChecker {
            rbac_off: true,
            ..FakeChecker::default()
        };
        let admin = FakeChecker::default().admin("u1", "o1");
        for checker in [root, rbac_off, admin] {
            assert_eq!(
                list::legacy_readable_streams(&checker, "u1", "o1", all()).await,
                None
            );
            assert_eq!(checker.stream_checks(), 0);
            assert!(checker.org_wide_asked().is_empty());
        }
    }

    #[tokio::test]
    async fn the_org_wide_question_names_only_the_wanted_types() {
        let logs_only = FakeChecker::default();
        let all = wanted(&[(StreamType::Logs, "app"), (StreamType::Logs, "audit")]);
        list::legacy_readable_streams(&logs_only, "u1", "o1", all).await;
        assert_eq!(logs_only.org_wide_asked(), [vec![StreamType::Logs]]);

        let nothing = FakeChecker::default();
        let kept = list::legacy_readable_streams(&nothing, "u1", "o1", HashSet::new()).await;
        assert_eq!(kept, Some(HashSet::new()));
        assert_eq!(nothing.stream_checks(), 0);
        assert!(nothing.org_wide_asked().is_empty());
    }

    #[tokio::test]
    async fn a_name_openfga_may_refuse_keeps_its_own_check() {
        use StreamType::Logs;

        let longest = "a".repeat(MAX_COVERED_ID_LEN);
        let too_long = "a".repeat(MAX_COVERED_ID_LEN + 1);
        let refused = [too_long.as_str(), "", "*", "a\u{1}b", "caf\u{e9}"];
        let shortcut = wanted(&[(Logs, longest.as_str()), (Logs, "app")]);
        let mut all = shortcut.clone();
        all.extend(wanted(&refused.map(|name| (Logs, name))));
        let checker = FakeChecker::default().reads_all("u1", "o1", Logs);
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", all).await;
        assert_eq!(kept, Some(shortcut));
        assert_eq!(checker.stream_checks(), refused.len());

        let only_refused = FakeChecker::default().reads_all("u1", "o1", Logs);
        list::legacy_readable_streams(&only_refused, "u1", "o1", wanted(&[(Logs, "*")])).await;
        assert!(only_refused.org_wide_asked().is_empty());
        assert_eq!(only_refused.stream_checks(), 1);
    }

    #[tokio::test]
    async fn a_covered_stream_keeps_its_own_name() {
        let checker = FakeChecker::default().reads_all("u1", "o1", StreamType::Metrics);
        let all = wanted(&[(StreamType::Metrics, "a:b"), (StreamType::Metrics, "c")]);
        let kept = list::legacy_readable_streams(&checker, "u1", "o1", all.clone()).await;
        assert_eq!(kept, Some(all));
        assert_eq!(checker.stream_checks(), 0);
    }

    #[tokio::test]
    async fn service_records_and_related_streams_follow_an_org_wide_grant() {
        let checker = || {
            FakeChecker::default()
                .reads_all("u1", "o1", StreamType::Logs)
                .reads("u1", "o1/traces/t1")
        };
        let records = vec![
            service("a", &["l1", "l2"], &["t1", "t2"]),
            service("b", &[], &["t2"]),
        ];
        let kept = readable_service_records(&checker(), SITE, "u1", "o1", records)
            .await
            .unwrap();
        let lists = serde_json::json!([["l1", "l2"], ["t1"], []]);
        assert_eq!(
            service_names(&kept),
            [("a".to_string(), lists.as_array().unwrap().clone())]
        );

        let streams = related(&["l2", "l1"], &["t2", "t1"], &["cpu"]);
        let kept = readable_related_streams(&checker(), SITE, "u1", "o1", streams)
            .await
            .unwrap();
        let names = |list: &[StreamInfo]| -> Vec<String> {
            list.iter().map(|info| info.stream_name.clone()).collect()
        };
        assert_eq!(names(&kept.logs), ["l2", "l1"]);
        assert_eq!(names(&kept.traces), ["t1"]);
        assert!(kept.metrics.is_empty() && kept.profiles.is_empty());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_meta_org_reads_its_role_from_the_membership_for_every_check() {
        use common::infra::config::ORG_USERS;

        let user = "issue3592-meta-role@example.com";
        let asked = UserRole::Viewer.to_string();
        assert_eq!(effective_role("o1", user, asked.clone()), asked);
        assert_eq!(
            effective_role(config::META_ORG_ID, user, asked.clone()),
            asked
        );
        ORG_USERS.insert(
            format!("{}/{user}", config::META_ORG_ID),
            infra::table::org_users::OrgUserRecord {
                email: user.to_string(),
                org_id: config::META_ORG_ID.to_string(),
                role: UserRole::Editor,
                token: String::new(),
                rum_token: None,
                created_at: 0,
                allow_static_token: false,
            },
        );
        let in_meta = effective_role(config::META_ORG_ID, user, asked.clone());
        assert_eq!(in_meta, UserRole::Editor.to_string());
        assert_eq!(effective_role("o1", user, asked.clone()), asked);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_meta_role_override_uses_the_sent_identity() {
        use common::infra::config::ORG_USERS;

        let org = config::META_ORG_ID;
        let request_id = "meta.mixed@example.com";
        let stored_email = "Meta.Mixed@Example.com";
        let key = format!("{org}/{stored_email}");
        ORG_USERS.insert(
            key.clone(),
            infra::table::org_users::OrgUserRecord::new(
                org,
                stored_email,
                UserRole::Editor,
                "",
                None,
            ),
        );
        let request_role = UserRole::Viewer.to_string();
        let resolve = |identity| {
            let sent = sent_user_id(identity, request_id, stored_email);
            (sent, effective_role(org, sent, request_role.clone()))
        };
        let stored = resolve(list::Identity::StoredEmail);
        let given = resolve(list::Identity::GivenId);
        ORG_USERS.remove(&key);
        assert_eq!(stored, (stored_email, UserRole::Editor.to_string()));
        assert_eq!(given, (request_id, request_role));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_user_outside_the_org_reads_no_type_org_wide() {
        // with OpenFGA off a member gets every type, so only the member lookup can empty this
        assert!(!o2_openfga::config::get_config().enabled);
        let wanted = [StreamType::Logs, StreamType::Metrics];
        let types = OpenFgaStreamChecker
            .org_wide_readable("issue3592-nobody@example.com", "issue3592_org", &wanted)
            .await;
        assert!(types.is_empty());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn rbac_enforced_follows_only_the_openfga_switch() {
        assert_eq!(
            rbac_enforced().await,
            o2_openfga::config::get_config().enabled
        );
    }

    #[tokio::test]
    async fn on_mode_service_lists_fail_whole_on_a_failed_answer_and_off_mode_drops_rows() {
        use list::{ListMode, UnavailableReason};

        let fake = FakeStreamChecker::default();
        let records = || vec![service("checkout", &["l1"], &["t1"])];
        let user = "u9-rows-1-10@example.com";
        fake.grant_read(
            user,
            &TypedStream {
                org_id: "o1".to_string(),
                stream_type: StreamType::Logs,
                name: "l1".to_string(),
            },
        );
        fake.set_list_mode(user, ListMode::On);
        fake.fail_types_access_once(user, UnavailableReason::Timeout);
        let failed = within_budget(
            1,
            readable_service_records(&fake, SITE, user, "o1", records()),
        )
        .await;
        assert_eq!(failed.unwrap_err().reason, UnavailableReason::Timeout);
        fake.fail_list_once(user, UnavailableReason::Server(502));
        let streams = related(&["l1"], &["t1"], &[]);
        let failed = within_budget(
            8,
            readable_related_streams(&fake, SITE, user, "o1", streams),
        )
        .await;
        assert_eq!(failed.unwrap_err().reason, UnavailableReason::Server(502));

        let kept = within_budget(
            10,
            readable_service_records(&fake, SITE, user, "o1", records()),
        )
        .await
        .unwrap();
        let lists = serde_json::json!([["l1"], [], []]);
        assert_eq!(
            service_names(&kept),
            [("checkout".to_string(), lists.as_array().unwrap().clone())]
        );

        fake.set_list_mode(user, ListMode::Off);
        fake.fail_stream_read_once(user, "l1");
        let dropped = within_budget(
            3,
            readable_service_records(&fake, SITE, user, "o1", records()),
        )
        .await
        .unwrap();
        assert!(
            dropped.is_empty(),
            "off keeps today's deny on a failed Check"
        );
    }
}
