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

use std::collections::{BTreeMap, BTreeSet};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{
    meta::service_identity::{
        COMPARE_DISABLED_NO_SPAN_VERSION, OrgIdentity, ServiceVersionRecord,
        VERSION_SOURCE_K8S_POD_IMAGE, VersionImage, WhereKind, WhereSummaryRecord, canon_env,
        is_no_env, is_no_env_literal, service_key,
    },
    utils::time::now_micros,
};
use infra::{db::get_orm_client_rw, table::service_versions};
use o2_enterprise::enterprise::service_identity::infer::{self, InferredEnv, WhereIdentity};
use serde_json::{Value, json};

use super::access::{self, ReadableStreams};

// The env picker counts only scopes seen in the last 7 days.
const ENV_WINDOW_US: i64 = 7 * 86_400_000_000;

pub struct Context {
    pub org: String,
    pub user: String,
    pub summaries: Vec<WhereSummaryRecord>,
    pub readable: ReadableStreams,
    pub identity: OrgIdentity,
    pub aliases: std::sync::Arc<Vec<config::meta::service_identity::AliasRow>>,
}

impl Context {
    pub async fn load(org: &str, user: &str, method: &str) -> Result<Self, Response> {
        if !access::endpoint(org, user, method).await {
            return Err(error(StatusCode::FORBIDDEN, "Unauthorized Access"));
        }
        let summaries = db::service_identity::get_cached_summaries(org)
            .await
            .map_err(unavailable)?;
        let readable = ReadableStreams::load(org, user, &summaries).await;
        let summaries = readable.visible(&summaries);
        let overrides = infra::table::service_identity_rules::list(get_orm_client_rw().await, org)
            .await
            .map_err(unavailable)?;
        Ok(Self {
            org: org.to_string(),
            user: user.to_string(),
            summaries,
            readable,
            identity: OrgIdentity { overrides },
            aliases: db::service_identity::get_cached_aliases(org)
                .await
                .map_err(unavailable)?,
        })
    }

    pub fn names(&self, service: &str, place: Option<&str>) -> BTreeSet<String> {
        let key = service_key(service);
        std::iter::once(service.to_string())
            .chain(
                self.aliases
                    .iter()
                    .filter(|row| {
                        row.deleted_at.is_none()
                            && row.status == "active"
                            && !row.conflicted
                            && matches!(row.kind.as_str(), "rename" | "rum_service")
                            && service_key(&row.canonical) == key
                            && (row.scope.is_empty()
                                || place.is_none_or(|place| {
                                    self.summaries.iter().any(|summary| {
                                        summary.where_key == place
                                            && summary.k8s_namespace == row.scope
                                    })
                                }))
                    })
                    .map(|row| row.alias.clone()),
            )
            .collect()
    }

    /// The scope keys of `names` in `place`, or in every place, matched by service key.
    pub fn scope_keys(&self, names: &BTreeSet<String>, place: Option<&str>) -> Vec<String> {
        let keys: BTreeSet<String> = names.iter().map(|name| service_key(name)).collect();
        let scopes: BTreeSet<&str> = self
            .summaries
            .iter()
            .filter(|row| {
                place.is_none_or(|place| place == row.where_key)
                    && keys.contains(&service_key(&row.service_name))
            })
            .map(|row| row.scope_key.as_str())
            .collect();
        scopes.into_iter().map(str::to_string).collect()
    }

    pub fn visible(&self, service: &str, place: &str) -> bool {
        let key = service_key(service);
        self.summaries
            .iter()
            .any(|row| row.where_key == place && service_key(&row.service_name) == key)
    }

    /// The scope's label from its first-seen row, plus `envs`: every env it was seen in.
    pub fn scope_label(&self, service: &str, place: &str) -> Option<Value> {
        let key = service_key(service);
        let rows: Vec<_> = self
            .summaries
            .iter()
            .filter(|row| row.where_key == place && service_key(&row.service_name) == key)
            .collect();
        (!rows.is_empty()).then(|| self.pinned_label(&rows))
    }

    /// `scope_label` for every visible scope at once.
    pub fn scope_labels(&self) -> BTreeMap<(&str, &str), Value> {
        let mut scopes: BTreeMap<(String, &str), Vec<&WhereSummaryRecord>> = BTreeMap::new();
        for row in &self.summaries {
            scopes
                .entry((service_key(&row.service_name), &row.where_key))
                .or_default()
                .push(row);
        }
        // One label per scope, filed under every casing its rows carry so any row finds it.
        let mut labels = BTreeMap::new();
        for rows in scopes.into_values() {
            let label = self.pinned_label(&rows);
            for row in &rows {
                labels
                    .entry((row.service_name.as_str(), row.where_key.as_str()))
                    .or_insert_with(|| label.clone());
            }
        }
        labels
    }

    pub fn label(
        &self,
        service: &str,
        place: &str,
        cluster: &str,
        namespace: &str,
        environment: (&str, config::meta::service_identity::EnvSource, &str),
    ) -> Value {
        let (env, source, source_value) = environment;
        let kind = if place.starts_with("k8s:") {
            WhereKind::K8s
        } else if place.starts_with("env:") {
            WhereKind::Env
        } else {
            WhereKind::Default
        };
        let resolved = infer::resolve_env(
            &self.identity,
            service,
            &WhereIdentity {
                where_key: place.to_string(),
                where_kind: kind,
                k8s_cluster: cluster.to_string(),
                k8s_namespace: namespace.to_string(),
            },
            InferredEnv {
                env: env.to_string(),
                env_source: source,
                env_source_value: source_value.to_string(),
                applied_override: None,
            },
        );
        let override_key = resolved.applied_override.map(|row| row.rule_key);
        let env_source = if override_key.is_some() {
            json!("override")
        } else {
            json!(source)
        };
        let no_env = override_key.is_none() && is_no_env(&resolved.env, source, source_value);
        let env_is_inferred = override_key.is_none() && source.is_inferred();
        json!({"where_key":place,"where":{"kind":kind,"k8s_cluster":cluster,"k8s_namespace":namespace},"env":resolved.env,"env_source":env_source,"env_source_value":override_key.as_deref().unwrap_or(source_value),"env_inferred":env,"env_inferred_source":source,"override_key":override_key,"no_env":no_env,"env_is_inferred":env_is_inferred})
    }

    pub fn version(&self, row: &ServiceVersionRecord, now: i64) -> Value {
        let mut result = serde_json::to_value(row).expect("registry row serialization");
        let label = self
            .scope_label(&row.service_name, &row.where_key)
            .unwrap_or_else(|| {
                self.label(
                    &row.service_name,
                    &row.where_key,
                    &row.k8s_cluster,
                    &row.k8s_namespace,
                    (&row.env, row.env_source, &row.env_source_value),
                )
            });
        result
            .as_object_mut()
            .expect("registry object")
            .extend(label.as_object().expect("label object").clone());
        let (disabled, reason) = compare_disabled(row);
        result["compare_disabled"] = json!(disabled);
        result["compare_disabled_reason"] = json!(reason);
        let active = row.last_seen >= now - 900_000_000;
        result["active"] = json!(active);
        result["status"] = json!(if active { "active" } else { "inactive" });
        let bounds = |first: Option<i64>, last: Option<i64>| {
            last.filter(|last| row.deleted_at.is_none_or(|deleted| *last > deleted))
                .map(|last| json!({"first_seen":first,"last_seen":last}))
        };
        result["signals"] = json!({"traces":bounds(row.traces_first_seen,row.traces_last_seen),"rum":bounds(row.rum_first_seen,row.rum_last_seen)});
        result
    }

    // An override relabels every env of the scope, so its set is the override alone.
    fn pinned_label(&self, rows: &[&WhereSummaryRecord]) -> Value {
        let pinned = rows
            .iter()
            .min_by_key(|row| (row.first_seen, &row.summary_key))
            .expect("nonempty scope");
        let mut label = self.label(
            &pinned.service_name,
            &pinned.where_key,
            &pinned.k8s_cluster,
            &pinned.k8s_namespace,
            (&pinned.env, pinned.env_source, &pinned.env_source_value),
        );
        let envs: Vec<String> = if label["override_key"].is_null() {
            let others: BTreeSet<&str> = rows
                .iter()
                .flat_map(|row| {
                    row.envs
                        .iter()
                        .map(String::as_str)
                        .chain([row.env.as_str()])
                })
                .filter(|env| !env.is_empty() && *env != pinned.env)
                .collect();
            (!pinned.env.is_empty())
                .then_some(pinned.env.as_str())
                .into_iter()
                .chain(others)
                .map(str::to_string)
                .collect()
        } else {
            vec![label["env"].as_str().unwrap_or_default().to_string()]
        };
        label["envs"] = json!(envs);
        label
    }
}

