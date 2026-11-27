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
use config::meta::service_identity::{VersionImage, is_image_short};
use infra::{
    db::get_orm_client_rw,
    table::{
        self,
        entity::{service_version_deploys as deploys, service_version_verdicts as verdicts},
    },
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde_json::{Value, json};
use tracing::Instrument;

use crate::{
    authz::list::{AuthzUnavailable, Calls, Outcome, all_of, authz_unavailable_response},
    service_identity::{
        access::{evidence_unavailable, org_wide_read},
        api::{Context, env_filter_matches, scope_identity, set_scope_identity},
    },
};

pub async fn verdicts(ctx: &Context, params: &BTreeMap<String, String>) -> Result<Value, Response> {
    let mut query = verdicts::Entity::find().filter(verdicts::Column::OrgId.eq(&ctx.org));
    let deploy_key = params.get("deploy_key").filter(|key| !key.is_empty());
    if let Some(key) = deploy_key {
        query = query.filter(verdicts::Column::DeployKey.eq(key));
    }
    if let Some(keys) = params.get("keys") {
        let keys: BTreeSet<_> = keys.split(',').filter(|key| !key.is_empty()).collect();
        if keys.is_empty() || keys.len() > 100 {
            return Err(error(
                StatusCode::BAD_REQUEST,
                "keys must contain 1 to 100 version keys",
            ));
        }
        query = query.filter(verdicts::Column::VersionKey.is_in(keys));
    }
    let rows = if params.contains_key("keys") || deploy_key.is_some() {
        query
            .order_by_desc(verdicts::Column::LastEvaluatedAt)
            .order_by_asc(verdicts::Column::VerdictKey)
            .all(get_orm_client_rw().await)
            .await
            .map_err(unavailable)?
    } else {
        version_rows(ctx, params).await?
    };
    let mut groups: BTreeMap<String, Vec<verdicts::Model>> = BTreeMap::new();
    for row in rows {
        if ctx.visible(&row.service_name, &row.where_key) {
            groups.entry(row.version_key.clone()).or_default().push(row);
        }
    }
    let mut result = Vec::new();
    for rows in groups.into_values() {
        result.push(summary(ctx, &rows).await?);
    }
    Ok(json!({"verdicts":result}))
}

pub async fn summary(ctx: &Context, rows: &[verdicts::Model]) -> Result<Value, Response> {
    summarize(ctx, rows, true).await
}

pub async fn deploys(ctx: &Context, params: &BTreeMap<String, String>) -> Result<Value, Response> {
    let service = required(params, "service")?;
    let start = time(params, "start_time", i64::MIN)?;
    let end = time(params, "end_time", i64::MAX)?;
    if start > end {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "start_time must precede end_time",
        ));
    }
    let mut query = deploy_history(ctx, service, params.get("where").map(String::as_str))
        .filter(deploys::Column::Kind.ne("pre_existing"))
        .filter(deploys::Column::At.gte(start))
        .filter(deploys::Column::At.lte(end));
    if let Some(place) = params.get("where") {
        query = query.filter(deploys::Column::WhereKey.eq(place));
    }
    let rows = query
        .order_by_asc(deploys::Column::At)
        .order_by_asc(deploys::Column::DeployKey)
        .all(get_orm_client_rw().await)
        .await
        .map_err(unavailable)?;
    let mut markers = Vec::new();
    for row in rows {
        if !ctx.visible(&row.service_name, &row.where_key) {
            continue;
        }
        let label = ctx
            .scope_label(&row.service_name, &row.where_key)
            .expect("visible scope");
        if !env_filter_matches(&label, params) {
            continue;
        }
        let (verdict, authz_error) = match deploy_verdict(ctx, &row).await? {
            Ok(verdict) => (verdict, None),
            Err(error) => (Value::Null, Some(error)),
        };
        let badge = if verdict["restricted"] == true {
            json!("restricted")
        } else if verdict["reason_code"] == "capped" {
            json!("capped")
        } else if verdict["state"] == "evaluating" {
            json!("evaluating")
        } else if !verdict.is_null() {
            verdict["verdict"].clone()
        } else if row.entry_source == "k8s" {
            json!("not_serving")
        } else {
            json!("none")
        };
        let registry = table::service_versions::get_by_keys(
            get_orm_client_rw().await,
            &ctx.org,
            std::slice::from_ref(&row.to_version_key),
        )
        .await
        .map_err(unavailable)?;
        let mut marker = json!({"version":row.to_version,"image":row.to_image,"from_image":row.from_image,"previous_image":row.from_image,"where_key":row.where_key,"env":label["env"],"env_source":label["env_source"],"at":row.at,
            "signal_first_seen":registry.first().map(|r|json!({"traces":r.traces_first_seen,"rum":r.rum_first_seen})),
            "previous_version":row.from_version,"kind":row.kind,"from_version":row.from_version,"deploy_key":row.deploy_key,
            "regions":[row.cluster],"provisional":false,"verdict":verdict,"badge":badge,"no_env":label["no_env"]});
        marker["image_ref"] = json!(registry.first().and_then(|r| r.image_ref.as_ref()));
        if let Some(previous) = row.from_version_key {
            let previous = table::service_versions::get_by_keys(
                get_orm_client_rw().await,
                &ctx.org,
                &[previous],
            )
            .await
            .map_err(unavailable)?;
            marker["previous_last_seen"] = json!(previous.first().map(|r| r.last_seen));
            marker["overlaps_previous"] =
                json!(previous.first().is_some_and(|r| r.last_seen >= row.at));
        } else {
            marker["previous_last_seen"] = Value::Null;
            marker["overlaps_previous"] = json!(false);
        }
        markers.push((marker, authz_error));
    }
    let mut merged = merge_deploy_markers(markers).map_err(evidence_authz_response)?;
    provisional(ctx, params, start, end, &mut merged).await?;
    merged.sort_by(|a, b| {
        a["at"]
            .as_i64()
            .cmp(&b["at"].as_i64())
            .then_with(|| a["deploy_key"].as_str().cmp(&b["deploy_key"].as_str()))
    });
    Ok(json!({"deploys":merged}))
}

pub(super) fn deploy_history(
    ctx: &Context,
    service: &str,
    place: Option<&str>,
) -> sea_orm::Select<deploys::Entity> {
    let names = ctx.names(service, place);
    deploys::Entity::find()
        .filter(deploys::Column::OrgId.eq(&ctx.org))
        .filter(deploys::Column::ScopeKey.is_in(ctx.scope_keys(&names, place)))
}

