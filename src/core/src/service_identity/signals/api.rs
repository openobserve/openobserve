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

use std::collections::BTreeSet;

use config::{
    meta::service_identity::VersionImage,
    utils::time::{SECOND_MICRO_SECS, now_micros},
};
use o2_enterprise::enterprise::service_identity::compare::{
    ArmWindow, Coverage, EndpointArm, RumArm, TraceArm,
};
use serde_json::Value;

// The compare answers inside the HTTP budget; a background read must not hold a lane for minutes.
const COMPARE_TIMEOUT_SECS: i64 = 10;
const BACKGROUND_TIMEOUT_SECS: i64 = 60;

#[derive(Clone, Default)]
pub struct Aggregate {
    pub traces: TraceArm,
    pub endpoints: Vec<EndpointArm>,
    pub rum: RumArm,
    pub total: u64,
    pub volumes: std::collections::BTreeMap<VersionImage, (u64, u64)>,
    pub versions: std::collections::BTreeMap<VersionImage, Aggregate>,
    /// T1/R1 rows with traffic that no detail row overlaps; above 0 the arm's detail is coarse.
    pub detail_gaps: u64,
    pub traffic_span: Option<(i64, i64)>,
    /// Detail reaching past `traffic_span` was measured over a wider window than the tiles.
    pub detail_span: Option<(i64, i64)>,
    /// Read at whole-hour steps because the arm starts more than a day back (D240).
    pub hourly: bool,
}

pub struct Selection<'a> {
    pub services: &'a BTreeSet<String>,
    pub place: &'a str,
    pub version: &'a str,
    pub image: Option<&'a str>,
    pub signal: &'a str,
    pub streams: &'a BTreeSet<String>,
    pub window: ArmWindow,
    pub local: bool,
    pub cluster: Option<&'a str>,
    /// Detail rows starting from here and overlapping `window` are read too.
    pub detail_from: Option<i64>,
}

impl Selection<'_> {
    pub fn identity(&self) -> VersionImage {
        VersionImage::new(self.version, self.image)
    }
}

/// How far a section's detail reaches both arms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DetailBasis {
    Fine,
    Coarse,
}

impl DetailBasis {
    pub fn of(a: &Aggregate, b: &Aggregate) -> Self {
        if a.detail_gaps > 0 || b.detail_gaps > 0 {
            Self::Coarse
        } else {
            Self::Fine
        }
    }

    /// Endpoint rows a verdict may classify new errors from; coarse detail gives none.
    pub fn endpoints(self, arm: &Aggregate) -> Vec<EndpointArm> {
        if self == Self::Coarse {
            Vec::new()
        } else {
            arm.endpoints.clone()
        }
    }

    /// RUM inputs a verdict may classify new error types from; coarse detail gives none.
    pub fn rum(self, arm: &Aggregate) -> RumArm {
        let mut rum = arm.rum.clone();
        if self == Self::Coarse {
            rum.error_types.clear();
            rum.error_evidence.clear();
        }
        rum
    }
}

struct AutoInput<'a> {
    ctx: &'a crate::service_identity::api::Context,
    names: &'a BTreeSet<String>,
    place: &'a str,
    version: &'a VersionImage,
    deploy: Option<&'a infra::table::entity::service_version_deploys::Model>,
    previous: Option<&'a config::meta::service_identity::ServiceVersionRecord>,
    window: ArmWindow,
    volumes: Option<&'a Aggregate>,
    descriptors: &'a [(String, ArmWindow)],
    batches: &'a [Aggregate],
    rules: o2_enterprise::enterprise::service_identity::compare::WindowRules,
    signal: &'a str,
    deploy_times: &'a std::collections::BTreeMap<(String, VersionImage), i64>,
}

type ArmRange = Option<(i64, i64)>;

pub async fn aggregate(org: &str, selection: &Selection<'_>) -> anyhow::Result<Aggregate> {
    Ok(
        aggregate_many(org, &[selection], COMPARE_TIMEOUT_SECS, false)
            .await?
            .pop()
            .unwrap_or_default(),
    )
}

