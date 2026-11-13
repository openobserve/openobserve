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

//! Service identity (service, where, env, version): registry rows, overrides and their keys.

use std::{cmp::Ordering, str::FromStr};

use serde::{Deserialize, Serialize};

pub const O2_SERVICE_WHERE: &str = "o2_service_where";
pub const O2_SERVICE_ENV: &str = "o2_service_env";
pub const O2_SERVICE_VERSION: &str = "o2_service_version";
pub const O2_SERVICE_IMAGE: &str = "o2_service_image";
pub const SIGNAL_TRACES: &str = "traces";
pub const SIGNAL_RUM: &str = "rum";
pub const RULE_TYPE_ENV_OVERRIDE: &str = "env_override";
/// Most pods a not_serving verdict lists; `pods_total` keeps the full count.
pub const NOT_SERVING_PODS_CAP: usize = 50;
pub const NOT_SERVING_K8S_REASON: &str = "seen_in_k8s_no_requests";
pub const VERSION_SOURCE_K8S_POD_IMAGE: &str = "k8s.pod.image";
pub const COMPARE_DISABLED_NO_SPAN_VERSION: &str = "no_span_version";
pub const IMAGE_SHORT_HEX: usize = 7;
/// Every stream the service signals processor writes, logs and metrics alike, starts with this.
pub const SERVICE_SIGNALS_STREAM_PREFIX: &str = "_o2_service_";
const NO_ENV_LITERALS: [&str; 3] = ["default", "none", "unknown"];
const SERVICE_UNIT_SUFFIXES: [&str; 4] = [".service", ".socket", ".target", ".slice"];
// An env label is cut to 253 bytes, the bound of every stored identity column.
const MAX_ENV_BYTES: usize = 253;
// Synonym and token table: 13 strings, 7 labels; one table serves tokens and `canon_env`.
const ENV_SYNONYMS: [(&str, &str); 13] = [
    ("production", "prod"),
    ("prd", "prod"),
    ("prod", "prod"),
    ("staging", "staging"),
    ("stage", "staging"),
    ("stg", "staging"),
    ("development", "dev"),
    ("dev", "dev"),
    ("testing", "test"),
    ("test", "test"),
    ("qa", "qa"),
    ("alpha", "alpha"),
    ("preview", "preview"),
];

/// How a where key was formed.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum WhereKind {
    K8s,
    Env,
    Default,
}

impl WhereKind {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::K8s => "k8s",
            Self::Env => "env",
            Self::Default => "default",
        }
    }
}

impl FromStr for WhereKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "k8s" => Ok(Self::K8s),
            "env" => Ok(Self::Env),
            "default" => Ok(Self::Default),
            other => Err(format!("unknown where_kind `{other}`")),
        }
    }
}

/// The inference step an env label came from; overrides apply at read time only.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EnvSource {
    Attribute,
    Namespace,
    Cluster,
    Workload,
    ClusterName,
    NamespaceName,
    Default,
    Rum,
}

impl EnvSource {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Attribute => "attribute",
            Self::Namespace => "namespace",
            Self::Cluster => "cluster",
            Self::Workload => "workload",
            Self::ClusterName => "cluster_name",
            Self::NamespaceName => "namespace_name",
            Self::Default => "default",
            Self::Rum => "rum",
        }
    }

    /// Guessed from a namespace, cluster or workload name rather than reported.
    pub const fn is_inferred(&self) -> bool {
        matches!(
            self,
            Self::Namespace
                | Self::Cluster
                | Self::Workload
                | Self::ClusterName
                | Self::NamespaceName
        )
    }
}

impl FromStr for EnvSource {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "attribute" => Ok(Self::Attribute),
            "namespace" => Ok(Self::Namespace),
            "cluster" => Ok(Self::Cluster),
            "workload" => Ok(Self::Workload),
            "cluster_name" => Ok(Self::ClusterName),
            "namespace_name" => Ok(Self::NamespaceName),
            "default" => Ok(Self::Default),
            "rum" => Ok(Self::Rum),
            other => Err(format!("unknown env_source `{other}`")),
        }
    }
}

/// What an env override targets; precedence is service > where > cluster.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OverrideScope {
    Service,
    Where,
    Cluster,
}

impl OverrideScope {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Where => "where",
            Self::Cluster => "cluster",
        }
    }
}

impl FromStr for OverrideScope {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "service" => Ok(Self::Service),
            "where" => Ok(Self::Where),
            "cluster" => Ok(Self::Cluster),
            other => Err(format!("unknown override scope `{other}`")),
        }
    }
}

/// One (service, where, version) seen in one stream by one request; times in microseconds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ServiceVersionObservation {
    pub service_name: String,
    pub where_key: String,
    pub where_kind: WhereKind,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub env: String,
    pub env_source: EnvSource,
    pub env_source_value: String,
    pub version: String,
    pub raw_version: Option<String>,
    pub version_source: String,
    /// The image digest's first 7 hex characters; part of the identity only when known.
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub image_ref: Option<String>,
    pub source_stream: String,
    /// `SIGNAL_TRACES` or `SIGNAL_RUM`.
    pub signal: String,
    pub first_seen: i64,
    pub last_seen: i64,
}

impl ServiceVersionObservation {
    pub fn version_key(&self, org_id: &str) -> String {
        version_key_for(
            org_id,
            &self.service_name,
            &self.where_key,
            &self.version,
            self.image.as_deref(),
        )
    }

    pub fn scope_key(&self, org_id: &str) -> String {
        scope_key(org_id, &self.service_name, &self.where_key)
    }

    pub fn summary_key(&self, org_id: &str) -> String {
        summary_key(
            org_id,
            &self.service_name,
            &self.where_key,
            &self.source_stream,
        )
    }