pub async fn enrich_versions(ctx: &Context, versions: &mut [Value]) -> Result<(), Response> {
    let mut started: BTreeMap<String, bool> = BTreeMap::new();
    for value in versions {
        if let Some(scope) = value["scope_key"].as_str().map(str::to_string) {
            if !started.contains_key(&scope) {
                let tracked = tracking_started(&ctx.org, &scope).await?;
                started.insert(scope.clone(), tracked);
            }
            value["tracking_started"] = json!(started[&scope]);
        }
        let Some(key) = value["version_key"].as_str() else {
            continue;
        };
        let rows = deploys::Entity::find()
            .filter(deploys::Column::OrgId.eq(&ctx.org))
            .filter(deploys::Column::ToVersionKey.eq(key))
            .order_by_desc(deploys::Column::At)
            .order_by_asc(deploys::Column::DeployKey)
            .limit(5)
            .all(get_orm_client_rw().await)
            .await
            .map_err(unavailable)?;
        let folded = all_of(Calls::Send, &rows, |row, calls| {
            deploy_outcome(ctx, row, calls)
        })
        .await;
        let restricted = match folded.outcome {
            Some(Outcome::Error(reason)) => return Err(evidence_authz_response(reason.into())),
            outcome => outcome != Some(Outcome::Allow),
        };
        let items: Vec<_> = rows.iter().map(|row| {
            json!({"at":row.at,"kind":row.kind,"from_version":row.from_version,"from_image":row.from_image,"cluster":row.cluster,"deploy_key":row.deploy_key})
        }).collect();
        value["deploys"] = json!(items);
        value["restricted"] = json!(restricted);
    }
    Ok(())
}

pub async fn enrich_catalog(
    ctx: &Context,
    scopes: &mut Vec<Value>,
    params: &BTreeMap<String, String>,
) -> Result<(), Response> {
    filter_catalog(ctx, scopes, params)
        .instrument(tracing::info_span!("authz.filter"))
        .await?;
    enrich_catalog_page(ctx, scopes, params)
        .instrument(tracing::info_span!("enrich"))
        .await
}

/// The region's deploy-tracking start and the end of its warm-up; both null until its first rollup.
pub async fn tracking(org: &str) -> Result<Value, Response> {
    let epoch = tracking_epoch(org).await?;
    Ok(json!({"epoch":epoch,"warmup_ends_at":epoch.map(warmup_end)}))
}

/// The newest serving version; the history or newest one stands while it serves or none does.
pub fn current_version(
    shown: Option<VersionImage>,
    serving: &[&config::meta::service_identity::ServiceVersionRecord],
) -> Option<VersionImage> {
    if serving.is_empty()
        || serving
            .iter()
            .any(|row| shown.as_ref() == Some(&row.identity()))
    {
        return shown;
    }
    serving
        .iter()
        .max_by(|a, b| (a.first_seen, &a.version_key).cmp(&(b.first_seen, &b.version_key)))
        .map(|row| row.identity())
        .or(shown)
}

pub fn rank(verdict: &str) -> u8 {
    match verdict {
        "regressed" => 5,
        "not_serving" => 4,
        "watch" => 3,
        "insufficient" => 2,
        "ok" => 1,
        _ => 0,
    }
}

/// The windows the stored verdict last judged; `b` is null until a baseline window was stored.
pub fn stored_windows(row: &verdicts::Model) -> Value {
    let b = match (row.baseline_start, row.baseline_end) {
        (Some(start), Some(end)) => json!({"start_time":start,"end_time":end}),
        _ => Value::Null,
    };
    json!({"a":{"start_time":row.eval_start,"end_time":row.window_end},"b":b})
}

async fn enrich_catalog_page(
    ctx: &Context,
    scopes: &mut Vec<Value>,
    params: &BTreeMap<String, String>,
) -> Result<(), Response> {
    let (limit, offset) = crate::service_identity::api::page(params, 100)?;
    *scopes = scopes.drain(..).skip(offset).take(limit).collect();
    for scope in scopes.iter_mut() {
        let key = scope["scope_key"].as_str().unwrap_or_default();
        let history = deploys::Entity::find()
            .filter(deploys::Column::OrgId.eq(&ctx.org))
            .filter(deploys::Column::ScopeKey.eq(key))
            .order_by_desc(deploys::Column::At)
            .order_by_asc(deploys::Column::DeployKey)
            .limit(1)
            .all(get_orm_client_rw().await)
            .await
            .map_err(unavailable)?;
        let rows = verdicts::Entity::find()
            .filter(verdicts::Column::OrgId.eq(&ctx.org))
            .filter(verdicts::Column::ScopeKey.eq(key))
            .order_by_desc(verdicts::Column::EvalStart)
            .order_by_desc(verdicts::Column::LastEvaluatedAt)
            .all(get_orm_client_rw().await)
            .await
            .map_err(unavailable)?;
        let shown = verdict_version(scope, history.first());
        let newest: Vec<_> = rows
            .iter()
            .filter(|row| shown.as_ref() == Some(&row.identity()))
            .cloned()
            .collect();
        let stored = summary(ctx, &newest).await?;
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        let mut by_version: BTreeMap<&str, Vec<verdicts::Model>> = BTreeMap::new();
        for row in &rows {
            by_version
                .entry(&row.version_key)
                .or_default()
                .push(row.clone());
        }
        let mut good = Vec::new();
        for versions in by_version.into_values() {
            let verdict = summary(ctx, &versions).await?;
            // Last good means a frozen ok on a version other than the newest one.
            if verdict["verdict"] == "ok"
                && !verdict["frozen_at"].is_null()
                && let Some(row) = versions.iter().max_by_key(|row| row.eval_start)
                && scope_identity(scope, "newest") != Some(row.identity())
            {
                good.push((row.eval_start, row.identity()));
            }
            if let Some(code) = verdict["verdict"].as_str() {
                *counts.entry(code.into()).or_default() += 1;
            }
        }
        let current = history
            .first()
            .map(deploys::Model::to_identity)
            .or_else(|| scope_identity(scope, "newest"));
        set_scope_identity(scope, "current", current.as_ref());
        let previous = history.first().and_then(deploys::Model::from_identity);
        set_scope_identity(scope, "previous", previous.as_ref());
        scope["tracking_started"] = json!(!history.is_empty());
        good.sort();
        set_scope_identity(scope, "last_good", good.last().map(|(_, version)| version));
        scope["verdict_counts"] = json!(counts);
        scope["newest_verdict"] = stored;
        if scope["newest_verdict"].is_null()
            && let Some(row) = history.first().filter(|row| row.kind == "pre_existing")
        {
            scope["newest_verdict"] = json!({"version_key":row.to_version_key,"service":row.service_name,"where_key":row.where_key,"version":row.to_version,"image":row.to_image,"state":"pre_existing","verdict":null,"deploy_key":row.deploy_key,"restricted":false,"regions":[]});
        }
    }
    Ok(())
}