pub async fn aggregate_many(
    org: &str,
    selections: &[&Selection<'_>],
    timeout: i64,
    background: bool,
) -> anyhow::Result<Vec<Aggregate>> {
    if selections.is_empty() {
        return Ok(Vec::new());
    }
    let window = o2_enterprise::enterprise::common::config::get_config()
        .service_signals
        .window_secs as i64
        * SECOND_MICRO_SECS;
    let read = super::arms::read(org, selections, window, now_micros(), background);
    tokio::time::timeout(std::time::Duration::from_secs(timeout.unsigned_abs()), read)
        .await
        .map_err(|_| anyhow::anyhow!("service signals read timed out after {timeout}s"))?
}

/// Background [`aggregate_many`] for selections of either locality.
pub async fn aggregate_grouped(
    org: &str,
    selections: &[Selection<'_>],
) -> anyhow::Result<Vec<Aggregate>> {
    let refs: Vec<_> = selections.iter().collect();
    aggregate_many(org, &refs, BACKGROUND_TIMEOUT_SECS, true).await
}

pub fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn evaluation_window(eval_start: i64, now: i64, max_span: i64) -> ArmWindow {
    ArmWindow {
        start: eval_start,
        end: now
            .min(eval_start.saturating_add(max_span.max(0)))
            .max(eval_start),
        coverage: Coverage::Ok,
    }
}

pub(super) fn baseline_window(
    a: ArmWindow,
    concurrent: bool,
    transition_start: i64,
    available_start: i64,
) -> ArmWindow {
    if concurrent {
        return a;
    }
    let end = transition_start;
    ArmWindow {
        start: transition_start
            .saturating_sub(a.span())
            .max(available_start)
            .min(end),
        end,
        coverage: if transition_start < available_start {
            Coverage::AgedOut
        } else {
            Coverage::Ok
        },
    }
}

pub async fn compare(
    ctx: &crate::service_identity::api::Context,
    request: Value,
) -> Result<Value, axum::response::Response> {
    use axum::http::StatusCode;
    use o2_enterprise::enterprise::service_identity::compare::{
        ArmBounds, ArmInput, Coverage, WindowRules,
    };
    use serde_json::json;

    use crate::service_identity::api::{error, unavailable};
    let required = |value: &Value, key: &str| {
        value[key]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                error(
                    StatusCode::BAD_REQUEST,
                    "service, where and a.version are required",
                )
            })
    };
    let requested =
        requested_signals(&request).map_err(|message| error(StatusCode::BAD_REQUEST, message))?;
    let service = required(&request, "service")?;
    let place = required(&request, "where")?;
    let version = required(&request["a"], "version")?;
    let names = ctx.names(&service, Some(&place));
    if !names.iter().any(|name| ctx.visible(name, &place)) {
        return Err(error(StatusCode::NOT_FOUND, "Service scope not found"));
    }
    if request["baseline"]
        .as_str()
        .is_some_and(|value| !matches!(value, "auto" | "canary" | "previous"))
        || request["mode"]
            .as_str()
            .is_some_and(|value| !matches!(value, "sequential" | "concurrent"))
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "invalid compare mode or baseline",
        ));
    }
    let max_span = request["max_span_secs"].as_i64().unwrap_or(86400);
    let ci = request["ci_level"].as_f64().unwrap_or(0.9);
    if !(1..=604800).contains(&max_span) || !(0.0..1.0).contains(&ci) {
        return Err(error(StatusCode::BAD_REQUEST, "invalid compare options"));
    }
    let now = config::utils::time::now_micros();
    let rules = WindowRules {
        window: o2_enterprise::enterprise::common::config::get_config()
            .service_signals
            .window_secs as i64
            * 1_000_000,
        max_span: max_span * 1_000_000,
        retention_start: now - 400 * 86_400_000_000,
    };
    let registry = registry(infra::db::get_orm_client_rw().await, ctx, &names)
        .await
        .map_err(unavailable)?;
    let scopes: BTreeSet<_> = names
        .iter()
        .map(|name| config::meta::service_identity::scope_key(&ctx.org, name, &place))
        .collect();
    let pinned = if let Some(key) = request["a"]["deploy_key"].as_str() {
        infra::table::service_version_deploys::get(
            infra::db::get_orm_client_rw().await,
            &ctx.org,
            key,
        )
        .await
        .map_err(unavailable)?
        .filter(|row| scopes.contains(&row.scope_key))
    } else {
        None
    };
    let version = pinned_identity(
        &registry,
        &place,
        &version,
        request["a"]["image"].as_str(),
        pinned.as_ref(),
    );
    let a_record = registry
        .iter()
        .find(|r| r.where_key == place && r.identity() == version);
    if a_record.is_some_and(|r| crate::service_identity::api::compare_disabled(r).0) {
        return Err(error(
            StatusCode::CONFLICT,
            config::meta::service_identity::COMPARE_DISABLED_NO_SPAN_VERSION,
        ));
    }
    let mut history = Vec::new();
    for scope in &scopes {
        history.extend(
            infra::table::service_version_deploys::history(
                infra::db::get_orm_client_rw().await,
                &ctx.org,
                scope,
                None,
                1000,
            )
            .await
            .map_err(unavailable)?,
        );
    }
    let explicit_deploy = pinned.filter(|row| row.to_identity() == version);
    let missing_transition = request["a"]["deploy_key"].is_string() && explicit_deploy.is_none();
    let deploy = explicit_deploy.as_ref().or_else(|| {
        (!missing_transition)
            .then(|| governing_transition(&history, &version))
            .flatten()
    });
    let a = a_record
        .and_then(|r| ArmBounds::from_record(r, None))
        .or_else(|| {
            deploy.map(|d| ArmBounds {
                version: version.version.clone(),
                image: version.image.clone(),
                version_key: d.to_version_key.clone(),
                first_seen: d.at,
                last_seen: now,
            })
        })
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Version not found"))?;
    let manual = request["b"]["version"]
        .as_str()
        .map(|v| arm_identity(&registry, &place, v, request["b"]["image"].as_str()));
    let manual = manual.as_ref();
    let b_record = manual.and_then(|v| {
        registry
            .iter()
            .find(|r| r.identity() == *v && r.where_key == place)
    });
    if manual.is_some() && b_record.is_none() {
        return Err(error(StatusCode::NOT_FOUND, "Baseline version not found"));
    }
    if b_record.is_some_and(|r| crate::service_identity::api::compare_disabled(r).0) {
        return Err(error(
            StatusCode::CONFLICT,
            config::meta::service_identity::COMPARE_DISABLED_NO_SPAN_VERSION,
        ));
    }
    let range = |arm: &Value| -> Result<Option<(i64, i64)>, axum::response::Response> {
        match (arm["start_time"].as_i64(), arm["end_time"].as_i64()) {
            (None, None) => Ok(None),
            (Some(start), Some(end)) if start < end && end - start <= 604_800_000_000 => {
                Ok(Some((start, end)))
            }
            _ => Err(error(StatusCode::BAD_REQUEST, "invalid arm window")),
        }
    };
    let a_range = range(&request["a"])?;
    let b_range = range(&request["b"])?;
    let explicit_concurrent = request["mode"] == "concurrent";
    let window = range(&request["window"])?;
    if explicit_concurrent && window.is_none() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "concurrent mode requires a window",
        ));
    }
    let rolled = db::service_signals::rolled_offset(&ctx.org)
        .await
        .map_err(unavailable)?;
    let end = now.min(rolled) / rules.window * rules.window;
    let automatic = manual.is_none() && request["baseline"].as_str().unwrap_or("auto") == "auto";
    let persisted = if automatic {
        if let Some(key) = deploy.and_then(|row| row.verdict_key.as_deref()) {
            infra::table::service_version_verdicts::get(
                infra::db::get_orm_client_rw().await,
                &ctx.org,
                key,
            )
            .await
            .map_err(unavailable)?
        } else {
            None
        }
    } else {
        None
    };
    let eval_start = persisted.as_ref().map_or_else(
        || deploy.map_or(a.first_seen, |d| d.at),
        |row| row.eval_start,
    );
    let manual_bounds = b_record
        .and_then(|r| ArmBounds::from_record(r, None))
        .map(|bounds| within_rollup(bounds, rolled));
    let (mut wa, manual_wb) = compare_windows(
        &within_rollup(a.clone(), rolled),
        manual_bounds.as_ref(),
        (a_range, b_range),
        window.filter(|_| explicit_concurrent),
        (eval_start, end),
        &rules,
    );
    let traces: BTreeSet<_> = ctx.readable.traces.iter().cloned().collect();
    let rum: BTreeSet<_> = ctx
        .readable
        .rum
        .then(|| "_rumdata".to_string())
        .into_iter()
        .collect();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    let a_traces = Selection {
        services: &names,
        place: &place,
        version: &version.version,
        image: version.image.as_deref(),
        signal: "traces",
        streams: &traces,
        window: wa,
        local: false,
        cluster: None,
        detail_from: None,
    };
    let a_rum = Selection {
        signal: "rum",
        streams: &rum,
        ..a_traces
    };
    let (ta, ra) = tokio::join!(
        tokio::time::timeout_at(
            deadline,
            requested_aggregate(requested.contains("traces"), &ctx.org, &a_traces)
        ),
        tokio::time::timeout_at(
            deadline,
            requested_aggregate(requested.contains("rum"), &ctx.org, &a_rum)
        )
    );
    let volumes = primary_volumes(
        ta.as_ref().ok().and_then(|r| r.as_ref().ok()),
        ra.as_ref().ok().and_then(|r| r.as_ref().ok()),
        request["signals"][0].as_str().expect("validated signals"),
    );
    let previous = if let Some(d) = deploy {
        d.from_identity().and_then(|v| {
            registry
                .iter()
                .find(|r| r.where_key == place && r.identity() == v)
        })
    } else {
        registry
            .iter()
            .filter(|r| r.where_key == place && r.first_seen < a.first_seen)
            .max_by_key(|r| r.first_seen)
    };
    let canary = deploy
        .and_then(|d| {
            serde_json::from_str::<
                Vec<o2_enterprise::enterprise::service_identity::deploys::ServingVersion>,
            >(&d.serving_versions)
            .ok()
        })
        .and_then(|members| {
            members
                .into_iter()
                .filter(|m| m.identity() != version)
                .filter_map(|m| {
                    volumes
                        .and_then(|v| {
                            v.volumes.get(&m.identity()).filter(|(n, latest)| {
                                *n >= 100
                                    && *latest >= 100
                                    && *n as f64 / v.total.max(1) as f64 >= 0.05
                                    && *latest as f64
                                        / v.volumes
                                            .values()
                                            .map(|(_, latest)| latest)
                                            .sum::<u64>()
                                            .max(1) as f64
                                        >= 0.05
                            })
                        })
                        .map(|n| (m.identity(), n.0))
                })
                .max_by_key(|(_, n)| *n)
                .map(|(v, _)| v)
        });
    let primary_traces = requested.contains("traces")
        && (ta
            .as_ref()
            .ok()
            .and_then(|result| result.as_ref().ok())
            .is_none_or(|aggregate| aggregate.total > 0)
            || request["signals"][0] == "traces");
    let primary_failed = if primary_traces {
        !matches!(&ta, Ok(Ok(_)))
    } else {
        !matches!(&ra, Ok(Ok(_)))
    };
    let has_persisted = persisted
        .as_ref()
        .is_some_and(|row| row.baseline_version.is_some());
    let mut baseline_unavailable = automatic && primary_failed && !has_persisted;
    let persisted_record = persisted
        .as_ref()
        .and_then(|row| persisted_baseline(&registry, row, &place));
    let (mut baseline, mut rule, mut concurrent) = if automatic && (primary_failed || has_persisted)
    {
        (
            persisted_record,
            persisted
                .as_ref()
                .map_or("none", |row| row.baseline_rule.as_str()),
            persisted
                .as_ref()
                .is_some_and(|row| matches!(row.baseline_rule.as_str(), "canary" | "env_fallback")),
        )
    } else if let Some(b) = b_record {
        (Some(b), "manual", explicit_concurrent)
    } else if request["baseline"] != "previous" && canary.is_some() {
        (
            registry
                .iter()
                .find(|r| canary.as_ref() == Some(&r.identity()) && r.where_key == place),
            "canary",
            true,
        )
    } else {
        (
            previous,
            if deploy.is_some() {
                "previous"
            } else {
                "previous_by_first_seen"
            },
            false,
        )
    };
    let mut b_bounds = baseline.and_then(|r| ArmBounds::from_record(r, None));
    let mut wb = if concurrent {
        baseline_window(wa, true, 0, 0)
    } else if manual.is_some() {
        manual_wb
    } else if let Some(bounds) = b_range {
        ArmWindow {
            start: bounds.0,
            end: bounds.1,
            coverage: Coverage::Ok,
        }
    } else if let Some(deploy) = deploy.filter(|_| manual.is_none()) {
        baseline_window(
            wa,
            false,
            deploy.at,
            b_bounds.as_ref().map_or(rules.retention_start, |b| {
                b.first_seen.max(rules.retention_start)
            }),
        )
    } else if let Some(b) = &b_bounds {
        baseline_window(
            wa,
            false,
            a.first_seen,
            b.first_seen.max(rules.retention_start),
        )
    } else {
        wa
    };
    let mut bv = persisted
        .as_ref()
        .and_then(infra::table::entity::service_version_verdicts::Model::baseline_identity)
        .unwrap_or_else(|| baseline.map_or_else(VersionImage::default, |r| r.identity()));
    let mut baseline_place = persisted
        .as_ref()
        .and_then(|row| row.baseline_where_key.as_deref())
        .unwrap_or(&place)
        .to_string();
    let mut descriptors = vec![(baseline_place.clone(), wb)];
    if explicit_concurrent
        && !descriptors
            .iter()
            .any(|(place, bounds)| place == &baseline_place && *bounds == wa)
    {
        descriptors.push((baseline_place.clone(), wa));
    }
    let automatic_lookup =
        automatic && !has_persisted && !primary_failed && (deploy.is_some() || previous.is_none());
    if automatic_lookup {
        let env = a_record
            .map(|row| {
                ctx.version(row, now)["env"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string()
            })
            .unwrap_or_default();
        let labels = ctx.scope_labels();
        for row in &ctx.summaries {
            if names.iter().any(|name| {
                config::meta::service_identity::service_key(name)
                    == config::meta::service_identity::service_key(&row.service_name)
            }) && row.where_key != place
                && labels
                    .get(&(row.service_name.as_str(), row.where_key.as_str()))
                    .is_some_and(|label| crate::service_identity::api::env_matches(label, &env))
            {
                for window in [
                    wa,
                    ArmWindow {
                        start: deploy.map_or(wa.start, |d| d.at) - wa.span(),
                        end: deploy.map_or(wa.start, |d| d.at),
                        coverage: Coverage::Ok,
                    },
                ] {
                    if !descriptors
                        .iter()
                        .any(|(place, bounds)| place == &row.where_key && *bounds == window)
                    {
                        descriptors.push((row.where_key.clone(), window));
                    }
                }
            }
        }
    }
    let bt = Selection {
        place: &baseline_place,
        version: &bv.version,
        image: bv.image.as_deref(),
        window: wb,
        ..a_traces
    };
    let br = Selection {
        place: &baseline_place,
        version: &bv.version,
        image: bv.image.as_deref(),
        window: wb,
        ..a_rum
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    let (mut trace_batches, mut rum_batches) = tokio::join!(
        tokio::time::timeout_at(
            deadline,
            requested_batches(requested.contains("traces"), &ctx.org, &bt, &descriptors)
        ),
        tokio::time::timeout_at(
            deadline,
            requested_batches(requested.contains("rum"), &ctx.org, &br, &descriptors)
        ),
    );
    if automatic_lookup {
        let primary_batches = if primary_traces {
            &trace_batches
        } else {
            &rum_batches
        };
        if let Ok(Ok(batches)) = primary_batches {
            let deploy_times = baseline_deploy_times(ctx, &names, &descriptors)
                .await
                .map_err(unavailable)?;
            let selection = choose_automatic_baseline(AutoInput {
                ctx,
                names: &names,
                place: &place,
                version: &version,
                deploy,
                previous,
                window: wa,
                volumes,
                descriptors: &descriptors,
                batches,
                rules,
                signal: if primary_traces { "traces" } else { "rum" },
                deploy_times: &deploy_times,
            })
            .map_err(unavailable)?;
            bv = selection.identity().unwrap_or_default();
            baseline_place = selection.where_key.unwrap_or_else(|| place.clone());
            wb = selection.window.unwrap_or(wa);
            rule = match selection.rule {
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::Canary => {
                    "canary"
                }
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::Previous => {
                    if deploy.is_some() {
                        "previous"
                    } else {
                        "previous_by_first_seen"
                    }
                }
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::EnvFallback => {
                    "env_fallback"
                }
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::None => "none",
            };
            concurrent = matches!(selection.rule,
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::Canary |
                o2_enterprise::enterprise::service_identity::verdict::BaselineRule::EnvFallback);
            if concurrent {
                wb = wa;
            }
            baseline = registry
                .iter()
                .find(|row| row.identity() == bv && row.where_key == baseline_place);
            b_bounds = baseline.and_then(|row| ArmBounds::from_record(row, None));
        } else {
            baseline_unavailable = true;
        }
    }
    if explicit_concurrent {
        concurrent = true;
        wb = wa;
    }
    let extract = |batches: &mut Vec<Aggregate>, rum: bool| {
        descriptors
            .iter()
            .position(|(place, bounds)| place == &baseline_place && *bounds == wb)
            .and_then(|index| batches.get_mut(index))
            .and_then(|batch| baseline_part(batch, &bv, rum))
            .unwrap_or_default()
    };
    let tb = trace_batches
        .as_mut()
        .ok()
        .and_then(|value| value.as_mut().ok())
        .map(|batches| extract(batches, false));
    let rb = rum_batches
        .as_mut()
        .ok()
        .and_then(|value| value.as_mut().ok())
        .map(|batches| extract(batches, true));
    let tb = match trace_batches {
        Err(error) => Err(error),
        Ok(Err(error)) => Ok(Err(error)),
        Ok(Ok(_)) => Ok(Ok(tb.unwrap_or_default())),
    };
    let rb = match rum_batches {
        Err(error) => Err(error),
        Ok(Err(error)) => Ok(Err(error)),
        Ok(Ok(_)) => Ok(Ok(rb.unwrap_or_default())),
    };
    let mut notes = Vec::new();
    if missing_transition {
        notes.push("Requested deploy transition is no longer available; comparing the version with an automatic baseline");
    }
    if baseline_unavailable {
        notes.push("baseline_unavailable");
    } else if bv.version.is_empty() {
        notes.push("no_previous_version");
    }
    if concurrent {
        let primary_a = if primary_traces { &ta } else { &ra };
        let primary_b = if primary_traces { &tb } else { &rb };
        if let (Ok(Ok(a)), Ok(Ok(b))) = (primary_a, primary_b) {
            let count = |data: &Aggregate| {
                if primary_traces {
                    data.traces.requests
                } else {
                    data.rum.views
                }
            };
            (wa, wb) = concurrent_windows(wa, wb, (count(a), count(b), a.total), &rules);
        }
    }
    let signal_presence =
        |traces: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
         rum: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>| json!({"traces":traces.as_ref().ok().and_then(|result|result.as_ref().ok()).is_some_and(|data|data.traces.requests>0),"rum":rum.as_ref().ok().and_then(|result|result.as_ref().ok()).is_some_and(|data|data.rum.views>0)});
    let a_presence = signal_presence(&ta, &ra);
    let b_presence = signal_presence(&tb, &rb);
    let share = |data: &Aggregate| {
        if primary_traces {
            data.traces.requests as f64 / data.total.max(1) as f64
        } else {
            data.rum.views as f64 / data.total.max(1) as f64
        }
    };
    let a_share = concurrent
        .then(|| {
            if primary_traces {
                ta.as_ref()
            } else {
                ra.as_ref()
            }
            .ok()
            .and_then(|result| result.as_ref().ok())
            .map(share)
        })
        .flatten();
    let b_share = concurrent
        .then(|| {
            if primary_traces {
                tb.as_ref()
            } else {
                rb.as_ref()
            }
            .ok()
            .and_then(|result| result.as_ref().ok())
            .map(share)
        })
        .flatten();
    let mut transition = if let Some(row) = deploy {
        super::deploys::transition(row).map_err(unavailable)?
    } else {
        use o2_enterprise::enterprise::service_identity::deploys::{EntrySource, Kind, Transition};
        Transition {
            deploy_key: String::new(),
            org_id: ctx.org.clone(),
            service_name: service.clone(),
            where_key: place.clone(),
            scope_key: config::meta::service_identity::scope_key(&ctx.org, &service, &place),
            cluster: config::get_cluster_name(),
            to_version: version.version.clone(),
            to_image: version.image.clone(),
            to_version_key: a.version_key.clone(),
            from_version: (!bv.version.is_empty()).then(|| bv.version.clone()),
            from_image: bv.image.clone(),
            from_version_key: None,
            kind: Kind::Deploy,
            entry_source: EntrySource::Traffic,
            at: wa.start,
            share_at_entry: 0.0,
            serving_versions: Vec::new(),
            overflow_count: 0,
            source_streams: ctx
                .summaries
                .iter()
                .filter(|row| row.service_name == service && row.where_key == place)
                .map(|row| {
                    format!(
                        "{}/{}",
                        if row.signal == "rum" {
                            "logs"
                        } else {
                            "traces"
                        },
                        row.source_stream
                    )
                })
                .collect(),
            superseded_at: None,
            verdict_key: None,
            created_at: now,
            updated_at: now,
        }
    };
    let (stored_verdict, prior) = if let Some(key) = transition.verdict_key.as_deref() {
        match infra::table::service_version_verdicts::get(
            infra::db::get_orm_client_rw().await,
            &ctx.org,
            key,
        )
        .await
        .map_err(unavailable)?
        {
            Some(row) => {
                let mut summary = super::reads::summary(ctx, std::slice::from_ref(&row)).await?;
                attach_not_serving_pods(ctx, &row, &mut summary).await;
                // Only the automatic baseline is the one the stored evaluation judged against.
                let prior = if automatic {
                    Some(
                        super::verdicts::restored(&ctx.org, &row)
                            .await
                            .map_err(unavailable)?,
                    )
                } else {
                    None
                };
                (summary, prior)
            }
            None => (serde_json::Value::Null, None),
        }
    } else {
        (serde_json::Value::Null, None)
    };
    transition.verdict_key = Some("live".into());
    use o2_enterprise::enterprise::service_identity::verdict::{
        BaselineSelection, EvaluationInput,
    };
    let successful = |result: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>| {
        result.as_ref().ok().and_then(|r| r.as_ref().ok()).cloned()
    };
    let traces_live = successful(&ta)
        .zip(successful(&tb))
        .filter(|_| !baseline_unavailable && requested.contains("traces"));
    let rum_live = successful(&ra)
        .zip(successful(&rb))
        .filter(|_| !baseline_unavailable && requested.contains("rum"));
    let picked = rule == "manual";
    let rolled_back_from =
        super::verdicts::from_verdict(infra::db::get_orm_client_rw().await, &ctx.org, &transition)
            .await
            .map_err(unavailable)?;
    let (mut live_row, live_metrics) = super::verdicts::preview(
        EvaluationInput {
            transition: &transition,
            baseline: BaselineSelection {
                rule: live_rule(rule, concurrent),
                version: (!bv.version.is_empty()).then(|| bv.version.clone()),
                image: bv.image.clone(),
                where_key: Some(baseline_place.clone()),
                window: Some(wb),
                ..Default::default()
            },
            traces: traces_live.as_ref().map(|(a, b)| {
                (
                    ArmInput {
                        window: wa,
                        data: Some(a.traces.clone()),
                    },
                    ArmInput {
                        window: wb,
                        data: Some(b.traces.clone()),
                    },
                )
            }),
            rum: rum_live.as_ref().map(|(a, b)| {
                (
                    ArmInput {
                        window: wa,
                        data: Some(DetailBasis::of(a, b).rum(a)),
                    },
                    ArmInput {
                        window: wb,
                        data: Some(DetailBasis::of(a, b).rum(b)),
                    },
                )
            }),
            endpoints_new: traces_live
                .as_ref()
                .map_or_else(Vec::new, |(a, b)| DetailBasis::of(a, b).endpoints(a)),
            endpoints_base: traces_live
                .as_ref()
                .map_or_else(Vec::new, |(a, b)| DetailBasis::of(a, b).endpoints(b)),
            new_windows: closed_windows(wa, rules.window),
            eval_start: wa.start,
            now,
            env: "default",
            not_serving: Default::default(),
            prior: prior.as_ref(),
            from_frozen: rolled_back_from.as_ref(),
        },
        picked,
    )
    .map_err(unavailable)?;
    if picked {
        // The picked baseline, not the automatic rule it is judged like, labels this verdict.
        live_row.baseline_rule = rule.into();
        live_row.baseline_rule_initial = rule.into();
        live_row.baseline_version_initial = live_row.baseline_version.clone();
    }
    live_row.source_streams_overflow |= deploy.is_some_and(|row| row.source_streams_overflow);
    let mut live_verdict = super::reads::summary(ctx, &[live_row]).await?;
    if live_verdict["restricted"] != true {
        live_verdict["metrics"] = serde_json::to_value(live_metrics).map_err(unavailable)?;
    }
    let a_rollup = has_rollup(&ta, &ra, &version);
    let b_rollup = if !bv.version.is_empty() && !baseline_unavailable {
        has_rollup(&tb, &rb, &bv)
    } else {
        Value::Null
    };
    let a_basis = arm_basis(&ta, &ra);
    let b_basis = arm_basis(&tb, &rb);
    let endpoints_limit = request["endpoints_limit"].as_u64().unwrap_or(50).min(1000) as usize;
    let traces = section_result(ta, tb, baseline_unavailable, |a, b| {
        let windows = if concurrent {
            concurrent_windows(
                wa,
                wb,
                (a.traces.requests, b.traces.requests, a.total),
                &rules,
            )
        } else {
            (wa, wb)
        };
        traces_detail(a, b, windows, ci, endpoints_limit)
    });
    let rum = section_result(ra, rb, baseline_unavailable, |a, b| {
        let windows = if concurrent {
            concurrent_windows(wa, wb, (a.rum.views, b.rum.views, a.total), &rules)
        } else {
            (wa, wb)
        };
        rum_detail(a, b, windows, ci)
    });
    let mut response = json!({"service":service,"where_key":place,"env":a_record.or(baseline).map(|row| ctx.version(row, now)["env"].clone()).unwrap_or(json!("default")),"mode":if concurrent{"concurrent"}else{"sequential"},"aliases_applied":names.iter().filter(|name| **name != service).collect::<Vec<_>>(),"arms":{"a":{"version":version.version,"image":version.image,"first_seen":a.first_seen,"last_seen":a.last_seen,"start_time":wa.start,"end_time":wa.end,"coverage":wa.coverage},"b":{"version":bv.version,"image":bv.image,"start_time":wb.start,"end_time":wb.end,"coverage":wb.coverage}},"baseline_rule":if !bv.version.is_empty(){rule}else{"none"},"baseline_reason":{"deploy_key":deploy.map(|r|&r.deploy_key)},"traces":traces,"rum":rum,"notes":notes});
    response["deploy_key"] = json!(deploy.map(|row| &row.deploy_key));
    response["stored_verdict"] = stored_verdict;
    response["live_verdict"] = live_verdict;
    super::rum_drill::attach(
        ctx,
        &mut response,
        super::rum_drill::CompareArms {
            requested: requested.contains("rum"),
            names: &names,
            a: super::rum_drill::Arm {
                version: &version.version,
                place: &place,
                start: wa.start,
                end: wa.end,
            },
            b: (!bv.version.is_empty() && !baseline_unavailable).then_some(super::rum_drill::Arm {
                version: &bv.version,
                place: &baseline_place,
                start: wb.start,
                end: wb.end,
            }),
            ci_level: ci,
        },
    )
    .await;
    redact_compare_evidence(&mut response);
    for (arm, record) in [("a", a_record), ("b", baseline)] {
        response["arms"][arm]["image_ref"] = json!(record.and_then(|r| r.image_ref.as_ref()));
    }
    response["no_env"] = a_record
        .or(baseline)
        .map_or(json!(false), |row| ctx.version(row, now)["no_env"].clone());
    response["arms"]["a"]["basis"] = json!(a_basis);
    response["arms"]["b"]["basis"] = json!(b_basis);
    response["arms"]["a"]["signals"] = a_presence;
    response["arms"]["b"]["signals"] = b_presence;
    response["arms"]["a"]["traffic_share"] = json!(a_share);
    response["arms"]["b"]["traffic_share"] = json!(b_share);
    response["arms"]["a"]["version_key"] = json!(a.version_key);
    response["arms"]["a"]["deploy_key"] = json!(deploy.map(|row| &row.deploy_key));
    response["arms"]["b"]["where_key"] = json!(baseline_place);
    response["arms"]["a"]["has_rollup"] = a_rollup;
    response["arms"]["b"]["has_rollup"] = b_rollup;
    response["arms"]["b"]["first_seen"] = json!(b_bounds.as_ref().map(|bounds| bounds.first_seen));
    response["arms"]["b"]["last_seen"] = json!(b_bounds.as_ref().map(|bounds| bounds.last_seen));
    for signal in ["traces", "rum"] {
        if !requested.contains(signal) {
            response
                .as_object_mut()
                .expect("response object")
                .remove(signal);
        }
    }
    Ok(response)
}

/// A compare response from the real section builders on two fixed arms, for the schema test.
#[cfg(feature = "test-utils")]
pub fn representative_compare() -> Value {
    use config::meta::service_identity::{NOT_SERVING_K8S_REASON, NotServingPod, NotServingPods};
    use o2_enterprise::enterprise::service_identity::compare::ErrorEvidence;

    let window = ArmWindow {
        start: 0,
        end: 3_600_000_000,
        coverage: Coverage::Ok,
    };
    let endpoint = |operation: &str, errors| EndpointArm {
        operation: operation.into(),
        source_stream: "default".into(),
        requests: 500,
        errors,
        latency: None,
    };
    let arm = |fingerprint: &str, errors: u64, endpoints| {
        let evidence = ErrorEvidence {
            error_type: Some("TypeError".into()),
            page: Some("/".into()),
            ..Default::default()
        };
        Aggregate {
            traces: TraceArm {
                requests: 1000,
                errors,
                latency: None,
            },
            endpoints,
            rum: RumArm {
                views: 800,
                error_views: 40,
                errors,
                sessions: 300,
                error_types: [(fingerprint.to_string(), errors)].into(),
                error_evidence: [(fingerprint.to_string(), evidence)].into(),
                ..Default::default()
            },
            total: 1800,
            ..Default::default()
        }
    };
    let a = arm(
        "fp-new",
        30,
        vec![endpoint("GET /a", 30), endpoint("GET /new", 5)],
    );
    let b = arm("fp-old", 4, vec![endpoint("GET /a", 0)]);
    let read = |aggregate: &Aggregate| Ok(Ok(aggregate.clone()));
    let mut verdict = serde_json::json!({"verdict":"not_serving","reason_code":NOT_SERVING_K8S_REASON,"restricted":false});
    let pod = NotServingPod {
        k8s_pod: "web-7d9".into(),
        status: Some("running".into()),
        ready: Some(true),
        ..Default::default()
    };
    let streams = vec!["k8s_info".to_string()];
    NotServingPods {
        pods: vec![pod],
        pods_total: 1,
        source_streams: streams.clone(),
        status_streams: streams,
    }
    .attach(&mut verdict, true, true);
    let mut response = serde_json::json!({
        "traces": section_result(read(&a), read(&b), false, |a, b| traces_detail(a, b, (window, window), 0.9, 50)),
        "rum": section_result(read(&a), read(&b), false, |a, b| rum_detail(a, b, (window, window), 0.9)),
        "live_verdict": verdict,
        "notes": ["baseline_unavailable"],
    });
    let mut sections = super::rum_drill::representative_sections().expect("drill sections");
    super::rum_drill::apply_samples(&mut response, &mut sections, &Default::default());
    response
        .as_object_mut()
        .expect("response object")
        .extend(sections);
    response
}

fn compare_windows(
    a: &o2_enterprise::enterprise::service_identity::compare::ArmBounds,
    b: Option<&o2_enterprise::enterprise::service_identity::compare::ArmBounds>,
    ranges: (ArmRange, ArmRange),
    concurrent: Option<(i64, i64)>,
    evaluation: (i64, i64),
    rules: &o2_enterprise::enterprise::service_identity::compare::WindowRules,
) -> (ArmWindow, ArmWindow) {
    let explicit = |(start, end)| ArmWindow {
        start,
        end,
        coverage: Coverage::Ok,
    };
    if let Some(window) = concurrent {
        let a = explicit(ranges.0.unwrap_or(window));
        return (a, a);
    }
    if let Some(b) = b {
        let (a, b) = o2_enterprise::enterprise::service_identity::compare::sequential_windows(
            a, ranges.0, b, ranges.1, rules,
        );
        return (ranges.0.map_or(a, explicit), ranges.1.map_or(b, explicit));
    }
    let mut a = ranges.0.map_or_else(
        || evaluation_window(evaluation.0, evaluation.1, rules.max_span),
        explicit,
    );
    if ranges.0.is_none() && a.start < rules.retention_start {
        a.start = rules.retention_start.min(a.end);
        if a.start == a.end {
            a.coverage = Coverage::AgedOut;
        }
    }
    (a, a)
}

/// Rollup windows of the configured length an arm spans, as the verdict job counts them.
fn closed_windows(window: ArmWindow, interval: i64) -> u32 {
    u32::try_from(window.span() / interval.max(1)).unwrap_or(u32::MAX)
}

/// The live verdict rule; a manual baseline is judged like the automatic rule of its mode.
fn live_rule(
    rule: &str,
    concurrent: bool,
) -> o2_enterprise::enterprise::service_identity::verdict::BaselineRule {
    use o2_enterprise::enterprise::service_identity::verdict::BaselineRule;
    match rule {
        "canary" => BaselineRule::Canary,
        "previous" | "previous_by_first_seen" => BaselineRule::Previous,
        "env_fallback" => BaselineRule::EnvFallback,
        "manual" if concurrent => BaselineRule::Canary,
        "manual" => BaselineRule::Previous,
        _ => BaselineRule::None,
    }
}

// Registry last_seen follows live ingest; arm aggregates exist only up to the rollup offset.
fn within_rollup(
    mut bounds: o2_enterprise::enterprise::service_identity::compare::ArmBounds,
    rolled: i64,
) -> o2_enterprise::enterprise::service_identity::compare::ArmBounds {
    bounds.last_seen = bounds
        .last_seen
        .min(rolled.saturating_sub(1))
        .max(bounds.first_seen);
    bounds
}

/// Marks detail reach: coarse claims no change, presence keeps no deltas.
fn traces_detail(
    a: Aggregate,
    b: Aggregate,
    (aw, bw): (ArmWindow, ArmWindow),
    ci: f64,
    endpoints_limit: usize,
) -> Value {
    use o2_enterprise::enterprise::service_identity::compare::{ArmInput, traces_section};
    let basis = DetailBasis::of(&a, &b);
    let mut result = serde_json::to_value(traces_section(
        &ArmInput {
            window: aw,
            data: Some(a.traces),
        },
        &ArmInput {
            window: bw,
            data: Some(b.traces),
        },
        &a.endpoints,
        &b.endpoints,
        ci,
        endpoints_limit,
    ))
    .expect("traces serialization");
    result["status"] = serde_json::json!("complete");
    detail_coverage(&mut result, basis);
    result
}

fn rum_detail(a: Aggregate, b: Aggregate, (aw, bw): (ArmWindow, ArmWindow), ci: f64) -> Value {
    use o2_enterprise::enterprise::service_identity::compare::{ArmInput, rum_section};
    let basis = DetailBasis::of(&a, &b);
    let mut result = serde_json::to_value(rum_section(
        &ArmInput {
            window: aw,
            data: Some(a.rum),
        },
        &ArmInput {
            window: bw,
            data: Some(b.rum),
        },
        ci,
    ))
    .expect("rum serialization");
    result["status"] = serde_json::json!("complete");
    detail_coverage(&mut result, basis);
    result
}

fn detail_coverage(section: &mut Value, basis: DetailBasis) {
    let status = match basis {
        DetailBasis::Coarse => {
            serde_json::json!({"status":"insufficient","reason":"detail_coarse"})
        }
        DetailBasis::Fine => serde_json::json!({"status":"ok","reason":null}),
    };
    if let Some(rows) = section.get_mut("endpoints").and_then(Value::as_array_mut) {
        for row in rows.iter_mut().filter_map(Value::as_object_mut) {
            if basis == DetailBasis::Coarse {
                row.remove("introduced");
            }
        }
        section["endpoint_detail"] = status;
    } else if let Some(types) = section
        .get_mut("error_types")
        .filter(|types| types.is_object())
    {
        if basis == DetailBasis::Coarse {
            types["introduced"] = serde_json::json!([]);
            types["fixed"] = serde_json::json!([]);
            types["insufficient"] = serde_json::json!(true);
        }
        section["error_detail"] = status;
    }
}

/// Adds the pods running a not_serving version when the caller reads their K1 sources.
async fn attach_not_serving_pods(
    ctx: &crate::service_identity::api::Context,
    row: &infra::table::entity::service_version_verdicts::Model,
    summary: &mut Value,
) {
    // K1 and span-pod rows are read region-locally, so only the evaluating region can list pods.
    if summary["verdict"] != "not_serving" || row.cluster != config::get_cluster_name() {
        return;
    }
    match super::deploys::not_serving_pods(&ctx.org, row).await {
        Ok(table) => {
            use crate::service_identity::access;
            let admin = access::org_wide_read(&ctx.org, &ctx.user).await;
            let pods_ok =
                access::evidence(&ctx.org, &ctx.user, &table.source_streams, false, admin).await;
            let status_ok =
                access::evidence(&ctx.org, &ctx.user, &table.status_streams, false, admin).await;
            table.attach(summary, pods_ok, status_ok);
        }
        Err(error) => log::warn!("[ServiceVersions] not_serving pods unavailable: {error}"),
    }
}

fn redact_compare_evidence(response: &mut Value) {
    if response["stored_verdict"]["restricted"] != true
        && response["live_verdict"]["restricted"] != true
    {
        return;
    }
    if let Some(object) = response.as_object_mut() {
        for key in super::rum_drill::SECTIONS {
            object.remove(key);
        }
    }
    if let Some(rows) = response
        .get_mut("traces")
        .and_then(|section| section.get_mut("endpoints"))
        .and_then(Value::as_array_mut)
    {
        for row in rows {
            if let Some(row) = row.as_object_mut() {
                for key in ["errors_a", "errors_b", "introduced", "early"] {
                    row.remove(key);
                }
            }
        }
    }
    for group in ["introduced", "fixed", "shared"] {
        if let Some(rows) = response
            .get_mut("rum")
            .and_then(|section| section.get_mut("error_types"))
            .and_then(|types| types.get_mut(group))
            .and_then(Value::as_array_mut)
        {
            for row in rows {
                if let Some(row) = row.as_object_mut() {
                    for key in [
                        "error_type",
                        "error_message",
                        "sample_error_id",
                        "sample_ts",
                        "sample_stack_top",
                        "page",
                    ] {
                        row.remove(key);
                    }
                }
            }
        }
    }
}

async fn baseline_deploy_times(
    ctx: &crate::service_identity::api::Context,
    names: &BTreeSet<String>,
    descriptors: &[(String, ArmWindow)],
) -> anyhow::Result<std::collections::BTreeMap<(String, VersionImage), i64>> {
    let places: BTreeSet<_> = descriptors
        .iter()
        .map(|(place, _)| place.as_str())
        .collect();
    let scopes: BTreeSet<String> = places
        .into_iter()
        .flat_map(|place| ctx.scope_keys(names, Some(place)))
        .collect();
    let mut times = std::collections::BTreeMap::new();
    for scope in &scopes {
        for row in infra::table::service_version_deploys::history(
            infra::db::get_orm_client_rw().await,
            &ctx.org,
            scope,
            None,
            1000,
        )
        .await?
        {
            let at = times
                .entry((row.where_key.clone(), row.to_identity()))
                .or_insert(i64::MIN);
            *at = (*at).max(row.at);
        }
    }
    Ok(times)
}

async fn requested_batches(
    enabled: bool,
    org: &str,
    selection: &Selection<'_>,
    descriptors: &[(String, ArmWindow)],
) -> anyhow::Result<Vec<Aggregate>> {
    if !enabled {
        return Ok(vec![]);
    }
    let selections: Vec<_> = descriptors
        .iter()
        .map(|(place, window)| Selection {
            place,
            window: *window,
            ..*selection
        })
        .collect();
    aggregate_many(
        org,
        &selections.iter().collect::<Vec<_>>(),
        COMPARE_TIMEOUT_SECS,
        false,
    )
    .await
}

fn choose_automatic_baseline(
    input: AutoInput<'_>,
) -> anyhow::Result<o2_enterprise::enterprise::service_identity::verdict::BaselineSelection> {
    use o2_enterprise::enterprise::service_identity::{
        deploys::{EntrySource, Kind, Transition},
        verdict::{self, BaselineCandidate, BaselineInput},
    };
    let AutoInput {
        ctx,
        names,
        place,
        version,
        deploy,
        previous,
        window,
        volumes,
        descriptors,
        batches,
        rules,
        signal,
        deploy_times,
    } = input;
    let mut transition = if let Some(deploy) = deploy {
        super::deploys::transition(deploy)?
    } else {
        Transition {
            deploy_key: String::new(),
            org_id: ctx.org.clone(),
            service_name: names.iter().next().cloned().unwrap_or_default(),
            where_key: place.into(),
            scope_key: String::new(),
            cluster: String::new(),
            to_version: version.version.clone(),
            to_image: version.image.clone(),
            to_version_key: String::new(),
            from_version: previous.map(|row| row.version.clone()),
            from_image: previous.and_then(|row| row.image.clone()),
            from_version_key: previous.map(|row| row.version_key.clone()),
            kind: Kind::Deploy,
            entry_source: EntrySource::Traffic,
            at: window.start,
            share_at_entry: 0.0,
            serving_versions: vec![],
            overflow_count: 0,
            source_streams: vec![],
            superseded_at: None,
            verdict_key: None,
            created_at: window.start,
            updated_at: window.end,
        }
    };
    // Global rollups need a shared region for baseline ranking.
    transition.cluster.clear();
    let label = |place: &str| {
        ctx.summaries
            .iter()
            .filter(|row| names.contains(&row.service_name) && row.where_key == place)
            .min_by_key(|row| (row.first_seen, &row.summary_key))
            .map(|row| {
                ctx.label(
                    &row.service_name,
                    &row.where_key,
                    &row.k8s_cluster,
                    &row.k8s_namespace,
                    (&row.env, row.env_source, &row.env_source_value),
                )["env"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string()
            })
            .unwrap_or_default()
    };
    let env = label(place);
    let mut candidates = Vec::new();
    for (place, bounds, aggregate) in std::iter::once((place, window, volumes)).chain(
        descriptors
            .iter()
            .zip(batches)
            .map(|((place, bounds), batch)| (place.as_str(), *bounds, Some(batch))),
    ) {
        if let Some(aggregate) = aggregate {
            let latest_total = aggregate.volumes.values().map(|(_, latest)| latest).sum();
            for (version, (requests, latest_requests)) in &aggregate.volumes {
                candidates.push(BaselineCandidate {
                    service: transition.service_name.clone(),
                    signal: signal.into(),
                    version: version.version.clone(),
                    image: version.image.clone(),
                    where_key: place.into(),
                    env: label(place),
                    cluster: String::new(),
                    window: bounds,
                    requests: *requests,
                    latest_requests: *latest_requests,
                    latest_total,
                    deploy_at: deploy_times
                        .get(&(place.to_string(), version.clone()))
                        .copied()
                        .unwrap_or(transition.at),
                });
            }
        }
    }
    Ok(verdict::baseline(&BaselineInput {
        transition: &transition,
        signal,
        env: &env,
        eval_start: window.start,
        window_end: window.end,
        scope_requests: volumes.map_or(0, |aggregate| aggregate.total),
        candidates: &candidates,
        previous: None,
        fanout_complete: true,
        rules,
    }))
}

async fn requested_aggregate(
    enabled: bool,
    org: &str,
    selection: &Selection<'_>,
) -> anyhow::Result<Aggregate> {
    if enabled {
        aggregate(org, selection).await
    } else {
        Ok(Aggregate::default())
    }
}

fn requested_signals(request: &Value) -> Result<BTreeSet<&str>, &'static str> {
    let values = request["signals"]
        .as_array()
        .filter(|values| !values.is_empty())
        .ok_or("signals must be a non-empty subset of traces and rum")?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|signal| matches!(*signal, "traces" | "rum"))
                .ok_or("unknown signal")
        })
        .collect()
}