type EnvGroup = (
    BTreeSet<String>,
    BTreeSet<String>,
    BTreeSet<String>,
    BTreeSet<String>,
);

pub async fn versions(ctx: &Context, params: &BTreeMap<String, String>) -> Result<Value, Response> {
    let service = params
        .get("service")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "service is required"))?;
    let place = params.get("where");
    let names = ctx.names(service, place.map(String::as_str));
    let scopes = ctx.scope_keys(&names, place.map(String::as_str));
    let rows: Vec<ServiceVersionRecord> =
        service_versions::active_by_scopes(get_orm_client_rw().await, &ctx.org, &scopes, i64::MIN)
            .await
            .map_err(unavailable)?
            .into_iter()
            .filter(|row| {
                ctx.names(service, Some(&row.where_key))
                    .iter()
                    .any(|name| service_key(name) == service_key(&row.service_name))
            })
            .collect();
    let now = now_micros();
    let mut versions: Vec<_> = rows
        .iter()
        .map(|row| ctx.version(row, now))
        .filter(|row| version_listed(row, params))
        .collect();
    versions.sort_by(|a, b| {
        b["first_seen"]
            .as_i64()
            .cmp(&a["first_seen"].as_i64())
            .then_with(|| a["version_key"].as_str().cmp(&b["version_key"].as_str()))
    });
    let total = versions.len();
    let (limit, offset) = page(params, 100)?;
    versions = versions.into_iter().skip(offset).take(limit).collect();
    let images = version_images(rows.iter());
    for value in &mut versions {
        let Some(key) = value["version_key"].as_str() else {
            continue;
        };
        let Some(row) = rows.iter().find(|row| row.version_key == key) else {
            continue;
        };
        let previous = rows
            .iter()
            .filter(|other| other.where_key == row.where_key && other.first_seen < row.first_seen)
            .max_by(|a, b| {
                a.first_seen
                    .cmp(&b.first_seen)
                    .then_with(|| b.version_key.cmp(&a.version_key))
            });
        value["previous_version"] = json!(previous.map(|row| &row.version));
        value["previous_image"] = json!(previous.and_then(|row| row.image.as_ref()));
        value["version_images"] = json!(image_count(&images, row));
        value["overlaps"] = json!(
            rows.iter()
                .filter(|other| other.where_key == row.where_key
                    && other.version_key != row.version_key
                    && other.first_seen <= row.last_seen
                    && row.first_seen <= other.last_seen)
                .map(|other| &other.version)
                .collect::<BTreeSet<_>>()
        );
        value["as_name"] = if service_key(&row.service_name) == service_key(service) {
            Value::Null
        } else {
            json!(row.service_name)
        };
    }
    super::signals::reads::enrich_versions(ctx, &mut versions).await?;
    let mut response = json!({"service":service,"aliases_applied":names.iter().filter(|name| *name != service).collect::<Vec<_>>(),"versions":versions,"total":total});
    if let Some(purged) = scope_purged_versions(ctx, &names, params.get("where")) {
        response["purged_versions"] = json!(purged);
    }
    response["tracking"] = super::signals::reads::tracking(&ctx.org).await?;
    Ok(response)
}

pub async fn catalog(ctx: &Context, params: &BTreeMap<String, String>) -> Result<Value, Response> {
    if params
        .get("signal")
        .is_some_and(|signal| !matches!(signal.as_str(), "traces" | "rum"))
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid signal"));
    }
    let wanted = params.get("service").map(|v| service_key(v));
    let mut groups: BTreeMap<(String, &str), Vec<&WhereSummaryRecord>> = BTreeMap::new();
    for row in &ctx.summaries {
        let key = service_key(&row.service_name);
        if params.get("where").is_some_and(|v| v != &row.where_key)
            || params
                .get("q")
                .is_some_and(|v| !row.service_name.contains(v))
            || params.get("signal").is_some_and(|v| v != &row.signal)
            || wanted.as_ref().is_some_and(|v| v != &key)
        {
            continue;
        }
        groups.entry((key, &row.where_key)).or_default().push(row);
    }
    let labels = ctx.scope_labels();
    let filtered = params.contains_key("env") || params.get("no_env").is_some_and(|v| v == "true");
    groups.retain(|_, rows| {
        labels
            .get(&(rows[0].service_name.as_str(), rows[0].where_key.as_str()))
            .map_or(!filtered, |label| env_filter_matches(label, params))
    });
    let keys: Vec<_> = groups
        .values()
        .flat_map(|rows| rows.iter().map(|row| row.newest_version_key.clone()))
        .collect();
    let registry = service_versions::get_by_keys(get_orm_client_rw().await, &ctx.org, &keys)
        .await
        .map_err(unavailable)?;
    let ranks: BTreeMap<_, _> = registry
        .iter()
        .filter(|row| row.is_live())
        .map(|row| (&row.version_key, row))
        .collect();
    let mut scopes: Vec<_> = groups
        .into_values()
        .map(|rows| {
            let newest = rows
                .iter()
                .filter_map(|row| ranks.get(&row.newest_version_key))
                .max_by_key(|row| (row.first_seen, &row.version_key));
            let row = rows
                .iter()
                .max_by_key(|row| row.last_seen)
                .expect("nonempty scope");
            let mut result = labels
                .get(&(row.service_name.as_str(), row.where_key.as_str()))
                .cloned()
                .unwrap_or_else(|| summary_label(ctx, row));
            let obj = result.as_object_mut().expect("label object");
            obj.insert("service".into(), json!(row.service_name));
            obj.insert("scope_key".into(), json!(row.scope_key));
            obj.insert("newest_version".into(), json!(newest.map(|v| &v.version)));
            obj.insert(
                "newest_image".into(),
                json!(newest.and_then(|v| v.image.as_ref())),
            );
            obj.insert(
                "newest_version_key".into(),
                json!(newest.map(|v| &v.version_key)),
            );
            obj.insert(
                "newest_first_seen".into(),
                json!(newest.map(|v| v.first_seen)),
            );
            obj.insert(
                "signals".into(),
                json!(rows.iter().map(|r| &r.signal).collect::<BTreeSet<_>>()),
            );
            result
        })
        .collect();
    scopes.sort_by(|a, b| {
        b["newest_first_seen"]
            .as_i64()
            .cmp(&a["newest_first_seen"].as_i64())
            .then_with(|| a["scope_key"].as_str().cmp(&b["scope_key"].as_str()))
    });
    let mut scopes = scopes;
    let registry_scopes = scopes.clone();
    let verdict_status = match super::signals::reads::enrich_catalog(ctx, &mut scopes, params).await
    {
        Ok(()) => "ok",
        Err(response) if response.status() == StatusCode::SERVICE_UNAVAILABLE => {
            if params.contains_key("verdict") {
                return Err(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "verdicts_unavailable",
                ));
            }
            let (limit, offset) = page(params, 100)?;
            scopes = registry_scopes
                .into_iter()
                .skip(offset)
                .take(limit)
                .collect();
            "unavailable"
        }
        Err(response) => return Err(response),
    };
    let scope_keys: Vec<_> = scopes
        .iter()
        .filter_map(|row| row["scope_key"].as_str().map(str::to_string))
        .collect();
    let active = service_versions::active_by_scopes(
        get_orm_client_rw().await,
        &ctx.org,
        &scope_keys,
        now_micros() - 900_000_000,
    )
    .await
    .map_err(unavailable)?;
    let verdict_counts = catalog_verdict_counts(&scopes);
    let images = version_images(
        service_versions::imaged_by_scopes(get_orm_client_rw().await, &ctx.org, &scope_keys)
            .await
            .map_err(unavailable)?
            .iter(),
    );
    for scope in &mut scopes {
        let serving: Vec<_> = active
            .iter()
            .filter(|row| scope["scope_key"] == row.scope_key)
            .collect();
        let shown = scope_identity(scope, "current").or_else(|| scope_identity(scope, "newest"));
        let current = super::signals::reads::current_version(shown, &serving);
        set_scope_identity(scope, "current", current.as_ref());
        scope["active_version_keys"] = json!(
            active
                .iter()
                .filter(|row| scope["scope_key"] == row.scope_key)
                .map(|row| (&row.version, &row.version_key))
                .collect::<BTreeMap<_, _>>()
        );
        scope["active_versions"] = json!(
            active
                .iter()
                .filter(|row| scope["scope_key"] == row.scope_key)
                .map(|row| &row.version)
                .collect::<Vec<_>>()
        );
        scope["active_version_rows"] = json!(
            serving
                .iter()
                .map(|row| {
                    let (disabled, reason) = compare_disabled(row);
                    json!({"version":row.version,"version_key":row.version_key,"image":row.image,"image_ref":row.image_ref,"version_images":image_count(&images, row),"compare_disabled":disabled,"compare_disabled_reason":reason})
                })
                .collect::<Vec<_>>()
        );
        let newest = scope["newest_version_key"]
            .as_str()
            .and_then(|key| ranks.get(&key.to_string()).copied());
        let current = scope_identity(scope, "current").and_then(|identity| {
            serving
                .iter()
                .copied()
                .chain(newest)
                .find(|row| row.identity() == identity)
        });
        set_scope_version(scope, "newest", newest, &images);
        set_scope_version(scope, "current", current, &images);
        for image in ["previous_image", "last_good_image"] {
            if scope.get(image).is_none() {
                scope[image] = Value::Null;
            }
        }
        count_pre_existing_images(scope, &images);
    }
    let env_groups = catalog_env_groups(&labels);
    let tracking = super::signals::reads::tracking(&ctx.org).await?;
    let stripped = stripped_versions(
        &ctx.summaries,
        &service_versions::raw_versions(get_orm_client_rw().await, &ctx.org)
            .await
            .map_err(unavailable)?,
    );
    Ok(
        json!({"registry_status":"ok","stripped_versions":stripped,"verdict_status":verdict_status,"verdict_counts":verdict_counts,"services":scopes,"envs":env_groups,"tracking":tracking}),
    )
}