    /// The registry row this observation alone would write.
    pub fn to_record(&self, org_id: &str, now: i64) -> ServiceVersionRecord {
        let (traces, rum) = match self.signal.as_str() {
            SIGNAL_RUM => (None, Some((self.first_seen, self.last_seen))),
            _ => (Some((self.first_seen, self.last_seen)), None),
        };
        ServiceVersionRecord {
            version_key: self.version_key(org_id),
            org_id: org_id.to_string(),
            service_name: self.service_name.clone(),
            where_key: self.where_key.clone(),
            where_kind: self.where_kind,
            k8s_cluster: self.k8s_cluster.clone(),
            k8s_namespace: self.k8s_namespace.clone(),
            scope_key: self.scope_key(org_id),
            env: self.env.clone(),
            version: self.version.clone(),
            raw_version: self.raw_version.clone(),
            version_source: self.version_source.clone(),
            image: self.image.clone(),
            image_ref: self.image_ref.clone(),
            env_source: self.env_source,
            env_source_value: self.env_source_value.clone(),
            first_seen: self.first_seen,
            last_seen: self.last_seen,
            traces_first_seen: traces.map(|(first, _)| first),
            traces_last_seen: traces.map(|(_, last)| last),
            rum_first_seen: rum.map(|(first, _)| first),
            rum_last_seen: rum.map(|(_, last)| last),
            deleted_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Ranks the version by its merged registry `first_seen`, not by when this request saw it.
    pub fn to_summary(
        &self,
        org_id: &str,
        registry: &ServiceVersionRecord,
        now: i64,
    ) -> WhereSummaryRecord {
        WhereSummaryRecord {
            summary_key: self.summary_key(org_id),
            org_id: org_id.to_string(),
            service_name: self.service_name.clone(),
            where_key: self.where_key.clone(),
            scope_key: self.scope_key(org_id),
            source_stream: self.source_stream.clone(),
            signal: self.signal.clone(),
            k8s_cluster: self.k8s_cluster.clone(),
            k8s_namespace: self.k8s_namespace.clone(),
            env: self.env.clone(),
            env_source: self.env_source,
            env_source_value: self.env_source_value.clone(),
            envs: (!self.env.is_empty())
                .then(|| self.env.clone())
                .into_iter()
                .collect(),
            newest_version: self.version.clone(),
            newest_version_key: registry.version_key.clone(),
            newest_first_seen: registry.first_seen,
            has_version: !self.version.is_empty(),
            first_seen: self.first_seen,
            last_seen: self.last_seen,
            purged_versions: 0,
            updated_at: now,
        }
    }
}

/// One `service_versions` row; times in microseconds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ServiceVersionRecord {
    pub version_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub where_kind: WhereKind,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub scope_key: String,
    /// The inferred label, never an override.
    pub env: String,
    pub version: String,
    pub raw_version: Option<String>,
    pub version_source: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub image_ref: Option<String>,
    pub env_source: EnvSource,
    pub env_source_value: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub traces_first_seen: Option<i64>,
    pub traces_last_seen: Option<i64>,
    pub rum_first_seen: Option<i64>,
    pub rum_last_seen: Option<i64>,
    pub deleted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ServiceVersionRecord {
    /// The (version, image) pair the signals rollup and deploy history key it by.
    pub fn identity(&self) -> VersionImage {
        VersionImage::new(&self.version, self.image.as_deref())
    }

    pub fn is_live(&self) -> bool {
        self.deleted_at
            .is_none_or(|deleted| self.last_seen > deleted)
    }

    /// Folds `incoming` in; commutative, associative and idempotent, like the registry upsert.
    pub fn merge(&mut self, incoming: &Self) {
        if newest_wins(incoming, self) {
            self.service_name = incoming.service_name.clone();
            self.env = incoming.env.clone();
            self.env_source = incoming.env_source;
            self.env_source_value = incoming.env_source_value.clone();
            self.version_source = incoming.version_source.clone();
            self.raw_version = incoming.raw_version.clone();
            self.image_ref = incoming.image_ref.clone();
        }
        // The key fixes the image, so two known values are equal.
        if self.image.is_none() {
            self.image = incoming.image.clone();
        }
        self.first_seen = self.first_seen.min(incoming.first_seen);
        self.last_seen = self.last_seen.max(incoming.last_seen);
        self.traces_first_seen = min_opt(self.traces_first_seen, incoming.traces_first_seen);
        self.traces_last_seen = max_opt(self.traces_last_seen, incoming.traces_last_seen);
        self.rum_first_seen = min_opt(self.rum_first_seen, incoming.rum_first_seen);
        self.rum_last_seen = max_opt(self.rum_last_seen, incoming.rum_last_seen);
        self.deleted_at = max_opt(self.deleted_at, incoming.deleted_at);
        self.created_at = self.created_at.min(incoming.created_at);
        self.updated_at = self.updated_at.max(incoming.updated_at);
        self.apply_floor();
    }

    /// Joins a tombstone into the row, exactly as `tombstone_many` does in the database.
    pub fn apply_tombstone(&mut self, deleted_at: i64) {
        if self.deleted_at.is_some_and(|floor| floor >= deleted_at) {
            return;
        }
        self.deleted_at = max_opt(self.deleted_at, Some(deleted_at));
        self.updated_at = self.updated_at.max(deleted_at);
        self.apply_floor();
    }

    /// Clamps every first-seen up to the tombstone; a signal is live while its last > it.
    pub fn apply_floor(&mut self) {
        let Some(floor) = self.deleted_at else {
            return;
        };
        self.first_seen = self.first_seen.max(floor);
        // Dead pairs are kept, not nulled: dropping their pre-floor min breaks associativity.
        for first in [&mut self.traces_first_seen, &mut self.rum_first_seen] {
            *first = first.map(|seen| seen.max(floor));
        }
    }
}

/// A version text and the build it ran as; two images of one text are two versions.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VersionImage {
    pub version: String,
    #[serde(default)]
    pub image: Option<String>,
}

impl VersionImage {
    pub fn new(version: &str, image: Option<&str>) -> Self {
        Self {
            version: version.to_string(),
            image: keyed_image(version, image).map(str::to_string),
        }
    }