/// The (version, image) of a requested arm; without an image, the imageless row, else the newest.
fn arm_identity(
    registry: &[config::meta::service_identity::ServiceVersionRecord],
    place: &str,
    version: &str,
    image: Option<&str>,
) -> VersionImage {
    if image.is_some() {
        return VersionImage::new(version, image);
    }
    let rows: Vec<_> = registry
        .iter()
        .filter(|r| r.where_key == place && r.version == version)
        .collect();
    if rows.is_empty() || rows.iter().any(|r| r.image.is_none()) {
        return VersionImage::new(version, None);
    }
    rows.into_iter()
        .max_by(|a, b| (a.first_seen, &a.version_key).cmp(&(b.first_seen, &b.version_key)))
        .map_or_else(|| VersionImage::new(version, None), |r| r.identity())
}

/// A pinned transition of the requested version text names the image an imageless request means.
fn pinned_identity(
    registry: &[config::meta::service_identity::ServiceVersionRecord],
    place: &str,
    version: &str,
    image: Option<&str>,
    pinned: Option<&infra::table::entity::service_version_deploys::Model>,
) -> VersionImage {
    match pinned {
        Some(row) if image.is_none() && row.to_version == version => row.to_identity(),
        _ => arm_identity(registry, place, version, image),
    }
}