/// A scope label is in `env` when it is its env or any env it was seen in, never as no env.
pub fn env_matches(label: &Value, env: &str) -> bool {
    label_env_entries(label)
        .iter()
        .any(|entry| entry.as_deref() == Some(env))
}

/// A scope label is in the No env option when it, or any env it was seen in, reported none.
pub fn no_env_matches(label: &Value) -> bool {
    label_env_entries(label).contains(&None)
}

/// The `env` and `no_env=true` filters together; either one absent passes.
pub fn env_filter_matches(label: &Value, params: &BTreeMap<String, String>) -> bool {
    params.get("env").is_none_or(|env| env_matches(label, env))
        && params
            .get("no_env")
            .is_none_or(|value| value != "true" || no_env_matches(label))
}

/// The `{prefix}_version` and `{prefix}_image` pair of a catalog scope.
pub fn scope_identity(scope: &Value, prefix: &str) -> Option<VersionImage> {
    scope[format!("{prefix}_version")]
        .as_str()
        .map(|version| VersionImage {
            version: version.to_string(),
            image: scope[format!("{prefix}_image")]
                .as_str()
                .map(str::to_string),
        })
}

pub fn set_scope_identity(scope: &mut Value, prefix: &str, version: Option<&VersionImage>) {
    scope[format!("{prefix}_version")] = json!(version.map(|v| &v.version));
    scope[format!("{prefix}_image")] = json!(version.and_then(|v| v.image.as_ref()));
}

/// Distinct known images per (scope, version text).
pub fn version_images<'a>(
    rows: impl Iterator<Item = &'a ServiceVersionRecord>,
) -> BTreeMap<(String, String), usize> {
    let mut images: BTreeMap<(String, String), BTreeSet<&str>> = BTreeMap::new();
    for row in rows {
        if let Some(image) = row.image.as_deref() {
            images
                .entry((row.scope_key.clone(), row.version.clone()))
                .or_default()
                .insert(image);
        }
    }
    images
        .into_iter()
        .map(|(key, images)| (key, images.len()))
        .collect()
}

pub fn image_count(
    images: &BTreeMap<(String, String), usize>,
    row: &ServiceVersionRecord,
) -> usize {
    images
        .get(&(row.scope_key.clone(), row.version.clone()))
        .copied()
        .unwrap_or_default()
}

/// A version known only from K8s has no spans to compare yet.
pub fn compare_disabled(row: &ServiceVersionRecord) -> (bool, Option<&'static str>) {
    let disabled = row.version_source == VERSION_SOURCE_K8S_POD_IMAGE;
    (
        disabled,
        disabled.then_some(COMPARE_DISABLED_NO_SPAN_VERSION),
    )
}

pub async fn envs(ctx: &Context, params: &BTreeMap<String, String>) -> Result<Value, Response> {
    let since = now_micros() - ENV_WINDOW_US;
    let rows: Vec<_> = ctx
        .summaries
        .iter()
        .filter(|row| row.last_seen >= since)
        .collect();
    let place = params.get("where");
    let versions = match place {
        Some(_) => Some(
            db::service_identity::get_cached_scope_versions(&ctx.org)
                .await
                .map_err(unavailable)?,
        ),
        None => None,
    };
    let envs = env_options(&rows, &ctx.scope_labels(), versions.as_deref());
    let mut result =
        json!({"envs":envs,"can_edit":access::endpoint(&ctx.org, &ctx.user, "PUT").await});
    if let (Some(place), Some(counts)) = (place, &versions) {
        let (services, versions) = scope_counts(&rows, place, params.get("service"), counts);
        result["scope_counts"] = services;
        result["scope_versions"] = versions;
    }
    Ok(result)
}

pub async fn unresolved(
    ctx: &Context,
    params: &BTreeMap<String, String>,
) -> Result<Value, Response> {
    let (limit, _) = page(params, 100)?;
    let mut no_version = BTreeMap::new();
    let mut placeholders = BTreeMap::new();
    for row in &ctx.summaries {
        if !row.has_version {
            no_version.insert((&row.service_name,&row.where_key),json!({"service":row.service_name,"where_key":row.where_key,"env":summary_label(ctx,row)["env"],"signals":[row.signal]}));
        }
        if config::meta::service_identity::is_placeholder_service(&row.service_name) {
            placeholders.insert(
                &row.service_name,
                json!({"service":row.service_name,"last_seen":row.last_seen}),
            );
        }
    }
    Ok(
        json!({"no_version":no_version.into_values().take(limit).collect::<Vec<_>>(),"placeholder_names":placeholders.into_values().take(limit).collect::<Vec<_>>()}),
    )
}

pub async fn overrides(
    ctx: &Context,
    params: &BTreeMap<String, String>,
) -> Result<Value, Response> {
    let rows: Vec<_> = ctx
        .identity
        .overrides
        .iter()
        .filter(|row| {
            override_visible(ctx, row)
                && params
                    .get("scope")
                    .is_none_or(|scope| scope == row.scope.as_str())
                && params.get("q").is_none_or(|q| {
                    row.value.contains(q)
                        || row.service_name.contains(q)
                        || row.where_key.contains(q)
                })
        })
        .collect();
    let total = rows.len();
    let (limit, offset) = page(params, 50)?;
    let counts = db::service_identity::get_cached_scope_versions(&ctx.org)
        .await
        .map_err(unavailable)?;
    let rows: Vec<_> = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|row| {
            let mut item = serde_json::to_value(row).expect("override serialization");
            item["affected"] = override_affected(ctx, row, &counts);
            item
        })
        .collect();
    Ok(json!({"overrides":rows,"total":total}))
}

pub async fn delete_override(ctx: &Context, key: &str, user: &str) -> Result<Value, Response> {
    let previous = ctx
        .identity
        .overrides
        .iter()
        .find(|row| row.rule_key == key && override_visible(ctx, row))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Override not found"))?;
    let mut row = previous.clone();
    row.deleted_at = Some(now_micros());
    row.updated_at = row.deleted_at.unwrap_or_default();
    row.updated_by = user.to_string();
    row.writer_cluster = config::get_cluster_name();
    persist_override(row).await?;
    Ok(json!({"removed":previous}))
}