    pub fn key(&self, org_id: &str, service_name: &str, where_key: &str) -> String {
        version_key_for(
            org_id,
            service_name,
            where_key,
            &self.version,
            self.image.as_deref(),
        )
    }
}

impl From<&str> for VersionImage {
    fn from(version: &str) -> Self {
        Self::new(version, None)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WhereSummaryRecord {
    pub summary_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub scope_key: String,
    pub source_stream: String,
    pub signal: String,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub env: String,
    pub env_source: EnvSource,
    pub env_source_value: String,
    /// Every env the stream was seen in, sorted; `env` is the one seen first.
    #[serde(default, deserialize_with = "envs_list_or_text")]
    pub envs: Vec<String>,
    pub newest_version: String,
    pub newest_version_key: String,
    pub newest_first_seen: i64,
    pub has_version: bool,
    pub first_seen: i64,
    pub last_seen: i64,
    pub purged_versions: i64,
    pub updated_at: i64,
}

impl WhereSummaryRecord {
    pub fn merge(&mut self, incoming: &Self) {
        if newest_name_rank(incoming) > newest_name_rank(self) {
            self.service_name = incoming.service_name.clone();
        }
        if newest_version_rank(incoming) > newest_version_rank(self) {
            self.newest_version = incoming.newest_version.clone();
            self.newest_version_key = incoming.newest_version_key.clone();
            self.newest_first_seen = incoming.newest_first_seen;
        }
        if env_rank(incoming) < env_rank(self) {
            self.env = incoming.env.clone();
            self.env_source = incoming.env_source;
            self.env_source_value = incoming.env_source_value.clone();
        }
        self.envs = self
            .envs
            .iter()
            .chain(&incoming.envs)
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        self.has_version |= incoming.has_version;
        self.first_seen = self.first_seen.min(incoming.first_seen);
        self.last_seen = self.last_seen.max(incoming.last_seen);
        self.purged_versions = self.purged_versions.max(incoming.purged_versions);
        self.updated_at = self.updated_at.max(incoming.updated_at);
    }
}

/// One `service_identity_rules` row: an env override, or its tombstone.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, utoipa::ToSchema)]
pub struct Override {
    pub rule_key: String,
    pub org_id: String,
    /// Always `RULE_TYPE_ENV_OVERRIDE` in phase 1.
    pub rule_type: String,
    pub scope: OverrideScope,
    pub k8s_cluster: String,
    pub where_key: String,
    pub service_name: String,
    pub value: String,
    pub inferred_value: String,
    pub inferred_source: EnvSource,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub writer_cluster: String,
}

/// The body of `PUT /service_identity/overrides`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, utoipa::ToSchema)]
pub struct OverrideWrite {
    pub scope: OverrideScope,
    #[serde(default)]
    pub where_key: String,
    #[serde(default)]
    pub k8s_cluster: String,
    #[serde(default)]
    pub service_name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct AliasRow {
    pub alias_key: String,
    pub org_id: String,
    pub kind: String,
    pub scope: String,
    pub alias: String,
    pub canonical: String,
    pub status: String,
    pub origin: String,
    pub evidence: Option<String>,
    pub confidence: String,
    pub accepted_by: Option<String>,
    pub accepted_at: Option<i64>,
    pub batch_id: Option<String>,
    pub prev_status: Option<String>,
    pub first_seen: Option<i64>,
    pub last_seen: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub writer_cluster: String,
    #[serde(default)]
    pub fencing_token: i64,
    /// Accepted with `allow_collisions`, so a replicated collision never sends it to review.
    #[serde(default)]
    pub allow_collisions: bool,
    /// Derived per region from the collision rule, so it never travels or overwrites intent.
    #[serde(skip)]
    pub conflicted: bool,
}

/// An org's live overrides, as ENT resolution reads them.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct OrgIdentity {
    pub overrides: Vec<Override>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct VersionDeletion {
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub version: String,
    #[serde(default)]
    pub image: Option<String>,
    pub scope_key: String,
    pub version_key: String,
    pub deleted_at: i64,
}

/// One pod that runs a not_serving version, read from the K1 container-info metric.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, utoipa::ToSchema)]
pub struct NotServingPod {
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub k8s_pod: String,
    pub k8s_workload: String,
    pub k8s_container: String,
    /// Unix µs from which this pod ran the version while the version had no requests.
    pub since: i64,
    /// Latest waiting reason, else `running` when ready; absent when unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready: Option<bool>,
}

/// The not_serving pods table: at most [`NOT_SERVING_PODS_CAP`] rows plus the uncapped total.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct NotServingPods {
    pub pods: Vec<NotServingPod>,
    pub pods_total: u64,
    /// Typed K1 streams the rows came from; never serialized, the caller must read all.
    #[serde(skip)]
    pub source_streams: Vec<String>,
    /// Typed streams `status`/`ready` came from, authorized separately from the pod list.
    #[serde(skip)]
    pub status_streams: Vec<String>,
}

impl NotServingPods {
    /// Adds `pods`/`pods_total` to a readable K8s not_serving summary; returns whether it did.
    pub fn attach(
        &self,
        verdict: &mut serde_json::Value,
        sources_readable: bool,
        status_readable: bool,
    ) -> bool {
        let k8s_not_serving = verdict["verdict"] == "not_serving"
            && (verdict["reason_code"] == NOT_SERVING_K8S_REASON
                || verdict["reason"] == NOT_SERVING_K8S_REASON);
        // A list with no typed source cannot be authorized, so it fails closed.
        if !sources_readable
            || self.source_streams.is_empty()
            || !k8s_not_serving
            || verdict["restricted"] != false
        {
            return false;
        }
        let Some(object) = verdict.as_object_mut() else {
            return false;
        };
        let status_readable = status_readable && !self.status_streams.is_empty();
        let pods: Vec<_> = self
            .pods
            .iter()
            .take(NOT_SERVING_PODS_CAP)
            .map(|pod| NotServingPod {
                status: pod.status.clone().filter(|_| status_readable),
                ready: pod.ready.filter(|_| status_readable),
                ..pod.clone()
            })
            .collect();
        object.insert(
            "pods".into(),
            serde_json::to_value(pods).unwrap_or_default(),
        );
        object.insert(
            "pods_total".into(),
            serde_json::Value::from(self.pods_total.max(self.pods.len() as u64)),
        );
        true
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum ServiceIdentityMessage {
    DeployPut {
        org_id: String,
        rows: Vec<serde_json::Value>,
    },
    VerdictPut {
        org_id: String,
        rows: Vec<serde_json::Value>,
        metrics: Vec<serde_json::Value>,
    },
    VersionsPut {
        org_id: String,
        records: Vec<ServiceVersionRecord>,
    },
    VersionsDelete {
        org_id: String,
        records: Vec<VersionDeletion>,
    },
    AliasPut {
        org_id: String,
        rows: Vec<AliasRow>,
    },
    AliasDelete {
        org_id: String,
        alias_key: String,
        updated_at: i64,
        writer_cluster: String,
    },
    SummaryPut {
        rows: Vec<WhereSummaryRecord>,
    },
    OverridePut {
        row: Box<Override>,
    },
    OverrideDelete {
        org_id: String,
        rule_key: String,
        updated_at: i64,
        writer_cluster: String,
    },
}

/// A name already reduced by [`service_key`], so it is never reduced again (D226).
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ServiceKey(String);

impl ServiceKey {
    pub fn of(name: &str) -> Self {
        Self(service_key(name))
    }

    /// A key its writer stored already reduced, such as a series label.
    pub fn stored(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }

    /// A name whose key is this one, for inputs that take a name and reduce it.
    pub fn spelling(&self) -> String {
        service_key_spellings(&self.0)
            .into_iter()
            .next()
            .unwrap_or_else(|| self.0.clone())
    }

    /// The [`scope_key`] every spelling of this service has at `where_key`.
    pub fn scope_key(&self, org_id: &str, where_key: &str) -> String {
        hash_key(serde_json::json!([org_id, self.0, where_key]))
    }
}

/// Registry primary key; stream and stream type are deliberately not part of it.
pub fn alias_key(org_id: &str, kind: &str, scope: &str, alias: &str) -> String {
    hash_key(serde_json::json!([org_id, kind, scope, alias]))
}

pub fn version_key(org_id: &str, service_name: &str, where_key: &str, version: &str) -> String {
    hash_key(serde_json::json!([
        org_id,
        service_key(service_name),
        where_key,
        version
    ]))
}

/// `version_key` plus the image, which joins the key only when `keyed_image` keeps it.
pub fn version_key_for(
    org_id: &str,
    service_name: &str,
    where_key: &str,
    version: &str,
    image: Option<&str>,
) -> String {
    match keyed_image(version, image) {
        Some(image) => hash_key(serde_json::json!([
            org_id,
            service_key(service_name),
            where_key,
            version,
            image
        ])),
        None => version_key(org_id, service_name, where_key, version),
    }
}

/// The image a (version, image) pair is keyed by: a 7-hex short of a non-empty version.
pub fn keyed_image<'a>(version: &str, image: Option<&'a str>) -> Option<&'a str> {
    image.filter(|image| !version.is_empty() && is_image_short(image))
}

/// True for a 7 lowercase hex image short, the only form an image is stored in.
pub fn is_image_short(image: &str) -> bool {
    image.len() == IMAGE_SHORT_HEX
        && image
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// True when the service reported no env; an override or a pipeline-set env never counts.
pub fn is_no_env(env: &str, source: EnvSource, source_value: &str) -> bool {
    match source {
        EnvSource::Default => true,
        EnvSource::Attribute if source_value == O2_SERVICE_ENV => false,
        // Inference skips these literals, so only rows written before that still carry one.
        EnvSource::Attribute | EnvSource::Rum => is_no_env_literal(env),
        _ => false,
    }
}

/// The service name both service registries match by; the original casing is display only.
pub fn service_key(name: &str) -> String {
    let lowered = name.trim().to_lowercase();
    match SERVICE_UNIT_SUFFIXES
        .iter()
        .find_map(|suffix| lowered.strip_suffix(suffix))
        .map(str::trim_end)
    {
        Some(stem) if !stem.is_empty() => stem.to_string(),
        _ => lowered,
    }
}

/// Every trimmed, lowercased spelling whose `service_key` is `key`, for case-insensitive filters.
pub fn service_key_spellings(key: &str) -> Vec<String> {
    let key = key.trim().to_lowercase();
    std::iter::once(key.clone())
        .chain(
            SERVICE_UNIT_SUFFIXES
                .iter()
                .map(|suffix| format!("{key}{suffix}")),
        )
        .filter(|spelling| service_key(spelling) == key)
        .collect()
}

/// The env label of a reported value; `None` when the value reports no env.
pub fn canon_env(value: &str) -> Option<String> {
    let lowered = value.trim().to_lowercase();
    if lowered.is_empty() || is_no_env_literal(&lowered) {
        return None;
    }
    Some(match env_synonym(&lowered) {
        Some(label) => label.to_string(),
        None => truncate_utf8(&lowered, MAX_ENV_BYTES).to_string(),
    })
}

/// The label a whole token names in the env synonym table.
pub fn env_synonym(token: &str) -> Option<&'static str> {
    ENV_SYNONYMS
        .iter()
        .find(|(synonym, _)| synonym.len() == token.len() && synonym.eq_ignore_ascii_case(token))
        .map(|(_, label)| *label)
}

/// A value that names no env (`default`, `none`, `unknown`), at any inference step.
pub fn is_no_env_literal(value: &str) -> bool {
    NO_ENV_LITERALS
        .iter()
        .any(|literal| literal.eq_ignore_ascii_case(value.trim()))
}

pub fn scope_key(org_id: &str, service_name: &str, where_key: &str) -> String {
    ServiceKey::of(service_name).scope_key(org_id, where_key)
}

pub fn summary_key(
    org_id: &str,
    service_name: &str,
    where_key: &str,
    source_stream: &str,
) -> String {
    hash_key(serde_json::json!([
        org_id,
        service_key(service_name),
        where_key,
        source_stream
    ]))
}

/// One row per override target, so a repeated correction updates it and replication is idempotent.
pub fn rule_key(
    org_id: &str,
    scope: &str,
    k8s_cluster: &str,
    where_key: &str,
    service_name: &str,
) -> String {
    hash_key(serde_json::json!([
        org_id,
        scope,
        k8s_cluster,
        where_key,
        service_key(service_name)
    ]))
}

/// A span without a real service name: empty, the SDK's `unknown_service[:x]` or ingest default.
pub fn is_placeholder_service(name: &str) -> bool {
    name.is_empty()
        || name == "default"
        || name == "unknown_service"
        || name.starts_with("unknown_service:")
}

fn truncate_utf8(value: &str, max: usize) -> &str {
    let mut end = value.len().min(max);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn hash_key(tuple: serde_json::Value) -> String {
    sha256::digest(tuple.to_string())
}

/// Ties on `last_seen` fall to the bytes of the values, so every write order picks one winner.
fn newest_wins(incoming: &ServiceVersionRecord, stored: &ServiceVersionRecord) -> bool {
    let rank = |r: &ServiceVersionRecord| {
        (
            r.last_seen,
            r.env.clone().into_bytes(),
            r.env_source.as_str().as_bytes().to_vec(),
            r.env_source_value.clone().into_bytes(),
            r.version_source.clone().into_bytes(),
            r.raw_version.clone().unwrap_or_default().into_bytes(),
            r.image_ref.clone().unwrap_or_default().into_bytes(),
            r.service_name.clone().into_bytes(),
        )
    };
    rank(incoming).cmp(&rank(stored)) == Ordering::Greater
}

/// The most recently seen casing names the row; ties fall to the bytes.
fn newest_name_rank(r: &WhereSummaryRecord) -> (i64, &[u8]) {
    (r.last_seen, r.service_name.as_bytes())
}

/// A real version always outranks `''`; then the greatest `first_seen`, then the key's bytes.
fn newest_version_rank(r: &WhereSummaryRecord) -> (bool, i64, &[u8]) {
    (
        !r.newest_version.is_empty(),
        r.newest_first_seen,
        r.newest_version_key.as_bytes(),
    )
}

/// The env seen first wins, so a second env never relabels the scope.
fn env_rank(r: &WhereSummaryRecord) -> (i64, &[u8], &[u8], &[u8]) {
    (
        r.first_seen,
        r.env.as_bytes(),
        r.env_source.as_str().as_bytes(),
        r.env_source_value.as_bytes(),
    )
}

// A database model carries the set as its stored JSON text; a message carries it as an array.
fn envs_list_or_text<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Envs {
        List(Vec<String>),
        Text(String),
    }
    match Envs::deserialize(d)? {
        Envs::List(list) => Ok(list),
        Envs::Text(text) => serde_json::from_str(&text).map_err(serde::de::Error::custom),
    }
}

fn min_opt(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn max_opt(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spelling_of_a_service_key_maps_back_to_it() {
        assert_eq!(
            service_key_spellings("Checkout"),
            [
                "checkout",
                "checkout.service",
                "checkout.socket",
                "checkout.target",
                "checkout.slice"
            ]
        );
        assert!(service_key_spellings(".service").contains(&".service".to_string()));
        for key in ["checkout", "a.service", ".service"] {
            let spellings = service_key_spellings(key);
            assert!(!spellings.is_empty(), "{key:?}");
            assert!(spellings.iter().all(|s| service_key(s) == key), "{key:?}");
        }
    }

    #[test]
    fn a_stored_key_is_not_reduced_again() {
        for name in [
            "A.service.service",
            "Checkout",
            "checkout.service",
            ".service",
        ] {
            let key = ServiceKey::of(name);
            let stored = ServiceKey::stored(key.as_str());
            assert_eq!(stored, key, "{name:?}");
            assert_eq!(
                stored.scope_key("o", "w"),
                scope_key("o", name, "w"),
                "{name:?}"
            );
            assert_eq!(ServiceKey::of(&key.spelling()), key, "{name:?}");
        }
        assert_eq!(
            ServiceKey::stored("a.service").spelling(),
            "a.service.service"
        );
    }

    #[test]
    fn case_and_unit_suffix_variants_share_every_key() {
        let base = ("o", "checkout", "env:prod");
        for name in ["Checkout", "checkout.service"] {
            assert_eq!(
                version_key(base.0, name, base.2, "v1"),
                version_key(base.0, base.1, base.2, "v1")
            );
            assert_eq!(
                version_key_for(base.0, name, base.2, "v1", Some("abc1234")),
                version_key_for(base.0, base.1, base.2, "v1", Some("abc1234"))
            );
            assert_eq!(
                scope_key(base.0, name, base.2),
                scope_key(base.0, base.1, base.2)
            );
            assert_eq!(
                summary_key(base.0, name, base.2, "default"),
                summary_key(base.0, base.1, base.2, "default")
            );
        }
    }

    #[test]
    fn canon_env_maps_synonyms_and_reports_none_for_no_env() {
        assert_eq!(canon_env("production").as_deref(), Some("prod"));
        assert_eq!(canon_env(" Production ").as_deref(), Some("prod"));
        assert_eq!(canon_env("STG").as_deref(), Some("staging"));
        assert_eq!(canon_env("r2cloud").as_deref(), Some("r2cloud"));
        for none in ["", "  ", "default", "None", "UNKNOWN"] {
            assert_eq!(canon_env(none), None, "{none:?}");
        }
        assert_eq!(canon_env(&"é".repeat(200)).map(|v| v.len()), Some(252));
        assert_eq!(env_synonym("prd"), Some("prod"));
        assert_eq!(env_synonym("region-b"), None);
    }

    #[test]
    fn the_newest_observation_names_a_merged_version_and_summary() {
        let older = observation("v1", 10, 20, "prod");
        let mut newer = older.clone();
        newer.service_name = "Ingester".to_string();
        newer.last_seen = 30;
        let mut a = older.to_record("o", 0);
        let b = newer.to_record("o", 0);
        assert_eq!(a.version_key, b.version_key);
        let mut c = b.clone();
        c.merge(&a);
        a.merge(&b);
        assert_eq!(a.service_name, "Ingester");
        assert_eq!(a, c);
        let mut summary = older.to_summary("o", &a, 0);
        let incoming = newer.to_summary("o", &a, 0);
        assert_eq!(summary.summary_key, incoming.summary_key);
        let mut reversed = incoming.clone();
        reversed.merge(&summary);
        summary.merge(&incoming);
        assert_eq!(summary.service_name, "Ingester");
        assert_eq!(summary, reversed);
    }

    #[test]
    fn nameless_and_default_spans_are_placeholder_services() {
        for name in ["", "default", "unknown_service", "unknown_service:node"] {
            assert!(is_placeholder_service(name), "{name:?}");
        }
        for name in ["unknown_services", "defaults", "checkout", "my-default"] {
            assert!(!is_placeholder_service(name), "{name:?}");
        }
    }

    fn observation(version: &str, first: i64, last: i64, env: &str) -> ServiceVersionObservation {
        ServiceVersionObservation {
            service_name: "ingester".to_string(),
            where_key: "k8s:obs-region/openobserve".to_string(),
            where_kind: WhereKind::K8s,
            k8s_cluster: "obs-region".to_string(),
            k8s_namespace: "openobserve".to_string(),
            env: env.to_string(),
            env_source: EnvSource::ClusterName,
            env_source_value: "obs-region".to_string(),
            version: version.to_string(),
            raw_version: Some(version.to_string()),
            version_source: "service.version".to_string(),
            image: None,
            image_ref: None,
            source_stream: "default".to_string(),
            signal: SIGNAL_TRACES.to_string(),
            first_seen: first,
            last_seen: last,
        }
    }

    #[test]
    fn the_image_joins_the_version_key_only_when_known() {
        let plain = version_key("o", "s", "k8s:c/n", "2.4.0");
        assert_eq!(version_key_for("o", "s", "k8s:c/n", "2.4.0", None), plain);
        let a = version_key_for("o", "s", "k8s:c/n", "2.4.0", Some("3f9c2ab"));
        let b = version_key_for("o", "s", "k8s:c/n", "2.4.0", Some("9c1e4b7"));
        assert_ne!(a, plain);
        assert_ne!(a, b);
        assert_eq!(
            a,
            sha256::digest(r#"["o","s","k8s:c/n","2.4.0","3f9c2ab"]"#)
        );
        // No version, an over-long version or a non-digest image never splits a row.
        assert_eq!(
            version_key_for("o", "s", "w", "", Some("3f9c2ab")),
            version_key("o", "s", "w", "")
        );
        assert_eq!(
            version_key_for("o", "s", "w", "1", Some("latest!")),
            version_key("o", "s", "w", "1")
        );
    }

    #[test]
    fn a_version_image_keys_like_the_registry_row() {
        let built = VersionImage::new("2.4.0", Some("9c1e4b7"));
        assert_eq!(built.version, "2.4.0");
        assert_eq!(
            built.key("o", "s", "w"),
            version_key_for("o", "s", "w", "2.4.0", Some("9c1e4b7"))
        );
        assert_eq!(
            VersionImage::new("2.4.0", None).key("o", "s", "w"),
            version_key("o", "s", "w", "2.4.0")
        );
        assert_eq!(VersionImage::new("", Some("9c1e4b7")).image, None);
        assert_eq!(VersionImage::new("2.4.0", Some("LATEST!")).image, None);
    }

    #[test]
    fn two_images_of_one_version_are_two_registry_rows() {
        let mut a = observation("2.4.0", 1, 2, "prod");
        a.image = Some("3f9c2ab".to_string());
        a.image_ref = Some("ghcr.io/acme/checkout:2.4.0".to_string());
        let mut b = a.clone();
        b.image = Some("9c1e4b7".to_string());
        assert_ne!(a.version_key("org"), b.version_key("org"));
        let unknown = observation("2.4.0", 1, 2, "prod");
        assert_eq!(
            unknown.version_key("org"),
            version_key("org", "ingester", &unknown.where_key, "2.4.0")
        );
        let record = a.to_record("org", 5);
        assert_eq!(record.version, "2.4.0");
        assert_eq!(record.image.as_deref(), Some("3f9c2ab"));
        assert_eq!(
            record.image_ref.as_deref(),
            Some("ghcr.io/acme/checkout:2.4.0")
        );
        assert_eq!(
            record.identity(),
            VersionImage::new("2.4.0", Some("3f9c2ab"))
        );
    }

    #[test]
    fn merge_keeps_the_image_and_the_newest_reference() {
        let mut old = observation("2.4.0", 1, 2, "prod");
        old.image = Some("3f9c2ab".to_string());
        old.image_ref = Some("old/ref:2.4.0".to_string());
        let mut new = old.clone();
        new.last_seen = 9;
        new.image_ref = Some("new/ref:2.4.0".to_string());
        let (old, new) = (old.to_record("org", 1), new.to_record("org", 1));
        for (mut into, from) in [(old.clone(), new.clone()), (new.clone(), old.clone())] {
            into.merge(&from);
            assert_eq!(into.image.as_deref(), Some("3f9c2ab"));
            assert_eq!(into.image_ref.as_deref(), Some("new/ref:2.4.0"));
        }
    }

    #[test]
    fn a_record_without_image_fields_or_with_unknown_ones_still_decodes() {
        let mut value =
            serde_json::to_value(observation("1", 1, 2, "prod").to_record("o", 1)).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("image");
        object.remove("image_ref");
        let old: ServiceVersionRecord = serde_json::from_value(value.clone()).unwrap();
        assert_eq!((old.image, old.image_ref), (None, None));
        value["image"] = serde_json::json!("9c1e4b7");
        value["a_field_from_a_newer_node"] = serde_json::json!({"x": 1});
        let newer: ServiceVersionRecord = serde_json::from_value(value).unwrap();
        assert_eq!(newer.image.as_deref(), Some("9c1e4b7"));
    }

    #[test]
    fn no_env_comes_from_the_source_not_the_label() {
        assert!(is_no_env("default", EnvSource::Default, ""));
        for literal in ["default", "none", "Unknown", "NONE"] {
            assert!(
                is_no_env(literal, EnvSource::Attribute, "deployment.environment=x"),
                "{literal}"
            );
            assert!(is_no_env(literal, EnvSource::Rum, "env=x"), "{literal}");
        }
        // A pipeline-set env is the user's own choice, so a real "default" stays an env.
        assert!(!is_no_env("default", EnvSource::Attribute, O2_SERVICE_ENV));
        assert!(!is_no_env(
            "prod",
            EnvSource::Attribute,
            "deployment.environment=prod"
        ));
        assert!(!is_no_env("default", EnvSource::Namespace, "default"));
        assert!(!is_no_env(
            "defaults",
            EnvSource::Attribute,
            "deployment.environment=defaults"
        ));
    }

    #[test]
    fn the_five_name_based_sources_are_inferred() {
        for source in [
            EnvSource::Namespace,
            EnvSource::Cluster,
            EnvSource::Workload,
            EnvSource::ClusterName,
            EnvSource::NamespaceName,
        ] {
            assert!(source.is_inferred(), "{source:?}");
        }
        for source in [EnvSource::Attribute, EnvSource::Default, EnvSource::Rum] {
            assert!(!source.is_inferred(), "{source:?}");
        }
    }

    #[test]
    fn json_array_keys_never_collide_on_separator_characters() {
        assert_ne!(
            scope_key("o", "a\",\"b", "c"),
            scope_key("o", "a", "b\",\"c")
        );
        assert_ne!(version_key("o", "a", "b", ""), scope_key("o", "a", "b"));
    }

    #[test]
    fn rum_observation_fills_only_the_rum_columns() {
        let mut obs = observation("1.0", 10, 20, "prod");
        obs.signal = SIGNAL_RUM.to_string();
        let record = obs.to_record("org", 5);
        assert_eq!(record.rum_first_seen, Some(10));
        assert_eq!(record.rum_last_seen, Some(20));
        assert_eq!(record.traces_first_seen, None);
        assert_eq!(
            record.version_key,
            version_key("org", "ingester", &obs.where_key, "1.0")
        );
    }

    fn permutations(n: usize) -> Vec<Vec<usize>> {
        if n == 0 {
            return vec![vec![]];
        }
        let mut out = Vec::new();
        for rest in permutations(n - 1) {
            for at in 0..=rest.len() {
                let mut p = rest.clone();
                p.insert(at, n - 1);
                out.push(p);
            }
        }
        out
    }

    /// A live row, a revived row, a dead tombstone row and a RUM history of one key.
    fn floored_records() -> Vec<ServiceVersionRecord> {
        let live = observation("v1", 100, 400, "prod").to_record("org", 1);
        let mut revived = observation("v1", 300, 400, "prod").to_record("org", 2);
        revived.deleted_at = Some(300);
        let mut dead = observation("v1", 50, 250, "dev").to_record("org", 3);
        dead.deleted_at = Some(260);
        let mut browser = observation("v1", 10, 280, "staging");
        browser.signal = SIGNAL_RUM.to_string();
        vec![live, revived, dead, browser.to_record("org", 0)]
    }

    #[test]
    fn record_merge_with_floors_is_order_and_duplicate_insensitive() {
        let records = floored_records();
        let fold = |order: &[usize]| {
            let mut acc = records[order[0]].clone();
            for i in &order[1..] {
                acc.merge(&records[*i]);
            }
            acc
        };
        let expected = fold(&[0, 1, 2, 3]);
        for order in permutations(records.len()) {
            assert_eq!(fold(&order), expected, "{order:?}");
            let mut twice = fold(&order);
            twice.merge(&records[order[0]]);
            assert_eq!(twice, expected, "idempotent, {order:?}");
        }
        assert_eq!(expected.deleted_at, Some(300));
        assert!(expected.is_live());
        assert_eq!((expected.first_seen, expected.last_seen), (300, 400));
        assert_eq!(
            (expected.traces_first_seen, expected.traces_last_seen),
            (Some(300), Some(400))
        );
        assert_eq!(
            (expected.rum_first_seen, expected.rum_last_seen),
            (Some(300), Some(280)),
            "a RUM history that ended before the delete stays dead"
        );
    }

    /// A version first seen at 500 after a delayed delete at 300 keeps 500 in every order.
    #[test]
    fn delayed_tombstone_clamps_first_seen_instead_of_overwriting_it() {
        let after = observation("v1", 500, 600, "prod").to_record("org", 1);
        let mut tombstoned = observation("v1", 500, 600, "prod").to_record("org", 1);
        tombstoned.deleted_at = Some(300);
        let mut ab = after.clone();
        ab.merge(&tombstoned);
        let mut ba = tombstoned.clone();
        ba.merge(&after);
        let mut direct = after.clone();
        direct.apply_tombstone(300);
        assert_eq!(ab, ba);
        for row in [&ab, &direct] {
            assert_eq!(
                (row.first_seen, row.last_seen, row.deleted_at),
                (500, 600, Some(300))
            );
            assert_eq!(
                (row.traces_first_seen, row.traces_last_seen),
                (Some(500), Some(600))
            );
            assert!(row.is_live());
        }
        let later = observation("v2", 400, 600, "prod").to_record("org", 1);
        assert!(
            ab.first_seen > later.first_seen,
            "v1 is newer than a version first seen at 400"
        );

        let pre = observation("v1", 100, 200, "prod").to_record("org", 1);
        let mut pre_then_delete = pre.clone();
        pre_then_delete.apply_tombstone(300);
        pre_then_delete.merge(&after);
        let mut both_then_delete = pre.clone();
        both_then_delete.merge(&after);
        both_then_delete.apply_tombstone(300);
        assert_eq!(pre_then_delete, both_then_delete, "the delete commutes");
        assert_eq!(
            pre_then_delete.first_seen, 300,
            "pre- and post-delete history reads the floor, a lower bound"
        );
        assert_eq!(
            (
                pre_then_delete.traces_first_seen,
                pre_then_delete.traces_last_seen
            ),
            (Some(300), Some(600))
        );
    }

    #[test]
    fn the_reported_pair_converges_in_both_orders() {
        let a = observation("v1", 100, 400, "prod").to_record("org", 1);
        let mut b = observation("v1", 300, 400, "prod").to_record("org", 1);
        b.deleted_at = Some(300);
        let mut ab = a.clone();
        ab.merge(&b);
        let mut ba = b.clone();
        ba.merge(&a);
        assert_eq!(ab, ba);
        assert_eq!(
            (ab.first_seen, ab.last_seen, ab.deleted_at),
            (300, 400, Some(300))
        );
    }

    #[test]
    fn tombstone_hides_old_traffic_and_newer_traffic_revives_above_the_floor() {
        let mut row = observation("v1", 100, 200, "prod").to_record("org", 1);
        row.apply_tombstone(300);
        assert!(!row.is_live());
        row.merge(&observation("v1", 10, 290, "prod").to_record("org", 0));
        assert!(
            !row.is_live(),
            "traffic before the tombstone keeps it hidden"
        );
        let newer = observation("v1", 250, 400, "dev").to_record("org", 2);
        row.merge(&newer);
        let revived = row.clone();
        row.merge(&newer);
        assert_eq!(row, revived, "a redelivered revival changes nothing");
        assert!(row.is_live());
        assert_eq!((row.first_seen, row.traces_first_seen), (300, Some(300)));
        assert_eq!((row.env.as_str(), row.deleted_at), ("dev", Some(300)));
    }

    #[test]
    fn summary_merge_prefers_a_real_version_over_an_empty_one() {
        let v1 = observation("v1", 10, 20, "prod");
        let empty = observation("", 30, 40, "prod");
        let versioned = v1.to_summary("org", &v1.to_record("org", 1), 1);
        let unversioned = empty.to_summary("org", &empty.to_record("org", 1), 1);
        let mut a = versioned.clone();
        a.merge(&unversioned);
        let mut b = unversioned.clone();
        b.merge(&versioned);
        assert_eq!(a, b);
        assert_eq!(a.newest_version, "v1");
        assert!(a.has_version);
    }

    fn not_serving_pods(total: usize) -> NotServingPods {
        NotServingPods {
            pods: (0..total)
                .map(|i| NotServingPod {
                    k8s_cluster: "k8s".into(),
                    k8s_namespace: "ns".into(),
                    k8s_pod: format!("pod-{i:02}"),
                    k8s_workload: "checkout".into(),
                    k8s_container: "app".into(),
                    since: 10,
                    status: Some("CrashLoopBackOff".into()),
                    ready: Some(false),
                })
                .collect(),
            pods_total: total as u64,
            source_streams: vec!["metrics/kube_pod_container_info".into()],
            status_streams: vec!["metrics/kube_pod_container_status_ready".into()],
        }
    }

    #[test]
    fn not_serving_pods_attach_to_a_readable_k8s_not_serving_verdict_only() {
        let k8s = serde_json::json!({"verdict":"not_serving","reason":"seen_in_k8s_no_requests","reason_code":"seen_in_k8s_no_requests","restricted":false});
        let mut verdict = k8s.clone();
        assert!(not_serving_pods(60).attach(&mut verdict, true, true));
        assert_eq!(
            verdict["pods"].as_array().unwrap().len(),
            NOT_SERVING_PODS_CAP
        );
        assert_eq!(verdict["pods_total"], 60);
        assert_eq!(
            verdict["pods"][0],
            serde_json::json!({"k8s_cluster":"k8s","k8s_namespace":"ns","k8s_pod":"pod-00","k8s_workload":"checkout","k8s_container":"app","since":10,"status":"CrashLoopBackOff","ready":false})
        );
        let unattributed = NotServingPods {
            status_streams: vec![],
            ..not_serving_pods(1)
        };
        for (pods, status_readable) in [(not_serving_pods(1), false), (unattributed, true)] {
            let mut verdict = k8s.clone();
            assert!(pods.attach(&mut verdict, true, status_readable));
            assert_eq!(
                verdict["pods"][0]
                    .as_object()
                    .unwrap()
                    .keys()
                    .collect::<Vec<_>>(),
                [
                    "k8s_cluster",
                    "k8s_namespace",
                    "k8s_pod",
                    "k8s_workload",
                    "k8s_container",
                    "since"
                ],
                "status and ready need their own readable stream"
            );
        }
        let serving = serde_json::json!({"verdict":"ok","reason":null,"reason_code":"not_significant_yet","restricted":false});
        let drop = serde_json::json!({"verdict":"not_serving","reason":"traffic_drop","reason_code":"traffic_drop","restricted":false});
        let restricted = serde_json::json!({"verdict_key":"k","restricted":true});
        for (mut verdict, readable, pods) in [
            (serving, true, not_serving_pods(2)),
            (drop, true, not_serving_pods(2)),
            (restricted, true, not_serving_pods(2)),
            (k8s.clone(), false, not_serving_pods(2)),
            (
                k8s.clone(),
                true,
                NotServingPods {
                    source_streams: vec![],
                    ..not_serving_pods(2)
                },
            ),
        ] {
            let before = verdict.clone();
            assert!(!pods.attach(&mut verdict, readable, true));
            assert_eq!(
                verdict, before,
                "no pods field without a readable K8s not_serving verdict"
            );
        }
    }

    #[test]
    fn an_alias_put_without_the_allowance_decodes_as_not_allowed() {
        let decode = |row: &serde_json::Value| {
            let wire = serde_json::json!({"AliasPut": {"org_id": "o", "rows": [row]}});
            match serde_json::from_value::<ServiceIdentityMessage>(wire).unwrap() {
                ServiceIdentityMessage::AliasPut { rows, .. } => rows[0].allow_collisions,
                other => panic!("decoded as {other:?}"),
            }
        };
        let mut row = serde_json::to_value(AliasRow {
            alias_key: "k".into(),
            org_id: "o".into(),
            allow_collisions: true,
            ..Default::default()
        })
        .unwrap();
        assert!(decode(&row));
        row["a_field_from_a_newer_region"] = serde_json::json!(true);
        assert!(decode(&row), "unknown fields must not block a row");
        row.as_object_mut().unwrap().remove("allow_collisions");
        assert!(!decode(&row));
    }

    #[test]
    fn not_serving_pods_wire_shape_hides_source_streams() {
        let value = serde_json::to_value(not_serving_pods(1)).unwrap();
        assert_eq!(
            value.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["pods", "pods_total"]
        );
        let decoded: NotServingPods = serde_json::from_value(value).unwrap();
        assert!(decoded.source_streams.is_empty());
    }
}