fn merge_deploy_markers(
    markers: Vec<(Value, Option<AuthzUnavailable>)>,
) -> Result<Vec<Value>, AuthzUnavailable> {
    let mut merged: Vec<(Value, Option<AuthzUnavailable>)> = Vec::new();
    for (marker, error) in markers {
        if let Some((existing, existing_error)) = merged.iter_mut().find(|(other, _)| {
            other["version"] == marker["version"]
                && other["image"] == marker["image"]
                && other["where_key"] == marker["where_key"]
                && other["kind"] == marker["kind"]
                && other["from_version"] == marker["from_version"]
                && other["from_image"] == marker["from_image"]
                && marker["at"]
                    .as_i64()
                    .unwrap_or_default()
                    .abs_diff(other["at"].as_i64().unwrap_or_default())
                    <= 600_000_000
                && !other["regions"]
                    .as_array()
                    .expect("regions")
                    .contains(&marker["regions"][0])
        }) {
            existing["regions"]
                .as_array_mut()
                .expect("regions")
                .push(marker["regions"][0].clone());
            if marker["verdict"]["restricted"] == true
                || (existing["verdict"]["restricted"] != true
                    && rank(marker["verdict"]["verdict"].as_str().unwrap_or_default())
                        > rank(existing["verdict"]["verdict"].as_str().unwrap_or_default()))
            {
                existing["verdict"] = marker["verdict"].clone();
                existing["badge"] = marker["badge"].clone();
            }
            if existing["verdict"]["restricted"] == true {
                *existing_error = None;
            } else if existing_error.is_none() {
                *existing_error = error;
            }
        } else {
            merged.push((marker, error));
        }
    }
    merged
        .into_iter()
        .map(|(marker, error)| error.map_or(Ok(marker), Err))
        .collect()
}

async fn summarize(
    ctx: &Context,
    rows: &[verdicts::Model],
    details: bool,
) -> Result<Value, Response> {
    summarize_outcome(ctx, rows, details)
        .await?
        .map_err(evidence_authz_response)
}

async fn summarize_outcome(
    ctx: &Context,
    rows: &[verdicts::Model],
    details: bool,
) -> Result<Result<Value, AuthzUnavailable>, Response> {
    let mut latest: BTreeMap<&str, &verdicts::Model> = BTreeMap::new();
    for row in rows {
        let stored = latest.entry(&row.cluster).or_insert(row);
        if (row.eval_start, row.last_evaluated_at, &row.verdict_key)
            > (
                stored.eval_start,
                stored.last_evaluated_at,
                &stored.verdict_key,
            )
        {
            *stored = row;
        }
    }
    let rows: Vec<_> = latest.into_values().cloned().collect();
    let Some(row) = rows.iter().max_by(|a, b| {
        rank(&a.verdict)
            .cmp(&rank(&b.verdict))
            .then(a.last_evaluated_at.cmp(&b.last_evaluated_at))
            .then_with(|| b.verdict_key.cmp(&a.verdict_key))
    }) else {
        return Ok(Ok(Value::Null));
    };
    let admin = org_wide_read(&ctx.org, &ctx.user).await;
    let mut parse_error = None;
    let folded = all_of(Calls::Send, &rows, |evidence, calls| {
        let streams = match serde_json::from_str::<Vec<String>>(&evidence.source_streams) {
            Ok(streams) => streams,
            Err(error) => {
                parse_error = Some(error);
                Vec::new()
            }
        };
        async move {
            if streams.is_empty() {
                return Some(Outcome::Deny);
            }
            ctx.readable
                .evidence_outcome(
                    &ctx.org,
                    &ctx.user,
                    &streams,
                    evidence.source_streams_overflow,
                    admin,
                    &ctx.evidence,
                    calls,
                )
                .await
        }
    })
    .await;
    if let Some(err) = parse_error {
        return Err(unavailable(err));
    }
    match folded.outcome {
        Some(Outcome::Error(reason)) => return Ok(Err(reason.into())),
        Some(Outcome::Allow) => (),
        Some(Outcome::Deny) | None => {
            let mut restricted = json!({"verdict_key":row.verdict_key,"version_key":row.version_key,"service":row.service_name,"where_key":row.where_key,"version":row.version,"image":row.image,"restricted":true});
            count_verdict_images(row, &mut restricted).await?;
            return Ok(Ok(restricted));
        }
    }
    if !details {
        return Ok(Ok(
            json!({"verdict":row.verdict,"state":row.state,"reason_code":row.reason_code}),
        ));
    }
    let deploy =
        table::service_version_deploys::get(get_orm_client_rw().await, &ctx.org, &row.deploy_key)
            .await
            .map_err(unavailable)?;
    let mut result = json!({"verdict_key":row.verdict_key,"version_key":row.version_key,"service":row.service_name,"where_key":row.where_key,"version":row.version,"image":row.image,
        "verdict":row.verdict,"state":row.state,"reason":row.reason,"reason_code":row.reason_code,"signal":row.signal,
        "headline":{"metric":row.headline_metric,"new":row.headline_new,"base":row.headline_base,"lo":row.headline_lo,"hi":row.headline_hi,"ci_kind":row.headline_ci_kind},
        "second":{"metric":row.second_metric,"new":row.second_new,"base":row.second_base},"new_error_types":row.new_error_types,"new_error_sample":row.new_error_sample,
        "sample":{"n_new":row.n_new,"n_base":row.n_base,"since":row.eval_start},
        "baseline":{"version":row.baseline_version,"image":row.baseline_image,"rule":row.baseline_rule,"initial_rule":row.baseline_rule_initial,"initial_version":row.baseline_version_initial,"initial_image":row.baseline_image_initial,"switched_at":row.baseline_switched_at,"where_key":row.baseline_where_key,"env":row.baseline_env,"traffic_share":row.baseline_traffic_share},
        "checks_done":row.checks_done,"frozen_at":row.frozen_at,"recheck":{"verdict":row.recheck_verdict,"at":row.rechecked_at},
        "regions":rows.iter().map(|r|json!({"cluster":r.cluster,"verdict":r.verdict})).collect::<Vec<_>>(),
        "deploy_key":row.deploy_key,"deploy":deploy.map(|r|json!({"kind":r.kind,"at":r.at,"from_version":r.from_version,"from_image":r.from_image})),
        "rollback_outcome":row.rollback_outcome,"restricted":false,"windows":stored_windows(row),
        "needs":{"metric":row.needs_metric,"have":row.needs_have,"need":row.needs_need}});
    if let Some(label) = ctx.scope_label(&row.service_name, &row.where_key) {
        result["env"] = label["env"].clone();
        result["env_source"] = label["env_source"].clone();
    }
    result["headline"]["unit"] = json!(unit(row.headline_metric.as_deref()));
    result["second"]["unit"] = json!(unit(row.second_metric.as_deref()));
    result["metrics"] = match table::service_version_verdicts::metric_rows(
        get_orm_client_rw().await,
        &ctx.org,
        &row.verdict_key,
    )
    .await
    {
        Ok(metrics) => serde_json::to_value(metrics).map_err(unavailable)?,
        // A bad stored set is rewritten by the next evaluation, so it must not fail this read.
        Err(infra::errors::Error::Message(err)) => {
            log::error!("service verdict {} metrics skipped: {err}", row.verdict_key);
            json!([])
        }
        Err(err) => return Err(unavailable(err)),
    };
    count_verdict_images(row, &mut result).await?;
    Ok(Ok(result))
}