pub async fn put_override(
    ctx: &Context,
    request: config::meta::service_identity::OverrideWrite,
    user: &str,
) -> Result<Value, Response> {
    use config::meta::service_identity::{
        Override, OverrideScope, RULE_TYPE_ENV_OVERRIDE, rule_key,
    };
    if request.value.is_empty()
        || request.value.len() > 128
        || !request
            .value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch))
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid override value"));
    }
    let Some(value) = canon_env(&request.value) else {
        return Err(error(StatusCode::BAD_REQUEST, "invalid override value"));
    };
    let consistent = match request.scope {
        OverrideScope::Service => {
            !request.service_name.is_empty()
                && !request.where_key.is_empty()
                && valid_cluster(&request.where_key, &request.k8s_cluster)
        }
        OverrideScope::Where => {
            request.service_name.is_empty()
                && !request.where_key.is_empty()
                && valid_cluster(&request.where_key, &request.k8s_cluster)
        }
        OverrideScope::Cluster => {
            request.service_name.is_empty()
                && request.where_key.is_empty()
                && !request.k8s_cluster.is_empty()
        }
    };
    if !consistent {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "inconsistent override scope",
        ));
    }
    let targets: Vec<_> = ctx
        .summaries
        .iter()
        .filter(|row| match request.scope {
            OverrideScope::Service => {
                row.where_key == request.where_key
                    && same_service(&row.service_name, &request.service_name)
            }
            OverrideScope::Where => row.where_key == request.where_key,
            OverrideScope::Cluster => row.k8s_cluster == request.k8s_cluster,
        })
        .collect();
    if targets.is_empty() {
        return Err(error(StatusCode::NOT_FOUND, "Override target not found"));
    }
    let target = service_versions::latest_in_scope(
        get_orm_client_rw().await,
        &ctx.org,
        request.scope,
        &request.k8s_cluster,
        &request.where_key,
        &request.service_name,
    )
    .await
    .map_err(unavailable)?
    .filter(|row| ctx.visible(&row.service_name, &row.where_key))
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "Override target not found"))?;
    let key = rule_key(
        &ctx.org,
        request.scope.as_str(),
        &request.k8s_cluster,
        &request.where_key,
        &request.service_name,
    );
    let previous = ctx
        .identity
        .overrides
        .iter()
        .find(|row| row.rule_key == key);
    if previous.is_none() && ctx.identity.overrides.len() >= 1000 {
        return Err(error(StatusCode::BAD_REQUEST, "Override limit reached"));
    }
    let mut affected_services = BTreeSet::new();
    let mut affected_versions = 0;
    let scopes: BTreeSet<_> = targets
        .iter()
        .map(|row| (&row.service_name, &row.where_key, &row.k8s_cluster))
        .collect();
    for (service, place, cluster) in scopes {
        let affected = service_versions::count_by_scope(
            get_orm_client_rw().await,
            &ctx.org,
            OverrideScope::Service,
            cluster,
            place,
            service,
        )
        .await
        .map_err(unavailable)?;
        if affected.services > 0 {
            affected_services.insert(service);
        }
        affected_versions += affected.versions;
    }
    let now = now_micros();
    let removed = value == target.env;
    let row = Override {
        rule_key: key,
        org_id: ctx.org.clone(),
        rule_type: RULE_TYPE_ENV_OVERRIDE.to_string(),
        scope: request.scope,
        k8s_cluster: request.k8s_cluster,
        where_key: request.where_key,
        service_name: request.service_name,
        value,
        inferred_value: previous
            .map_or_else(|| target.env.clone(), |row| row.inferred_value.clone()),
        inferred_source: previous.map_or(target.env_source, |row| row.inferred_source),
        created_by: previous.map_or_else(|| user.to_string(), |row| row.created_by.clone()),
        updated_by: user.to_string(),
        created_at: previous.map_or(now, |row| row.created_at),
        updated_at: now,
        deleted_at: removed.then_some(now),
        writer_cluster: config::get_cluster_name(),
    };
    persist_override(row.clone()).await?;
    Ok(
        json!({"override":(!removed).then_some(row),"previous":previous,"removed":removed,"affected":{"services":affected_services.len(),"versions":affected_versions}}),
    )
}

pub async fn delete_version(ctx: &Context, key: &str) -> Result<Value, Response> {
    let rows =
        service_versions::get_by_keys(get_orm_client_rw().await, &ctx.org, &[key.to_string()])
            .await
            .map_err(unavailable)?;
    let live = rows
        .iter()
        .any(|row| row.is_live() && ctx.visible(&row.service_name, &row.where_key));
    if live {
        let deleted_at = now_micros().max(
            rows.iter()
                .map(|row| row.last_seen)
                .max()
                .unwrap_or_default(),
        );
        let message = config::meta::service_identity::ServiceIdentityMessage::VersionsDelete {
            org_id: ctx.org.clone(),
            records: rows
                .iter()
                .map(|row| config::meta::service_identity::VersionDeletion {
                    org_id: row.org_id.clone(),
                    service_name: row.service_name.clone(),
                    where_key: row.where_key.clone(),
                    version: row.version.clone(),
                    image: row.image.clone(),
                    scope_key: row.scope_key.clone(),
                    version_key: row.version_key.clone(),
                    deleted_at,
                })
                .collect(),
        };
        db::service_identity_sync::apply_remote_with(
            get_orm_client_rw().await,
            &ctx.org,
            message.clone(),
        )
        .await
        .map_err(unavailable)?;
        db::service_identity_sync::publish(message).await;
        db::service_identity::invalidate_summaries(&ctx.org).await;
    }
    Ok(json!({"deleted":live}))
}

pub fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}

pub fn unavailable(error: impl std::fmt::Display) -> Response {
    log::error!("service versions registry unavailable: {error}");
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"registry_unavailable","retry_after_secs":5,"registry_status":"unavailable"}))).into_response()
}

pub fn page(params: &BTreeMap<String, String>, default: usize) -> Result<(usize, usize), Response> {
    let parse = |name: &str, fallback| {
        params.get(name).map_or(Ok(fallback), |value| {
            value
                .parse::<usize>()
                .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid pagination"))
        })
    };
    Ok((parse("limit", default)?.clamp(1, 1000), parse("offset", 0)?))
}

async fn persist_override(row: config::meta::service_identity::Override) -> Result<(), Response> {
    let org = row.org_id.clone();
    infra::table::service_identity_rules::upsert(get_orm_client_rw().await, &row)
        .await
        .map_err(unavailable)?;
    let message = if row.deleted_at.is_some() {
        config::meta::service_identity::ServiceIdentityMessage::OverrideDelete {
            org_id: org.clone(),
            rule_key: row.rule_key.clone(),
            updated_at: row.updated_at,
            writer_cluster: row.writer_cluster.clone(),
        }
    } else {
        config::meta::service_identity::ServiceIdentityMessage::OverridePut { row: Box::new(row) }
    };
    db::service_identity_sync::publish(message).await;
    infra::coordinator::service_identity::emit_reload_event(&org)
        .await
        .map_err(unavailable)?;
    db::service_identity::on_event_with(
        get_orm_client_rw().await,
        &format!("/service_identity/{org}"),
    )
    .await;
    Ok(())
}

fn override_visible(ctx: &Context, row: &config::meta::service_identity::Override) -> bool {
    ctx.summaries
        .iter()
        .any(|scope| override_matches(row, scope))
}

fn override_matches(
    row: &config::meta::service_identity::Override,
    scope: &WhereSummaryRecord,
) -> bool {
    use config::meta::service_identity::OverrideScope;
    match row.scope {
        OverrideScope::Service => {
            same_service(&row.service_name, &scope.service_name) && row.where_key == scope.where_key
        }
        OverrideScope::Where => row.where_key == scope.where_key,
        OverrideScope::Cluster => row.k8s_cluster == scope.k8s_cluster,
    }
}

/// What an override relabels among the caller's visible scopes, counted like a PUT's `affected`.
fn override_affected(
    ctx: &Context,
    row: &config::meta::service_identity::Override,
    counts: &BTreeMap<String, u64>,
) -> Value {
    let scopes: BTreeSet<_> = ctx
        .summaries
        .iter()
        .filter(|scope| override_matches(row, scope))
        .map(|scope| (&scope.service_name, &scope.scope_key))
        .collect();
    let mut services = BTreeSet::new();
    let mut versions = 0;
    for (service, key) in scopes {
        if let Some(count) = counts.get(key).filter(|count| **count > 0) {
            services.insert(service);
            versions += count;
        }
    }
    json!({"services":services.len(),"versions":versions})
}