/// Every visible registry row of the requested service, across its places, as `versions` reads it.
async fn registry<C: sea_orm::ConnectionTrait>(
    conn: &C,
    ctx: &crate::service_identity::api::Context,
    names: &BTreeSet<String>,
) -> Result<Vec<config::meta::service_identity::ServiceVersionRecord>, infra::errors::Error> {
    let scopes = ctx.scope_keys(names, None);
    let mut registry: Vec<_> =
        infra::table::service_versions::active_by_scopes(conn, &ctx.org, &scopes, i64::MIN)
            .await?
            .into_iter()
            .filter(|r| ctx.visible(&r.service_name, &r.where_key))
            .collect();
    registry.sort_by(|a, b| {
        b.first_seen
            .cmp(&a.first_seen)
            .then_with(|| a.version_key.cmp(&b.version_key))
    });
    Ok(registry)
}

/// The registry row a persisted verdict judged against.
fn persisted_baseline<'a>(
    registry: &'a [config::meta::service_identity::ServiceVersionRecord],
    row: &infra::table::entity::service_version_verdicts::Model,
    place: &str,
) -> Option<&'a config::meta::service_identity::ServiceVersionRecord> {
    let identity = row.baseline_identity()?;
    let place = row.baseline_where_key.as_deref().unwrap_or(place);
    registry
        .iter()
        .find(|candidate| candidate.where_key == place && candidate.identity() == identity)
}