async fn version_rows(
    ctx: &Context,
    params: &BTreeMap<String, String>,
) -> Result<Vec<verdicts::Model>, Response> {
    let service = required(params, "service")?;
    let place = required(params, "where")?;
    let version = required(params, "version")?;
    let image = image_param(params)?;
    table::service_version_verdicts::list_by_version(
        get_orm_client_rw().await,
        &ctx.org,
        service,
        place,
        version,
        image,
    )
    .await
    .map_err(unavailable)
}

fn image_param(params: &BTreeMap<String, String>) -> Result<Option<&str>, Response> {
    match params.get("image").filter(|image| !image.is_empty()) {
        Some(image) if !is_image_short(image) => Err(error(
            StatusCode::BAD_REQUEST,
            "image must be 7 lowercase hex characters",
        )),
        image => Ok(image.map(String::as_str)),
    }
}

/// Counts the registered images of the verdict's and its baseline's version texts.
async fn count_verdict_images(row: &verdicts::Model, result: &mut Value) -> Result<(), Response> {
    let mut places = vec![row.where_key.clone()];
    if let Some(place) = row
        .baseline_where_key
        .as_ref()
        .filter(|p| **p != row.where_key)
    {
        places.push(place.clone());
    }
    let mut registry = Vec::new();
    for place in places {
        registry.extend(
            table::service_versions::list(
                get_orm_client_rw().await,
                &row.org_id,
                &table::service_versions::ListQuery {
                    service_name: Some(row.service_name.clone()),
                    where_key: Some(place),
                    limit: 1000,
                    offset: 0,
                },
            )
            .await
            .map_err(unavailable)?,
        );
    }
    let images = crate::service_identity::api::version_images(registry.iter());
    let count = |place: &str, version: &Value| {
        let scope =
            config::meta::service_identity::scope_key(&row.org_id, &row.service_name, place);
        version
            .as_str()
            .and_then(|version| images.get(&(scope, version.to_string())))
            .copied()
            .unwrap_or_default()
    };
    result["version_images"] = json!(count(&row.where_key, &result["version"]));
    if result["baseline"].is_object() {
        let place = row.baseline_where_key.as_deref().unwrap_or(&row.where_key);
        result["baseline"]["version_images"] = json!(count(place, &result["baseline"]["version"]));
    }
    Ok(())
}

async fn deploy_verdict(
    ctx: &Context,
    row: &deploys::Model,
) -> Result<Result<Value, AuthzUnavailable>, Response> {
    match deploy_outcome(ctx, row, Calls::Send).await {
        Some(Outcome::Allow) => (),
        Some(Outcome::Error(reason)) => return Ok(Err(reason.into())),
        Some(Outcome::Deny) | None => return Ok(Ok(json!({"restricted":true}))),
    }
    let Some(key) = row.verdict_key.as_deref() else {
        return Ok(Ok(Value::Null));
    };
    let verdict = table::service_version_verdicts::get(get_orm_client_rw().await, &ctx.org, key)
        .await
        .map_err(unavailable)?;
    match verdict {
        Some(verdict) => summarize_outcome(ctx, &[verdict], true).await,
        None => Ok(Ok(Value::Null)),
    }
}

async fn deploy_outcome(ctx: &Context, row: &deploys::Model, calls: Calls) -> Option<Outcome> {
    let Ok(streams) = serde_json::from_str::<Vec<String>>(&row.source_streams) else {
        return Some(Outcome::Deny);
    };
    if streams.is_empty() {
        return Some(Outcome::Deny);
    }
    let admin = org_wide_read(&ctx.org, &ctx.user).await;
    ctx.readable
        .evidence_outcome(
            &ctx.org,
            &ctx.user,
            &streams,
            row.source_streams_overflow,
            admin,
            &ctx.evidence,
            calls,
        )
        .await
}

fn evidence_authz_response(error: AuthzUnavailable) -> Response {
    authz_unavailable_response(evidence_unavailable(error.reason))
}