/// Services and versions per Apply-to option; `cluster` exists only for a k8s where.
fn scope_counts(
    rows: &[&WhereSummaryRecord],
    place: &str,
    service: Option<&String>,
    versions: &BTreeMap<String, u64>,
) -> (Value, Value) {
    let tally = |keep: &dyn Fn(&WhereSummaryRecord) -> bool| {
        let scopes: BTreeSet<_> = rows
            .iter()
            .filter(|row| keep(row))
            .map(|row| (&row.service_name, &row.scope_key))
            .collect();
        let services = scopes
            .iter()
            .map(|(name, _)| *name)
            .collect::<BTreeSet<_>>()
            .len();
        let count: u64 = scopes
            .iter()
            .filter_map(|(_, key)| versions.get(*key))
            .sum();
        (services, count)
    };
    let (in_where, where_versions) = tally(&|row| row.where_key == place);
    let (one, one_versions) = tally(&|row| {
        row.where_key == place && service.is_some_and(|name| *name == row.service_name)
    });
    let mut counts = json!({"where":in_where,"service":one});
    let mut totals = json!({"where":where_versions,"service":one_versions});
    if let Some((cluster, _)) = place
        .strip_prefix("k8s:")
        .and_then(|rest| rest.split_once('/'))
    {
        let (services, count) = tally(&|row| row.k8s_cluster == cluster);
        counts["cluster"] = json!(services);
        totals["cluster"] = json!(count);
    }
    (counts, totals)
}

fn version_listed(version: &Value, params: &BTreeMap<String, String>) -> bool {
    env_filter_matches(version, params)
        && (params
            .get("include_inactive")
            .is_none_or(|value| value != "false")
            || version["active"] == true)
}

/// The Env filter options, real envs by name, then one No env option when any scope has none.
fn env_options(
    rows: &[&WhereSummaryRecord],
    labels: &BTreeMap<(&str, &str), Value>,
    versions: Option<&BTreeMap<String, u64>>,
) -> Vec<Value> {
    let mut groups: BTreeMap<String, EnvGroup> = BTreeMap::new();
    let mut none = EnvGroup::default();
    for row in rows {
        let Some(label) = labels.get(&(row.service_name.as_str(), row.where_key.as_str())) else {
            continue;
        };
        for entry in label_env_entries(label) {
            let group = match entry {
                Some(env) => groups.entry(env).or_default(),
                None => &mut none,
            };
            group.0.insert(row.service_name.clone());
            group.1.insert(row.where_key.clone());
            group.2.insert(row.env_source.as_str().to_string());
            group.3.insert(row.scope_key.clone());
        }
    }
    let item = |env: String, no_env: bool, (services, wheres, sources, scopes): EnvGroup| {
        let inferred = !no_env
            && !sources.is_empty()
            && sources.iter().all(|source| {
                source
                    .parse::<config::meta::service_identity::EnvSource>()
                    .is_ok_and(|source| source.is_inferred())
            });
        let mut item = json!({"env":env,"no_env":no_env,"inferred":inferred,"services":services.len(),"wheres":wheres.len(),"sources":sources});
        if let Some(counts) = versions {
            item["versions"] = json!(scopes.iter().filter_map(|key| counts.get(key)).sum::<u64>());
        }
        item
    };
    let mut items: Vec<_> = groups
        .into_iter()
        .map(|(env, group)| item(env, false, group))
        .collect();
    if !none.0.is_empty() {
        items.push(item(String::new(), true, none));
    }
    items
}

/// The catalog `envs` groups: real envs by name, then the no-env group when it is not empty.
fn catalog_env_groups(labels: &BTreeMap<(&str, &str), Value>) -> Vec<Value> {
    let mut groups: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut none: BTreeSet<String> = BTreeSet::new();
    for ((_, place), label) in labels {
        for entry in label_env_entries(label) {
            match entry {
                Some(env) => groups.entry(env).or_default(),
                None => &mut none,
            }
            .insert((*place).to_string());
        }
    }
    let mut items: Vec<_> = groups
        .into_iter()
        .map(|(env, where_keys)| json!({"env":env,"no_env":false,"where_keys":where_keys}))
        .collect();
    if !none.is_empty() {
        items.push(json!({"env":"","no_env":true,"where_keys":none}));
    }
    items
}