/// The baseline's share of one batch; RUM series carry the version text only, as A's arm reads
/// them.
fn baseline_part(batch: &mut Aggregate, version: &VersionImage, rum: bool) -> Option<Aggregate> {
    let key = if rum {
        batch
            .versions
            .keys()
            .find(|key| key.version == version.version)
            .cloned()?
    } else {
        version.clone()
    };
    batch.versions.remove(&key)
}

fn governing_transition<'a>(
    history: &'a [infra::table::entity::service_version_deploys::Model],
    version: &VersionImage,
) -> Option<&'a infra::table::entity::service_version_deploys::Model> {
    history
        .iter()
        .filter(|row| row.to_identity() == *version)
        .max_by(|a, b| {
            a.at.cmp(&b.at)
                .then_with(|| b.deploy_key.cmp(&a.deploy_key))
        })
}

fn section_result(
    a: Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
    b: Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
    baseline_unavailable: bool,
    make: impl FnOnce(Aggregate, Aggregate) -> Value,
) -> Value {
    match (a, b) {
        (Ok(Ok(a)), _) if baseline_unavailable => serde_json::json!({
            "status":"complete", "insufficient":true, "reason":"baseline_unavailable",
            "observed":{"requests":a.traces.requests,"views":a.rum.views}
        }),
        (Ok(Ok(a)), Ok(Ok(b))) => make(a, b),
        (Err(_), _) | (_, Err(_)) => {
            serde_json::json!({"status":"timeout","insufficient":true,"reason":"timeout"})
        }
        _ => serde_json::json!({"status":"error","insufficient":true,"reason":"query_failed"}),
    }
}

/// "hourly" when either signal of an arm was read at whole-hour steps (D240).
fn arm_basis(
    traces: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
    rum: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
) -> &'static str {
    let hourly = |read: &Result<anyhow::Result<Aggregate>, _>| matches!(read, Ok(Ok(aggregate)) if aggregate.hourly);
    if hourly(traces) || hourly(rum) {
        "hourly"
    } else {
        "fine"
    }
}

/// An arm whose window holds no rollup row of its version is unprocessed, not zero traffic.
fn has_rollup(
    traces: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
    rum: &Result<anyhow::Result<Aggregate>, tokio::time::error::Elapsed>,
    version: &VersionImage,
) -> Value {
    match (traces, rum) {
        // RUM rows key by version text only, so they stand for every image of it.
        (Ok(Ok(traces)), Ok(Ok(rum))) => serde_json::json!(
            traces.volumes.contains_key(version)
                || rum
                    .volumes
                    .contains_key(&VersionImage::new(&version.version, None))
        ),
        _ => Value::Null,
    }
}

fn concurrent_windows(
    a: ArmWindow,
    b: ArmWindow,
    counts: (u64, u64, u64),
    rules: &o2_enterprise::enterprise::service_identity::compare::WindowRules,
) -> (ArmWindow, ArmWindow) {
    let (ca, cb) = o2_enterprise::enterprise::service_identity::compare::concurrent_share(
        (a.start, a.end),
        counts.0,
        counts.1,
        counts.2,
        rules,
    );
    (
        ArmWindow {
            coverage: ca.window.coverage,
            ..a
        },
        ArmWindow {
            coverage: cb.window.coverage,
            ..b
        },
    )
}