async fn filter_catalog(
    ctx: &Context,
    scopes: &mut Vec<Value>,
    params: &BTreeMap<String, String>,
) -> Result<(), Response> {
    if let Some(filter) = params.get("verdict")
        && filter.split(',').any(|v| {
            !matches!(
                v,
                "regressed"
                    | "not_serving"
                    | "watch"
                    | "insufficient"
                    | "ok"
                    | "pre_existing"
                    | "no_version"
                    | "capped"
            )
        })
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid verdict filter"));
    }
    let Some(filter) = params.get("verdict") else {
        return Ok(());
    };
    let has_version = |key: &str| {
        ctx.summaries
            .iter()
            .any(|row| row.scope_key == key && row.has_version)
    };
    if filter.split(',').all(|code| code == "no_version") {
        scopes.retain(|scope| !has_version(scope["scope_key"].as_str().unwrap_or_default()));
        return Ok(());
    }
    let mut candidates: BTreeMap<String, Vec<verdicts::Model>> = BTreeMap::new();
    let mut latest_deploys = BTreeMap::new();
    for batch in scopes.chunks(500) {
        let keys = batch.iter().filter_map(|scope| scope["scope_key"].as_str());
        let latest = deploys::Entity::find()
            .filter(deploys::Column::OrgId.eq(&ctx.org))
            .filter(deploys::Column::ScopeKey.is_in(keys))
            .filter(sea_orm::sea_query::Expr::cust("deploy_key = (SELECT latest.deploy_key FROM service_version_deploys AS latest WHERE latest.org_id = service_version_deploys.org_id AND latest.scope_key = service_version_deploys.scope_key ORDER BY latest.at DESC, latest.deploy_key ASC LIMIT 1)"))
            .all(get_orm_client_rw().await).await.map_err(unavailable)?;
        for row in latest {
            latest_deploys.insert(row.scope_key.clone(), row);
        }
        let mut condition = sea_orm::Condition::any();
        for scope in batch {
            let key = scope["scope_key"].as_str().unwrap_or_default();
            let shown = verdict_version(scope, latest_deploys.get(key)).unwrap_or_default();
            condition = condition.add(
                sea_orm::Condition::all()
                    .add(verdicts::Column::ScopeKey.eq(key))
                    .add(verdicts::Column::Version.eq(shown.version)),
            );
        }
        let rows = verdicts::Entity::find()
            .filter(verdicts::Column::OrgId.eq(&ctx.org))
            .filter(condition)
            .all(get_orm_client_rw().await)
            .await
            .map_err(unavailable)?;
        for row in rows {
            candidates
                .entry(row.scope_key.clone())
                .or_default()
                .push(row);
        }
    }
    let mut selected = Vec::new();
    for scope in scopes.drain(..) {
        let key = scope["scope_key"].as_str().unwrap_or_default();
        let code = if !has_version(key) {
            json!("no_version")
        } else {
            let shown = verdict_version(&scope, latest_deploys.get(key));
            let rows: Vec<_> = candidates
                .remove(key)
                .unwrap_or_default()
                .into_iter()
                .filter(|row| shown.as_ref() == Some(&row.identity()))
                .collect();
            let verdict = summarize(ctx, &rows, false).await?;
            if verdict["reason_code"] == "capped" {
                json!("capped")
            } else if !verdict.is_null() {
                verdict["verdict"].clone()
            } else {
                let latest = latest_deploys.get(key);
                if latest.is_some_and(|row| {
                    row.kind == "pre_existing"
                        && scope_identity(&scope, "newest") == Some(row.to_identity())
                }) {
                    json!("pre_existing")
                } else {
                    Value::Null
                }
            }
        };
        if code
            .as_str()
            .is_some_and(|code| filter.split(',').any(|v| v == code))
        {
            selected.push(scope);
        }
    }
    *scopes = selected;
    Ok(())
}

/// The version whose verdict a catalog row shows: the newest deploy's, so it matches the row.
fn verdict_version(scope: &Value, newest_deploy: Option<&deploys::Model>) -> Option<VersionImage> {
    newest_deploy.map_or_else(
        || scope_identity(scope, "newest"),
        |row| Some(row.to_identity()),
    )
}

async fn provisional(
    ctx: &Context,
    params: &BTreeMap<String, String>,
    start: i64,
    end: i64,
    markers: &mut Vec<Value>,
) -> Result<(), Response> {
    let Some(epoch) = tracking_epoch(&ctx.org).await? else {
        return Ok(());
    };
    let service = required(params, "service")?;
    let history = deploy_history(ctx, service, params.get("where").map(String::as_str))
        .all(get_orm_client_rw().await)
        .await
        .map_err(unavailable)?;
    let place = params.get("where").map(String::as_str);
    let names = ctx.names(service, place);
    let rows = table::service_versions::active_by_scopes(
        get_orm_client_rw().await,
        &ctx.org,
        &ctx.scope_keys(&names, place),
        i64::MIN,
    )
    .await
    .map_err(unavailable)?;
    for row in rows {
        if row.first_seen < warmup_end(epoch)
            || row.first_seen < start
            || row.first_seen > end
            || !row.is_live()
            || !ctx.visible(&row.service_name, &row.where_key)
            || history.iter().any(|deploy| {
                deploy.where_key == row.where_key
                    && (deploy.to_version_key == row.version_key || deploy.at >= row.first_seen)
            })
        {
            continue;
        }
        let value = ctx.version(&row, config::utils::time::now_micros());
        if !env_filter_matches(&value, params) {
            continue;
        }
        markers.push(json!({"version":row.version,"image":row.image,"image_ref":row.image_ref,"from_image":null,"previous_image":null,"no_env":value["no_env"],"where_key":row.where_key,"env":value["env"],"env_source":value["env_source"],"at":row.first_seen,
                "signal_first_seen":{"traces":row.traces_first_seen,"rum":row.rum_first_seen},"previous_version":null,"overlaps_previous":false,"previous_last_seen":null,
                "kind":"deploy","from_version":null,"deploy_key":null,"regions":[config::get_cluster_name()],"provisional":true,"verdict":null,"badge":"none"}));
    }
    Ok(())
}

// A scope is tracked once the detector stored its first transition; until then nothing is judged.
async fn tracking_started(org: &str, scope: &str) -> Result<bool, Response> {
    Ok(deploys::Entity::find()
        .filter(deploys::Column::OrgId.eq(org))
        .filter(deploys::Column::ScopeKey.eq(scope))
        .one(get_orm_client_rw().await)
        .await
        .map_err(unavailable)?
        .is_some())
}

async fn tracking_epoch(org: &str) -> Result<Option<i64>, Response> {
    let Some((epoch, _)) = infra::db::get_db()
        .await
        .get_with_revision(&format!("/service_signals/epoch/{org}"))
        .await
        .map_err(unavailable)?
    else {
        return Ok(None);
    };
    std::str::from_utf8(&epoch)
        .map_err(unavailable)?
        .parse()
        .map(Some)
        .map_err(unavailable)
}

// Every transition entering before this is pre_existing.
fn warmup_end(epoch: i64) -> i64 {
    let window = o2_enterprise::enterprise::common::config::get_config()
        .service_signals
        .window_secs as i64
        * 1_000_000;
    epoch.saturating_add(
        o2_enterprise::enterprise::service_identity::deploys::WARMUP_WINDOWS.saturating_mul(window),
    )
}

fn unit(metric: Option<&str>) -> &'static str {
    match metric {
        Some("error_rate" | "error_view_rate") => "ratio",
        Some("p50" | "p95" | "p99") => "us",
        Some("lcp_p75" | "inp_p75") => "ms",
        Some("cls_p75") => "score",
        _ => "count",
    }
}

fn required<'a>(params: &'a BTreeMap<String, String>, name: &str) -> Result<&'a str, Response> {
    params
        .get(name)
        .filter(|v| !v.is_empty())
        .map(String::as_str)
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, &format!("{name} is required")))
}

fn time(params: &BTreeMap<String, String>, name: &str, default: i64) -> Result<i64, Response> {
    params.get(name).map_or(Ok(default), |v| {
        v.parse()
            .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid time"))
    })
}