/// Every env a label lists; a scope without any keeps its single (possibly empty) env group.
fn label_envs(label: &Value) -> Vec<String> {
    let envs: Vec<String> = label["envs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|env| env.as_str().map(str::to_string))
        .collect();
    if envs.is_empty() {
        vec![label["env"].as_str().unwrap_or_default().to_string()]
    } else {
        envs
    }
}

/// Each env a label counts under; `None` is the single no-env group.
fn label_env_entries(label: &Value) -> Vec<Option<String>> {
    let own = label["env"].as_str().unwrap_or_default();
    let own_no_env = label["no_env"] == true;
    let mut entries = Vec::new();
    for env in label_envs(label) {
        let no_env = if env == own {
            own_no_env
        } else {
            is_no_env_literal(&env)
        };
        let entry = (!no_env).then_some(env);
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    entries
}

/// The `{prefix}_*` image, source and compare fields of one catalog version, from its row.
fn set_scope_version(
    scope: &mut Value,
    prefix: &str,
    row: Option<&ServiceVersionRecord>,
    images: &BTreeMap<(String, String), usize>,
) {
    let version = format!("{prefix}_version");
    if let Some(row) = row {
        let (disabled, reason) = compare_disabled(row);
        scope[&version] = json!(row.version);
        scope[format!("{prefix}_image")] = json!(row.image);
        scope[format!("{prefix}_image_ref")] = json!(row.image_ref);
        scope[format!("{prefix}_version_images")] = json!(image_count(images, row));
        scope[format!("{prefix}_version_source")] = json!(row.version_source);
        scope[format!("{prefix}_compare_disabled")] = json!(disabled);
        scope[format!("{prefix}_compare_disabled_reason")] = json!(reason);
        return;
    }
    let image = format!("{prefix}_image");
    if scope.get(&image).is_none() {
        scope[image] = Value::Null;
    }
    scope[format!("{prefix}_image_ref")] = Value::Null;
    scope[format!("{prefix}_version_images")] = json!(0);
    scope[format!("{prefix}_version_source")] = Value::Null;
    scope[format!("{prefix}_compare_disabled")] = json!(false);
    scope[format!("{prefix}_compare_disabled_reason")] = Value::Null;
}

/// A pre_existing verdict has no stored summary to carry its image count, so the catalog adds it.
fn count_pre_existing_images(scope: &mut Value, images: &BTreeMap<(String, String), usize>) {
    if scope["newest_verdict"]["state"] != "pre_existing" {
        return;
    }
    let key = (
        scope["scope_key"].as_str().unwrap_or_default().to_string(),
        scope["newest_verdict"]["version"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    );
    scope["newest_verdict"]["version_images"] = json!(images.get(&key).copied().unwrap_or(0));
}

fn summary_label(ctx: &Context, row: &WhereSummaryRecord) -> Value {
    ctx.label(
        &row.service_name,
        &row.where_key,
        &row.k8s_cluster,
        &row.k8s_namespace,
        (&row.env, row.env_source, &row.env_source_value),
    )
}

fn valid_cluster(place: &str, cluster: &str) -> bool {
    if let Some(parts) = place.strip_prefix("k8s:") {
        parts
            .split_once('/')
            .is_some_and(|(expected, _)| expected == cluster)
    } else {
        cluster.is_empty()
    }
}

/// Versions purged from the visible scopes, or `None` when the caller sees none.
fn scope_purged_versions(
    ctx: &Context,
    names: &BTreeSet<String>,
    place: Option<&String>,
) -> Option<i64> {
    let mut by_scope: BTreeMap<&str, i64> = BTreeMap::new();
    let keys: BTreeSet<String> = names.iter().map(|name| service_key(name)).collect();
    for row in ctx.summaries.iter().filter(|row| {
        keys.contains(&service_key(&row.service_name))
            && place.is_none_or(|place| place == &row.where_key)
            && ctx.visible(&row.service_name, &row.where_key)
    }) {
        // Every stream/signal row of a scope carries the scope-wide count, so a scope counts once.
        let count = by_scope.entry(row.scope_key.as_str()).or_default();
        *count = (*count).max(row.purged_versions);
    }
    (!by_scope.is_empty()).then(|| by_scope.values().sum())
}

fn same_service(a: &str, b: &str) -> bool {
    service_key(a) == service_key(b)
}

fn catalog_verdict_counts(scopes: &[Value]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for scope in scopes {
        if scope["newest_verdict"]["restricted"] != true
            && let Some(verdict) = scope["newest_verdict"]["verdict"].as_str()
        {
            *counts.entry(verdict.to_string()).or_default() += 1;
        }
    }
    counts
}

/// Distinct version labels of the readable scopes whose raw value lost a git hash when normalised.
fn stripped_versions(readable: &[WhereSummaryRecord], rows: &[(String, String, String)]) -> usize {
    let scopes: BTreeSet<_> = readable.iter().map(|row| &row.scope_key).collect();
    rows.iter()
        .filter(|(scope, _, raw)| {
            scopes.contains(scope)
                && o2_enterprise::enterprise::service_identity::normalize::stripped_git_hash(raw)
        })
        .map(|(_, version, _)| version)
        .collect::<BTreeSet<_>>()
        .len()
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::AliasRow;

    use super::*;

    fn record(stream: &str, scope: &str) -> WhereSummaryRecord {
        WhereSummaryRecord {
            service_name: "svc".into(),
            where_key: "default".into(),
            k8s_namespace: String::new(),
            summary_key: format!("summary-{scope}"),
            org_id: "org".into(),
            scope_key: scope.into(),
            source_stream: stream.into(),
            signal: "traces".into(),
            k8s_cluster: String::new(),
            env: "default".into(),
            env_source: config::meta::service_identity::EnvSource::Default,
            env_source_value: String::new(),
            envs: Vec::new(),
            newest_version: "v1".into(),
            newest_version_key: format!("version-{scope}"),
            newest_first_seen: 1,
            has_version: true,
            first_seen: 1,
            last_seen: 2,
            purged_versions: 0,
            updated_at: 2,
        }
    }

    fn raw_rows(rows: &[(&str, &str, &str)]) -> Vec<(String, String, String)> {
        rows.iter()
            .map(|(scope, version, raw)| (scope.to_string(), version.to_string(), raw.to_string()))
            .collect()
    }

    #[test]
    fn stripped_versions_counts_each_label_whose_hash_was_cut_once() {
        let readable = [record("t", "s")];
        assert_eq!(stripped_versions(&readable, &[]), 0);
        assert_eq!(
            stripped_versions(
                &readable,
                &raw_rows(&[("s", "1.0", "1.0"), ("s", "2.0", "ghcr.io/o2/web:2.0")])
            ),
            0
        );
        let cut = raw_rows(&[
            ("s", "1.4.2", "1.4.2-a1b2c3d"),
            ("s", "1.4.2", "1.4.2-9f8e7d6"),
            ("s", "1.5.0", "1.5.0"),
            ("other", "2.0.0", "2.0.0-0a1b2c3"),
        ]);
        assert_eq!(stripped_versions(&readable, &cut), 1);
        assert_eq!(stripped_versions(&[], &cut), 0);
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn stripped_versions_count_only_scopes_of_streams_the_user_can_read() {
        use crate::authz::{TypedStream, fake_checker};
        let (org, user) = ("s8w_stripped", "s8w-one-stream@example.com");
        fake_checker().grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: config::meta::stream::StreamType::Traces,
                name: "allowed".into(),
            },
        );
        let summaries = [record("allowed", "open"), record("hidden", "closed")];
        let visible = ReadableStreams::load(org, user, &summaries)
            .await
            .visible(&summaries);
        let rows = raw_rows(&[("closed", "1.4.2", "1.4.2-a1b2c3d")]);
        assert_eq!(stripped_versions(&summaries, &rows), 1);
        assert_eq!(stripped_versions(&visible, &rows), 0);
        let none = ReadableStreams::load(org, "s8w-no-streams@example.com", &summaries)
            .await
            .visible(&summaries);
        assert!(none.is_empty());
        assert_eq!(stripped_versions(&none, &rows), 0);
    }

    #[test]
    fn nameless_default_and_unknown_service_spans_are_listed_as_placeholders() {
        let summary = |name: &str| WhereSummaryRecord {
            service_name: name.into(),
            where_key: "default".into(),
            k8s_namespace: String::new(),
            summary_key: format!("summary-{name}"),
            org_id: "org".into(),
            scope_key: format!("scope-{name}"),
            source_stream: "default".into(),
            signal: "traces".into(),
            k8s_cluster: String::new(),
            env: "default".into(),
            env_source: config::meta::service_identity::EnvSource::Default,
            env_source_value: String::new(),
            envs: Vec::new(),
            newest_version: "v1".into(),
            newest_version_key: format!("version-{name}"),
            newest_first_seen: 1,
            has_version: true,
            first_seen: 1,
            last_seen: 2,
            purged_versions: 0,
            updated_at: 2,
        };
        let ctx = Context {
            org: "org".into(),
            user: String::new(),
            summaries: [
                "",
                "default",
                "unknown_service:node",
                "unknown_services",
                "checkout",
            ]
            .into_iter()
            .map(summary)
            .collect(),
            readable: ReadableStreams {
                traces: Default::default(),
                rum: false,
            },
            identity: OrgIdentity::default(),
            aliases: std::sync::Arc::new(Vec::new()),
        };
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(unresolved(&ctx, &BTreeMap::new()))
            .unwrap();
        let names: Vec<_> = result["placeholder_names"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["service"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["", "default", "unknown_service:node"]);
    }

    #[test]
    fn catalog_counts_only_visible_latest_scope_verdicts() {
        let scopes = vec![
            json!({"newest_verdict":{"verdict":"regressed"}}),
            json!({"newest_verdict":{"verdict":"ok"}}),
            json!({"newest_verdict":{"verdict":"ok"},"verdict_counts":{"ok":42}}),
            json!({"newest_verdict":{"verdict":"regressed","restricted":true}}),
            json!({"newest_verdict":{"state":"pre_existing"}}),
            json!({"newest_verdict":null}),
        ];
        assert_eq!(
            catalog_verdict_counts(&scopes),
            BTreeMap::from([("ok".into(), 2), ("regressed".into(), 1)])
        );
        assert!(catalog_verdict_counts(&[]).is_empty());
    }

    #[test]
    fn history_aliases_are_active_unconflicted_scoped_and_deduplicated() {
        let mut ctx = Context {
            org: "org".into(),
            user: String::new(),
            summaries: vec![WhereSummaryRecord {
                service_name: "checkout".into(),
                where_key: "k8s:c/ns".into(),
                k8s_namespace: "ns".into(),
                summary_key: "summary".into(),
                org_id: "org".into(),
                scope_key: "scope".into(),
                source_stream: "trace".into(),
                signal: "traces".into(),
                k8s_cluster: "c".into(),
                env: "prod".into(),
                env_source: config::meta::service_identity::EnvSource::Default,
                env_source_value: String::new(),
                envs: Vec::new(),
                newest_version: "v1".into(),
                newest_version_key: "version".into(),
                newest_first_seen: 1,
                has_version: true,
                first_seen: 1,
                last_seen: 2,
                purged_versions: 0,
                updated_at: 2,
            }],
            readable: ReadableStreams {
                traces: Default::default(),
                rum: false,
            },
            identity: OrgIdentity::default(),
            aliases: std::sync::Arc::new(Vec::new()),
        };
        let alias = AliasRow {
            kind: "rename".into(),
            scope: "ns".into(),
            alias: "old-checkout".into(),
            canonical: "checkout".into(),
            status: "active".into(),
            ..Default::default()
        };
        ctx.aliases = std::sync::Arc::new(vec![
            alias.clone(),
            alias.clone(),
            AliasRow {
                alias: "proposed".into(),
                status: "proposed".into(),
                ..alias.clone()
            },
            AliasRow {
                alias: "deleted".into(),
                deleted_at: Some(1),
                ..alias.clone()
            },
            AliasRow {
                alias: "conflicted".into(),
                conflicted: true,
                ..alias.clone()
            },
            AliasRow {
                alias: "wrong-namespace".into(),
                scope: "other".into(),
                ..alias.clone()
            },
            AliasRow {
                alias: "rum-checkout".into(),
                kind: "rum_service".into(),
                scope: String::new(),
                ..alias.clone()
            },
            AliasRow {
                alias: "workload".into(),
                kind: "k8s_workload".into(),
                ..alias
            },
        ]);
        assert_eq!(
            ctx.names("checkout", Some("k8s:c/ns")),
            BTreeSet::from([
                "checkout".into(),
                "old-checkout".into(),
                "rum-checkout".into()
            ])
        );
        assert_eq!(
            ctx.names("checkout", Some("k8s:c/other")),
            BTreeSet::from(["checkout".into(), "rum-checkout".into()])
        );
    }

    #[test]
    fn purged_versions_count_each_scope_once_across_stream_rows() {
        let row = |where_key: &str, stream: &str, purged: i64| WhereSummaryRecord {
            service_name: "checkout".into(),
            where_key: where_key.into(),
            k8s_namespace: "ns".into(),
            summary_key: format!("{where_key}/{stream}"),
            org_id: "org".into(),
            scope_key: format!("scope/{where_key}"),
            source_stream: stream.into(),
            signal: "traces".into(),
            k8s_cluster: "c".into(),
            env: "prod".into(),
            env_source: config::meta::service_identity::EnvSource::Default,
            env_source_value: String::new(),
            envs: Vec::new(),
            newest_version: "v1".into(),
            newest_version_key: "version".into(),
            newest_first_seen: 1,
            has_version: true,
            first_seen: 1,
            last_seen: 2,
            purged_versions: purged,
            updated_at: 2,
        };
        let ctx = Context {
            org: "org".into(),
            user: String::new(),
            summaries: vec![
                row("k8s:c/ns", "default", 1),
                row("k8s:c/ns", "second", 1),
                row("k8s:c/ns", "late", 0),
                row("k8s:c/other", "default", 2),
            ],
            readable: ReadableStreams {
                traces: Default::default(),
                rum: false,
            },
            identity: OrgIdentity::default(),
            aliases: std::sync::Arc::new(Vec::new()),
        };
        let names = BTreeSet::from(["checkout".to_string()]);
        let place = "k8s:c/ns".to_string();
        assert_eq!(scope_purged_versions(&ctx, &names, Some(&place)), Some(1));
        assert_eq!(scope_purged_versions(&ctx, &names, None), Some(3));
        let hidden = "k8s:c/hidden".to_string();
        assert_eq!(scope_purged_versions(&ctx, &names, Some(&hidden)), None);
    }

    fn scope_row(
        service: &str,
        env: &str,
        source: config::meta::service_identity::EnvSource,
        source_value: &str,
    ) -> WhereSummaryRecord {
        let mut row = record("traces", &format!("scope-{service}"));
        row.service_name = service.into();
        row.where_key = format!("env:{service}");
        row.summary_key = format!("summary-{service}");
        row.env = env.into();
        row.env_source = source;
        row.env_source_value = source_value.into();
        row.envs = vec![env.to_string()];
        row
    }

    #[test]
    fn case_and_unit_suffix_variants_are_one_service() {
        let mut row = record("traces", "scope-checkout");
        row.service_name = "checkout".into();
        row.where_key = "k8s:c/ns".into();
        let mut ctx = context(vec![row]);
        assert!(ctx.visible("Checkout", "k8s:c/ns"));
        assert!(ctx.visible("checkout.service", "k8s:c/ns"));
        assert!(!ctx.visible("checkout", "k8s:c/other"));
        assert!(ctx.scope_label("CHECKOUT.service", "k8s:c/ns").is_some());
        assert!(ctx.scope_labels().contains_key(&("checkout", "k8s:c/ns")));
        ctx.aliases = std::sync::Arc::new(vec![AliasRow {
            alias: "legacy-checkout".into(),
            canonical: "Checkout".into(),
            kind: "rename".into(),
            status: "active".into(),
            ..Default::default()
        }]);
        assert!(
            ctx.names("checkout.service", Some("k8s:c/ns"))
                .contains("legacy-checkout")
        );
    }

    fn context(summaries: Vec<WhereSummaryRecord>) -> Context {
        Context {
            org: "org".into(),
            user: String::new(),
            summaries,
            readable: ReadableStreams {
                traces: Default::default(),
                rum: false,
            },
            identity: OrgIdentity::default(),
            aliases: std::sync::Arc::new(Vec::new()),
        }
    }

    fn env_scopes() -> Context {
        use config::meta::service_identity::{EnvSource, O2_SERVICE_ENV};
        context(vec![
            scope_row("none-reported", "default", EnvSource::Default, ""),
            scope_row(
                "said-unknown",
                "unknown",
                EnvSource::Attribute,
                "deployment.environment=unknown",
            ),
            scope_row(
                "piped-default",
                "default",
                EnvSource::Attribute,
                O2_SERVICE_ENV,
            ),
            scope_row(
                "from-namespace",
                "prod",
                EnvSource::Namespace,
                "payments-prod",
            ),
            scope_row(
                "reported-prod",
                "prod",
                EnvSource::Attribute,
                "deployment.environment=prod",
            ),
        ])
    }

    #[test]
    fn no_env_and_inferred_flags_come_from_the_source() {
        let ctx = env_scopes();
        let labels = ctx.scope_labels();
        let flags = |service: &str| {
            let place = format!("env:{service}");
            let label = &labels[&(service, place.as_str())];
            (label["no_env"].clone(), label["env_is_inferred"].clone())
        };
        assert_eq!(flags("none-reported"), (json!(true), json!(false)));
        assert_eq!(flags("said-unknown"), (json!(true), json!(false)));
        assert_eq!(flags("piped-default"), (json!(false), json!(false)));
        assert_eq!(flags("from-namespace"), (json!(false), json!(true)));
        assert_eq!(flags("reported-prod"), (json!(false), json!(false)));
        let none = &labels[&("none-reported", "env:none-reported")];
        let real = &labels[&("piped-default", "env:piped-default")];
        assert!(
            !env_matches(none, "default"),
            "no env is not the env named default"
        );
        assert!(env_matches(real, "default"));
        assert!(no_env_matches(none));
        assert!(!no_env_matches(real));
    }

    #[test]
    fn the_env_options_group_no_env_scopes_into_one_last_option() {
        let ctx = env_scopes();
        let rows: Vec<_> = ctx.summaries.iter().collect();
        let items = env_options(&rows, &ctx.scope_labels(), None);
        let summary: Vec<_> = items
            .iter()
            .map(|item| {
                (
                    item["env"].as_str().unwrap().to_string(),
                    item["no_env"].clone(),
                    item["inferred"].clone(),
                    item["services"].clone(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("default".to_string(), json!(false), json!(false), json!(1)),
                ("prod".to_string(), json!(false), json!(false), json!(2)),
                (String::new(), json!(true), json!(false), json!(2)),
            ]
        );
        let only_inferred = context(vec![scope_row(
            "from-namespace",
            "prod",
            config::meta::service_identity::EnvSource::Namespace,
            "payments-prod",
        )]);
        let rows: Vec<_> = only_inferred.summaries.iter().collect();
        let items = env_options(&rows, &only_inferred.scope_labels(), None);
        assert_eq!(items.len(), 1, "no No env option without a no-env scope");
        assert_eq!(items[0]["inferred"], json!(true));
        let groups = catalog_env_groups(&ctx.scope_labels());
        let last = groups.last().unwrap();
        assert_eq!(last["no_env"], json!(true));
        assert_eq!(last["env"], "");
        assert_eq!(
            last["where_keys"],
            json!(["env:none-reported", "env:said-unknown"])
        );
        assert!(
            groups[..groups.len() - 1]
                .iter()
                .all(|group| group["no_env"] == false)
        );
    }

    fn registry_row(
        version: &str,
        image: Option<&str>,
        source: &str,
        first: i64,
    ) -> ServiceVersionRecord {
        let mut observation = config::meta::service_identity::ServiceVersionObservation {
            service_name: "checkout".into(),
            where_key: "env:prod".into(),
            where_kind: WhereKind::Env,
            k8s_cluster: String::new(),
            k8s_namespace: String::new(),
            env: "prod".into(),
            env_source: config::meta::service_identity::EnvSource::Attribute,
            env_source_value: "deployment.environment=prod".into(),
            version: version.into(),
            raw_version: Some(version.into()),
            version_source: source.into(),
            image: image.map(str::to_string),
            image_ref: image.map(|image| format!("ghcr.io/acme/checkout:{version}@{image}")),
            source_stream: "default".into(),
            signal: "traces".into(),
            first_seen: first,
            last_seen: first + 10,
        };
        observation.first_seen = first;
        observation.to_record("org", first)
    }

    #[test]
    fn version_images_count_distinct_images_of_one_version_text() {
        let rows = [
            registry_row("2.4.0", Some("3f9c2ab"), "service.version", 1),
            registry_row("2.4.0", Some("9c1e4b7"), "service.version", 2),
            registry_row("2.4.0", Some("9c1e4b7"), "service.version", 3),
            registry_row("2.3.9", Some("77de019"), "service.version", 0),
            registry_row("2.3.8", None, "service.version", 0),
        ];
        let counts = version_images(rows.iter());
        let scope = rows[0].scope_key.clone();
        assert_eq!(counts[&(scope.clone(), "2.4.0".to_string())], 2);
        assert_eq!(counts[&(scope.clone(), "2.3.9".to_string())], 1);
        assert!(!counts.contains_key(&(scope, "2.3.8".to_string())));
    }

    #[test]
    fn a_k8s_only_version_row_disables_compare_and_carries_its_image() {
        let ctx = context(vec![scope_row(
            "checkout",
            "prod",
            config::meta::service_identity::EnvSource::Attribute,
            "deployment.environment=prod",
        )]);
        let k8s = registry_row(
            "2.4.0",
            Some("9c1e4b7"),
            config::meta::service_identity::VERSION_SOURCE_K8S_POD_IMAGE,
            1,
        );
        let value = ctx.version(&k8s, 1);
        assert_eq!(value["version"], "2.4.0");
        assert_eq!(value["image"], "9c1e4b7");
        assert_eq!(value["image_ref"], "ghcr.io/acme/checkout:2.4.0@9c1e4b7");
        assert_eq!(value["compare_disabled"], json!(true));
        assert_eq!(value["compare_disabled_reason"], "no_span_version");
        let spans = ctx.version(&registry_row("2.4.0", None, "service.version", 1), 1);
        assert_eq!(spans["compare_disabled"], json!(false));
        assert!(spans["compare_disabled_reason"].is_null());
        assert!(spans["image"].is_null());
    }

    #[test]
    fn a_pre_existing_newest_verdict_counts_the_images_of_its_version_text() {
        let rows = [
            registry_row("2.4.0", Some("3f9c2ab"), "container.image.tag", 1),
            registry_row("2.4.0", Some("9c1e4b7"), "container.image.tag", 2),
        ];
        let counts = version_images(rows.iter());
        let verdict = |state: &str| json!({"scope_key":rows[1].scope_key,"newest_verdict":{"version":"2.4.0","image":"9c1e4b7","state":state,"verdict":null}});
        let mut scope = verdict("pre_existing");
        count_pre_existing_images(&mut scope, &counts);
        let shown = &scope["newest_verdict"];
        assert_eq!(
            (&shown["version"], &shown["image"], &shown["version_images"]),
            (&json!("2.4.0"), &json!("9c1e4b7"), &json!(2))
        );
        let mut stored = verdict("frozen");
        count_pre_existing_images(&mut stored, &counts);
        assert_eq!(
            stored,
            verdict("frozen"),
            "a stored verdict is counted by its summary"
        );
        let mut empty = json!({"scope_key":rows[1].scope_key,"newest_verdict":null});
        count_pre_existing_images(&mut empty, &counts);
        assert!(empty["newest_verdict"].is_null());
    }

    #[test]
    fn catalog_version_fields_name_the_image_source_and_keep_the_text() {
        let rows = [
            registry_row("2.4.0", Some("3f9c2ab"), "container.image.tag", 1),
            registry_row("2.4.0", Some("9c1e4b7"), "k8s.pod.image", 2),
        ];
        let counts = version_images(rows.iter());
        let mut scope =
            json!({"scope_key":rows[1].scope_key,"newest_version":"2.4.0","current_version":null});
        set_scope_version(&mut scope, "newest", Some(&rows[1]), &counts);
        set_scope_version(&mut scope, "current", None, &counts);
        assert_eq!(scope["newest_version"], "2.4.0");
        assert_eq!(scope["newest_image"], "9c1e4b7");
        assert_eq!(scope["newest_version_images"], 2);
        assert_eq!(scope["newest_version_source"], "k8s.pod.image");
        assert_eq!(scope["newest_compare_disabled"], json!(true));
        assert_eq!(scope["newest_compare_disabled_reason"], "no_span_version");
        assert!(scope["current_version"].is_null());
        assert!(scope["current_version_source"].is_null());
        assert!(scope["current_image"].is_null());
        assert_eq!(scope["current_version_images"], 0);
        let identity = scope_identity(&scope, "newest").unwrap();
        assert_eq!(identity, VersionImage::new("2.4.0", Some("9c1e4b7")));
        set_scope_identity(&mut scope, "current", Some(&identity));
        assert_eq!(
            (&scope["current_version"], &scope["current_image"]),
            (&json!("2.4.0"), &json!("9c1e4b7"))
        );
        set_scope_identity(&mut scope, "current", None);
        assert!(scope["current_version"].is_null() && scope["current_image"].is_null());
    }

    #[test]
    fn a_scope_seen_in_two_envs_keeps_its_first_env_and_matches_either() {
        let row = |stream: &str, env: &str, envs: &[&str], first: i64| WhereSummaryRecord {
            service_name: "checkout".into(),
            where_key: "k8s:c/ns".into(),
            k8s_namespace: "ns".into(),
            summary_key: format!("summary-{stream}"),
            org_id: "org".into(),
            scope_key: "scope".into(),
            source_stream: stream.into(),
            signal: "traces".into(),
            k8s_cluster: "c".into(),
            env: env.into(),
            env_source: config::meta::service_identity::EnvSource::Attribute,
            env_source_value: "deployment.environment".into(),
            envs: envs.iter().map(|env| env.to_string()).collect(),
            newest_version: "v1".into(),
            newest_version_key: "version".into(),
            newest_first_seen: 1,
            has_version: true,
            first_seen: first,
            last_seen: 900,
            purged_versions: 0,
            updated_at: 900,
        };
        let ctx = Context {
            org: "org".into(),
            user: String::new(),
            summaries: vec![
                row("late", "staging", &["staging"], 300),
                row("early", "prod", &["dev", "prod"], 100),
            ],
            readable: ReadableStreams {
                traces: Default::default(),
                rum: false,
            },
            identity: OrgIdentity::default(),
            aliases: std::sync::Arc::new(Vec::new()),
        };
        let labels = ctx.scope_labels();
        let label = &labels[&("checkout", "k8s:c/ns")];
        assert_eq!(label["env"], "prod");
        assert_eq!(label["envs"], json!(["prod", "dev", "staging"]));
        assert_eq!(
            ctx.scope_label("checkout", "k8s:c/ns").as_ref(),
            Some(label)
        );
        assert!(
            ["prod", "dev", "staging"]
                .iter()
                .all(|env| env_matches(label, env))
        );
        assert!(!env_matches(label, "qa"));
        assert_eq!(label_envs(label), ["prod", "dev", "staging"]);
        let record = config::meta::service_identity::ServiceVersionRecord {
            version_key: "version".into(),
            org_id: "org".into(),
            service_name: "checkout".into(),
            where_key: "k8s:c/ns".into(),
            where_kind: config::meta::service_identity::WhereKind::K8s,
            k8s_cluster: "c".into(),
            k8s_namespace: "ns".into(),
            scope_key: "scope".into(),
            env: "prod".into(),
            version: "v1".into(),
            raw_version: None,
            version_source: "attribute".into(),
            image: None,
            image_ref: None,
            env_source: config::meta::service_identity::EnvSource::Attribute,
            env_source_value: "deployment.environment".into(),
            first_seen: 100,
            last_seen: 900,
            traces_first_seen: Some(100),
            traces_last_seen: Some(900),
            rum_first_seen: None,
            rum_last_seen: None,
            deleted_at: None,
            created_at: 100,
            updated_at: 900,
        };
        let version = ctx.version(&record, 900);
        let filter = |env: &str| BTreeMap::from([("env".to_string(), env.to_string())]);
        for env in ["prod", "dev", "staging"] {
            assert!(version_listed(&version, &filter(env)), "env={env} lists it");
        }
        assert!(!version_listed(&version, &filter("qa")));
    }
}