fn primary_volumes<'a>(
    traces: Option<&'a Aggregate>,
    rum: Option<&'a Aggregate>,
    first_requested: &str,
) -> Option<&'a Aggregate> {
    match traces {
        Some(traces) if traces.total > 0 => Some(traces),
        Some(_) if first_requested == "rum" => rum,
        Some(traces) => Some(traces),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    /// Old rollup rows as the metrics series they now are, read through the arm builder.
    fn decode(rows: &[Value], version: &VersionImage) -> anyhow::Result<Aggregate> {
        use o2_enterprise::enterprise::service_identity::signals::series as m;
        let mut families: HashMap<&'static str, Vec<super::super::metrics::SeriesIncrease>> =
            HashMap::new();
        let mut signal = "traces";
        for row in rows {
            let text = |name: &str| row[name].as_str().unwrap_or_default().to_string();
            let count = |name: &str| row[name].as_u64().unwrap_or_default() as f64;
            let span = row["row_start"]
                .as_i64()
                .zip(row["row_end"].as_i64())
                .or(Some((0, 1)));
            let series = |extra: &[(&str, String)], total: f64| {
                let mut labels = vec![
                    ("version", text("version")),
                    ("image", text("image")),
                    ("source_stream", text("source_stream")),
                ];
                labels.extend(extra.iter().cloned());
                super::super::metrics::SeriesIncrease {
                    labels: labels
                        .into_iter()
                        .map(|(name, value)| {
                            std::sync::Arc::new(config::meta::promql::value::Label {
                                name: name.to_string(),
                                value,
                            })
                        })
                        .collect(),
                    total,
                    // A series never reads more recent traffic than its own total.
                    latest: row["latest"]
                        .as_u64()
                        .map_or(total, |n| (n as f64).min(total)),
                    span,
                }
            };
            let status =
                |metric: &'static str, total: f64, errors: f64, extra: &[(&str, String)]| {
                    let ok = [extra, &[("status", "ok".to_string())]].concat();
                    let error = [extra, &[("status", "error".to_string())]].concat();
                    [
                        (metric, series(&ok, total - errors)),
                        (metric, series(&error, errors)),
                    ]
                };
            let mut out = Vec::new();
            match row["signal"].as_str().unwrap_or_default() {
                "traces" => out.extend(status(
                    m::M_REQUESTS,
                    count("requests"),
                    count("errors"),
                    &[],
                )),
                "traces_endpoint" => out.extend(status(
                    m::M_ENDPOINT_REQUESTS,
                    count("requests"),
                    count("errors"),
                    &[("operation", text("operation"))],
                )),
                "rum" => {
                    signal = "rum";
                    out.extend(status(
                        m::M_RUM_VIEWS,
                        count("views"),
                        count("error_views"),
                        &[],
                    ));
                    out.push((m::M_RUM_ERRORS, series(&[], count("errors"))));
                    out.push((m::M_RUM_SESSIONS, series(&[], count("sessions"))));
                }
                "rum_error" => {
                    signal = "rum";
                    out.push((
                        m::M_RUM_ERROR_TYPES,
                        series(
                            &[("fingerprint", text("error_fingerprint"))],
                            count("count"),
                        ),
                    ));
                }
                other => anyhow::bail!("unexpected compare signal {other}"),
            }
            for (metric, s) in out {
                families.entry(metric).or_default().push(s);
            }
        }
        Ok(super::super::arms::aggregate(signal, version, &families))
    }

    #[test]
    fn an_arm_without_an_image_reads_the_imageless_row_else_the_newest_image() {
        use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};
        let row = |image: Option<&str>, first: i64| {
            ServiceVersionObservation {
                service_name: "web".into(),
                where_key: "env:prod".into(),
                where_kind: WhereKind::Env,
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: EnvSource::Attribute,
                env_source_value: "deployment.environment=prod".into(),
                version: "2.4.0".into(),
                raw_version: None,
                version_source: "service.version".into(),
                image: image.map(str::to_string),
                image_ref: None,
                source_stream: "spans".into(),
                signal: "traces".into(),
                first_seen: first,
                last_seen: first,
            }
            .to_record("org", first)
        };
        let images = [row(Some("3f9c2ab"), 1), row(Some("9c1e4b7"), 2)];
        assert_eq!(
            arm_identity(&images, "env:prod", "2.4.0", None),
            VersionImage::new("2.4.0", Some("9c1e4b7"))
        );
        assert_eq!(
            arm_identity(&images, "env:prod", "2.4.0", Some("3f9c2ab")),
            VersionImage::new("2.4.0", Some("3f9c2ab"))
        );
        let mixed = [row(Some("3f9c2ab"), 1), row(None, 2)];
        assert_eq!(
            arm_identity(&mixed, "env:prod", "2.4.0", None),
            "2.4.0".into()
        );
        assert_eq!(
            arm_identity(&images, "env:other", "2.4.0", None),
            "2.4.0".into()
        );
        assert_eq!(
            images[0].identity(),
            VersionImage::new("2.4.0", Some("3f9c2ab"))
        );
    }

    #[test]
    fn a_pinned_transition_names_the_image_of_an_imageless_request() {
        use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};
        let row = |image: &str, first: i64| {
            ServiceVersionObservation {
                service_name: "web".into(),
                where_key: "env:prod".into(),
                where_kind: WhereKind::Env,
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: EnvSource::Attribute,
                env_source_value: "deployment.environment=prod".into(),
                version: "2.4.0".into(),
                raw_version: None,
                version_source: "service.version".into(),
                image: Some(image.to_string()),
                image_ref: None,
                source_stream: "spans".into(),
                signal: "traces".into(),
                first_seen: first,
                last_seen: first,
            }
            .to_record("org", first)
        };
        let images = [row("3f9c2ab", 1), row("9c1e4b7", 2)];
        let older = infra::table::entity::service_version_deploys::Model {
            to_version: "2.4.0".into(),
            to_image: Some("3f9c2ab".into()),
            ..Default::default()
        };
        let older_build = VersionImage::new("2.4.0", Some("3f9c2ab"));
        let newest_build = VersionImage::new("2.4.0", Some("9c1e4b7"));
        assert_eq!(
            pinned_identity(&images, "env:prod", "2.4.0", None, Some(&older)),
            older_build
        );
        assert_eq!(
            pinned_identity(&images, "env:prod", "2.4.0", None, None),
            newest_build
        );
        assert_eq!(
            pinned_identity(&images, "env:prod", "2.4.0", Some("9c1e4b7"), Some(&older)),
            newest_build
        );
        let other_text = infra::table::entity::service_version_deploys::Model {
            to_version: "2.5.0".into(),
            to_image: Some("3f9c2ab".into()),
            ..Default::default()
        };
        assert_eq!(
            pinned_identity(&images, "env:prod", "2.4.0", None, Some(&other_text)),
            newest_build
        );
    }

    #[test]
    fn an_image_arm_has_rollup_from_its_text_only_rum_rows() {
        let identity = VersionImage::new("2.4.0", Some("9c1e4b7"));
        let rum = |views: u64| serde_json::json!({"version":"2.4.0","signal":"rum","views":views,"total":views,"latest":views,"row_start":0,"row_end":10});
        for views in [10, 0] {
            assert_eq!(
                has_rollup(
                    &Ok(decode(&[], &identity)),
                    &Ok(decode(&[rum(views)], &identity)),
                    &identity
                ),
                Value::Bool(true),
                "{views} views"
            );
        }
        assert_eq!(
            has_rollup(
                &Ok(decode(&[], &identity)),
                &Ok(decode(&[], &identity)),
                &identity
            ),
            Value::Bool(false)
        );
        let other_build = serde_json::json!({"version":"2.4.0","image":"3f9c2ab","signal":"traces","requests":10,"total":10,"latest":10,"row_start":0,"row_end":10});
        assert_eq!(
            has_rollup(
                &Ok(decode(&[other_build], &identity)),
                &Ok(decode(&[], &identity)),
                &identity
            ),
            Value::Bool(false)
        );
    }

    #[test]
    fn rum_rows_count_for_every_image_of_their_version_but_trace_rows_do_not() {
        let identity = VersionImage::new("2.4.0", Some("9c1e4b7"));
        let rum = serde_json::json!({"version":"2.4.0","signal":"rum","views":10,"total":10,"latest":10,"row_start":0,"row_end":10});
        assert!(decode(&[rum], &identity).unwrap().traffic_span.is_some());
        let other_image = serde_json::json!({"version":"2.4.0","signal":"traces","requests":10,"total":10,"latest":10,"row_start":0,"row_end":10});
        assert!(
            decode(&[other_image], &identity)
                .unwrap()
                .traffic_span
                .is_none()
        );
    }

    #[test]
    fn compare_reads_each_image_of_one_version_text_as_its_own_arm() {
        let rows = [
            serde_json::json!({"version":"2.4.0","image":"3f9c2ab","signal":"traces","requests":100,"errors":1,"total":150,"latest":10,"row_start":0,"row_end":10}),
            serde_json::json!({"version":"2.4.0","image":"9c1e4b7","signal":"traces","requests":50,"errors":25,"total":150,"latest":5,"row_start":20,"row_end":30}),
            serde_json::json!({"version":"2.4.0","image":"3f9c2ab","signal":"traces_endpoint","operation":"GET /cart","source_stream":"spans","requests":100,"errors":1}),
            serde_json::json!({"version":"2.4.0","image":"9c1e4b7","signal":"traces_endpoint","operation":"POST /pay","source_stream":"spans","requests":50,"errors":25}),
        ];
        let arm = |image| {
            let read = decode(&rows, &VersionImage::new("2.4.0", Some(image))).unwrap();
            (
                read.traces.requests,
                read.traces.errors,
                read.endpoints
                    .iter()
                    .map(|endpoint| endpoint.operation.clone())
                    .collect::<Vec<_>>(),
                read.traffic_span,
                read.volumes.len(),
            )
        };
        assert_eq!(
            arm("3f9c2ab"),
            (100, 1, vec!["GET /cart".to_string()], Some((0, 10)), 2)
        );
        assert_eq!(
            arm("9c1e4b7"),
            (50, 25, vec!["POST /pay".to_string()], Some((20, 30)), 2)
        );
    }

    fn assert_compare_path(
        manual: bool,
        concurrent: bool,
        ranges: (ArmRange, ArmRange),
        expected: ((i64, i64), (i64, i64)),
    ) {
        use o2_enterprise::enterprise::service_identity::compare::{ArmBounds, WindowRules};
        let hour = 3_600_000_000;
        let a = ArmBounds {
            version: "a".into(),
            image: None,
            version_key: "a".into(),
            first_seen: 2 * hour,
            last_seen: 4 * hour - 1,
        };
        let b = ArmBounds {
            version: "b".into(),
            image: None,
            version_key: "b".into(),
            first_seen: hour,
            last_seen: hour + hour / 6 - 1,
        };
        let rules = WindowRules {
            window: 300_000_000,
            max_span: 24 * hour,
            retention_start: 0,
        };
        let (a, initial_b) = compare_windows(
            &a,
            manual.then_some(&b),
            ranges,
            concurrent.then_some((2 * hour, 4 * hour)),
            (2 * hour, 4 * hour),
            &rules,
        );
        let b = if concurrent {
            baseline_window(a, true, 0, 0)
        } else if manual {
            initial_b
        } else {
            ranges.1.map_or_else(
                || baseline_window(a, false, 2 * hour, hour),
                |(start, end)| ArmWindow {
                    start,
                    end,
                    coverage: Coverage::Ok,
                },
            )
        };
        assert_eq!(
            (
                (a.start / (hour / 6), a.end / (hour / 6)),
                (b.start / (hour / 6), b.end / (hour / 6))
            ),
            expected
        );
    }

    #[test]
    fn an_arm_without_rollup_rows_is_missing_data_not_zero_traffic() {
        let with_rows = |volume: Option<u64>| {
            let mut aggregate = Aggregate::default();
            if let Some(requests) = volume {
                aggregate.volumes.insert("1.0".into(), (requests, requests));
            }
            Ok(Ok(aggregate))
        };
        assert_eq!(
            has_rollup(&with_rows(None), &with_rows(None), &"1.0".into()),
            false
        );
        assert_eq!(
            has_rollup(&with_rows(Some(0)), &with_rows(None), &"1.0".into()),
            true
        );
        assert_eq!(
            has_rollup(&with_rows(None), &with_rows(Some(4)), &"1.0".into()),
            true
        );
        assert_eq!(
            has_rollup(&with_rows(Some(9)), &with_rows(Some(4)), &"2.0".into()),
            false
        );
        assert_eq!(
            has_rollup(
                &Ok(Err(anyhow::anyhow!("failed"))),
                &with_rows(None),
                &"1.0".into()
            ),
            Value::Null
        );
    }

    #[test]
    fn compare_windows_follow_the_mode_and_explicit_bounds() {
        let hour = 3_600_000_000;
        let (a, b) = (Some((2 * hour, 3 * hour)), Some((hour, 2 * hour)));
        // (manual, concurrent, explicit a/b, expected a/b windows in 10-minute steps)
        for (manual, concurrent, explicit, expected) in [
            (true, false, (None, None), ((23, 24), (6, 7))),
            (true, false, (a, None), ((12, 18), (6, 7))),
            (true, false, (a, b), ((12, 18), (6, 12))),
            (true, true, (None, None), ((12, 24), (12, 24))),
            (true, true, (a, b), ((12, 18), (12, 18))),
            (false, false, (None, None), ((12, 24), (6, 12))),
            (false, false, (a, b), ((12, 18), (6, 12))),
            (false, true, (a, None), ((12, 18), (12, 18))),
        ] {
            assert_compare_path(manual, concurrent, explicit, expected);
        }
    }

    #[test]
    fn manual_sequential_tail_window_ends_at_the_rollup_offset() {
        use o2_enterprise::enterprise::service_identity::compare::{ArmBounds, WindowRules};
        let hour = 3_600_000_000;
        let bounds = |first_seen, last_seen| ArmBounds {
            version: "v".into(),
            image: None,
            version_key: "v".into(),
            first_seen,
            last_seen,
        };
        let rules = WindowRules {
            window: 300_000_000,
            max_span: 24 * hour,
            retention_start: 0,
        };
        let b = bounds(hour, hour + hour / 6 - 1);
        let live = bounds(2 * hour, 4 * hour - 1);
        let (stale, _) = compare_windows(&live, Some(&b), (None, None), None, (0, 0), &rules);
        assert_eq!((stale.start, stale.end), (4 * hour - hour / 6, 4 * hour));
        let rolled = within_rollup(live.clone(), 3 * hour);
        assert_eq!(rolled.last_seen, 3 * hour - 1);
        let (a, b) = compare_windows(&rolled, Some(&b), (None, None), None, (0, 0), &rules);
        assert_eq!((a.start, a.end), (3 * hour - hour / 6, 3 * hour));
        assert_eq!((b.start, b.end), (hour, hour + hour / 6));
        assert_eq!(within_rollup(live.clone(), 5 * hour), live);
        assert_eq!(within_rollup(live, hour).last_seen, 2 * hour);
    }

    #[test]
    fn baseline_windows_refresh_and_preserve_max_span() {
        let hour = 3_600_000_000;
        let a = evaluation_window(0, 48 * hour, hour);
        assert_eq!((a.start, a.end), (0, hour));
        let explicit = ArmWindow {
            start: 2 * hour,
            end: 3 * hour,
            coverage: Coverage::Ok,
        };
        assert_eq!(baseline_window(explicit, true, 0, 0), explicit);
        let exact = ArmWindow {
            start: 123,
            end: 1_000_123,
            coverage: Coverage::Ok,
        };
        let rules = o2_enterprise::enterprise::service_identity::compare::WindowRules {
            window: 300_000_000,
            max_span: 1_000_000,
            retention_start: 0,
        };
        assert_eq!(
            concurrent_windows(exact, exact, (100, 100, 200), &rules),
            (exact, exact)
        );
        assert_eq!(baseline_window(a, false, 0, -24 * hour).span(), hour);
        assert_eq!(baseline_window(a, false, 0, -hour / 2).span(), hour / 2);
        let unavailable = baseline_window(a, false, 0, hour);
        assert_eq!((unavailable.start, unavailable.end), (0, 0));
        assert_eq!(unavailable.coverage, Coverage::AgedOut);
        for now in [300_000_000, 600_000_000, 900_000_000] {
            let a = evaluation_window(0, now, 24 * hour);
            assert_eq!(baseline_window(a, true, 0, 0), a);
            assert_eq!(a.end, now);
        }
    }

    #[test]
    fn signal_subsets_reject_empty_and_unknown_values() {
        assert!(requested_signals(&serde_json::json!({"signals":[]})).is_err());
        assert!(requested_signals(&serde_json::json!({"signals":["logs"]})).is_err());
        assert_eq!(
            requested_signals(&serde_json::json!({"signals":["rum"]})).unwrap(),
            BTreeSet::from(["rum"])
        );
    }

    #[tokio::test]
    async fn unrequested_signal_does_not_access_registry_or_search() {
        let selection = Selection {
            services: &BTreeSet::new(),
            place: "where",
            version: "v1",
            image: None,
            signal: "traces",
            streams: &BTreeSet::from(["unreadable".to_string()]),
            window: ArmWindow {
                start: 1,
                end: 2,
                coverage: o2_enterprise::enterprise::service_identity::compare::Coverage::Ok,
            },
            local: false,
            cluster: None,
            detail_from: None,
        };
        assert_eq!(
            requested_aggregate(false, "uninitialized-org", &selection)
                .await
                .unwrap()
                .total,
            0
        );
    }

    #[test]
    fn regional_history_uses_latest_transition_then_smallest_key() {
        use infra::table::entity::service_version_deploys::Model;
        let history = vec![
            Model {
                deploy_key: "a".into(),
                cluster: "east".into(),
                to_version: "v2".into(),
                at: 100,
                from_version: Some("v1".into()),
                ..Default::default()
            },
            Model {
                deploy_key: "z".into(),
                cluster: "west".into(),
                to_version: "v2".into(),
                at: 200,
                from_version: Some("v0".into()),
                ..Default::default()
            },
            Model {
                deploy_key: "b".into(),
                cluster: "north".into(),
                to_version: "v2".into(),
                at: 200,
                from_version: Some("v3".into()),
                ..Default::default()
            },
        ];
        let chosen = governing_transition(&history, &"v2".into()).unwrap();
        assert_eq!(chosen.deploy_key, "b");
        assert_eq!(chosen.from_version.as_deref(), Some("v3"));
        assert!(governing_transition(&history, &"v4".into()).is_none());
        let mut reversed = history;
        reversed.reverse();
        assert_eq!(
            governing_transition(&reversed, &"v2".into())
                .unwrap()
                .deploy_key,
            "b"
        );
    }

    #[test]
    fn surviving_section_with_persisted_baseline_is_evaluated() {
        let result = section_result(
            Ok(Ok(Aggregate::default())),
            Ok(Ok(Aggregate::default())),
            false,
            |_, _| serde_json::json!({"status":"complete","baseline":"persisted"}),
        );
        assert_eq!(result["baseline"], "persisted");
    }

    #[tokio::test]
    async fn primary_timeout_preserves_failed_section_status() {
        let timeout = tokio::time::timeout(
            std::time::Duration::ZERO,
            std::future::pending::<anyhow::Result<Aggregate>>(),
        )
        .await;
        let result = section_result(timeout, Ok(Ok(Aggregate::default())), true, |_, _| {
            panic!("failed primary cannot complete")
        });
        assert_eq!(result["status"], "timeout");
        assert_eq!(result["reason"], "timeout");
    }

    #[test]
    fn primary_baseline_uses_scope_trace_traffic_even_when_rum_is_larger() {
        let traces = decode(&[serde_json::json!({"version":"v1","signal":"traces","requests":1000,"latest":1000,"total":21000})], &"v2".into()).unwrap();
        let rum = decode(&[serde_json::json!({"version":"v0","signal":"rum","views":100000,"latest":100000,"total":110000})], &"v2".into()).unwrap();
        let selected = primary_volumes(Some(&traces), Some(&rum), "rum").unwrap();
        assert_eq!(
            selected.volumes.get(&VersionImage::from("v1")),
            Some(&(1000, 1000))
        );
        assert!(!selected.volumes.contains_key(&VersionImage::from("v0")));
        assert_eq!(traces.traces.requests, 0);
    }

    #[test]
    fn rum_only_scope_uses_rum_baseline() {
        let traces = Aggregate::default();
        let rum = decode(&[serde_json::json!({"version":"v0","signal":"rum","views":10000,"latest":10000,"total":20000})], &"v1".into()).unwrap();
        assert_eq!(
            primary_volumes(Some(&traces), Some(&rum), "rum")
                .unwrap()
                .volumes
                .get(&VersionImage::from("v0")),
            Some(&(10000, 10000))
        );
        assert!(primary_volumes(None, Some(&rum), "traces").is_none());
        assert_eq!(
            primary_volumes(Some(&traces), Some(&rum), "traces")
                .unwrap()
                .total,
            0
        );
    }

    #[test]
    fn automatic_baseline_uses_primary_canary_then_visible_env_fallback() {
        use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};
        use o2_enterprise::enterprise::service_identity::{
            compare::WindowRules, verdict::BaselineRule,
        };

        use crate::service_identity::{access::ReadableStreams, api::Context};
        let observation = ServiceVersionObservation {
            service_name: "svc".into(),
            where_key: "k8s:c/one".into(),
            where_kind: WhereKind::K8s,
            k8s_cluster: "c".into(),
            k8s_namespace: "one".into(),
            env: "prod".into(),
            env_source: EnvSource::Attribute,
            env_source_value: "deployment.environment".into(),
            version: "v2".into(),
            raw_version: Some("v2".into()),
            version_source: "service.version".into(),
            image: None,
            image_ref: None,
            source_stream: "t".into(),
            signal: "traces".into(),
            first_seen: 10,
            last_seen: 19,
        };
        let record = observation.to_record("o", 20);
        let mut other = observation.clone();
        other.where_key = "k8s:c/two".into();
        other.k8s_namespace = "two".into();
        let mut ctx = Context {
            org: "o".into(),
            user: String::new(),
            summaries: vec![
                observation.to_summary("o", &record, 20),
                other.to_summary("o", &other.to_record("o", 20), 20),
            ],
            readable: ReadableStreams {
                traces: std::collections::HashSet::from(["t".into()]),
                rum: false,
            },
            identity: Default::default(),
            aliases: Default::default(),
        };
        let deploy = infra::table::entity::service_version_deploys::Model {
            org_id: "o".into(),
            service_name: "svc".into(),
            where_key: "k8s:c/one".into(),
            cluster: "r".into(),
            to_version: "v2".into(),
            from_version: None,
            kind: "deploy".into(),
            entry_source: "traffic".into(),
            at: 10,
            serving_versions: r#"[{"version":"v1","share":0.1},{"version":"v2","share":0.9}]"#
                .into(),
            source_streams: "[]".into(),
            ..Default::default()
        };
        let names = BTreeSet::from(["svc".into()]);
        let window = ArmWindow {
            start: 10,
            end: 20,
            coverage: o2_enterprise::enterprise::service_identity::compare::Coverage::Ok,
        };
        let descriptors = vec![
            (
                "k8s:c/one".into(),
                ArmWindow {
                    start: 0,
                    end: 10,
                    ..window
                },
            ),
            ("k8s:c/two".into(), window),
        ];
        let mut primary=decode(&[serde_json::json!({"version":"v2","signal":"traces","requests":10000,"latest":10000,"total":11000}),serde_json::json!({"version":"v1","signal":"traces","requests":1000,"latest":1000,"total":11000})], &"v2".into()).unwrap();
        let mut batches=vec![decode(&[serde_json::json!({"version":"v1","signal":"traces","requests":1000,"latest":1000,"total":1000})], &"v1".into()).unwrap(),decode(&[serde_json::json!({"version":"v0","signal":"traces","requests":50000,"latest":50000,"total":50000})], &"v0".into()).unwrap()];
        let choose = |ctx: &Context, primary: &Aggregate, batches: &[Aggregate]| {
            choose_automatic_baseline(AutoInput {
                ctx,
                names: &names,
                place: "k8s:c/one",
                version: &"v2".into(),
                deploy: Some(&deploy),
                previous: None,
                window,
                volumes: Some(primary),
                descriptors: &descriptors,
                batches,
                rules: WindowRules {
                    window: 1,
                    max_span: 100,
                    retention_start: -100,
                },
                signal: "traces",
                deploy_times: &Default::default(),
            })
            .unwrap()
        };
        let selected = choose(&ctx, &primary, &batches);
        assert_eq!(selected.rule, BaselineRule::Canary);
        assert_eq!(selected.version.as_deref(), Some("v1"));
        primary.volumes.insert("v1".into(), (1, 1));
        batches[0].volumes.insert("v1".into(), (1, 1));
        let selected = choose(&ctx, &primary, &batches);
        assert_eq!(selected.rule, BaselineRule::EnvFallback);
        assert_eq!(selected.version.as_deref(), Some("v0"));
        assert_eq!(selected.where_key.as_deref(), Some("k8s:c/two"));
        ctx.summaries.retain(|row| row.where_key == "k8s:c/one");
        assert_eq!(choose(&ctx, &primary, &batches).rule, BaselineRule::None);
    }
    #[test]
    fn restricted_compare_omits_optional_evidence() {
        let mut response = serde_json::json!({"stored_verdict":{"restricted":true},"inp_targets":{},"rum_breakdown":{},"pages":{},"rum_series":{},"traces":{"endpoints":[{"operation":"op","errors_a":3,"errors_b":0,"introduced":true,"early":true}]},"rum":{"error_types":{"introduced":[{"fingerprint":"fp","error_type":"TypeError","error_message":"secret","sample_error_id":"id","sample_ts":1,"sample_stack_top":"stack","page":"/private"}]}}});
        redact_compare_evidence(&mut response);
        for key in super::super::rum_drill::SECTIONS {
            assert!(response.get(key).is_none(), "{key}");
        }
        assert_eq!(
            response["traces"]["endpoints"][0],
            serde_json::json!({"operation":"op"})
        );
        assert_eq!(
            response["rum"]["error_types"]["introduced"][0],
            serde_json::json!({"fingerprint":"fp"})
        );
    }

    #[test]
    fn coarse_detail_sections_make_no_introduced_or_fixed_claim() {
        let traces = serde_json::json!({"insufficient":false,"endpoints":[{"operation":"GET /a","status":"a_only","errors_a":3,"errors_b":0,"introduced":true,"early":false}]});
        let rum = serde_json::json!({"insufficient":false,"error_types":{"introduced":[{"fingerprint":"new","count":2}],"fixed":[{"fingerprint":"old","count":1}],"shared":[{"fingerprint":"both","count_a":1,"count_b":1,"delta":0}],"insufficient":false,"early":false}});
        let (mut coarse_traces, mut coarse_rum) = (traces.clone(), rum.clone());
        detail_coverage(&mut coarse_traces, DetailBasis::Coarse);
        detail_coverage(&mut coarse_rum, DetailBasis::Coarse);
        assert_eq!(
            coarse_traces["endpoint_detail"],
            serde_json::json!({"status":"insufficient","reason":"detail_coarse"})
        );
        assert!(coarse_traces["endpoints"][0].get("introduced").is_none());
        assert_eq!(coarse_traces["endpoints"][0]["errors_a"], 3);
        assert_eq!(coarse_traces["insufficient"], false);
        assert_eq!(
            coarse_rum["error_detail"],
            serde_json::json!({"status":"insufficient","reason":"detail_coarse"})
        );
        assert_eq!(
            coarse_rum["error_types"]["introduced"],
            serde_json::json!([])
        );
        assert_eq!(coarse_rum["error_types"]["fixed"], serde_json::json!([]));
        assert_eq!(coarse_rum["error_types"]["insufficient"], true);
        assert_eq!(
            coarse_rum["error_types"]["shared"],
            rum["error_types"]["shared"]
        );
        let (mut fine_traces, mut fine_rum) = (traces.clone(), rum.clone());
        detail_coverage(&mut fine_traces, DetailBasis::Fine);
        detail_coverage(&mut fine_rum, DetailBasis::Fine);
        assert_eq!(
            fine_traces["endpoint_detail"],
            serde_json::json!({"status":"ok","reason":null})
        );
        assert_eq!(fine_traces["endpoints"], traces["endpoints"]);
        assert_eq!(fine_rum["error_detail"]["status"], "ok");
        assert_eq!(fine_rum["error_types"], rum["error_types"]);
    }

    #[test]
    fn verdict_inputs_never_turn_an_existing_error_into_a_new_one() {
        use o2_enterprise::enterprise::service_identity::{
            compare::{ArmInput, TraceArm},
            deploys::Transition,
            verdict::{self, BaselineRule, BaselineSelection, EvaluationInput, Verdict},
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"s","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"v2","to_version_key":"v2-key","from_version":"v1","from_version_key":"v1-key",
            "kind":"deploy","entry_source":"traffic","at":7_200_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"verdict","created_at":0,"updated_at":0
        })).unwrap();
        let (wb, wa) = (
            ArmWindow {
                start: 3_600_000_000,
                end: 7_200_000_000,
                coverage: Coverage::Ok,
            },
            ArmWindow {
                start: 7_200_000_000,
                end: 10_800_000_000,
                coverage: Coverage::Ok,
            },
        );
        let endpoint = |operation: &str, requests, errors| EndpointArm {
            operation: operation.into(),
            source_stream: "t".into(),
            requests,
            errors,
            latency: None,
        };
        let arm = |endpoints: Vec<EndpointArm>, errors: &[(&str, u64)], gaps| Aggregate {
            traces: TraceArm {
                requests: 5000,
                errors: 50,
                latency: None,
            },
            rum: RumArm {
                views: 5000,
                error_views: 50,
                errors: 50,
                error_types: errors.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
                ..Default::default()
            },
            endpoints,
            detail_gaps: gaps,
            ..Default::default()
        };
        let a = arm(
            vec![endpoint("GET /err", 1000, 50), endpoint("GET /ok", 4000, 0)],
            &[("fp", 50)],
            0,
        );
        let coarse_b = arm(vec![endpoint("GET /ok", 4000, 0)], &[], 3);
        let mut hourly_b = arm(
            vec![endpoint("GET /err", 1000, 50), endpoint("GET /ok", 4000, 0)],
            &[("fp", 50)],
            0,
        );
        hourly_b.traffic_span = Some((wb.start + 1_800_000_000, wb.end));
        hourly_b.detail_span = Some((wb.start, wb.end));
        let mut clean_b = arm(vec![endpoint("GET /ok", 4000, 0)], &[], 0);
        clean_b.traffic_span = hourly_b.traffic_span;
        clean_b.detail_span = hourly_b.detail_span;
        let judge = |b: &Aggregate, basis: Option<DetailBasis>, signal: &str| {
            let (endpoints_new, endpoints_base, rum_a, rum_b) = match basis {
                Some(basis) => (
                    basis.endpoints(&a),
                    basis.endpoints(b),
                    basis.rum(&a),
                    basis.rum(b),
                ),
                None => (
                    a.endpoints.clone(),
                    b.endpoints.clone(),
                    a.rum.clone(),
                    b.rum.clone(),
                ),
            };
            verdict::evaluate(&EvaluationInput {
                transition: &transition,
                baseline: BaselineSelection {
                    rule: BaselineRule::Previous,
                    version: Some("v1".into()),
                    where_key: Some("w".into()),
                    window: Some(wb),
                    ..Default::default()
                },
                traces: (signal == "traces").then(|| {
                    (
                        ArmInput {
                            window: wa,
                            data: Some(a.traces.clone()),
                        },
                        ArmInput {
                            window: wb,
                            data: Some(b.traces.clone()),
                        },
                    )
                }),
                rum: (signal == "rum").then_some((
                    ArmInput {
                        window: wa,
                        data: Some(rum_a),
                    },
                    ArmInput {
                        window: wb,
                        data: Some(rum_b),
                    },
                )),
                endpoints_new,
                endpoints_base,
                new_windows: 12,
                eval_start: wa.start,
                now: wa.end,
                env: "prod",
                not_serving: Default::default(),
                prior: None,
                from_frozen: None,
            })
            .verdict
        };
        let flagged = |verdict| matches!(verdict, Verdict::Watch | Verdict::Regressed);
        for signal in ["traces", "rum"] {
            assert!(
                flagged(judge(&coarse_b, None, signal)),
                "{signal}: raw inputs"
            );
            let coarse = DetailBasis::of(&a, &coarse_b);
            assert_eq!(coarse, DetailBasis::Coarse);
            assert!(
                !flagged(judge(&coarse_b, Some(coarse), signal)),
                "{signal}: coarse"
            );
            let clean = DetailBasis::of(&a, &clean_b);
            assert!(
                flagged(judge(&clean_b, Some(clean), signal)),
                "{signal}: presence still flags"
            );
        }
    }

    #[test]
    fn a_manual_baseline_is_judged_like_the_automatic_rule_of_its_mode() {
        use o2_enterprise::enterprise::service_identity::verdict::BaselineRule;
        assert_eq!(live_rule("manual", true), BaselineRule::Canary);
        assert_eq!(live_rule("manual", false), BaselineRule::Previous);
        assert_eq!(live_rule("canary", true), BaselineRule::Canary);
        assert_eq!(
            live_rule("previous_by_first_seen", false),
            BaselineRule::Previous
        );
        assert_eq!(live_rule("env_fallback", true), BaselineRule::EnvFallback);
        assert_eq!(live_rule("none", false), BaselineRule::None);
    }

    #[test]
    fn live_windows_count_the_configured_window_length() {
        let window = ArmWindow {
            start: 600_000_000,
            end: 720_000_000,
            coverage: Coverage::Ok,
        };
        assert_eq!(closed_windows(window, 60_000_000), 2);
        assert_eq!(closed_windows(window, 300_000_000), 0);
        assert_eq!(closed_windows(window, 0), 120_000_000);
    }

    #[test]
    fn an_arm_read_in_whole_hours_reports_the_hourly_basis() {
        let read = |hourly| {
            Ok(Ok(Aggregate {
                hourly,
                ..Aggregate::default()
            }))
        };
        assert_eq!(arm_basis(&read(false), &read(false)), "fine");
        assert_eq!(arm_basis(&read(false), &read(true)), "hourly");
        assert_eq!(arm_basis(&read(true), &read(false)), "hourly");
    }

    fn seen(
        service: &str,
        version: &str,
        image: Option<&str>,
        at: i64,
    ) -> config::meta::service_identity::ServiceVersionObservation {
        use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};
        ServiceVersionObservation {
            service_name: service.into(),
            where_key: "k8s:c/ns".into(),
            where_kind: WhereKind::K8s,
            k8s_cluster: "c".into(),
            k8s_namespace: "ns".into(),
            env: "prod".into(),
            env_source: EnvSource::Attribute,
            env_source_value: "deployment.environment".into(),
            version: version.into(),
            raw_version: Some(version.into()),
            version_source: "service.version".into(),
            image: image.map(Into::into),
            image_ref: image.map(|image| format!("reg/app@{image}")),
            source_stream: "t".into(),
            signal: "traces".into(),
            first_seen: at,
            last_seen: at + 9,
        }
    }

    #[tokio::test]
    async fn registry_and_deploy_history_match_canonical_service_spellings() {
        use infra::table::entity::service_version_deploys as deploys;
        use sea_orm::{EntityTrait, IntoActiveModel};

        use crate::service_identity::{access::ReadableStreams, api::Context};
        let (v1, v2) = (
            seen("checkout.service", "v1", None, 10),
            seen("Checkout", "v2", None, 20),
        );
        let rows = vec![v1.to_record("o", 30), v2.to_record("o", 30)];
        let ctx = Context {
            org: "o".into(),
            user: String::new(),
            summaries: vec![v2.to_summary("o", &rows[1], 30)],
            readable: ReadableStreams {
                traces: std::collections::HashSet::from(["t".into()]),
                rum: false,
            },
            identity: Default::default(),
            aliases: Default::default(),
        };
        let names = ctx.names("Checkout", Some("k8s:c/ns"));
        for conn in
            infra::table::service_versions::sqlite_and_postgres_for_tests("compare_casing").await
        {
            infra::table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            infra::table::service_versions::merge_upsert_many(&conn, rows.clone())
                .await
                .unwrap();
            let registry = registry(&conn, &ctx, &names).await.unwrap();
            let v1 = arm_identity(&registry, "k8s:c/ns", "v1", None);
            assert!(registry.iter().any(|r| r.identity() == v1), "{registry:?}");
            deploys::Entity::insert(
                deploys::Model {
                    org_id: "o".into(),
                    deploy_key: "deploy".into(),
                    service_name: "checkout.service".into(),
                    where_key: "k8s:c/ns".into(),
                    scope_key: rows[0].scope_key.clone(),
                    ..Default::default()
                }
                .into_active_model(),
            )
            .exec(&conn)
            .await
            .unwrap();
            for place in [None, Some("k8s:c/ns")] {
                let history = super::super::reads::deploy_history(&ctx, "Checkout", place)
                    .all(&conn)
                    .await
                    .unwrap();
                assert_eq!(history.len(), 1);
                assert_eq!(history[0].service_name, "checkout.service");
            }
        }
    }

    #[test]
    fn a_persisted_baseline_comes_from_its_own_image_build() {
        let registry = [
            seen("svc", "v1", Some("3f9c2ab"), 10).to_record("o", 50),
            seen("svc", "v1", Some("9c1e4b7"), 20).to_record("o", 50),
        ];
        let row = infra::table::entity::service_version_verdicts::Model {
            baseline_version: Some("v1".into()),
            baseline_image: Some("9c1e4b7".into()),
            ..Default::default()
        };
        let found = persisted_baseline(&registry, &row, "k8s:c/ns").unwrap();
        assert_eq!(
            (found.first_seen, found.image_ref.as_deref()),
            (20, Some("reg/app@9c1e4b7"))
        );
    }

    #[test]
    fn an_imaged_baseline_keeps_the_rum_traffic_of_its_version_text() {
        let mut batch = Aggregate::default();
        let mut rum = Aggregate::default();
        rum.rum.views = 5;
        batch.versions.insert(VersionImage::new("v1", None), rum);
        let part = baseline_part(&mut batch, &VersionImage::new("v1", Some("5d0e1f2")), true);
        assert_eq!(part.map(|arm| arm.rum.views), Some(5));
    }
}