fn unavailable(err: impl std::fmt::Display) -> Response {
    log::error!("service verdict storage: {err}");
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Service verdict storage unavailable",
    )
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "test-utils")]
    use config::meta::service_identity::WhereSummaryRecord;

    use super::*;
    #[cfg(feature = "test-utils")]
    use crate::{
        authz::{fake_checker, list::ListMode},
        service_identity::access::{ReadableStreams, RumReads},
    };

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn deploys_answers_503_when_an_evidence_check_fails() {
        use config::meta::stream::StreamType;
        use sea_orm::IntoActiveModel;

        use crate::authz::{TypedStream, list::UnavailableReason};

        let org = format!("deploys_authz_{}", config::utils::time::now_micros());
        let user = "deploys-evidence-failure@example.com";
        let checker = fake_checker();
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.clone(),
                stream_type: StreamType::Traces,
                name: "t1".into(),
            },
        );
        let summary = deploy_summary(&org);
        let ctx =
            evidence_context(&org, user, ListMode::On, 0, std::slice::from_ref(&summary)).await;
        checker.fail_object_check_once(user, UnavailableReason::Server(500));

        crate::service_identity::global_tables_for_tests().await;
        let conn = get_orm_client_rw().await;
        deploys::Entity::insert(
            deploys::Model {
                deploy_key: org.clone(),
                org_id: org,
                scope_key: summary.scope_key,
                where_key: summary.where_key,
                service_name: summary.service_name,
                kind: "deploy".into(),
                at: 1,
                source_streams: json!([format!("logs/{}", "x".repeat(300))]).to_string(),
                ..Default::default()
            }
            .into_active_model(),
        )
        .exec_without_returning(conn)
        .await
        .unwrap();
        let params = BTreeMap::from([("service".into(), "svc".into())]);
        let response = deploys(&ctx, &params).await.unwrap_err();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[axum::http::header::RETRY_AFTER], "3");
        assert_eq!(response.headers()["x-o2-authz"], "unavailable");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error_code"], "authz_unavailable");
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn enrich_versions_keeps_a_definite_restriction_without_checking_later_deploys() {
        use sea_orm::IntoActiveModel;

        use crate::authz::{
            fake_checker,
            list::{ModeAnswers, UnavailableReason},
        };

        let org = format!("versions_authz_{}", config::utils::time::now_micros());
        let user = "versions-denied-deploy@example.com";
        let ctx = evidence_context(&org, user, ListMode::On, 0, &[deploy_summary(&org)]).await;
        assert!(matches!(ctx.readable.answers, ModeAnswers::Serve(_)));
        let checker = fake_checker();
        let failing_stream = "x".repeat(300);
        checker.fail_object_check_of(user, &failing_stream, UnavailableReason::Timeout);
        let denied = deploys::Model {
            deploy_key: format!("{org}-denied"),
            org_id: org.clone(),
            to_version_key: "v1".into(),
            at: 2,
            source_streams: json!(["traces/denied"]).to_string(),
            ..Default::default()
        };
        let failing = deploys::Model {
            deploy_key: format!("{org}-failing"),
            at: 1,
            source_streams: json!([format!("logs/{failing_stream}")]).to_string(),
            ..denied.clone()
        };

        crate::service_identity::global_tables_for_tests().await;
        let conn = get_orm_client_rw().await;
        deploys::Entity::insert_many(
            [denied.clone(), failing.clone()].map(IntoActiveModel::into_active_model),
        )
        .exec_without_returning(conn)
        .await
        .unwrap();

        let before = checker.calls(user);
        let mut versions = [json!({"version_key":"v1"})];
        enrich_versions(&ctx, &mut versions).await.unwrap();
        assert_eq!(versions[0]["restricted"], true);
        assert_eq!(versions[0]["deploys"][0]["deploy_key"], denied.deploy_key);
        assert_eq!(versions[0]["deploys"][1]["deploy_key"], failing.deploy_key);
        assert_eq!(checker.calls(user), before);
        assert_eq!(
            deploy_outcome(&ctx, &failing, Calls::Send).await,
            Some(Outcome::Error(UnavailableReason::Timeout))
        );
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn summary_keeps_a_later_definite_restriction_after_an_evidence_error() {
        use crate::authz::{
            fake_checker,
            list::{ModeAnswers, SMALL_REQUEST_OBJECTS},
        };

        let org = format!("verdict_authz_{}", config::utils::time::now_micros());
        let user = "verdict-denied-evidence@example.com";
        let ctx = on_evidence_context(&org, user, SMALL_REQUEST_OBJECTS).await;
        assert!(matches!(ctx.readable.answers, ModeAnswers::SmallOn));
        let checker = fake_checker();
        assert_eq!(
            ctx.readable
                .evidence(
                    &org,
                    user,
                    &["traces/denied".into()],
                    false,
                    false,
                    &ctx.evidence
                )
                .await,
            Ok(false)
        );
        checker.fail_stream_read_once(user, "app");
        let failing = verdicts::Model {
            verdict_key: format!("{org}-failing"),
            org_id: org.clone(),
            cluster: "a".into(),
            source_streams: json!(["traces/app"]).to_string(),
            ..Default::default()
        };
        let denied = verdicts::Model {
            verdict_key: format!("{org}-denied"),
            cluster: "b".into(),
            source_streams: json!(["traces/denied"]).to_string(),
            ..failing.clone()
        };

        crate::service_identity::global_tables_for_tests().await;
        let before = checker.calls(user);
        let result = summary(&ctx, &[failing, denied]).await.unwrap();
        assert_eq!(result["restricted"], true);
        let after = checker.calls(user);
        assert_eq!(after.streams - before.streams, 1);
        assert_eq!((after.types_access, after.lists), (0, 0));
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn summary_returns_a_reached_parse_error_after_an_evidence_error() {
        use crate::authz::list::SMALL_REQUEST_OBJECTS;

        let org = "malformed_verdict_sources";
        let user = "malformed-verdict-sources@example.com";
        let ctx = on_evidence_context(org, user, SMALL_REQUEST_OBJECTS).await;
        let checker = fake_checker();
        checker.fail_stream_read_once(user, "app");
        let failing = verdicts::Model {
            org_id: org.into(),
            cluster: "a".into(),
            source_streams: json!(["traces/app"]).to_string(),
            ..Default::default()
        };
        let malformed = verdicts::Model {
            cluster: "b".into(),
            source_streams: "{".into(),
            ..failing.clone()
        };
        let before = checker.calls(user);
        let response = summary(&ctx, &[failing, malformed]).await.unwrap_err();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(!response.headers().contains_key("x-o2-authz"));
        assert_eq!(checker.calls(user).streams - before.streams, 1);
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn small_on_versions_stop_checks_at_the_first_error_or_denial() {
        use sea_orm::IntoActiveModel;

        use crate::authz::list::{ModeAnswers, SMALL_REQUEST_OBJECTS};

        crate::service_identity::global_tables_for_tests().await;
        let conn = get_orm_client_rw().await;
        let checker = fake_checker();
        let run = config::utils::time::now_micros();
        for newer_fails in [true, false] {
            let org = format!("small_versions_authz_{run}_{newer_fails}");
            let on_user = format!("small-versions-on-{newer_fails}@example.com");
            let off_user = format!("small-versions-off-{newer_fails}@example.com");
            let on = on_evidence_context(&org, &on_user, SMALL_REQUEST_OBJECTS).await;
            assert!(matches!(on.readable.answers, ModeAnswers::SmallOn));
            let off = evidence_context(&org, &off_user, ListMode::Off, 0, &[]).await;
            let (newer_source, older_source) = if newer_fails {
                ("logs/failing", "logs/denied")
            } else {
                ("logs/denied", "logs/failing")
            };
            let newer = deploys::Model {
                deploy_key: format!("{org}-newer"),
                org_id: org.clone(),
                to_version_key: "v1".into(),
                at: 2,
                source_streams: json!([newer_source]).to_string(),
                ..Default::default()
            };
            let older = deploys::Model {
                deploy_key: format!("{org}-older"),
                at: 1,
                source_streams: json!([older_source]).to_string(),
                ..newer.clone()
            };
            deploys::Entity::insert_many([newer, older].map(IntoActiveModel::into_active_model))
                .exec_without_returning(conn)
                .await
                .unwrap();
            for user in [&on_user, &off_user] {
                checker.fail_stream_read_once(user, "failing");
            }

            let mut on_versions = [json!({"version_key":"v1"})];
            let mut off_versions = on_versions.clone();
            let before = checker.calls(&on_user);
            let result = enrich_versions(&on, &mut on_versions).await;
            enrich_versions(&off, &mut off_versions).await.unwrap();
            assert_eq!(off_versions[0]["restricted"], true);
            assert_eq!(off_versions[0]["deploys"].as_array().unwrap().len(), 2);
            if newer_fails {
                let response = result.unwrap_err();
                assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
                assert_eq!(response.headers()["x-o2-authz"], "unavailable");
            } else {
                result.unwrap();
                assert_eq!(on_versions, off_versions);
            }
            let after = checker.calls(&on_user);
            assert_eq!(
                after.streams - before.streams,
                1,
                "only the newer deploy needs a Check"
            );
            assert_eq!(after, checker.calls(&off_user));
        }
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn deploys_merges_region_restrictions_before_surfacing_evidence_errors() {
        use config::meta::stream::StreamType;
        use sea_orm::IntoActiveModel;

        use crate::authz::{TypedStream, list::UnavailableReason};

        crate::service_identity::global_tables_for_tests().await;
        infra::db::get_db().await.create_table().await.unwrap();
        let conn = get_orm_client_rw().await;
        let checker = fake_checker();
        let params = BTreeMap::from([("service".into(), "svc".into())]);
        let failing = "x".repeat(300);
        let run = config::utils::time::now_micros();
        for (sibling_readable, failure_in_verdict) in
            [(false, false), (true, false), (false, true), (true, true)]
        {
            let case = format!("{sibling_readable}_{failure_in_verdict}");
            let org = format!("merged_deploy_{run}_{case}");
            let user = format!("merged-deploy-on-{case}@example.com");
            let off_user = format!("merged-deploy-off-{case}@example.com");
            for user in [&user, &off_user] {
                checker.grant_read(
                    user,
                    &TypedStream {
                        org_id: org.clone(),
                        stream_type: StreamType::Traces,
                        name: "t1".into(),
                    },
                );
            }
            let summary = deploy_summary(&org);
            let rows = std::slice::from_ref(&summary);
            let ctx = evidence_context(&org, &user, ListMode::On, 0, rows).await;
            let off = evidence_context(&org, &off_user, ListMode::Off, 0, rows).await;
            checker.fail_object_check_of(&user, &failing, UnavailableReason::Timeout);
            checker.fail_stream_read_once(&off_user, &failing);
            let failing_sources = json!([format!("logs/{failing}")]).to_string();
            let first = deploys::Model {
                deploy_key: format!("{org}-a"),
                org_id: org,
                service_name: summary.service_name,
                where_key: summary.where_key,
                scope_key: summary.scope_key,
                cluster: "a".into(),
                to_version: "v1".into(),
                to_version_key: "v1".into(),
                kind: "deploy".into(),
                at: 1,
                source_streams: if failure_in_verdict {
                    json!(["traces/t1"]).to_string()
                } else {
                    failing_sources.clone()
                },
                verdict_key: failure_in_verdict.then(|| format!("verdict-{}", ctx.org)),
                ..Default::default()
            };
            let sibling = if sibling_readable {
                "traces/t1"
            } else {
                "traces/denied"
            };
            let second = deploys::Model {
                deploy_key: format!("{}-b", first.org_id),
                cluster: "b".into(),
                at: first.at + 599_000_000,
                source_streams: json!([sibling]).to_string(),
                verdict_key: None,
                ..first.clone()
            };
            if let Some(key) = &first.verdict_key {
                verdicts::Entity::insert(
                    verdicts::Model {
                        verdict_key: key.clone(),
                        org_id: first.org_id.clone(),
                        deploy_key: first.deploy_key.clone(),
                        service_name: first.service_name.clone(),
                        where_key: first.where_key.clone(),
                        scope_key: first.scope_key.clone(),
                        cluster: first.cluster.clone(),
                        deploy_kind: first.kind.clone(),
                        verdict: "insufficient".into(),
                        state: "frozen".into(),
                        signal: "traces".into(),
                        baseline_rule: "none".into(),
                        baseline_rule_initial: "none".into(),
                        reason_code: "below_min_count".into(),
                        source_streams: failing_sources,
                        ..Default::default()
                    }
                    .into_active_model(),
                )
                .exec_without_returning(conn)
                .await
                .unwrap();
            }
            deploys::Entity::insert_many([first, second].map(IntoActiveModel::into_active_model))
                .exec_without_returning(conn)
                .await
                .unwrap();

            let result = deploys(&ctx, &params).await;
            if sibling_readable {
                let response = result.unwrap_err();
                assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
                assert_eq!(response.headers()["x-o2-authz"], "unavailable");
            } else {
                let answer = result.unwrap();
                assert_eq!(answer["deploys"].as_array().unwrap().len(), 1);
                assert_eq!(answer["deploys"][0]["regions"], json!(["a", "b"]));
                assert_eq!(answer["deploys"][0]["verdict"], json!({"restricted":true}));
                assert_eq!(answer, deploys(&off, &params).await.unwrap());
            }
            assert_eq!(checker.calls(&user).object_checks, 1);
        }
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn catalog_no_version_skips_excluded_verdict_evidence() {
        use config::meta::stream::StreamType;
        use sea_orm::IntoActiveModel;

        use crate::authz::{TypedStream, list::SMALL_REQUEST_OBJECTS};

        crate::service_identity::global_tables_for_tests().await;
        infra::db::get_db().await.create_table().await.unwrap();
        let org = format!("catalog_no_version_{}", config::utils::time::now_micros());
        let user = "catalog-no-version-authz@example.com";
        let checker = fake_checker();
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.clone(),
                stream_type: StreamType::Traces,
                name: "t1".into(),
            },
        );
        let versioned = deploy_summary(&org);
        let unversioned = WhereSummaryRecord {
            scope_key: format!("{org}-unversioned"),
            has_version: false,
            ..versioned.clone()
        };
        let scopes = vec![
            json!({"scope_key": versioned.scope_key, "newest_version": "v1"}),
            json!({"scope_key": unversioned.scope_key}),
        ];
        let ctx = evidence_context(
            &org,
            user,
            ListMode::On,
            SMALL_REQUEST_OBJECTS,
            &[versioned, unversioned],
        )
        .await;
        verdicts::Entity::insert(
            verdicts::Model {
                verdict_key: org.clone(),
                org_id: org.clone(),
                scope_key: org,
                version: "v1".into(),
                verdict: "ok".into(),
                source_streams: json!(["traces/verdict_evidence"]).to_string(),
                ..Default::default()
            }
            .into_active_model(),
        )
        .exec_without_returning(get_orm_client_rw().await)
        .await
        .unwrap();
        checker.fail_stream_read_once(user, "verdict_evidence");
        let before = checker.calls(user);
        let mut filtered = scopes.clone();
        let params = |verdict: &str| BTreeMap::from([("verdict".into(), verdict.into())]);

        filter_catalog(&ctx, &mut filtered, &params("no_version"))
            .await
            .unwrap();
        assert_eq!(filtered, scopes[1..]);
        assert_eq!(checker.calls(user), before);

        let mut mixed = scopes;
        let response = filter_catalog(&ctx, &mut mixed, &params("no_version,ok"))
            .await
            .unwrap_err();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()["x-o2-authz"], "unavailable");
        assert_eq!(checker.calls(user).streams, before.streams + 1);
    }

    #[cfg(feature = "test-utils")]
    async fn on_evidence_context(org: &str, user: &str, cutoff: usize) -> Context {
        evidence_context(org, user, ListMode::On, cutoff, &[]).await
    }

    #[cfg(feature = "test-utils")]
    async fn evidence_context(
        org: &str,
        user: &str,
        mode: ListMode,
        cutoff: usize,
        summaries: &[WhereSummaryRecord],
    ) -> Context {
        let checker = fake_checker();
        checker.set_list_mode(user, mode);
        checker.set_small_request_objects(user, cutoff);
        let readable = ReadableStreams::load(org, user, summaries, RumReads::Summaries)
            .await
            .unwrap();
        Context {
            org: org.into(),
            user: user.into(),
            summaries: readable.visible(summaries),
            readable,
            evidence: Default::default(),
            identity: Default::default(),
            aliases: Default::default(),
        }
    }

    #[cfg(feature = "test-utils")]
    fn deploy_summary(org: &str) -> WhereSummaryRecord {
        use config::meta::service_identity::EnvSource;

        WhereSummaryRecord {
            summary_key: org.into(),
            org_id: org.into(),
            service_name: "svc".into(),
            where_key: "default".into(),
            scope_key: org.into(),
            source_stream: "t1".into(),
            signal: "traces".into(),
            k8s_cluster: String::new(),
            k8s_namespace: String::new(),
            env: "default".into(),
            env_source: EnvSource::Default,
            env_source_value: String::new(),
            envs: Vec::new(),
            newest_version: "v1".into(),
            newest_version_key: "v1".into(),
            newest_first_seen: 1,
            has_version: true,
            first_seen: 1,
            last_seen: 2,
            purged_versions: 0,
            updated_at: 2,
        }
    }

    #[test]
    fn a_catalog_row_shows_the_verdict_of_its_newest_deploy() {
        let scope = json!({"newest_version":"2.0","newest_image":"9c1e4b7"});
        let deploy = |kind: &str| deploys::Model {
            kind: kind.into(),
            to_version: "1.0".into(),
            ..Default::default()
        };
        for kind in ["redeploy", "rollback", "deploy", "pre_existing"] {
            assert_eq!(
                verdict_version(&scope, Some(&deploy(kind))),
                Some("1.0".into()),
                "{kind}"
            );
        }
        assert_eq!(
            verdict_version(&scope, None),
            Some(VersionImage::new("2.0", Some("9c1e4b7")))
        );
        assert_eq!(verdict_version(&json!({}), None), None);
    }

    #[test]
    fn an_image_filter_must_be_an_image_short() {
        let params = |image: &str| BTreeMap::from([("image".to_string(), image.to_string())]);
        assert_eq!(image_param(&BTreeMap::new()).unwrap(), None);
        assert_eq!(image_param(&params("")).unwrap(), None);
        assert_eq!(image_param(&params("9c1e4b7")).unwrap(), Some("9c1e4b7"));
        for bad in ["9C1E4B7", "9c1e4b", "9c1e4b7f", "sha256:9c1e4b7"] {
            assert_eq!(
                image_param(&params(bad)).unwrap_err().status(),
                StatusCode::BAD_REQUEST,
                "{bad}"
            );
        }
    }

    #[tokio::test]
    async fn tracking_reports_the_epoch_and_the_warm_up_end() {
        infra::db::create_table().await.unwrap();
        // A persistent meta store keeps the epoch of an earlier run, so each run takes a fresh org.
        let org = &format!("tracking_epoch_org_{}", config::utils::time::now_micros());
        assert_eq!(
            tracking(org).await.unwrap(),
            json!({"epoch":null,"warmup_ends_at":null})
        );
        infra::db::get_db()
            .await
            .put(
                &format!("/service_signals/epoch/{org}"),
                bytes::Bytes::from("1000000"),
                infra::db::NO_NEED_WATCH,
                None,
            )
            .await
            .unwrap();
        let window = o2_enterprise::enterprise::common::config::get_config()
            .service_signals
            .window_secs as i64
            * 1_000_000;
        assert_eq!(
            tracking(org).await.unwrap(),
            json!({"epoch":1_000_000,"warmup_ends_at":1_000_000 + 8 * window})
        );
    }
}
